import { createChat, listChats } from '@/lib/chats';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ chats: (await listChats()).map(({ id, title, updatedAt }) => ({ id, title, updatedAt })) });
}

export async function POST(): Promise<Response> {
  return Response.json({ chat: await createChat() });
}
