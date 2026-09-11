'use client';

import { useCallback, useState } from 'react';

export interface StageProgress {
  label: string;
  stage: string;
  done?: number;
  total?: number;
  chunks?: number;
  error?: string;
  skipped?: string;
  finishedMs?: number;
}

export function useIngest(onFinished: () => void) {
  const [progress, setProgress] = useState<Record<string, StageProgress>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setProgress(
      Object.fromEntries(files.map((f) => [f.name, { label: f.name, stage: 'queued' }])),
    );

    const form = new FormData();
    files.forEach((f) => form.append('files', f));

    try {
      const res = await fetch('/api/ingest', { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `upload failed: ${res.status}`);
      }
      if (!res.body) throw new Error('no response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let current = files[0]?.name ?? 'document';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
          const dataLine = /^data:\s*(.*)$/m.exec(frame)?.[1];
          if (!event || dataLine === undefined) continue;

          const data = JSON.parse(dataLine) as {
            documentId?: string; stage?: string; done?: number; total?: number;
            chunks?: number; message?: string; reason?: string; ms?: number;
          };
          // The server keys events by documentId once a record exists; before
          // that it keys by filename. Track whichever arrives.
          const key = data.documentId ?? current;
          current = key;

          setProgress((p) => {
            const prev = p[key] ?? { label: key, stage: 'queued' };
            if (event === 'status') {
              return { ...p, [key]: { ...prev, stage: data.stage ?? prev.stage, done: data.done, total: data.total, chunks: data.chunks ?? prev.chunks } };
            }
            if (event === 'done') {
              return { ...p, [key]: { ...prev, stage: 'ready', chunks: data.chunks, finishedMs: data.ms } };
            }
            if (event === 'skipped') {
              return { ...p, [key]: { ...prev, stage: 'skipped', skipped: data.reason } };
            }
            if (event === 'error') {
              return { ...p, [key]: { ...prev, stage: 'failed', error: data.message } };
            }
            return p;
          });
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onFinished();
    }
  }, [onFinished]);

  return { upload, progress, busy, error };
}
