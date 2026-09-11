import unzipper from 'unzipper';

/** Expand a zip in memory. Returns [filename, buffer] for each regular file. */
export async function expandZip(buf: Buffer): Promise<[string, Buffer][]> {
  const dir = await unzipper.Open.buffer(buf);
  const out: [string, Buffer][] = [];
  for (const file of dir.files) {
    if (file.type !== 'File') continue;
    const base = file.path.split('/').pop() ?? file.path;
    if (base.startsWith('.') || base.startsWith('__MACOSX')) continue;
    out.push([base, await file.buffer()]);
  }
  return out;
}
