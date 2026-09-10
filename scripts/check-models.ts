import { config } from '../lib/config';
import { requireApiKey } from '../lib/gemini';

async function main() {
  const key = requireApiKey();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`,
  );
  if (!res.ok) {
    throw new Error(`ListModels failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    models?: { name: string; supportedGenerationMethods?: string[] }[];
  };
  const names = (body.models ?? []).map((m) => m.name.replace(/^models\//, ''));

  let ok = true;
  for (const [label, wanted] of [
    ['chat', config.CHAT_MODEL],
    ['embedding', config.EMBEDDING_MODEL],
  ] as const) {
    if (names.includes(wanted)) {
      console.log(`OK    ${label}: ${wanted}`);
    } else {
      ok = false;
      const near = names.filter((n) => n.includes(wanted.split('-')[1] ?? '')).slice(0, 12);
      console.error(`FAIL  ${label}: "${wanted}" not available.`);
      console.error(`      candidates: ${near.join(', ') || names.slice(0, 20).join(', ')}`);
    }
  }

  // Confirm the embedding endpoint really returns the configured dimensionality.
  const { embedQuery } = await import('../lib/gemini');
  const v = await embedQuery('gold bullion delivery');
  console.log(`OK    embedding dimensions after conform(): ${v.length}`);

  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
