import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../lib/config';
import { parseFile } from '../lib/pipeline/parse';
import { chunkDocument } from '../lib/pipeline/chunk';
import { countTokens } from '../lib/tokens';
import type { Chunk } from '../lib/types';

function tableIntact(c: Chunk): boolean {
  const rows = c.text.split('\n').filter((l) => l.trim().startsWith('|'));
  if (rows.length === 0) return true;
  // A split table shows as a chunk that begins or ends mid-table.
  const firstIsRow = c.text.trim().split('\n')[0].trim().startsWith('|');
  return !(firstIsRow && rows.length === 1);
}

async function main() {
  const files = (await readdir(paths.corpus)).filter((f) => f.endsWith('.json')).sort();
  let failed = false;
  let total = 0;

  for (const f of files) {
    let doc;
    try {
      [doc] = await parseFile(await readFile(join(paths.corpus, f)), f);
    } catch (e) {
      console.log(`${f.padEnd(46)} SKIPPED (parseFile refused: ${(e as Error).message})`);
      continue;
    }
    const chunks = chunkDocument(doc, f.replace(/\.json$/, ''));
    total += chunks.length;

    const byKind = chunks.reduce<Record<string, number>>((acc, c) => {
      acc[c.kind] = (acc[c.kind] ?? 0) + 1;
      return acc;
    }, {});
    const maxTok = Math.max(0, ...chunks.map((c) => countTokens(c.text)));
    console.log(
      `${f.padEnd(46)} chunks=${String(chunks.length).padStart(3)} ` +
      `maxTok=${String(maxTok).padStart(4)} ${JSON.stringify(byKind)}`,
    );

    // Every split family must occupy consecutive ordinals with partIndex
    // counting from 0, or Task 9's sibling expansion stitches in foreign text.
    for (const c of chunks) {
      if (c.partIndex !== undefined && c.partCount !== undefined) {
        const first = c.ordinal - c.partIndex;
        const partCount = c.partCount;
        const family = chunks.filter((x) => x.ordinal >= first && x.ordinal < first + partCount);
        const contiguous =
          family.length === partCount &&
          family.every((x, i) => x.partIndex === i && x.headingPath.join('>') === c.headingPath.join('>'));
        if (!contiguous) {
          failed = true;
          console.log(`  FAIL split family broken at ${c.id}: ordinal=${c.ordinal} ` +
                      `partIndex=${c.partIndex}/${c.partCount} resolved ${family.length} siblings`);
        }
      }
      if (!tableIntact(c)) {
        failed = true;
        console.log(`  FAIL table split across chunk boundary: ${c.id}`);
      }
      if (c.headingPath.length === 0) {
        failed = true;
        console.log(`  FAIL empty headingPath: ${c.id}`);
      }
    }

    if (f.endsWith('faqs.json')) {
      const qa = chunks.filter((c) => c.kind === 'qa');
      if (qa.length < 16) {
        failed = true;
        console.log(`  FAIL expected >=16 qa chunks in faqs, got ${qa.length}`);
      }
      const points = qa.find((c) => /how does the points system work/i.test(c.question ?? ''));
      if (!points) {
        failed = true;
        console.log('  FAIL "How does the points system work?" is not its own qa chunk');
      } else {
        const oneQuestion = (points.text.match(/\?/g) ?? []).length <= 2;
        console.log(`  points chunk: ${points.text.length} chars, single-question=${oneQuestion}`);
        if (!/1 point for every £1/i.test(points.text)) {
          failed = true;
          console.log('  FAIL points chunk does not contain its own answer');
        }
      }
    }
  }

  console.log(`\ntotal chunks: ${total}`);
  console.log(failed ? 'CHUNKING FAILED' : 'Chunking assertions passed.');
  if (failed) process.exit(1);
}

main();
