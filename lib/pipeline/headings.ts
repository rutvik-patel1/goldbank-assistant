import { config } from '../config';
import { splitLeadingTocList } from './normalize';

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor',
  'of', 'on', 'or', 'the', 'to', 'up', 'via', 'with', 'is', 'are', 'be',
]);

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function anchorOf(url: string): string | undefined {
  const i = url.indexOf('#');
  return i >= 0 ? url.slice(i + 1) : undefined;
}

/**
 * True when a standalone line looks like a section title rendered as body text:
 * short, unpunctuated, and predominantly Title Case.
 */
export function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > config.MAX_HEADING_CHARS) return false;
  if (/^#{1,6}\s/.test(t)) return false;              // already a heading
  if (/^\s*([-*+]|\d+[.)])\s/.test(t)) return false;  // list item
  if (/^[|>]/.test(t)) return false;                  // table row or blockquote
  if (/[.:;!?]$/.test(t)) return false;               // terminal punctuation
  if (/^\*\*.*\*\*$/.test(t)) return false;           // fully bold = emphasis, not a heading
  if (/^\[.*\]\(.*\)$/.test(t)) return false;         // bare link
  if (/\]\(/.test(t)) return false;                   // contains an inline link

  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 3) return false;
  const upperRatio = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (upperRatio > 0.9) return false;                 // SHOUTED emphasis, not a heading

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 14) return false;
  const significant = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  if (significant.length === 0) return false;
  const capitalized = significant.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalized / significant.length >= config.HEADING_CAPS_RATIO;
}

/**
 * Reconstruct document structure for pages whose section titles are unmarked
 * paragraphs. Two signals: the leading TOC anchor list (authoritative, and it
 * yields real URL fragments for deep-linked citations) and a Title-Case
 * heuristic for sections the TOC omits.
 */
export function promoteHeadings(markdown: string): {
  markdown: string;
  anchors: Record<string, string>;
  promoted: string[];
} {
  const { toc, rest } = splitLeadingTocList(markdown);

  const tocAnchors: Record<string, string> = {};
  const tocTitles = new Set<string>();
  for (const entry of toc) {
    const [text, url] = entry.split('\t');
    const key = normalizeTitle(text);
    if (!key) continue;
    tocTitles.add(key);
    const a = anchorOf(url ?? '');
    if (a) tocAnchors[key] = a;
  }

  const lines = rest.split('\n');
  const out: string[] = [];
  const anchors: Record<string, string> = {};
  const promoted: string[] = [];
  let inFence = false;

  const nextNonBlank = (from: number): string | null => {
    for (let j = from; j < lines.length; j++) {
      if (lines[j].trim() !== '') return lines[j];
    }
    return null;
  };
  const prevIsBlankOrStart = (i: number): boolean =>
    i === 0 || lines[i - 1].trim() === '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) inFence = !inFence;

    if (inFence || !prevIsBlankOrStart(i) || line.trim() === '') {
      out.push(line);
      continue;
    }

    const key = normalizeTitle(line);
    const inToc = key.length > 0 && tocTitles.has(key);
    const heuristic = looksLikeHeading(line);

    // A heading must be followed by content, and that content must not itself
    // be a heading (two consecutive headings means we misread one of them).
    const following = nextNonBlank(i + 1);
    const followedByContent = following !== null && !/^#{1,6}\s/.test(following.trim());

    if ((inToc || heuristic) && followedByContent) {
      const title = line.trim().replace(/^\*\*|\*\*$/g, '');
      out.push(`## ${title}`);
      promoted.push(title);
      if (tocAnchors[key]) anchors[normalizeTitle(title)] = tocAnchors[key];
      continue;
    }

    out.push(line);
  }

  // Existing real headings also deserve their TOC anchor, when one matches.
  for (const line of out) {
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (!m) continue;
    const key = normalizeTitle(m[1]);
    if (tocAnchors[key] && !anchors[key]) anchors[key] = tocAnchors[key];
  }

  return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n'), anchors, promoted };
}
