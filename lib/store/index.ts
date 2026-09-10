import { config } from '../config';
import { createJsonStore } from './json';
import { createLanceStore } from './lancedb';
import type { VectorStore } from './types';

let instance: Promise<VectorStore> | null = null;

export function getStore(): Promise<VectorStore> {
  if (!instance) {
    instance = config.VECTOR_STORE === 'json' ? createJsonStore() : createLanceStore();
  }
  return instance;
}

/** Fail loudly on the classic silent RAG bug: index built at a different dimensionality. */
export async function assertDimensions(): Promise<void> {
  const store = await getStore();
  const actual = await store.dimensions();
  if (actual !== null && actual !== config.EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Index was built with ${actual}-dim vectors but EMBEDDING_DIMENSIONS is ` +
      `${config.EMBEDDING_DIMENSIONS}. Delete ./data and re-run "npm run seed".`,
    );
  }
}

export type { VectorStore } from './types';
