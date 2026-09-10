import type { ParsedDoc } from '../../lib/types';

export function loadText(buf: Buffer, filename: string): ParsedDoc {
  const body = buf.toString('utf8');
  const isMd = /\.md$/i.test(filename);
  const title = filename.replace(/\.(md|txt)$/i, '');
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return {
    markdown: isMd && h1 ? body : `# ${title}\n\n${body}`,
    metadata: { title: h1 ?? title, filename, contentType: isMd ? 'text/markdown' : 'text/plain' },
  };
}
