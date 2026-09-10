import * as lancedb from '@lancedb/lancedb';
import type { VectorQuery } from '@lancedb/lancedb';
import { mkdir } from 'node:fs/promises';
import { config, paths } from '../config';
import type { EmbeddedChunk, ScoredChunk } from '../types';
import { fromRow, toRow, type SearchFilter, type StoreRow, type VectorStore } from './types';

const TABLE = 'chunks';

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

export async function createLanceStore(): Promise<VectorStore> {
  await mkdir(paths.lancedb, { recursive: true });
  const db = await lancedb.connect(paths.lancedb);

  async function table() {
    const names = await db.tableNames();
    return names.includes(TABLE) ? db.openTable(TABLE) : null;
  }

  return {
    async upsert(chunks: EmbeddedChunk[]) {
      if (chunks.length === 0) return;
      const rows = chunks.map(toRow);
      // LanceDB's `Data` type wants `Record<string, unknown>[]`; StoreRow is
      // structurally identical (every field a non-null scalar or number[])
      // but, as a named interface, has no index signature. Cast at the
      // boundary rather than loosening StoreRow itself.
      const arrowRows = rows as unknown as Record<string, unknown>[];
      const t = await table();
      if (t) {
        // Replace any pre-existing rows with these ids, then append.
        const ids = rows.map((r) => `'${esc(r.id)}'`).join(',');
        await t.delete(`id IN (${ids})`);
        await t.add(arrowRows);
      } else {
        await db.createTable(TABLE, arrowRows);
      }
    },

    async search(vector, k, filter?: SearchFilter) {
      const t = await table();
      if (!t) return [];
      // `search()` is typed to return `VectorQuery | Query | AutoQuery` since
      // it also accepts string/FTS queries; a number[] vector always yields
      // a VectorQuery at runtime, so narrow the type here.
      let q = (t.search(vector) as VectorQuery).distanceType('cosine').limit(k);
      if (filter?.documentId) q = q.where(`documentId = '${esc(filter.documentId)}'`);
      const rows = (await q.toArray()) as (StoreRow & { _distance: number })[];
      return rows.map<ScoredChunk>((r) => ({
        ...fromRow(r),
        score: 1 - r._distance, // cosine distance → similarity
      }));
    },

    async getByIds(ids) {
      const t = await table();
      if (!t || ids.length === 0) return [];
      const list = ids.map((i) => `'${esc(i)}'`).join(',');
      const rows = (await t.query().where(`id IN (${list})`).toArray()) as StoreRow[];
      return rows.map(fromRow);
    },

    async getByOrdinalRange(documentId, from, to) {
      const t = await table();
      if (!t) return [];
      const rows = (await t
        .query()
        .where(`documentId = '${esc(documentId)}' AND ordinal >= ${from} AND ordinal <= ${to}`)
        .toArray()) as StoreRow[];
      return rows.map(fromRow).sort((a, b) => a.ordinal - b.ordinal);
    },

    async deleteByDocument(documentId) {
      const t = await table();
      if (!t) return;
      await t.delete(`documentId = '${esc(documentId)}'`);
    },

    async count() {
      const t = await table();
      return t ? t.countRows() : 0;
    },

    async dimensions() {
      const t = await table();
      if (!t) return null;
      const rows = (await t.query().limit(1).toArray()) as StoreRow[];
      return rows.length ? Array.from(rows[0].vector).length : null;
    },
  };
}
