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

    // The server keys its first event for a file by FILENAME, then switches to the
    // server-assigned documentId once a manifest record exists. Naively keying rows
    // by whatever id arrives leaves an orphaned row frozen at "parsing" under the
    // filename plus a second row labelled with a raw nanoid. So track the file being
    // processed and migrate its row onto the real id exactly once — while still
    // allowing a .zip to open ADDITIONAL rows for the further documents inside it.
    const fileNames = new Set(files.map((f) => f.name));
    let fileLabel = files[0]?.name ?? 'document';
    let activeKey = fileLabel;
    let migrated = false;

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

          let data: {
            documentId?: string; stage?: string; done?: number; total?: number;
            chunks?: number; message?: string; reason?: string; ms?: number;
          };
          try {
            data = JSON.parse(dataLine);
          } catch {
            continue; // skip one malformed frame rather than abandoning the stream
          }

          // A filename-keyed event means the server has started a new file.
          if (data.documentId && fileNames.has(data.documentId)) {
            fileLabel = data.documentId;
            activeKey = data.documentId;
            migrated = false;
          }
          const key = data.documentId ?? activeKey;

          setProgress((p) => {
            const next = { ...p };
            let prev = next[key];
            if (!prev) {
              // First real documentId for this file: carry the filename row over.
              if (!migrated && next[activeKey]) {
                prev = next[activeKey];
                delete next[activeKey];
                migrated = true;
              } else {
                // A further document from the same upload (e.g. inside a zip).
                prev = { label: fileLabel, stage: 'queued' };
              }
            }

            if (event === 'status') {
              next[key] = { ...prev, stage: data.stage ?? prev.stage, done: data.done, total: data.total, chunks: data.chunks ?? prev.chunks };
            } else if (event === 'done') {
              next[key] = { ...prev, stage: 'ready', chunks: data.chunks, finishedMs: data.ms };
            } else if (event === 'skipped') {
              next[key] = { ...prev, stage: 'skipped', skipped: data.reason };
            } else if (event === 'error') {
              next[key] = { ...prev, stage: 'failed', error: data.message };
            } else {
              return p;
            }
            return next;
          });

          activeKey = key;
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
