import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from '../config';
import type { EmbeddedChunk, ScoredChunk } from '../types';
import { cosine, type SearchFilter, type VectorStore } from './types';

export async function createJsonStore(): Promise<VectorStore> {
  let rows: EmbeddedChunk[] = [];
  try {
    rows = JSON.parse(await readFile(paths.jsonIndex, 'utf8')) as EmbeddedChunk[];
  } catch {
    rows = [];
  }

  async function flush() {
    await mkdir(dirname(paths.jsonIndex), { recursive: true });
    await writeFile(paths.jsonIndex, JSON.stringify(rows));
  }

  return {
    async upsert(chunks) {
      const incoming = new Set(chunks.map((c) => c.id));
      rows = rows.filter((r) => !incoming.has(r.id)).concat(chunks);
      await flush();
    },

    async search(vector, k, filter?: SearchFilter) {
      const pool = filter?.documentId
        ? rows.filter((r) => r.documentId === filter.documentId)
        : rows;
      return pool
        .map<ScoredChunk>((r) => ({ ...r, score: cosine(vector, r.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },

    async getByIds(ids) {
      const set = new Set(ids);
      return rows.filter((r) => set.has(r.id));
    },

    async getByOrdinalRange(documentId, from, to) {
      return rows
        .filter((r) => r.documentId === documentId && r.ordinal >= from && r.ordinal <= to)
        .sort((a, b) => a.ordinal - b.ordinal);
    },

    async deleteByDocument(documentId) {
      rows = rows.filter((r) => r.documentId !== documentId);
      await flush();
    },

    async count() {
      return rows.length;
    },

    async dimensions() {
      return rows.length ? rows[0].embedding.length : null;
    },
  };
}
