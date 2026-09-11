import { CitationChip } from './CitationChip';
import { PipelineStrip } from './PipelineStrip';
import type { UiTurn } from '@/lib/useChatStream';

function renderWithMarkers(text: string) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (!m) return <span key={i}>{part}</span>;
    return (
      <sup key={i} className="mx-0.5 rounded bg-gold-soft px-1 text-[0.7em] font-semibold text-gold">
        {m[1]}
      </sup>
    );
  });
}

export function MessageBubble({ turn }: { turn: UiTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gold-soft px-4 py-2.5">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="prose-answer max-w-none">
        {turn.content
          ? turn.content.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{renderWithMarkers(para)}</p>
            ))
          : turn.streaming && <span className="text-muted">Searching the knowledge base…</span>}
        {turn.streaming && turn.content && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-gold align-middle" />
        )}
      </div>

      {turn.citations && turn.citations.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Sources</div>
          {turn.citations.map((c) => (
            <CitationChip key={c.chunkId} citation={c} />
          ))}
        </div>
      )}

      {turn.meta && <PipelineStrip meta={turn.meta} />}
    </div>
  );
}
