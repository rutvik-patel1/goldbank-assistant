import type { Meta } from '@/lib/useChatStream';

export function PipelineStrip({ meta }: { meta: Meta }) {
  return (
    <details className="mt-3 rounded-lg border border-line bg-panel text-sm">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">
        How this answer was built — {meta.retrieved.length} passages, top score{' '}
        {meta.topScore.toFixed(3)}
        {meta.ms ? ` · ${meta.ms}ms` : ''}
        {meta.gated ? ' · below threshold, generation skipped' : ''}
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Search query
          </div>
          <div className="mt-1">{meta.condensedQuery}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Retrieved passages
          </div>
          <ol className="mt-1 space-y-1">
            {meta.retrieved.map((r) => (
              <li key={r.chunkId} className="flex gap-2 text-xs">
                <span className="w-12 shrink-0 font-mono text-gold">{r.score.toFixed(3)}</span>
                <span className="w-14 shrink-0 text-muted">{r.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.headingPath.join(' › ')}</span>
                  <span className="block truncate text-muted">{r.snippet}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </details>
  );
}
