import { notFound } from 'next/navigation';
import { getChat } from '@/lib/chats';
import { ChatPanel } from '@/components/ChatPanel';
import { ChatShell } from '@/components/ChatShell';
import type { UiTurn } from '@/lib/useChatStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function SharedChat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) notFound();

  const turns: UiTurn[] = chat.turns.map((t) => ({
    role: t.role,
    content: t.content,
    citations: t.citations,
    meta: t.debug
      ? {
          condensedQuery: t.debug.condensedQuery ?? '',
          topScore: t.debug.retrieved?.[0]?.score ?? 0,
          gated: (t.debug.retrieved?.length ?? 0) === 0,
          retrieved: (t.debug.retrieved ?? []).map((r) => ({
            chunkId: r.chunkId, score: r.score, kind: '', headingPath: r.headingPath, snippet: '',
          })),
          ms: t.debug.ms,
        }
      : undefined,
  }));

  return (
    <ChatShell activeId={chat.id}>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">{chat.title}</h1>
          <span className="text-xs text-muted">
            Resumed · {new Date(chat.updatedAt).toLocaleString()}
          </span>
        </div>
        <ChatPanel initialTurns={turns} initialChatId={chat.id} />
      </div>
    </ChatShell>
  );
}
