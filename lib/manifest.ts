import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from './config';
import type { DocumentRecord } from './types';

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function read(): Promise<DocumentRecord[]> {
  try {
    return JSON.parse(await readFile(paths.manifest, 'utf8')) as DocumentRecord[];
  } catch {
    return [];
  }
}

async function write(records: DocumentRecord[]): Promise<void> {
  await mkdir(dirname(paths.manifest), { recursive: true });
  await writeFile(paths.manifest, JSON.stringify(records, null, 2));
}

export function listDocuments(): Promise<DocumentRecord[]> {
  return serialize(read);
}

export function upsertDocument(rec: DocumentRecord): Promise<void> {
  return serialize(async () => {
    const all = await read();
    const i = all.findIndex((r) => r.id === rec.id);
    if (i >= 0) all[i] = rec;
    else all.push(rec);
    await write(all);
  });
}

export function patchDocument(id: string, patch: Partial<DocumentRecord>): Promise<void> {
  return serialize(async () => {
    const all = await read();
    const i = all.findIndex((r) => r.id === id);
    if (i < 0) {
      // The record was removed underneath us (a concurrent replace). Say so: the
      // in-flight document's vectors may already be in the store with no row.
      console.warn(`manifest: patch for unknown document ${id} (removed concurrently?)`);
      return;
    }
    all[i] = { ...all[i], ...patch, updatedAt: new Date().toISOString() };
    await write(all);
  });
}

export function removeDocument(id: string): Promise<void> {
  return serialize(async () => {
    await write((await read()).filter((r) => r.id !== id));
  });
}

export function findByHash(hash: string): Promise<DocumentRecord | undefined> {
  return serialize(async () => (await read()).find((r) => r.contentHash === hash));
}

export function findBySourceUrl(url: string): Promise<DocumentRecord | undefined> {
  return serialize(async () => (await read()).find((r) => r.sourceUrl === url));
}

/** Replace-on-change key for uploads, which carry no sourceUrl. */
export function findByFilename(filename: string): Promise<DocumentRecord | undefined> {
  return serialize(async () =>
    (await read()).find((r) => !r.sourceUrl && r.filename === filename),
  );
}
