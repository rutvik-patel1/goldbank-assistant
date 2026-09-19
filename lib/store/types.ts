import type { Chunk, EmbeddedChunk, ScoredChunk } from '../types';

export interface SearchFilter {
  documentId?: string;
}

export interface VectorStore {
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  search(vector: number[], k: number, filter?: SearchFilter): Promise<ScoredChunk[]>;
  /** Fetch specific chunks by id — used for sibling expansion. */
  getByIds(ids: string[]): Promise<EmbeddedChunk[]>;
  /** Fetch a contiguous ordinal range within one document — used for sibling expansion. */
  getByOrdinalRange(documentId: string, from: number, to: number): Promise<EmbeddedChunk[]>;
  deleteByDocument(documentId: string): Promise<void>;
  count(): Promise<number>;
  /** Dimensionality of stored vectors, or null when the store is empty. */
  dimensions(): Promise<number | null>;
}

export interface StoreRow {
  id: string;
  documentId: string;
  ordinal: number;
  vector: number[];
  text: string;
  kind: string;
  sourceTitle: string;
  sourceUrl: string;   // '' when absent — LanceDB dislikes nullable inference
  anchor: string;      // ''
  question: string;    // ''
  partIndex: number;   // -1 when not a split part
  partCount: number;   // -1
  metaJson: string;    // { headingPath }
}

export function toRow(c: EmbeddedChunk): StoreRow {
  return {
    id: c.id,
    documentId: c.documentId,
    ordinal: c.ordinal,
    vector: c.embedding,
    text: c.text,
    kind: c.kind,
    sourceTitle: c.sourceTitle,
    sourceUrl: c.sourceUrl ?? '',
    anchor: c.anchor ?? '',
    question: c.question ?? '',
    partIndex: c.partIndex ?? -1,
    partCount: c.partCount ?? -1,
    metaJson: JSON.stringify({ headingPath: c.headingPath }),
  };
}

export function fromRow(r: StoreRow): EmbeddedChunk {
  const meta = JSON.parse(r.metaJson) as { headingPath: string[] };
  return {
    id: r.id,
    documentId: r.documentId,
    ordinal: r.ordinal,
    embedding: Array.from(r.vector),
    text: r.text,
    kind: r.kind as Chunk['kind'],
    sourceTitle: r.sourceTitle,
    sourceUrl: r.sourceUrl || undefined,
    anchor: r.anchor || undefined,
    question: r.question || undefined,
    partIndex: r.partIndex >= 0 ? r.partIndex : undefined,
    partCount: r.partCount >= 0 ? r.partCount : undefined,
    headingPath: meta.headingPath,
  };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
