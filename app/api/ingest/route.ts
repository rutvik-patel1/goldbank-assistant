import { basename, extname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, paths } from '@/lib/config';
import { sseStream } from '@/lib/sse';
import { assertDimensions } from '@/lib/store';
import { ingestBuffer, type IngestEvent } from '@/lib/pipeline/ingest';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Reduce a multipart filename to a single safe path segment. */
function safeUploadName(name: string): string {
  const base = basename(name).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return /^[\w.\- ]{1,120}$/.test(base) ? base : 'upload';
}

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return Response.json({ error: 'No files provided under the "files" field.' }, { status: 400 });
  }

  for (const file of files) {
    if (file.size > config.MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: `${file.name} is ${(file.size / 1e6).toFixed(1)}MB; the limit is ${(config.MAX_UPLOAD_BYTES / 1e6).toFixed(0)}MB.` },
        { status: 413 },
      );
    }
    if (!config.SUPPORTED_EXTENSIONS.includes(extname(file.name).toLowerCase())) {
      return Response.json(
        { error: `${file.name}: unsupported format. Supported: ${config.SUPPORTED_EXTENSIONS.join(', ')}` },
        { status: 415 },
      );
    }
  }

  return sseStream<IngestEvent | { message: string }>(async (emit) => {
    await assertDimensions();
    await mkdir(paths.uploads, { recursive: true });

    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      // A multipart filename is attacker-controlled. Unsanitised, join() lets it
      // escape ./data/uploads entirely — "x/../../../pwned.json" resolves to the
      // repo root — which is an unauthenticated arbitrary file write. basename()
      // strips any path, and the allowlist rejects what is left if it is odd.
      await writeFile(join(paths.uploads, `${Date.now()}-${safeUploadName(file.name)}`), buf);
      emit('status', { type: 'status', documentId: file.name, stage: 'parsing' } as IngestEvent);
      await ingestBuffer(buf, file.name, (e) => emit(e.type, e));
    }
  });
}
