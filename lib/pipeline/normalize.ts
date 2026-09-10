import { createHash } from 'node:crypto';
import { config } from '../config';

export function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

/** Strip the leading table-of-contents anchor list, returning it separately. */
export function splitLeadingTocList(markdown: string): { toc: string[]; rest: string } {
  const lines = markdown.split('\n');
  const toc: string[] = [];
  const kept: string[] = [];
  let inLeadingRegion = true;

  for (const line of lines) {
    const m = /^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*$/.exec(line);
    if (inLeadingRegion && m) {
      toc.push(`${m[1]}\t${m[2]}`);
      continue;
    }
    // The leading region ends at the first heading that follows any harvested links.
    if (toc.length > 0 && /^#{1,6}\s/.test(line)) inLeadingRegion = false;
    kept.push(line);
  }
  return { toc, rest: kept.join('\n') };
}

export function normalizeMarkdown(markdown: string): string {
  let md = markdown.replace(/\r\n?/g, '\n');

  // Drop boilerplate lines (reCAPTCHA notices, cookie banners, skip links).
  md = md
    .split('\n')
    .filter((line) => !config.BOILERPLATE_PATTERNS.some((re) => re.test(line.trim())))
    .join('\n');

  // Remove a leading "## Title" that merely repeats the "# Title" beneath it,
  // which every scraped GoldBank page contains.
  const dup = /^\s*##\s+(.+)\n+#\s+(.+)$/m.exec(md);
  if (dup) {
    const a = dup[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    const b = dup[2].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (a && (b.includes(a) || a.includes(b))) {
      md = md.replace(/^\s*##\s+.+\n+(?=#\s)/m, '');
    }
  }

  // Collapse runs of blank lines and trim trailing whitespace per line.
  md = md.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
  md = md.replace(/\n{3,}/g, '\n\n').trim();

  // Guarantee the document starts at h1.
  if (!/^#\s/.test(md)) {
    const firstHeading = /^(#{2,6})\s+(.+)$/m.exec(md);
    if (firstHeading) md = md.replace(/^#{2,6}(\s+)/m, '#$1');
  }
  return md;
}
