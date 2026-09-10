import type { ParsedDoc } from '../../lib/types';

interface Scraped {
  markdown?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export function loadScrapedJson(buf: Buffer, filename: string): ParsedDoc {
  const raw = JSON.parse(buf.toString('utf8')) as Scraped;
  const markdown = raw.markdown ?? raw.content;
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw new Error(`${filename}: JSON has no "markdown" string field`);
  }
  const meta = raw.metadata ?? {};
  const status = meta.statusCode;
  if (typeof status === 'number' && status >= 400) {
    throw new Error(`${filename}: scrape recorded HTTP ${status}; refusing to index an error page`);
  }
  return {
    markdown,
    metadata: {
      title: deriveTitle(markdown, meta, filename),
      sourceUrl: (meta.sourceURL ?? meta.url) as string | undefined,
      filename,
      contentType: 'application/json',
    },
  };
}

/**
 * Pick a title a human can tell apart in a citation.
 *
 * The scraped `<title>` is unusable across most of this corpus: six of the nine
 * indexable pages report the site-wide "Gold Bank - London", so citations and the
 * document library would show six identically-named sources and a reader could not
 * tell which policy an answer came from. Each document's own `# h1`, by contrast,
 * is specific and correct ("Cookies Policy", "Terms of Service", "Modern Slavery
 * Statement"), so prefer it and fall back only when it is absent.
 *
 * A useful side effect: when the title and the h1 agree, `chunkDocument`'s
 * breadcrumb dedup collapses them, so headingPath reads
 * "Cookies Policy › We Use the Following Cookies" rather than repeating the title.
 */
function deriveTitle(
  markdown: string,
  meta: Record<string, unknown>,
  filename: string,
): string {
  const h1 = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  if (h1) return h1;

  const scraped = String(meta.title ?? '')
    .replace(/\s*\|\s*Gold Bank\s*$/i, '')
    .trim();
  // Reject the site-wide default; it identifies nothing.
  if (scraped && !/^gold bank(\s*[-–|]\s*london)?$/i.test(scraped)) return scraped;

  // Last resort: humanise the URL slug, else the filename.
  const url = String(meta.sourceURL ?? meta.url ?? '');
  const slug = url.split('?')[0].replace(/\/$/, '').split('/').pop();
  if (slug) {
    return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return filename;
}
