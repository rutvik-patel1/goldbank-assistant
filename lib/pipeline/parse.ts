import { extname } from 'node:path';
import { config } from '../config';
import type { ParsedDoc } from '../types';
import { loadScrapedJson } from '../loaders/scraped-json';
import { loadPdf } from '../loaders/pdf';
import { loadDocx } from '../loaders/docx';
import { loadHtml } from '../loaders/html';
import { loadText } from '../loaders/text';
import { expandZip } from '../loaders/zip';
import { normalizeMarkdown } from './normalize';

async function loadOne(buf: Buffer, filename: string): Promise<ParsedDoc> {
  switch (extname(filename).toLowerCase()) {
    case '.json': return loadScrapedJson(buf, filename);
    case '.pdf':  return loadPdf(buf, filename);
    case '.docx': return loadDocx(buf, filename);
    case '.html':
    case '.htm':  return loadHtml(buf, filename);
    case '.md':
    case '.txt':  return loadText(buf, filename);
    default:
      throw new Error(
        `${filename}: unsupported format. Supported: ${config.SUPPORTED_EXTENSIONS.join(', ')}`,
      );
  }
}

/** Parse one uploaded file into one or more normalized documents. */
export async function parseFile(buf: Buffer, filename: string): Promise<ParsedDoc[]> {
  if (extname(filename).toLowerCase() === '.zip') {
    const members = await expandZip(buf);
    const docs: ParsedDoc[] = [];
    const errors: string[] = [];
    for (const [name, memberBuf] of members) {
      if (!config.SUPPORTED_EXTENSIONS.includes(extname(name).toLowerCase())) continue;
      if (extname(name).toLowerCase() === '.zip') continue; // no nested zips
      try {
        docs.push(await loadOne(memberBuf, name));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (docs.length === 0) {
      throw new Error(
        `${filename}: no supported documents found in archive` +
        (errors.length ? ` (${errors.length} failed: ${errors[0]})` : ''),
      );
    }
    return docs.map((d) => ({ ...d, markdown: normalizeMarkdown(d.markdown) }));
  }

  const doc = await loadOne(buf, filename);
  return [{ ...doc, markdown: normalizeMarkdown(doc.markdown) }];
}
