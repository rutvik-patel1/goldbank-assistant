import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { config } from './config';

export function requireApiKey(): string {
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'Missing GEMINI_API_KEY. Create .env.local with GEMINI_API_KEY=<key from https://aistudio.google.com/apikey>',
    );
  }
  return key;
}

let chat: ChatGoogleGenerativeAI | null = null;
export function getChatModel(temperature = 0.1): ChatGoogleGenerativeAI {
  if (!chat) {
    chat = new ChatGoogleGenerativeAI({
      model: config.CHAT_MODEL,
      apiKey: requireApiKey(),
      temperature,
      maxRetries: 3,
    });
  }
  return chat;
}

let embeddings: GoogleGenerativeAIEmbeddings | null = null;
export function getEmbeddings(): GoogleGenerativeAIEmbeddings {
  if (!embeddings) {
    embeddings = new GoogleGenerativeAIEmbeddings({
      model: config.EMBEDDING_MODEL,
      apiKey: requireApiKey(),
      // Honored by @langchain/google-genai >= 2.x; enforced defensively below regardless.
      ...({ outputDimensionality: config.EMBEDDING_DIMENSIONS } as Record<string, unknown>),
    });
  }
  return embeddings;
}

/**
 * Detects rate-limit-shaped errors from any Gemini call site (chat or
 * embedding) so retry logic has exactly one definition to agree on.
 */
export function isRateLimit(e: unknown): boolean {
  const msg = (e as Error)?.message ?? '';
  return /429|rate limit|too many requests|quota|RESOURCE_EXHAUSTED/i.test(msg);
}

/** Truncate to the configured dimensionality and L2-normalize. */
export function conform(vector: number[]): number[] {
  const d = config.EMBEDDING_DIMENSIONS;
  if (vector.length < d) {
    throw new Error(
      `Embedding model returned ${vector.length} dims, fewer than the configured ${d}. ` +
      `Lower EMBEDDING_DIMENSIONS or change EMBEDDING_MODEL.`,
    );
  }
  const v = vector.length === d ? vector : vector.slice(0, d);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

/** Unwrap a LangChain message's content, which is a string or an array of parts. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : '',
      )
      .join('');
  }
  return '';
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const raw = await getEmbeddings().embedDocuments(texts);
  // @langchain/google-genai's embedDocuments() swallows a per-batch rate-limit
  // rejection internally (Promise.allSettled) and substitutes an empty vector
  // for every text in that batch instead of throwing. Left alone, conform()
  // would report that as a generic dimension mismatch — a message isRateLimit()
  // doesn't recognize — so the retry path in embed.ts would never fire and a
  // transient 429 would silently and permanently degrade the index. Detect the
  // empty-vector shape here and raise it as the rate limit it actually is.
  const emptyCount = raw.filter((v) => v.length === 0).length;
  if (emptyCount > 0) {
    throw new Error(
      `RESOURCE_EXHAUSTED: embedding provider returned ${emptyCount} empty vector(s) ` +
      `of ${raw.length} requested — likely a rate limit swallowed by the client library`,
    );
  }
  return raw.map(conform);
}

export async function embedQuery(text: string): Promise<number[]> {
  return conform(await getEmbeddings().embedQuery(text));
}
