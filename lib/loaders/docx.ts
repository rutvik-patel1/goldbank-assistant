import mammoth from 'mammoth';
import type { ParsedDoc } from '../../lib/types';
import { htmlToMarkdown } from './html';

export async function loadDocx(buf: Buffer, filename: string): Promise<ParsedDoc> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const title = filename.replace(/\.docx$/i, '');
  const md = htmlToMarkdown(html);
  return {
    markdown: md.startsWith('#') ? md : `# ${title}\n\n${md}`,
    metadata: { title, filename, contentType: 'docx' },
  };
}
