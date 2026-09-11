import { config } from '../config';
import { countTokens } from '../tokens';
import type { Citation, ScoredChunk } from '../types';

/**
 * Order retrieved chunks the way a reader would meet them — grouped by
 * document, then by original position — and number them for citation.
 * Answer-time context is verbatim chunk text only; enrichment never appears.
 */
export function buildContext(chunks: ScoredChunk[]): { context: string; citations: Citation[] } {
  const seen = new Set<string>();
  const unique = chunks.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  // Keep the strongest chunks when the budget binds, but present them in
  // document order so the model reads coherent passages.
  const ranked = [...unique].sort((a, b) => b.score - a.score);
  const kept: ScoredChunk[] = [];
  let tokens = 0;
  for (const c of ranked) {
    const t = countTokens(c.text) + 40; // header allowance
    if (tokens + t > config.CONTEXT_TOKEN_BUDGET && kept.length > 0) continue;
    kept.push(c);
    tokens += t;
  }

  // Group by document, then read in original order. documentId is the final
  // discriminator so this is a total order even if two documents shared a title.
  kept.sort((a, b) => {
    if (a.documentId === b.documentId) return a.ordinal - b.ordinal;
    const byTitle = a.sourceTitle.localeCompare(b.sourceTitle);
    return byTitle !== 0 ? byTitle : a.documentId.localeCompare(b.documentId);
  });

  const citations: Citation[] = [];
  const blocks: string[] = [];

  kept.forEach((c, i) => {
    const n = i + 1;
    const url = c.sourceUrl
      ? c.anchor ? `${c.sourceUrl}#${c.anchor}` : c.sourceUrl
      : undefined;
    const header = `[${n}] ${c.headingPath.join(' › ')}${url ? `  (${url})` : ''}`;
    blocks.push(`${header}\n${c.text}`);
    citations.push({
      n,
      chunkId: c.id,
      documentTitle: c.sourceTitle,
      headingPath: c.headingPath,
      sourceUrl: c.sourceUrl,
      anchor: c.anchor,
      snippet: c.text.slice(0, config.CITATION_SNIPPET_CHARS),
    });
  });

  return { context: blocks.join('\n\n---\n\n'), citations };
}
