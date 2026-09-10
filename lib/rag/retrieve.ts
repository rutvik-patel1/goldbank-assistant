import { config } from '../config';
import { embedQuery } from '../gemini';
import { assertDimensions, getStore } from '../store';
import type { ScoredChunk } from '../types';

export interface RetrievalResult {
  chunks: ScoredChunk[];
  gated: boolean;
  topScore: number;
}

/**
 * Reunite chunks that were split from one oversized section. A clause cut in
 * two mid-obligation must reach the model whole.
 */
async function expandSiblings(hits: ScoredChunk[]): Promise<ScoredChunk[]> {
  const store = await getStore();
  const byId = new Map(hits.map((c) => [c.id, c]));

  for (const hit of hits) {
    if (hit.partIndex === undefined || hit.partCount === undefined) continue;
    const span = hit.partCount;
    const from = Math.max(0, hit.ordinal - hit.partIndex);
    const siblings = await store.getByOrdinalRange(hit.documentId, from, from + span - 1);
    for (const s of siblings) {
      if (byId.has(s.id)) continue;
      // Siblings inherit a slightly discounted score so ordering stays sensible.
      byId.set(s.id, { ...s, score: hit.score * 0.95 });
    }
  }
  return [...byId.values()];
}

export async function retrieve(query: string): Promise<RetrievalResult> {
  await assertDimensions();
  const store = await getStore();

  const vector = await embedQuery(query);
  const hits = await store.search(vector, config.TOP_K);

  const topScore = hits.length ? hits[0].score : 0;
  if (hits.length === 0 || topScore < config.MIN_SCORE) {
    return { chunks: [], gated: true, topScore };
  }

  const expanded = await expandSiblings(hits);
  return { chunks: expanded, gated: false, topScore };
}
