import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../lib/config';
import { parseFile } from '../lib/pipeline/parse';
import { chunkDocument, embeddingText } from '../lib/pipeline/chunk';
import { enrichChunks } from '../lib/pipeline/enrich';

async function main() {
  const f = 'goldbank.co.uk_legal_returns-policy.json';
  const [doc] = await parseFile(await readFile(join(paths.corpus, f)), f);
  const chunks = chunkDocument(doc, 'returns-policy').slice(0, 4);

  const t0 = Date.now();
  const enriched = await enrichChunks(chunks, (d, t) => process.stdout.write(`\r${d}/${t}`));
  console.log(`\nenriched ${enriched.length} chunks in ${Date.now() - t0}ms`);

  for (const c of enriched) {
    console.log(`\n--- ${c.headingPath.join(' › ')} [${c.kind}]`);
    console.log(`summary:   ${c.enrichment?.summary ?? '(none)'}`);
    console.log(`questions: ${(c.enrichment?.hypotheticalQuestions ?? []).join(' | ')}`);
    console.log(`keywords:  ${(c.enrichment?.keywords ?? []).join(', ')}`);
  }

  console.log(`\nembeddingText() sample (first 400 chars):\n${embeddingText(enriched[0]).slice(0, 400)}`);

  const t1 = Date.now();
  await enrichChunks(chunks);
  console.log(`\ncache re-run took ${Date.now() - t1}ms (expect < 100ms)`);
}

main();
