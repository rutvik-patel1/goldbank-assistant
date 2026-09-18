function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  // Models
  CHAT_MODEL: process.env.GEMINI_CHAT_MODEL ?? 'gemini-3.1-flash-lite',
  CHAT_TEMPERATURE: Number(process.env.CHAT_TEMPERATURE ?? 0.1),
  EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
  EMBEDDING_DIMENSIONS: int('EMBEDDING_DIMENSIONS', 768),

  // Store
  VECTOR_STORE: (process.env.VECTOR_STORE ?? 'lancedb') as 'lancedb' | 'json',
  DATA_DIR: process.env.DATA_DIR ?? './data',

  // Chunking
  MAX_CHUNK_TOKENS: int('MAX_CHUNK_TOKENS', 450),
  CHUNK_OVERLAP_RATIO: 0.15,
  MAX_QUESTION_CHARS: 140,
  MAX_TOC_SCAN_LINES: int('MAX_TOC_SCAN_LINES', 60),
  MIN_CHUNK_TOKENS: 12,
  MAX_HEADING_CHARS: 90,
  HEADING_CAPS_RATIO: 0.6,
  MAX_SENTENCE_HEADING_CHARS: 70,
  MAX_SENTENCE_HEADING_WORDS: 10,
  MIN_HEADING_LETTERS: 3,
  MAX_HEADING_UPPER_RATIO: 0.9,
  MAX_HEADING_WORDS: 14,

  // Enrichment
  ENRICHMENT: (process.env.ENRICHMENT ?? 'on') as 'on' | 'off',
  ENRICH_CONCURRENCY: int('ENRICH_CONCURRENCY', 4),
  ENRICH_MAX_RETRIES: int('ENRICH_MAX_RETRIES', 5),
  ENRICH_MAX_CHARS: int('ENRICH_MAX_CHARS', 6000),

  // Embedding
  EMBED_BATCH_SIZE: int('EMBED_BATCH_SIZE', 64),
  EMBED_CONCURRENCY: int('EMBED_CONCURRENCY', 2),
  EMBED_MAX_RETRIES: int('EMBED_MAX_RETRIES', 5),

  // Retrieval
  TOP_K: int('TOP_K', 8),
  MIN_SCORE: Number(process.env.MIN_SCORE ?? 0.55),
  CONTEXT_TOKEN_BUDGET: int('CONTEXT_TOKEN_BUDGET', 6000),
  SIBLING_SCORE_DISCOUNT: Number(process.env.SIBLING_SCORE_DISCOUNT ?? 0.95),
  CONDENSE_HISTORY_TURNS: int('CONDENSE_HISTORY_TURNS', 6),
  CITATION_SNIPPET_CHARS: int('CITATION_SNIPPET_CHARS', 400),

  // Upload
  MAX_UPLOAD_BYTES: int('MAX_UPLOAD_BYTES', 20 * 1024 * 1024),
  SUPPORTED_EXTENSIONS: ['.json', '.zip', '.pdf', '.docx', '.md', '.txt', '.html', '.htm'] as string[],

  // Normalization: lines/blocks stripped from scraped markdown
  BOILERPLATE_PATTERNS: [
    /^reCAPTCHA$/i,
    /^Recaptcha requires verification\.?$/i,
    /^protected by \*\*reCAPTCHA\*\*$/i,
    /^Privacy\s+-\s+Terms$/i,
    /^Skip to (main )?content$/i,
    /^Accept( all)? cookies$/i,
    /^Manage cookies$/i,
  ] as RegExp[],
} as const;

export const paths = {
  data: config.DATA_DIR,
  lancedb: `${config.DATA_DIR}/lancedb`,
  jsonIndex: `${config.DATA_DIR}/index.json`,
  manifest: `${config.DATA_DIR}/documents.json`,
  chats: `${config.DATA_DIR}/chats`,
  uploads: `${config.DATA_DIR}/uploads`,
  enrichCache: `${config.DATA_DIR}/enrichment-cache`,
  corpus: 'knowledge-base/goldbank',
};
