import type { ParsedDoc } from '../../lib/types';

/**
 * pdf-parse v2 exposes a class, not a function: `new PDFParse({data}).getText()`
 * resolves to `{ pages, text, total }`. It also injects `-- n of m --` page
 * separators into `text`, which must be stripped before the text is measured or
 * indexed, or an image-only PDF's separator noise would pass the emptiness guard.
 */
const PAGE_SEPARATOR = /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm;

export async function loadPdf(buf: Buffer, filename: string): Promise<ParsedDoc> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });

  try {
    const result = await parser.getText();
    const text = result.text.replace(PAGE_SEPARATOR, '').replace(/\n{3,}/g, '\n\n').trim();
    const pageCount = result.total ?? result.pages?.length ?? 0;

    if (text.length < 40) {
      throw new Error(
        `${filename}: no extractable text (${text.length} chars across ${pageCount} pages). ` +
        `This is likely a scanned/image-only PDF; OCR is out of scope.`,
      );
    }

    let title = filename.replace(/\.pdf$/i, '');
    try {
      const info = await parser.getInfo();
      const t = (info as { info?: { Title?: unknown } }).info?.Title;
      if (typeof t === 'string' && t.trim()) title = t.trim();
    } catch {
      // Metadata is optional; the filename is a fine title.
    }

    return {
      markdown: `# ${title}\n\n${text}`,
      metadata: { title, filename, contentType: 'application/pdf', pageCount },
    };
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.startsWith(`${filename}:`)) throw e; // our own guard, already formatted
    if (/password|encrypt/i.test(msg)) {
      throw new Error(`${filename}: encrypted PDF — password required`);
    }
    throw new Error(`${filename}: could not parse PDF — ${msg}`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
