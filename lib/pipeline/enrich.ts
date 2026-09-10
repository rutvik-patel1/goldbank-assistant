import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { config, paths } from '../config';
import { getChatModel, textOf } from '../gemini';
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

function parseEnrichment(raw: string): Enrichment {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON object in model output');
  const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<Enrichment>;
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
    .replace('{{TEXT}}', chunk.text.slice(0, 6000));

  try {
    const res = await getChatModel(0).invoke(prompt);
    const text = textOf(res.content);
    const parsed = parseEnrichment(text);
    await writeCache(key, parsed);
    return parsed;
  } catch (e) {
    console.warn(`enrichment failed for ${chunk.id}: ${(e as Error).message}`);
    return undefined;
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
