'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function ConversationSidebar({
  conversations,
  activeId,
}: {
  conversations: ConversationSummary[];
  activeId?: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The list is server-rendered; after any mutation ask the server for the
  // truth again rather than patching local state, so the sidebar can never
  // disagree with what is on disk.
  const refresh = () => router.refresh();

  const remove = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      if (id === activeId) router.push('/');
      else refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (id: string) => {
    const title = draft.trim();
    setEditing(null);
    if (!title) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(`rename failed (${res.status})`);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <nav aria-label="Past conversations" className="space-y-2">
      <Link
        href="/"
        className="block rounded-lg border border-line bg-panel px-3 py-2 text-center text-sm font-medium hover:border-gold hover:bg-gold-soft"
      >
        + New conversation
      </Link>

      {error && <p className="px-1 text-xs text-gold">{error}</p>}

      {conversations.length === 0 && (
        <p className="px-1 py-2 text-xs text-muted">
          No saved conversations yet. Ask a question to start one.
        </p>
      )}

      <ul className="space-y-1">
        {conversations.map((c) => {
          const active = c.id === activeId;
          return (
            <li
              key={c.id}
              className={`group rounded-lg border px-2 py-1.5 ${
                active ? 'border-gold bg-gold-soft' : 'border-transparent hover:border-line hover:bg-panel'
              }`}
            >
              {editing === c.id ? (
                <input
                  autoFocus
                  value={draft}
                  aria-label="Rename conversation"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void rename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void rename(c.id);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  className="w-full rounded border border-line bg-panel px-1.5 py-1 text-sm outline-none"
                />
              ) : (
                <>
                  <Link href={`/c/${c.id}`} className="block truncate text-sm">
                    {c.title}
                  </Link>
                  <div className="flex items-center justify-between">
                    <span className="text-[0.7rem] text-muted">{when(c.updatedAt)}</span>
                    <span className="flex gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => {
                          setDraft(c.title);
                          setEditing(c.id);
                        }}
                        className="text-[0.7rem] text-muted hover:text-gold"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void remove(c.id, c.title)}
                        className="text-[0.7rem] text-muted hover:text-gold"
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
