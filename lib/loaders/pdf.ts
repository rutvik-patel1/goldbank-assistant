import type { ParsedDoc } from '../../lib/types';

type PdfFn = (data: Buffer) => Promise<{ text: string; numpages: number; info?: Record<string, unknown> }>;

async function resolvePdf(): Promise<PdfFn> {
  const mod = (await import('pdf-parse')) as unknown as Record<string, unknown>;
  const fn = (mod.default ?? mod.pdf ?? mod) as unknown;
  if (typeof fn !== 'function') throw new Error('Could not resolve the pdf-parse entry point');
  return fn as PdfFn;
}

export async function loadPdf(buf: Buffer, filename: string): Promise<ParsedDoc> {
  const pdf = await resolvePdf();
  let out: Awaited<ReturnType<PdfFn>>;
  try {
    out = await pdf(buf);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/password|encrypt/i.test(msg)) {
      throw new Error(`${filename}: encrypted PDF — password required`);
    }
    throw new Error(`${filename}: could not parse PDF — ${msg}`);
  }

  const text = out.text.trim();
  if (text.length < 40) {
    throw new Error(
      `${filename}: no extractable text (${text.length} chars across ${out.numpages} pages). ` +
      `This is likely a scanned/image-only PDF; OCR is out of scope.`,
    );
  }

  const title = String((out.info?.Title as string) ?? '').trim() || filename.replace(/\.pdf$/i, '');
  return {
    markdown: `# ${title}\n\n${text}`,
    metadata: { title, filename, contentType: 'application/pdf', pageCount: out.numpages },
  };
}
