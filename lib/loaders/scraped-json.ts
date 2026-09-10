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
      title: String(meta.title ?? filename).replace(/\s*\|\s*Gold Bank\s*$/i, '').trim(),
      sourceUrl: (meta.sourceURL ?? meta.url) as string | undefined,
      filename,
      contentType: 'application/json',
    },
  };
}
