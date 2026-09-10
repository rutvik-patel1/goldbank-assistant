import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../lib/config';
import { parseFile } from '../lib/pipeline/parse';
import { normalizeTitle, promoteHeadings } from '../lib/pipeline/headings';

const EXPECTED: Record<string, string[]> = {
  'goldbank.co.uk_legal_terms-of-service.json': [
    'Acceptable Use',
    'We May Make Changes to These Terms',
    'By Using Our Site You Accept These Terms',
    "Which Country's Laws Apply to a Dispute",
  ],
  'goldbank.co.uk_legal_privacy-policy.json': [],
};

async function main() {
  const files = (await readdir(paths.corpus)).filter((f) => f.endsWith('.json')).sort();
  let failed = false;

  for (const f of files) {
    let doc;
    try {
      [doc] = await parseFile(await readFile(join(paths.corpus, f)), f);
    } catch (e) {
      console.log(`${f.padEnd(46)} SKIPPED (${(e as Error).message})`);
      continue;
    }
    const { markdown, anchors, promoted } = promoteHeadings(doc.markdown);
    const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)];
    console.log(
      `${f.padEnd(46)} promoted=${String(promoted.length).padStart(3)} ` +
      `headings=${String(headings.length).padStart(3)} anchors=${String(Object.keys(anchors).length).padStart(3)}`,
    );

    for (const want of EXPECTED[f] ?? []) {
      const got = promoted.some((p) => normalizeTitle(p) === normalizeTitle(want));
      if (!got) {
        failed = true;
        console.log(`  FAIL expected section not recovered: "${want}"`);
      }
    }
    if (f in EXPECTED) {
      const sample = promoted.slice(0, 8).map((p) => `"${p}"`).join(', ');
      console.log(`  promoted sample: ${sample}`);
      const anchorSample = Object.entries(anchors).slice(0, 3)
        .map(([k, v]) => `${k} -> #${v}`).join(' | ');
      console.log(`  anchor sample:   ${anchorSample || '(none)'}`);
    }
  }

  console.log(failed ? '\nHEADING RECOVERY FAILED' : '\nAll expected sections recovered.');
  if (failed) process.exit(1);
}

main();
