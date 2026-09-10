import TurndownService from 'turndown';
import type { ParsedDoc } from '../../lib/types';

let td: TurndownService | null = null;
function service(): TurndownService {
  if (!td) {
    td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    td.remove(['script', 'style', 'noscript']);
  }
  return td;
}

export function htmlToMarkdown(html: string): string {
  return service().turndown(html);
}

export function loadHtml(buf: Buffer, filename: string): ParsedDoc {
  const html = buf.toString('utf8');
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || filename;
  const md = htmlToMarkdown(html);
  return {
    markdown: md.startsWith('#') ? md : `# ${title}\n\n${md}`,
    metadata: { title, filename, contentType: 'text/html' },
  };
}
