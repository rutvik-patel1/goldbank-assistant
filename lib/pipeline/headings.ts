import { config } from '../config';
import { splitLeadingTocList } from './normalize';

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor',
  'of', 'on', 'or', 'the', 'to', 'up', 'via', 'with', 'is', 'are', 'be',
]);

/**
 * A numbered section title, e.g. `1\. Important information and who we are`.
 * The privacy policy numbers its eight top-level sections this way and carries
 * NO table-of-contents list, so this deterministic signal is the only reliable
 * way to recover its structure. The optional backslash is markdown's escape of
 * the period, which the scrape preserves.
 */
const NUMBERED_HEADING = /^(\d+)\\?\.\s+(.+)$/;

/**
 * A label/value line, e.g. `Postal address: 215 The Broadway, Southall, UB1 1NB`
 * or `Telephone number: 02035001111`. These are predominantly capitalized (proper
 * nouns, postcodes) and so pass a Title-Case test, but they are contact data, not
 * section titles. The corpus contains four of them in the privacy policy alone.
 */
const LABEL_LINE = /^[^:]{1,40}:\s*\S/;

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
export function isNumberedHeading(line: string): boolean {
  return NUMBERED_HEADING.test(line.trim());
}

/** Shape rules that disqualify a line from being any kind of heading. */
function passesBaseExclusions(t: string): boolean {
  if (t.length === 0 || t.length > config.MAX_HEADING_CHARS) return false;
  if (/^#{1,6}\s/.test(t)) return false;              // already a heading
  // List item — but a numbered heading (`1\. Title`) looks like one, so exempt it.
  if (/^\s*([-*+]|\d+[.)])\s/.test(t) && !NUMBERED_HEADING.test(t)) return false;
  if (/^[|>]/.test(t)) return false;                  // table row or blockquote
  // Terminal punctuation — but a numbered heading may legitimately be phrased as
  // a question ("3\. How is your personal data collected?"), so exempt it here too.
  // The exemption is deliberately limited to NUMBERED headings: FAQ questions also
  // end in "?" and must stay body text, because the Q&A splitter pairs each one
  // with its answer inside a section rather than treating it as a section title.
  if (/[.:;!?]$/.test(t) && !NUMBERED_HEADING.test(t)) return false;
  if (/^\*\*.*\*\*$/.test(t)) return false;           // fully bold = emphasis, not a heading
  if (/^\[.*\]\(.*\)$/.test(t)) return false;         // bare link
  if (/\]\(/.test(t)) return false;                   // contains an inline link
  if (LABEL_LINE.test(t)) return false;               // `Postal address: …` is contact data

  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 3) return false;
  const upperRatio = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (upperRatio > 0.9) return false;                 // SHOUTED emphasis, not a heading
  return true;
}

/** Predominantly Title Case, e.g. `Acceptable Use`, `We May Make Changes to Our Site`. */
function isTitleCaseHeading(t: string): boolean {
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 14) return false;
  const significant = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  if (significant.length === 0) return false;
  const capitalized = significant.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalized / significant.length >= config.HEADING_CAPS_RATIO;
}

/**
 * Sentence case, e.g. `Purpose of this privacy policy`, `Your legal rights`.
 * The privacy policy writes its subheadings this way, so a Title-Case-only test
 * recovers 6 of its ~26 sections and leaves a 28 KB document nearly structureless.
 * Kept tight — short, few words, and comma-free — so body sentences (which end in
 * terminal punctuation and are caught above anyway) cannot slip through.
 */
function isSentenceCaseHeading(t: string): boolean {
  const words = t.split(/\s+/).filter(Boolean);
  return (
    t.length <= config.MAX_SENTENCE_HEADING_CHARS &&
    words.length <= config.MAX_SENTENCE_HEADING_WORDS &&
    /^[A-Z]/.test(t) &&
    !t.includes(',')
  );
}

/**
 * True when a standalone line looks like a section title rendered as body text.
 * Three accepting signals, any of which suffices: numbered, Title Case, or
 * sentence case. All share one set of disqualifying shape rules.
 */
export function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!passesBaseExclusions(t)) return false;
  return NUMBERED_HEADING.test(t) || isTitleCaseHeading(t) || isSentenceCaseHeading(t);
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
  let sawNumberedSection = false;

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
      // Once a document has shown numbered top-level sections (the privacy
      // policy's `1\.`…`8\.`), later unnumbered titles are their subsections —
      // nesting them yields breadcrumbs like
      // `Privacy Policy › 4. How we use your personal data › Promotional offers from us`
      // instead of 26 flat siblings. Documents without numbering stay flat at h2.
      const numbered = isNumberedHeading(title);
      if (numbered) sawNumberedSection = true;
      const level = !numbered && sawNumberedSection ? '###' : '##';
      out.push(`${level} ${title}`);
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
