import { getChatModel, textOf } from '../gemini';
import type { ChatTurn } from '../types';

const PROMPT = `Rewrite the user's latest message as a single standalone search query for a knowledge base about Gold Bank, a UK gold bullion dealer.

Rules:
- Resolve pronouns and references using the conversation.
- Keep the user's own vocabulary; do not answer the question.
- Output ONLY the query, one line, no quotes, no preamble.

Conversation:
{{HISTORY}}

Latest message: {{QUESTION}}

Standalone query:`;

/** Returns the question unchanged on the first turn — no call, no cost. */
export async function condenseQuery(turns: ChatTurn[], question: string): Promise<string> {
  const history = turns.filter((t) => t.content.trim() !== '');
  if (history.length === 0) return question;

  const rendered = history
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.slice(0, 500)}`)
    .join('\n');

  try {
    const res = await getChatModel(0).invoke(
      PROMPT.replace('{{HISTORY}}', rendered).replace('{{QUESTION}}', question),
    );
    const text = textOf(res.content);
    const line = text.trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
    return line.length >= 3 ? line : question;
  } catch {
    return question; // condensation is an optimisation, never a hard dependency
  }
}
