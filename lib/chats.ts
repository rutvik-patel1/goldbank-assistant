import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { paths } from './config';
import type { ChatSession, ChatTurn } from './types';

/**
 * Chat ids come straight from a URL path segment (`/c/<id>`, `/api/chats/<id>`),
 * so they must be validated before touching the filesystem. Without this,
 * `getChat('../../package')` joins out of ./data/chats and returns the contents
 * of any JSON-parseable file reachable by traversal — an unauthenticated file
 * read. The alphabet below is nanoid's default set, which is what createChat emits.
 */
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function file(id: string): string {
  if (!CHAT_ID.test(id)) {
    throw new Error(`invalid chat id: ${JSON.stringify(id.slice(0, 32))}`);
  }
  return join(paths.chats, `${id}.json`);
}

// Same lesson as lib/manifest.ts: appendTurn is a read-modify-write over one
// JSON file, so two concurrent appends to the SAME session (a double-submit, or
// two tabs on one conversation) would both read the old state and the second
// write would silently drop the first turn. Serialize every mutation.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export async function createChat(): Promise<ChatSession> {
  await mkdir(paths.chats, { recursive: true });
  const now = new Date().toISOString();
  const session: ChatSession = { id: nanoid(10), title: 'New conversation', turns: [], createdAt: now, updatedAt: now };
  await writeFile(file(session.id), JSON.stringify(session, null, 2));
  return session;
}

export async function getChat(id: string): Promise<ChatSession | null> {
  // An invalid id throws inside file(); treat it the same as "not found" so
  // callers render a 404 rather than surfacing an error.
  try {
    return JSON.parse(await readFile(file(id), 'utf8')) as ChatSession;
  } catch {
    return null;
  }
}

export async function listChats(): Promise<ChatSession[]> {
  try {
    const names = (await readdir(paths.chats)).filter((n) => n.endsWith('.json'));
    const all = await Promise.all(names.map((n) => getChat(n.replace(/\.json$/, ''))));
    return all
      .filter((c): c is ChatSession => c !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function appendTurn(id: string, turn: ChatTurn): Promise<ChatSession | null> {
  return serialize(async () => {
    const session = await getChat(id);
    if (!session) return null;
    session.turns.push(turn);
    session.updatedAt = new Date().toISOString();
    if (session.turns.length === 1 && turn.role === 'user') {
      session.title = turn.content.slice(0, 70);
    }
    await mkdir(paths.chats, { recursive: true });
    await writeFile(file(id), JSON.stringify(session, null, 2));
    return session;
  });
}
