import { config } from '../config';
import { getChatModel, textOf } from '../gemini';
import type { Citation } from '../types';

export const SYSTEM_PROMPT = `You are the Gold Bank assistant. Gold Bank is a UK gold bullion dealer. You answer customer questions using ONLY the numbered context passages supplied below.

How to answer:
- Ground every factual statement in the context. Cite the passage with its number in square brackets, like [1] or [2][3], immediately after the statement it supports.
- Quote exact figures, fees, and timeframes from the context rather than paraphrasing them loosely.
- If the context answers part of the question, answer that part and then say plainly which part you do not have information about.
- If the context does not answer the question at all, say so and suggest what the customer could ask instead. Never fill the gap from general knowledge.
- Be concise and direct. Use short paragraphs, and a bulleted list when the context itself is a list.

Hard limits:
- Never give investment, tax, or legal advice, and never predict gold prices. If asked, say that Gold Bank cannot advise on this and point to the relevant policy in the context if there is one.
- Never invent policies, prices, phone numbers, or timeframes.
- Never mention "context", "passages", or "the documents" — speak as Gold Bank's assistant.`;

export function buildUserPrompt(question: string, context: string): string {
  return `Context passages:\n\n${context}\n\n---\n\nCustomer question: ${question}`;
}

export async function* streamAnswer(question: string, context: string): AsyncGenerator<string> {
  const model = getChatModel(config.CHAT_TEMPERATURE);
  const stream = await model.stream([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(question, context) },
  ]);
  for await (const chunk of stream) {
    const text = textOf(chunk.content);
    if (text) yield text;
  }
}

export const REFUSAL =
  "I don't have anything about that in the Gold Bank knowledge base. I can help with " +
  'membership points, payment options, delivery and shipping, order cancellations, ' +
  'returns, and our privacy and cookie policies.';

/**
 * Strip citation markers that point at passages we never supplied, and report
 * which citations the answer actually used so the UI shows no dead chips.
 */
export function validateCitations(
  answer: string,
  citations: Citation[],
): { answer: string; used: Citation[] } {
  const valid = new Set(citations.map((c) => c.n));
  const usedNumbers = new Set<number>();

  // Only ONE- or TWO-digit groups are treated as citation markers. Context never
  // holds more than a handful of passages, whereas this corpus quotes statutes by
  // year — "the Financial Services Regulations 2004" — and a model writing "[2004]"
  // must not have it silently deleted from an otherwise correct answer.
  const cleaned = answer.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g, (_match, group: string) => {
    const nums = group.split(',').map((s) => Number(s.trim())).filter((n) => valid.has(n));
    nums.forEach((n) => usedNumbers.add(n));
    return nums.length ? nums.map((n) => `[${n}]`).join('') : '';
  });

  return {
    answer: cleaned
      .replace(/[ \t]{2,}/g, ' ')
      // Tidy the space a stripped marker leaves behind, before any closing punctuation.
      .replace(/ +([.,;:!?)\]])/g, '$1')
      .trim(),
    used: citations.filter((c) => usedNumbers.has(c.n)),
  };
}
