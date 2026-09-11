'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { useChatStream, type UiTurn } from '@/lib/useChatStream';

const SEEDS = [
  'How does the points system work?',
  'Do you deliver outside the UK?',
  'What happens if I cancel my order?',
  'Do I need ID to open an account?',
];

export function ChatPanel({ initialTurns = [], readOnly = false }: { initialTurns?: UiTurn[]; readOnly?: boolean }) {
  const { turns, pending, error, send } = useChatStream(initialTurns);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const submit = (text: string) => {
    setDraft('');
    void send(text);
  };

  return (
    <div className="space-y-6">
      {turns.length === 0 && !readOnly && (
        <div className="rounded-2xl border border-line bg-panel p-6">
          <h1 className="text-xl font-semibold">Ask about buying, selling, and shipping gold</h1>
          <p className="mt-1 text-sm text-muted">
            Answers come only from Gold Bank&apos;s published FAQs and policies, with a link to the
            exact section every time.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {SEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-gold hover:bg-gold-soft"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {turns.map((t, i) => (
          <MessageBubble key={i} turn={t} />
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-gold">
          {error}
        </div>
      )}

      {!readOnly && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
          className="sticky bottom-4 flex gap-2 rounded-xl border border-line bg-panel p-2 shadow-sm"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about delivery, payments, returns, points…"
            className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none"
            disabled={pending}
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
          >
            {pending ? 'Thinking…' : 'Ask'}
          </button>
        </form>
      )}
    </div>
  );
}
