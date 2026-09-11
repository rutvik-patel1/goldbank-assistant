import { sseStream } from '@/lib/sse';
import { appendTurn, getChat } from '@/lib/chats';
import { condenseQuery } from '@/lib/rag/condense';
import { retrieve } from '@/lib/rag/retrieve';
import { buildContext } from '@/lib/rag/context';
import { REFUSAL, streamAnswer, validateCitations } from '@/lib/rag/answer';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface Body {
  chatId?: string;
  question: string;
}

export async function POST(req: Request): Promise<Response> {
  const { chatId, question } = (await req.json()) as Body;
  if (!question || question.trim() === '') {
    return Response.json({ error: 'question is required' }, { status: 400 });
  }

  const session = chatId ? await getChat(chatId) : null;
  const priorTurns = session?.turns ?? [];

  return sseStream<unknown>(async (emit) => {
    const started = Date.now();

    if (session) await appendTurn(session.id, { role: 'user', content: question });

    const condensed = await condenseQuery(priorTurns, question);
    const { chunks, gated, topScore } = await retrieve(condensed);
    const { context, citations } = buildContext(chunks);

    emit('meta', {
      condensedQuery: condensed,
      topScore,
      gated,
      retrieved: chunks
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((c) => ({
          chunkId: c.id, score: c.score, kind: c.kind,
          headingPath: c.headingPath, snippet: c.text.slice(0, 160),
        })),
    });

    if (gated) {
      emit('token', { text: REFUSAL });
      emit('citations', { citations: [] });
      emit('done', { ms: Date.now() - started });
      if (session) {
        await appendTurn(session.id, {
          role: 'assistant', content: REFUSAL, citations: [],
          debug: { condensedQuery: condensed, retrieved: [], ms: Date.now() - started },
        });
      }
      return;
    }

    let raw = '';
    for await (const token of streamAnswer(question, context)) {
      raw += token;
      emit('token', { text: token });
    }

    const { answer, used } = validateCitations(raw, citations);
    emit('citations', { citations: used });
    emit('done', { ms: Date.now() - started, corrected: answer !== raw.trim() });

    if (session) {
      await appendTurn(session.id, {
        role: 'assistant',
        content: answer,
        citations: used,
        debug: {
          condensedQuery: condensed,
          retrieved: chunks.map((c) => ({ chunkId: c.id, score: c.score, headingPath: c.headingPath })),
          ms: Date.now() - started,
        },
      });
    }
  });
}
