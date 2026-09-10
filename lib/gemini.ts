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
  return raw.map(conform);
}

export async function embedQuery(text: string): Promise<number[]> {
  return conform(await getEmbeddings().embedQuery(text));
}
