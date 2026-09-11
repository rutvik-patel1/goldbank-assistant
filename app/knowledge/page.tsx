import { listDocuments } from '@/lib/manifest';
import { getStore } from '@/lib/store';
import { KnowledgeClient } from '@/components/KnowledgeClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // the index changes underneath this page

export default async function KnowledgePage() {
  // Read lib/ directly rather than fetching our own API: this is the server.
  const [documents, store] = await Promise.all([listDocuments(), getStore()]);
  const vectorCount = await store.count();

  return (
    <KnowledgeClient
      initialDocuments={[...documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
      initialVectorCount={vectorCount}
    />
  );
}
