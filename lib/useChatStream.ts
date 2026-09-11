'use client';

import { useCallback, useRef, useState } from 'react';
import type { Citation } from './types';

export interface RetrievedDebug {
  chunkId: string;
  score: number;
  kind: string;
  headingPath: string[];
  snippet: string;
}

export interface Meta {
  condensedQuery: string;
  topScore: number;
  gated: boolean;
  retrieved: RetrievedDebug[];
  ms?: number;
}

export interface UiTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  meta?: Meta;
  streaming?: boolean;
}

/** Parse an SSE body incrementally. */
async function readSse(
  res: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = /^event:\s*(.+)$/m.exec(raw)?.[1]?.trim();
      const dataLine = /^data:\s*(.*)$/m.exec(raw)?.[1];
      if (!event || dataLine === undefined) continue;
      try {
        onEvent(event, JSON.parse(dataLine));
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

export function useChatStream(initialTurns: UiTurn[] = []) {
  const [turns, setTurns] = useState<UiTurn[]>(initialTurns);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatId = useRef<string | null>(null);

  const send = useCallback(async (question: string) => {
    if (!question.trim() || pending) return;
    setError(null);
    setPending(true);

    setTurns((t) => [
      ...t,
      { role: 'user', content: question },
      { role: 'assistant', content: '', streaming: true },
    ]);

    const patchLast = (patch: Partial<UiTurn>) =>
      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    try {
      if (!chatId.current) {
        const created = await fetch('/api/chats', { method: 'POST' });
        chatId.current = ((await created.json()) as { chat: { id: string } }).chat.id;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: chatId.current, question }),
      });
      if (!res.ok || !res.body) throw new Error(`request failed: ${res.status}`);

      let accumulated = '';
      await readSse(res, (event, data) => {
        if (event === 'meta') {
          patchLast({ meta: data as Meta });
        } else if (event === 'token') {
          accumulated += (data as { text: string }).text;
          patchLast({ content: accumulated });
        } else if (event === 'citations') {
          patchLast({ citations: (data as { citations: Citation[] }).citations });
        } else if (event === 'done') {
          patchLast({ streaming: false });
        } else if (event === 'error') {
          throw new Error((data as { message: string }).message);
        }
      });
      patchLast({ streaming: false });
    } catch (e) {
      setError((e as Error).message);
      patchLast({ streaming: false });
    } finally {
      setPending(false);
    }
  }, [pending]);

  // NOTE: deliberately not returning chatId here. The brief's original code
  // returned `chatId: chatId.current`, which reads a ref's .current during
  // render/return — `npm run lint` flags this as a react-hooks/refs error
  // ("Cannot access ref value during render"). Nothing consumes this field
  // (ChatPanel destructures only turns/pending/error/send, and the documented
  // hook contract is `{ turns, pending, send, meta, error }`), so it's dropped
  // rather than papered over with a lint-suppression comment.
  return { turns, pending, error, send };
}
