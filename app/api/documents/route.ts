import { listDocuments } from '@/lib/manifest';
import { getStore } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const documentId = new URL(req.url).searchParams.get('documentId');
  const store = await getStore();

  if (documentId) {
    // Chunks for one document, ordered — powers the expandable library view.
    const chunks = await store.getByOrdinalRange(documentId, 0, Number.MAX_SAFE_INTEGER);
    return Response.json({
      chunks: chunks.map(({ embedding: _embedding, ...rest }) => rest),
    });
  }

  return Response.json({
    documents: (await listDocuments()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    vectorCount: await store.count(),
  });
}
