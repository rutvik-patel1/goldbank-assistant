'use client';

import { useRef, useState } from 'react';
import type { StageProgress } from '@/lib/useIngest';

const STAGES = ['parsing', 'chunking', 'enriching', 'embedding', 'ready'];

function StageBar({ p }: { p: StageProgress }) {
  if (p.stage === 'failed') {
    return <span className="text-sm text-gold">failed — {p.error}</span>;
  }
  if (p.stage === 'skipped') {
    return <span className="text-sm text-muted">skipped — {p.skipped}</span>;
  }

  const idx = STAGES.indexOf(p.stage);
  const inner = p.total ? Math.round((100 * (p.done ?? 0)) / p.total) : 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      {STAGES.map((s, i) => (
        <span
          key={s}
          className={
            i < idx ? 'text-muted' : i === idx ? 'font-semibold text-gold' : 'text-line'
          }
        >
          {s}
          {i === idx && p.total ? ` ${p.done}/${p.total} (${inner}%)` : ''}
        </span>
      ))}
      {p.stage === 'ready' && p.chunks !== undefined && (
        <span className="text-muted">
          · {p.chunks} chunks{p.finishedMs ? ` in ${(p.finishedMs / 1000).toFixed(1)}s` : ''}
        </span>
      )}
    </div>
  );
}

export function UploadZone({
  onUpload,
  progress,
  busy,
  error,
}: {
  onUpload: (files: File[]) => void;
  progress: Record<string, StageProgress>;
  busy: boolean;
  error: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = Object.entries(progress);

  return (
    <section className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onUpload([...e.dataTransfer.files]);
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragging ? 'border-gold bg-gold-soft' : 'border-line bg-panel'
        }`}
      >
        <p className="font-medium">Drop documents here</p>
        <p className="mt-1 text-sm text-muted">
          PDF, DOCX, Markdown, plain text, HTML, scraped JSON, or a ZIP of any of those
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-4 rounded-lg border border-line px-4 py-2 text-sm hover:border-gold disabled:opacity-40"
        >
          {busy ? 'Processing…' : 'Choose files'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.docx,.md,.txt,.html,.htm,.json,.zip"
          onChange={(e) => onUpload([...(e.target.files ?? [])])}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-gold">{error}</div>
      )}

      {rows.length > 0 && (
        <div className="space-y-2 rounded-xl border border-line bg-panel p-3">
          {rows.map(([key, p]) => (
            <div key={key}>
              <div className="truncate text-sm font-medium">{p.label}</div>
              <StageBar p={p} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
