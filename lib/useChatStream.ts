'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  // Held in state, not a ref: the share URL must be renderable. (An earlier ref
  // could not be returned without tripping react-hooks/refs, which left /c/[id]
  // unreachable — every conversation persisted and no way to find its link.)
  const [chatId, setChatId] = useState<string | null>(null);
  const chatId_ = useRef<string | null>(null);
  // `pending` is state, so a second submit fired before React commits the
  // pending render would pass the guard and corrupt patchLast's "last turn"
  // target. A ref closes that window synchronously.
  const sending = useRef(false);
  // Abort an in-flight stream on unmount: otherwise navigating away keeps the
  // reader running, keeps calling setState on a dead hook, and keeps burning
  // the free-tier request budget for a response nobody will see.
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(async (question: string) => {
    if (!question.trim() || sending.current) return;
    sending.current = true;
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
      const controller = new AbortController();
      abort.current = controller;

      if (!chatId_.current) {
        const created = await fetch('/api/chats', {
          method: 'POST',
          signal: controller.signal,
        });
        if (!created.ok) throw new Error(`could not start a conversation (${created.status})`);
        const id = ((await created.json()) as { chat: { id: string } }).chat.id;
        chatId_.current = id;
        setChatId(id);
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: chatId_.current, question }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`request failed: ${res.status}`);

      let accumulated = '';
      await readSse(res, (event, data) => {
        if (event === 'meta') {
          patchLast({ meta: data as Meta });
        } else if (event === 'token') {
          accumulated += (data as { text: string }).text;
          patchLast({ content: accumulated });
        } else if (event === 'answer') {
          // Replace the raw stream with the validated text so dead markers are
          // gone before the user reads them, and the live view matches /c/[id].
          accumulated = (data as { answer: string }).answer;
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
      // An abort is a deliberate unmount, not an error worth showing.
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      patchLast({ streaming: false });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }, []);

  return { turns, pending, error, send, chatId };
}
