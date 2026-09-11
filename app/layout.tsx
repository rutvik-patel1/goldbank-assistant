import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gold Bank Assistant',
  description: 'RAG chatbot over the Gold Bank knowledge base',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">Gold Bank</span>
              <span className="text-sm text-muted">Assistant</span>
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="hover:text-gold">Chat</Link>
              <Link href="/knowledge" className="hover:text-gold">Knowledge base</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
