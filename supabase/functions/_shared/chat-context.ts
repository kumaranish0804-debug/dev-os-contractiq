import { encode } from 'gpt-tokenizer/model/gpt-4o';
import type { ChatMessage } from './llm.ts';
import { CHAT_SYSTEM_HISTORY, renderChatSystem } from './pure/prompts.ts';
import type { QueryType } from './pure/query-classifier.ts';

// Chat message assembly — the conversation memory layer (Spec 09 §9.6, prompt v1.1).

export const CHAT_SETTINGS = { temperature: 0.4, maxTokens: 1000 } as const;
export const CONTEXT_TOKEN_BUDGET = 100_000;

/**
 * Conversation turns (a question + its answer) sent per question type. CONTRACT and BOTH also carry
 * the whole contract, so they keep the recent 10; HISTORY has no contract and can look further back.
 */
export const TURN_LIMITS: Record<QueryType, number> = { contract: 10, both: 10, history: 20 };

export type HistoryMessage = { role: 'user' | 'assistant'; content: string; status: 'complete' | 'error' };

/** The last `turns` turns, each starting at a user message (so a turn keeps its answer). */
export function lastTurns(history: ChatMessage[], turns: number): ChatMessage[] {
  const starts = history.flatMap((m, i) => (m.role === 'user' ? [i] : []));
  if (starts.length <= turns) return history.slice(starts[0] ?? history.length);
  return history.slice(starts[starts.length - turns]);
}

/**
 * [system for the question type (+ contract unless HISTORY)] → recent completed history → question.
 * `history` must be loaded before the new question is saved, so it never contains the question.
 * After the turn cap, a token guard drops the oldest pairs; the contract is never truncated.
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
      ? CHAT_SYSTEM_HISTORY
      : renderChatSystem({
          queryType: input.queryType,
          contractType: input.contractType,
          contractText: input.contractText,
        });

  // Failed assistant turns never reach the model.
  const completed: ChatMessage[] = input.history
    .filter((m) => m.status === 'complete')
    .map((m) => ({ role: m.role, content: m.content }));
  let history = lastTurns(completed, TURN_LIMITS[input.queryType]);

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
