import { encode } from 'gpt-tokenizer/model/gpt-4o';
import type { ChatMessage } from './openai.ts';
import { CHAT_SYSTEM_HISTORY_V1, renderChatSystem } from './pure/prompts-v1.ts';
import type { QueryType } from './pure/query-classifier.ts';

// Chat message assembly (Spec 09 §9.6).

export const CHAT_SETTINGS = { temperature: 0.4, maxTokens: 1000 } as const;
export const CONTEXT_TOKEN_BUDGET = 100_000;

export type HistoryMessage = { role: 'user' | 'assistant'; content: string; status: 'complete' | 'error' };

/**
 * [system (+ contract unless history-only)] → completed history (ascending) → question.
 * Over the token budget, the oldest history pairs are dropped; the contract is never truncated.
 */
export function buildChatMessages(
  input: {
    queryType: QueryType;
    contractType: 'NDA' | 'MSA';
    contractText: string;
    history: HistoryMessage[];
    question: string;
  },
  countTokens: (s: string) => number = (s) => encode(s).length,
): ChatMessage[] {
  const system =
    input.queryType === 'history'
      ? CHAT_SYSTEM_HISTORY_V1
      : renderChatSystem({
          queryType: input.queryType,
          contractType: input.contractType,
          contractText: input.contractText,
        });

  // Failed assistant turns never reach the model.
  let history: ChatMessage[] = input.history
    .filter((m) => m.status === 'complete')
    .map((m) => ({ role: m.role, content: m.content }));

  const fixed = countTokens(system) + countTokens(input.question) + CHAT_SETTINGS.maxTokens;
  const historyTokens = history.map((m) => countTokens(m.content));
  let total = fixed + historyTokens.reduce((a, b) => a + b, 0);
  let drop = 0;
  while (total > CONTEXT_TOKEN_BUDGET && drop < history.length) {
    // Drop a whole user/assistant pair where possible, so roles keep alternating.
    const step = history[drop]?.role === 'user' && history[drop + 1]?.role === 'assistant' ? 2 : 1;
    for (let i = 0; i < step; i++) total -= historyTokens[drop + i]!;
    drop += step;
  }
  history = history.slice(drop);

  return [{ role: 'system', content: system }, ...history, { role: 'user', content: input.question }];
}
