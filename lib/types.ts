export type ChunkKind = 'qa' | 'clause' | 'prose' | 'table';

export interface ParsedDoc {
  markdown: string;
  metadata: {
    title: string;
    sourceUrl?: string;
    filename: string;
    contentType?: string;
    pageCount?: number;
    [k: string]: unknown;
  };
}

export interface Enrichment {
  summary: string;
  hypotheticalQuestions: string[];
  keywords: string[];
}

export interface Chunk {
  id: string;
  documentId: string;
  ordinal: number;
  text: string;
  kind: ChunkKind;
  headingPath: string[];
  anchor?: string;
  question?: string;
  partIndex?: number;
  partCount?: number;
  sourceUrl?: string;
  sourceTitle: string;
  enrichment?: Enrichment;
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export interface ScoredChunk extends Chunk {
  score: number;
}

export type DocumentStatus =
  | 'parsing' | 'chunking' | 'enriching' | 'embedding' | 'ready' | 'failed';

export interface DocumentRecord {
  id: string;
  filename: string;
  title: string;
  sourceUrl?: string;
  contentHash: string;
  status: DocumentStatus;
  chunkCount: number;
  enrichedCount: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  n: number;
  chunkId: string;
  documentTitle: string;
  headingPath: string[];
  sourceUrl?: string;
  anchor?: string;
  snippet: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  debug?: {
    condensedQuery?: string;
    retrieved?: { chunkId: string; score: number; headingPath: string[] }[];
    ms?: number;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  turns: ChatTurn[];
  createdAt: string;
  updatedAt: string;
}
