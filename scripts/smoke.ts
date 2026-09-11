import { config } from '../lib/config';
import { listDocuments } from '../lib/manifest';
import { getStore } from '../lib/store';
import { retrieve } from '../lib/rag/retrieve';
import { buildContext } from '../lib/rag/context';
import { streamAnswer, validateCitations } from '../lib/rag/answer';

const GOLDEN: { q: string; expectDoc: RegExp; expectText: RegExp }[] = [
  {
    q: 'How does the points system work?',
    expectDoc: /Frequently Asked/i,
    expectText: /1 point for every £1/i,
  },
  {
    q: 'Do you ship outside the UK?',
    expectDoc: /Frequently Asked|Delivery/i,
    expectText: /(do not|don't|only).*(UK|mainland)/i,
  },
  {
    q: 'Is there a fee if I cancel my order?',
    expectDoc: /Frequently Asked|Terms|Returns/i,
    expectText: /£100|cancellation fee/i,
  },
];

async function main() {
  const docs = await listDocuments();
  const store = await getStore();
  console.log(`documents: ${docs.length}  vectors: ${await store.count()}  ` +
              `store: ${config.VECTOR_STORE}\n`);
  if (docs.filter((d) => d.status === 'ready').length === 0) {
    throw new Error('index is empty — run "npm run seed" first');
  }

  let failed = 0;
  for (const c of GOLDEN) {
    const { chunks, gated } = await retrieve(c.q);
    const { context, citations } = buildContext(chunks);

    let raw = '';
    if (!gated) for await (const t of streamAnswer(c.q, context)) raw += t;
    const { answer, used } = validateCitations(raw, citations);

    const docsCited = [...new Set(used.map((u) => u.documentTitle))];
    const docOk = docsCited.some((d) => c.expectDoc.test(d));
    const textOk = c.expectText.test(answer);
    const citedOk = used.length > 0;

    console.log(`Q: ${c.q}`);
    console.log(`A: ${answer.replace(/\n+/g, ' ').slice(0, 220)}…`);
    console.log(`   cited: ${docsCited.join(' | ') || '(none)'}`);
    console.log(`   ${docOk ? 'OK  ' : 'FAIL'} cites an expected document`);
    console.log(`   ${textOk ? 'OK  ' : 'FAIL'} answer contains ${c.expectText}`);
    console.log(`   ${citedOk ? 'OK  ' : 'FAIL'} answer carries at least one citation\n`);
    if (!docOk || !textOk || !citedOk) failed++;
  }

  console.log(failed === 0 ? 'SMOKE PASSED' : `SMOKE FAILED (${failed}/${GOLDEN.length})`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
