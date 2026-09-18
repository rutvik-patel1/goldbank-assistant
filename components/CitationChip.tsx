'use client';

import { useState } from 'react';
import { config } from '@/lib/config';
import type { Citation } from '@/lib/types';

export function CitationChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  const href = citation.sourceUrl
    ? citation.anchor ? `${citation.sourceUrl}#${citation.anchor}` : citation.sourceUrl
    : undefined;

  return (
    <div className="rounded-lg border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-gold-soft"
      >
        <span className="mt-0.5 shrink-0 rounded bg-gold-soft px-1.5 text-xs font-semibold text-gold">
          {citation.n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{citation.documentTitle}</span>
          <span className="block truncate text-xs text-muted">
            {citation.headingPath.slice(1).join(' › ') || citation.headingPath[0]}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2 text-sm">
          <p className="whitespace-pre-wrap text-muted">
            {citation.snippet}
            {citation.snippet.length >= config.CITATION_SNIPPET_CHARS ? '…' : ''}
          </p>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-block text-xs font-medium text-gold underline"
            >
              Read this section on goldbank.co.uk →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
