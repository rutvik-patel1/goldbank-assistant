import { nanoid } from 'nanoid';
import type { DocumentRecord, DocumentStatus, ParsedDoc } from '../types';
import { getStore } from '../store';
import {
  findByHash, findBySourceUrl, patchDocument, removeDocument, upsertDocument,
} from '../manifest';
import { chunkDocument } from './chunk';
import { embedChunks } from './embed';
import { enrichChunks } from './enrich';
import { contentHash } from './normalize';
import { parseFile } from './parse';

export type IngestEvent =
  | { type: 'status'; documentId: string; stage: DocumentStatus; done?: number; total?: number; chunks?: number }
  | { type: 'done'; documentId: string; chunks: number; ms: number }
  | { type: 'error'; documentId: string; message: string }
  | { type: 'skipped'; documentId: string; reason: string };

export interface IngestResult {
  documentId: string;
  chunks: number;
  skipped?: string;
  error?: string;
}

async function ingestDoc(
  doc: ParsedDoc,
  emit: (e: IngestEvent) => void,
  force = false,
): Promise<IngestResult> {
  const started = Date.now();
  const hash = contentHash(doc.markdown);
  const title = String(doc.metadata.title);
  const filename = String(doc.metadata.filename);

  const identical = force ? undefined : await findByHash(hash);
  if (identical && identical.status === 'ready') {
    emit({ type: 'skipped', documentId: identical.id, reason: 'already indexed (identical content)' });
    return { documentId: identical.id, chunks: identical.chunkCount, skipped: 'already indexed' };
  }

  // A changed document with the same source URL replaces the old version outright.
  const store = await getStore();
  if (doc.metadata.sourceUrl) {
    const prior = await findBySourceUrl(doc.metadata.sourceUrl);
    if (prior) {
      await store.deleteByDocument(prior.id);
      await removeDocument(prior.id);
    }
  }

  const documentId = nanoid(10);
  const now = new Date().toISOString();
  const record: DocumentRecord = {
    id: documentId, filename, title,
    sourceUrl: doc.metadata.sourceUrl, contentHash: hash,
    status: 'parsing', chunkCount: 0, enrichedCount: 0, createdAt: now, updatedAt: now,
  };
  await upsertDocument(record);

  try {
    emit({ type: 'status', documentId, stage: 'chunking' });
    await patchDocument(documentId, { status: 'chunking' });
    const chunks = chunkDocument(doc, documentId);
    if (chunks.length === 0) throw new Error('document produced no chunks after parsing');
    emit({ type: 'status', documentId, stage: 'chunking', chunks: chunks.length });

    emit({ type: 'status', documentId, stage: 'enriching', done: 0, total: chunks.length });
    await patchDocument(documentId, { status: 'enriching', chunkCount: chunks.length });
    const enriched = await enrichChunks(chunks, (done, total) =>
      emit({ type: 'status', documentId, stage: 'enriching', done, total }),
    );
    const enrichedCount = enriched.filter((c) => c.enrichment).length;

    emit({ type: 'status', documentId, stage: 'embedding', done: 0, total: chunks.length });
    await patchDocument(documentId, { status: 'embedding' });
    const embedded = await embedChunks(enriched, (done, total) =>
      emit({ type: 'status', documentId, stage: 'embedding', done, total }),
    );

    await store.upsert(embedded);
    await patchDocument(documentId, {
      status: 'ready', chunkCount: embedded.length, enrichedCount, error: undefined,
    });
    const ms = Date.now() - started;
    emit({ type: 'done', documentId, chunks: embedded.length, ms });
    return { documentId, chunks: embedded.length };
  } catch (e) {
    const message = (e as Error).message;
    await patchDocument(documentId, { status: 'failed', error: message });
    await store.deleteByDocument(documentId); // never leave a half-indexed document
    emit({ type: 'error', documentId, message });
    return { documentId, chunks: 0, error: message };
  }
}

export async function ingestBuffer(
  buf: Buffer,
  filename: string,
  emit: (e: IngestEvent) => void,
  opts: { force?: boolean } = {},
): Promise<IngestResult[]> {
  let docs: ParsedDoc[];
  try {
    docs = await parseFile(buf, filename);
  } catch (e) {
    const message = (e as Error).message;
    emit({ type: 'error', documentId: filename, message });
    return [{ documentId: filename, chunks: 0, error: message }];
  }

  const results: IngestResult[] = [];
  for (const doc of docs) {
    results.push(await ingestDoc(doc, emit, opts.force ?? false));
  }
  return results;
}
