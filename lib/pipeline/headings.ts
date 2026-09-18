import { config } from '../config';
import { splitLeadingTocList } from './normalize';

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor',
  'of', 'on', 'or', 'the', 'to', 'up', 'via', 'with', 'is', 'are', 'be',
]);

/**
 * A numbered section title, e.g. `1\. Important information and who we are`.
 * The privacy policy numbers its ten top-level sections this way and carries
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

/**
 * Shape rules that disqualify a line from being any kind of heading.
 *
 * The rules divide in two. STRUCTURAL rules apply to every candidate. STYLE
 * rules describe prose that merely resembles a heading, and every one of them
 * is exempted for numbered lines — an explicit `1\. …` marker is a stronger
 * statement of intent than any style signal, so a numbered heading must not be
 * vetoed for being bold, question-phrased, colon-bearing, or list-shaped.
 * Applying the exemption to only some style rules is how a numbered section
 * ends up silently missing from the recovered tree.
 *
 * The exemption is limited to NUMBERED lines on purpose: FAQ questions also end
 * in "?" and must stay body text, because the Q&A splitter pairs each question
 * with its answer INSIDE a section rather than treating it as a section title.
 */
function passesBaseExclusions(t: string): boolean {
  const numbered = NUMBERED_HEADING.test(t);

  // --- Structural: never a heading, numbered or not.
  if (t.length === 0 || t.length > config.MAX_HEADING_CHARS) return false;
  if (/^#{1,6}\s/.test(t)) return false;              // already a heading
  if (/^[|>]/.test(t)) return false;                  // table row or blockquote
  if (/^\[.*\]\(.*\)$/.test(t)) return false;         // bare link
  if (/\]\(/.test(t)) return false;                   // contains an inline link

  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length < config.MIN_HEADING_LETTERS) return false;
  const upperRatio = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (upperRatio > config.MAX_HEADING_UPPER_RATIO) return false;  // SHOUTED emphasis

  // --- Style: prose that resembles a heading. All exempted for numbered lines.
  if (numbered) return true;
  if (/^\s*([-*+]|\d+[.)])\s/.test(t)) return false;  // list item
  if (/[.:;!?]$/.test(t)) return false;               // terminal punctuation
  if (/^\*\*.*\*\*$/.test(t)) return false;           // fully bold = emphasis
  if (LABEL_LINE.test(t)) return false;               // `Postal address: …` is contact data
  return true;
}

/** Predominantly Title Case, e.g. `Acceptable Use`, `We May Make Changes to Our Site`. */
function isTitleCaseHeading(t: string): boolean {
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > config.MAX_HEADING_WORDS) return false;
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
 * paragraphs. The leading TOC anchor list is authoritative (and yields real
 * URL fragments for deep-linked citations); sections it omits fall back to
 * `looksLikeHeading`'s three signals — numbered, Title Case, or sentence case.
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
      // Unescape markdown's `1\.` numbering: headingPath feeds citation
      // breadcrumbs in the UI, where a literal backslash would show through.
      const title = line
        .trim()
        .replace(/^\*\*|\*\*$/g, '')
        .replace(/^(\d+)\\\.(\s)/, '$1.$2');
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
      // First write wins: two sections whose titles normalize identically must not
      // silently overwrite each other's deep-link anchor.
      const anchorKey = normalizeTitle(title);
      if (tocAnchors[key] && !anchors[anchorKey]) anchors[anchorKey] = tocAnchors[key];
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
