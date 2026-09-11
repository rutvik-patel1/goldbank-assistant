import { CitationChip } from './CitationChip';
import { PipelineStrip } from './PipelineStrip';
import type { UiTurn } from '@/lib/useChatStream';

/**
 * The model answers in markdown — the system prompt asks for a bulleted list
 * when the source is a list, and a live answer to "How does the points system
 * work?" comes back as "* You earn 1 point for every £1...". Rendering only the
 * citation markers would put literal asterisks on screen for the first seed
 * question, so handle the small subset of markdown the model actually emits:
 * unordered lists and bold. Anything else renders as plain text.
 */

/** Citation markers are one or two digits, matching validateCitations. */
function renderMarkers(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\[\d{1,2}\])/g).map((part, i) => {
    const m = /^\[(\d{1,2})\]$/.exec(part);
    if (!m) return <span key={`${keyPrefix}-t${i}`}>{part}</span>;
    return (
      <sup
        key={`${keyPrefix}-m${i}`}
        className="mx-0.5 rounded bg-gold-soft px-1 text-[0.7em] font-semibold text-gold"
      >
        {m[1]}
      </sup>
    );
  });
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  text.split(/(\*\*[^*]+\*\*)/g).forEach((segment, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(segment);
    if (bold) {
      out.push(
        <strong key={`${keyPrefix}-b${i}`}>{renderMarkers(bold[1], `${keyPrefix}-b${i}`)}</strong>,
      );
    } else if (segment) {
      out.push(...renderMarkers(segment, `${keyPrefix}-s${i}`));
    }
  });
  return out;
}

const BULLET = /^\s*[*\-•]\s+/;

function renderAnswer(content: string): React.ReactNode[] {
  return content.split(/\n{2,}/).flatMap((block, bi) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    // A block whose every line is a bullet becomes a real list.
    if (lines.every((l) => BULLET.test(l))) {
      return [
        <ul key={`b${bi}`}>
          {lines.map((l, li) => (
            <li key={`b${bi}-${li}`}>{renderInline(l.replace(BULLET, ''), `b${bi}-${li}`)}</li>
          ))}
        </ul>,
      ];
    }

    // A block that opens with prose and continues into bullets: split it.
    const firstBullet = lines.findIndex((l) => BULLET.test(l));
    if (firstBullet > 0) {
      return [
        <p key={`b${bi}p`}>{renderInline(lines.slice(0, firstBullet).join(' '), `b${bi}p`)}</p>,
        <ul key={`b${bi}u`}>
          {lines.slice(firstBullet).map((l, li) => (
            <li key={`b${bi}u-${li}`}>{renderInline(l.replace(BULLET, ''), `b${bi}u-${li}`)}</li>
          ))}
        </ul>,
      ];
    }

    return [<p key={`b${bi}`}>{renderInline(block, `b${bi}`)}</p>];
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
          ? renderAnswer(turn.content)
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
