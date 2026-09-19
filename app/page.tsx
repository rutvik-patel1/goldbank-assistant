import { ChatShell } from '@/components/ChatShell';
import { ChatPanel } from '@/components/ChatPanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // the conversation list changes underneath this page

export default function Home() {
  return (
    <ChatShell>
      <ChatPanel />
    </ChatShell>
  );
}
