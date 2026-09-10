import { removeDocument } from '@/lib/manifest';
import { getStore } from '@/lib/store';

export const runtime = 'nodejs';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = await getStore();
  await store.deleteByDocument(id);
  await removeDocument(id);
  return Response.json({ ok: true });
}
