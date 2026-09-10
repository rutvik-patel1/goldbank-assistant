// Redirect DATA_DIR BEFORE importing lib/config: `paths` is computed at module
// evaluation time, so a later assignment would be inert and this harness would
// write its fixtures into the real ./data and clobber the seeded index.
//
// Everything below is wrapped in an immediately-invoked async function rather
// than using top-level await: this package.json has no "type": "module", so
// tsx/esbuild transpile .ts files to CJS output, which cannot contain
// top-level await. The dynamic `await import(...)` calls still happen after
// the DATA_DIR assignment, and the config.DATA_DIR guard is unchanged.
process.env.DATA_DIR = './data/verify';

import { rm } from 'node:fs/promises';
import type { EmbeddedChunk } from '../lib/types';
import type { VectorStore } from '../lib/store/types';

async function run() {
  const { config } = await import('../lib/config');
  const { createJsonStore } = await import('../lib/store/json');
  const { createLanceStore } = await import('../lib/store/lancedb');

  const D = config.EMBEDDING_DIMENSIONS;

  function vec(seed: number): number[] {
    const v = Array.from({ length: D }, (_, i) => Math.sin(seed * (i + 1)));
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return v.map((x) => x / n);
  }

  function chunk(i: number, documentId: string): EmbeddedChunk {
    return {
      id: `c${i}`, documentId, ordinal: i, text: `text ${i}`, kind: 'clause',
      headingPath: ['Doc', `Section ${i}`], sourceTitle: 'Doc',
      embedding: vec(i + 1),
      partIndex: i === 2 ? 0 : undefined, partCount: i === 2 ? 2 : undefined,
    };
  }

  async function contract(name: string, store: VectorStore) {
    const a = [chunk(1, 'docA'), chunk(2, 'docA'), chunk(3, 'docB')];
    await store.upsert(a);

    const assert = (cond: boolean, msg: string) => {
      console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}: ${msg}`);
      if (!cond) process.exitCode = 1;
    };

    assert((await store.count()) === 3, 'count === 3 after upsert');
    assert((await store.dimensions()) === D, `dimensions === ${D}`);

    const hits = await store.search(vec(2), 3);
    assert(hits[0].id === 'c1', 'nearest neighbour of vec(2) is c1');
    assert(hits[0].score > 0.99, `top score ~1.0 (got ${hits[0].score.toFixed(4)})`);
    assert(hits[0].headingPath[1] === 'Section 1', 'headingPath survives round-trip');

    const filtered = await store.search(vec(4), 5, { documentId: 'docB' });
    assert(filtered.length === 1 && filtered[0].documentId === 'docB', 'documentId filter works');

    const range = await store.getByOrdinalRange('docA', 1, 2);
    assert(range.length === 2 && range[0].ordinal === 1, 'ordinal range returns 2 sorted rows');

    const byId = await store.getByIds(['c3']);
    assert(byId.length === 1 && byId[0].partIndex === undefined, 'getByIds + optional field round-trip');

    await store.upsert([{ ...chunk(1, 'docA'), text: 'updated' }]);
    assert((await store.count()) === 3, 'upsert of existing id replaces, does not duplicate');
    assert((await store.getByIds(['c1']))[0].text === 'updated', 'upsert overwrites text');

    await store.deleteByDocument('docA');
    assert((await store.count()) === 1, 'deleteByDocument removed both docA rows');
  }

  if (config.DATA_DIR !== './data/verify') {
    throw new Error(`refusing to run: DATA_DIR is "${config.DATA_DIR}", expected ./data/verify`);
  }
  await rm('./data/verify', { recursive: true, force: true });
  await contract('json   ', await createJsonStore());
  await contract('lancedb', await createLanceStore());
  await rm('./data/verify', { recursive: true, force: true });
  console.log(process.exitCode ? '\nCONTRACT FAILED' : '\nBoth adapters satisfy the contract.');
}

run();
