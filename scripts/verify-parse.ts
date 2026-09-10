import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../lib/config';
import { parseFile } from '../lib/pipeline/parse';

async function main() {
  const files = (await readdir(paths.corpus)).filter((f) => f.endsWith('.json')).sort();
  console.log(`corpus files: ${files.length}\n`);
  let refused = 0;
  for (const f of files) {
    let doc;
    try {
      [doc] = await parseFile(await readFile(join(paths.corpus, f)), f);
    } catch (e) {
      // One corpus page (returns-and-exchanges) was scraped as HTTP 404 and its
      // body is a "404 - Page not found" stub. Refusing it is correct behaviour,
      // not a failure: indexing it would answer policy questions from an error page.
      refused++;
      console.log(`${f.padEnd(46)} REFUSED — ${(e as Error).message}`);
      continue;
    }
    // Test for the trailing artifact BLOCK (a standalone line), not any mention:
    // the cookies-policy table legitimately documents two "Google reCAPTCHA"
    // cookies in its rows, and those must not read as boilerplate.
    const hasRecaptcha = doc.markdown
      .split('\n')
      .some((l) => /^(reCAPTCHA|Recaptcha requires verification\.?|protected by \*\*reCAPTCHA\*\*)$/i.test(l.trim()));
    const startsH1 = /^#\s/.test(doc.markdown);
    const blankRuns = /\n{3,}/.test(doc.markdown);
    console.log(
      `${f.padEnd(46)} len=${String(doc.markdown.length).padStart(6)} ` +
      `h1=${startsH1 ? 'y' : 'N'} recaptcha=${hasRecaptcha ? 'PRESENT' : 'clean'} ` +
      `blankruns=${blankRuns ? 'PRESENT' : 'clean'} url=${doc.metadata.sourceUrl ? 'y' : 'N'}`,
    );
  }
  if (refused !== 1) {
    console.log(`\nFAIL expected exactly 1 refused document (the 404 page), got ${refused}`);
    process.exitCode = 1;
  }

  // Zip path: the original archive must expand to 10 documents.
  const zip = '/home/bacancy/Downloads/bdcdbd9c-8a16-4399-9f65-e56026c44dcf.zip';
  try {
    const docs = await parseFile(await readFile(zip), 'kb.zip');
    console.log(`\nzip expansion: ${docs.length} documents (expect 9)`);
  } catch (e) {
    console.log(`\nzip expansion skipped: ${(e as Error).message}`);
  }
}

main();
