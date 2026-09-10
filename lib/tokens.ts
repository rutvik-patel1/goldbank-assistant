import { encode } from 'gpt-tokenizer';

/**
 * Token count used only for budgeting. This is a GPT tokenizer, not Gemini's,
 * so treat it as a consistent proxy rather than an exact count.
 */
export function countTokens(text: string): number {
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
