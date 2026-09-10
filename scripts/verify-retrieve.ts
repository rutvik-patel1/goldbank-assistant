import { condenseQuery } from '../lib/rag/condense';
import { retrieve } from '../lib/rag/retrieve';
import { buildContext } from '../lib/rag/context';
import { config } from '../lib/config';
import type { ChatTurn } from '../lib/types';

const CASES: { q: string; expectDoc: RegExp }[] = [
  { q: 'How do I earn points when I sell gold to you?', expectDoc: /FAQ/i },
  { q: 'Do you deliver outside the UK?',                expectDoc: /FAQ|Delivery/i },
  { q: 'What happens if I cancel my order?',            expectDoc: /FAQ|Terms|Returns/i },
  { q: 'Can I get my money back on a purchase?',        expectDoc: /Returns|Terms|FAQ/i },
  { q: 'What cookies does the site set?',               expectDoc: /Cookie/i },
];

async function main() {
  let failed = false;

  for (const c of CASES) {
    const { chunks, gated, topScore } = await retrieve(c.q);
    const { context, citations } = buildContext(chunks);
    const docs = [...new Set(citations.map((x) => x.documentTitle))];
    const hit = docs.some((d) => c.expectDoc.test(d));

    console.log(`\nQ: ${c.q}`);
    console.log(`   top=${topScore.toFixed(3)} gated=${gated} chunks=${chunks.length} ` +
                `contextTokens≈${Math.round(context.length / 4)}`);
    console.log(`   docs: ${docs.join(' | ')}`);
    console.log(`   [1] ${citations[0]?.headingPath.join(' › ') ?? '(none)'}` +
                `${citations[0]?.anchor ? ` #${citations[0].anchor}` : ''}`);
    if (gated || !hit) {
      failed = true;
      console.log(`   FAIL expected a document matching ${c.expectDoc}`);
    }
  }

  // The gate must fire on something genuinely absent from the corpus.
  const off = await retrieve('What is the airspeed velocity of an unladen swallow?');
  console.log(`\noff-topic: top=${off.topScore.toFixed(3)} gated=${off.gated} ` +
              `(MIN_SCORE=${config.MIN_SCORE})`);
  if (!off.gated) {
    console.log('   NOTE gate did not fire — consider raising MIN_SCORE');
  }

  // Condensation must resolve a pronoun-only follow-up.
  const turns: ChatTurn[] = [
    { role: 'user', content: 'How long does delivery take?' },
    { role: 'assistant', content: 'Standard delivery takes 2-5 working days.' },
  ];
  const condensed = await condenseQuery(turns, 'and what about outside the UK?');
  console.log(`\ncondensed: "${condensed}"`);
  if (!/uk|deliver|ship/i.test(condensed)) {
    failed = true;
    console.log('   FAIL condensed query lost the delivery subject');
  }

  console.log(failed ? '\nRETRIEVAL FAILED' : '\nRetrieval assertions passed.');
  if (failed) process.exit(1);
}

main();
