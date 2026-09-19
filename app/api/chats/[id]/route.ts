import { deleteChat, getChat, renameChat } from '@/lib/chats';

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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  // deleteChat routes through file(), which rejects ids outside nanoid's
  // alphabet — so a traversal attempt reads as "not found", not as a file op.
  const ok = await deleteChat(id);
  if (!ok) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { title?: unknown } | null;
  if (!body || typeof body.title !== 'string' || !body.title.trim()) {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }
  const chat = await renameChat(id, body.title);
  if (!chat) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ chat });
}
