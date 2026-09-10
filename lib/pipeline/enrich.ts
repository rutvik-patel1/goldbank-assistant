import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { config, paths } from '../config';
import { getChatModel, isRateLimit, textOf } from '../gemini';
import type { Chunk, Enrichment } from '../types';

const PROMPT = `You are indexing a passage from a UK gold bullion dealer's website so that customer questions can find it.

Return ONLY a JSON object, no markdown fence, with exactly these keys:
{
  "summary": "one plain-language sentence describing what this passage tells a customer",
  "hypotheticalQuestions": ["2-4 questions a customer would ask that THIS passage answers, in plain everyday wording, not legal wording"],
  "keywords": ["3-8 specific terms: amounts, timeframes, product names, policy terms"]
}

Rules:
- Write the questions the way a real customer types them, not the way the passage is written.
- Do not invent facts that are absent from the passage.
- If the passage is boilerplate with no customer-relevant content, return empty arrays and a one-line summary.

Section: {{HEADING}}

Passage:
"""
{{TEXT}}
"""`;

function cacheKey(chunk: Chunk): string {
  return createHash('sha256')
    .update(`${config.CHAT_MODEL}\n${chunk.headingPath.join('>')}\n${chunk.text}`)
    .digest('hex');
}

async function readCache(key: string): Promise<Enrichment | null> {
  try {
    return JSON.parse(await readFile(join(paths.enrichCache, `${key}.json`), 'utf8')) as Enrichment;
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: Enrichment): Promise<void> {
  await mkdir(paths.enrichCache, { recursive: true });
  await writeFile(join(paths.enrichCache, `${key}.json`), JSON.stringify(value));
}

const EMPTY_ENRICHMENT: Enrichment = { summary: '', hypotheticalQuestions: [], keywords: [] };

/**
 * Model output is untrusted. This never throws: a fenced response, prose around
 * the JSON, a truncated object, or wrongly-typed fields all degrade to empty
 * values rather than propagating. `enrichOne` also catches, but relying on the
 * caller would make this unsafe to reuse anywhere else.
 */
function parseEnrichment(raw: string): Enrichment {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) return EMPTY_ENRICHMENT;
  let obj: Partial<Enrichment>;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<Enrichment>;
  } catch {
    return EMPTY_ENRICHMENT;
  }
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    hypotheticalQuestions: Array.isArray(obj.hypotheticalQuestions)
      ? obj.hypotheticalQuestions.filter((q): q is string => typeof q === 'string').slice(0, 4)
      : [],
    keywords: Array.isArray(obj.keywords)
      ? obj.keywords.filter((k): k is string => typeof k === 'string').slice(0, 8)
      : [],
  };
}

async function enrichOne(chunk: Chunk): Promise<Enrichment | undefined> {
  const key = cacheKey(chunk);
  const cached = await readCache(key);
  if (cached) return cached;

  const prompt = PROMPT
    .replace('{{HEADING}}', chunk.headingPath.join(' › '))
    .replace('{{TEXT}}', chunk.text.slice(0, config.ENRICH_MAX_CHARS));

  // Retry rate limits. Without this, a transient 429 on a free-tier key drops a
  // chunk's enrichment, the chunk is embedded WITHOUT it, and the content hash is
  // unchanged — so every later seed skips the document and the degraded vector
  // persists forever with no error. Silent, permanent quality loss.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await getChatModel(0).invoke(prompt);
      const parsed = parseEnrichment(textOf(res.content));
      await writeCache(key, parsed);
      return parsed;
    } catch (e) {
      if (!isRateLimit(e) || attempt >= config.ENRICH_MAX_RETRIES) {
        console.warn(`enrichment failed for ${chunk.id}: ${(e as Error).message}`);
        return undefined;
      }
      const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function enrichChunks(
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<Chunk[]> {
  if (config.ENRICHMENT === 'off') return chunks;

  const limit = pLimit(config.ENRICH_CONCURRENCY);
  let done = 0;
  return Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const enrichment = await enrichOne(chunk);
        onProgress?.(++done, chunks.length);
        return enrichment ? { ...chunk, enrichment } : chunk;
      }),
    ),
  );
}
