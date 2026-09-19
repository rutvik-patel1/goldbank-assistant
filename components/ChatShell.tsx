import { listChats } from '@/lib/chats';
import { ConversationSidebar } from '@/components/ConversationSidebar';

/**
 * Two-column shell for the chat routes. Reads the conversation list directly
 * from lib/ — this is the server, so fetching our own API would be a needless
 * round trip — and renders it before hydration.
 *
 * Only `/` and `/c/[id]` use this; `/knowledge` keeps its full-width layout,
 * where a conversation list would be noise.
 */
export async function ChatShell({
  activeId,
  children,
}: {
  activeId?: string;
  children: React.ReactNode;
}) {
  const chats = await listChats();
  const conversations = chats.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));

  return (
    <div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Above the chat on narrow screens, beside it from md up. */}
      <aside className="md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:self-start md:overflow-y-auto">
        <ConversationSidebar conversations={conversations} activeId={activeId} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
