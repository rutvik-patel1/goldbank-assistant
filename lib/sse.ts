export function sseStream<T>(
  run: (emit: (event: string, data: T) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Once the client aborts, enqueue() throws "Invalid state". If that throw
      // escapes, ingest catches it as a PIPELINE failure and deletes the vectors
      // of a document that had already finished — a closed tab destroying good
      // work. So emit() goes quiet after the first failure, and close() is guarded.
      let closed = false;
      const emit = (event: string, data: T) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // client went away; keep the server-side work running
        }
      };
      try {
        await run(emit);
      } catch (e) {
        emit('error', { message: (e as Error).message } as unknown as T);
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed by the client */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
