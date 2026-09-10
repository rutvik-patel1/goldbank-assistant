import pLimit from 'p-limit';
import { config } from '../config';
import { embedTexts, isRateLimit } from '../gemini';
import type { Chunk, EmbeddedChunk } from '../types';
import { embeddingText } from './chunk';

async function embedBatchWithRetry(texts: string[]): Promise<number[][]> {
  let attempt = 0;
  for (;;) {
    try {
      return await embedTexts(texts);
    } catch (e) {
      attempt++;
      if (attempt > config.EMBED_MAX_RETRIES || !isRateLimit(e)) {
        throw new Error(`embedding failed after ${attempt} attempt(s): ${(e as Error).message}`);
      }
      const wait = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function embedChunks(
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<EmbeddedChunk[]> {
  const batches: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += config.EMBED_BATCH_SIZE) {
    batches.push(chunks.slice(i, i + config.EMBED_BATCH_SIZE));
  }

  const limit = pLimit(config.EMBED_CONCURRENCY);
  let done = 0;
  const results = await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const vectors = await embedBatchWithRetry(batch.map(embeddingText));
        if (vectors.length !== batch.length) {
          throw new Error(`embedding returned ${vectors.length} vectors for ${batch.length} chunks`);
        }
        done += batch.length;
        onProgress?.(done, chunks.length);
        return batch.map<EmbeddedChunk>((c, i) => ({ ...c, embedding: vectors[i] }));
      }),
    ),
  );
  return results.flat();
}
