import { getChat } from '@/lib/chats';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ chat });
}
