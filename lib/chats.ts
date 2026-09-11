import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { paths } from './config';
import type { ChatSession, ChatTurn } from './types';

function file(id: string): string {
  return join(paths.chats, `${id}.json`);
}

export async function createChat(): Promise<ChatSession> {
  await mkdir(paths.chats, { recursive: true });
  const now = new Date().toISOString();
  const session: ChatSession = { id: nanoid(10), title: 'New conversation', turns: [], createdAt: now, updatedAt: now };
  await writeFile(file(session.id), JSON.stringify(session, null, 2));
  return session;
}

export async function getChat(id: string): Promise<ChatSession | null> {
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

export async function appendTurn(id: string, turn: ChatTurn): Promise<ChatSession | null> {
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
}
