'use client';

import { useCallback, useEffect, useState } from 'react';
import { DocumentRow } from '@/components/DocumentRow';
import { UploadZone } from '@/components/UploadZone';
import { useIngest } from '@/lib/useIngest';
import type { DocumentRecord } from '@/lib/types';

export default function KnowledgePage() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [vectorCount, setVectorCount] = useState(0);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/documents');
    const body = (await res.json()) as { documents: DocumentRecord[]; vectorCount: number };
    setDocs(body.documents);
    setVectorCount(body.vectorCount);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const { upload, progress, busy, error } = useIngest(refresh);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Knowledge base</h1>
        <p className="mt-1 text-sm text-muted">
          {docs.length} document{docs.length === 1 ? '' : 's'} · {vectorCount} indexed chunks
        </p>
      </header>

      <UploadZone onUpload={upload} progress={progress} busy={busy} error={error} />

      <section className="space-y-2">
        {docs.map((d) => (
          <DocumentRow key={d.id} doc={d} onDeleted={refresh} />
        ))}
        {docs.length === 0 && (
          <p className="rounded-xl border border-line bg-panel px-4 py-6 text-center text-sm text-muted">
            Nothing indexed yet. Drop a file above, or run <code>npm run seed</code> to load the
            bundled Gold Bank corpus.
          </p>
        )}
      </section>
    </div>
  );
}
