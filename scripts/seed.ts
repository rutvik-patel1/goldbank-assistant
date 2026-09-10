import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config, paths } from '../lib/config';
import { assertDimensions, getStore } from '../lib/store';
import { listDocuments } from '../lib/manifest';
import { ingestBuffer, type IngestEvent } from '../lib/pipeline/ingest';

async function filesToIngest(target: string): Promise<[string, Buffer][]> {
  const s = await stat(target);
  if (s.isFile()) return [[target.split('/').pop()!, await readFile(target)]];
  const names = (await readdir(target)).filter((n) =>
    config.SUPPORTED_EXTENSIONS.some((e) => n.toLowerCase().endsWith(e)),
  );
  return Promise.all(names.sort().map(async (n) => [n, await readFile(join(target, n))] as [string, Buffer]));
}

async function main() {
  const target = process.argv[2] ?? paths.corpus;
  console.log(`seeding from: ${target}`);
  console.log(`store: ${config.VECTOR_STORE}  model: ${config.CHAT_MODEL}  ` +
              `embeddings: ${config.EMBEDDING_MODEL}@${config.EMBEDDING_DIMENSIONS}  ` +
              `enrichment: ${config.ENRICHMENT}`);
  await assertDimensions();

  const files = await filesToIngest(target);
  console.log(`${files.length} file(s)\n`);

  let ok = 0, failed = 0, skipped = 0, refusedCount = 0;
  for (const [name, buf] of files) {
    const emit = (e: IngestEvent) => {
      if (e.type === 'status' && e.done !== undefined) {
        process.stdout.write(`\r  ${name}: ${e.stage} ${e.done}/${e.total}   `);
      } else if (e.type === 'status') {
        process.stdout.write(`\r  ${name}: ${e.stage}${e.chunks ? ` (${e.chunks} chunks)` : ''}   `);
      } else if (e.type === 'done') {
        console.log(`\r  ${name}: ready — ${e.chunks} chunks in ${(e.ms / 1000).toFixed(1)}s`);
      } else if (e.type === 'skipped') {
        console.log(`\r  ${name}: skipped — ${e.reason}`);
      } else {
        console.log(`\r  ${name}: FAILED — ${e.message}`);
      }
    };
    for (const r of await ingestBuffer(buf, name, emit)) {
      // A page the loaders deliberately reject (e.g. a scraped 404) is refused
      // input, not a broken pipeline — it must not fail the seed run.
      if (r.error && /error page|HTTP 4\d\d/i.test(r.error)) refusedCount++;
      else if (r.error) failed++;
      else if (r.skipped) skipped++;
      else ok++;
    }
  }

  const store = await getStore();
  const docs = await listDocuments();
  console.log(`\nindexed ${ok} document(s), skipped ${skipped}, refused ${refusedCount}, failed ${failed}`);
  console.log(`manifest: ${docs.length} record(s), ${docs.filter((d) => d.status === 'ready').length} ready`);
  console.log(`vectors in store: ${await store.count()}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
