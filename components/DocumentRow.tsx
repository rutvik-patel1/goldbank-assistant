'use client';

import { useState } from 'react';
import type { Chunk, DocumentRecord } from '@/lib/types';

const KIND_STYLE: Record<string, string> = {
  qa: 'bg-gold-soft text-gold',
  clause: 'bg-line text-muted',
  table: 'bg-line text-muted',
  prose: 'bg-line text-muted',
};

export function DocumentRow({
  doc,
  onDeleted,
}: {
  doc: DocumentRecord;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && chunks === null) {
      setLoading(true);
      const res = await fetch(`/api/documents?documentId=${encodeURIComponent(doc.id)}`);
      setChunks(((await res.json()) as { chunks: Chunk[] }).chunks);
      setLoading(false);
    }
  };

  const [removeError, setRemoveError] = useState<string | null>(null);

  const remove = async () => {
    if (!confirm(`Remove "${doc.title}" and its ${doc.chunkCount} chunks from the index?`)) return;
    setRemoveError(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      // Without this check a failed delete is indistinguishable from a successful
      // one: the list refreshes from server truth and the row simply stays.
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      onDeleted();
    } catch (e) {
      setRemoveError((e as Error).message);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <div className="truncate font-medium">{doc.title}</div>
          <div className="truncate text-xs text-muted">
            {doc.status === 'ready' ? `${doc.chunkCount} chunks` : doc.status}
            {doc.error ? ` — ${doc.error}` : ''}
            {doc.sourceUrl ? ` · ${doc.sourceUrl}` : ` · ${doc.filename}`}
          </div>
        </button>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            doc.status === 'ready' ? 'bg-gold-soft text-gold' : 'bg-line text-muted'
          }`}
        >
          {doc.status}
        </span>
        <button type="button" onClick={remove} className="text-xs text-muted hover:text-gold">
          Remove
        </button>
      </div>

      {removeError && (
        <p className="border-t border-line px-4 py-2 text-xs text-gold">{removeError}</p>
      )}

      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {loading && <div className="text-sm text-muted">Loading chunks…</div>}
          {chunks?.map((c) => (
            <div key={c.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${KIND_STYLE[c.kind] ?? ''}`}>
                  {c.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">
                  {c.headingPath.join(' › ')}
                  {c.partCount ? ` · part ${(c.partIndex ?? 0) + 1}/${c.partCount}` : ''}
                  {c.anchor ? ` · #${c.anchor}` : ''}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{c.text.slice(0, 400)}
                {c.text.length > 400 ? '…' : ''}</p>
            </div>
          ))}
          {chunks?.length === 0 && <div className="text-sm text-muted">No chunks indexed.</div>}
        </div>
      )}
    </div>
  );
}
