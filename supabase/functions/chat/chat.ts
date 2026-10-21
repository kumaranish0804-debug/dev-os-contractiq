import { z } from 'zod';
import { createAzureAgentComplete } from '../_shared/azure-agent.ts';
import { buildChatMessages, CHAT_SETTINGS, type HistoryMessage } from '../_shared/chat-context.ts';
import { costUsd } from '../_shared/cost.ts';
import { AppError, type ErrorCode } from '../_shared/errors.ts';
import type { HandlerContext } from '../_shared/handler.ts';
import { exposeUpstreamErrors, upstreamMessage, withRetry, type CompleteFn, type TokenUsage } from '../_shared/llm.ts';
import { log } from '../_shared/logging.ts';
import { hasConversationAttribution, parseCitations } from '../_shared/pure/citations.ts';
import { LIMITS } from '../_shared/pure/limits.ts';
import { NOT_FOUND_IN_CONVERSATION, NOT_FOUND_IN_DOCUMENT, PROMPT_VERSION } from '../_shared/pure/prompts.ts';
import { classifyQuery, type QueryType } from '../_shared/pure/query-classifier.ts';
import { env } from '../_shared/supabase.ts';

// Spec 09 §9.5: one JSON response per question. The Azure agent answers in a single call, so
// every outcome is either the answer or the error envelope — and the assistant message is
// always saved (complete or error) once the question has been stored.

export const CHAT_TIMINGS = { totalMs: 45_000 };

export type ChatDeps = {
  /**
   * Builds the chat agent client. Reads secrets lazily, inside the failure path. `model` prices
   * the call only when the agent's response does not name its model.
   */
  createComplete: () => Promise<{ complete: CompleteFn; model: string | null }>;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  timings?: typeof CHAT_TIMINGS;
};

export const defaultDeps: ChatDeps = {
  createComplete: async () => ({
    complete: createAzureAgentComplete({
      apiKey: env('AZURE_API_KEY'),
      endpoint: env('AZURE_CHAT_AGENT_ENDPOINT'),
      apiVersion: Deno.env.get('AZURE_API_VERSION') || undefined,
    }),
    model: Deno.env.get('AZURE_CHAT_MODEL') || null,
  }),
  now: () => Date.now(),
};

export type ChatResponse = {
  session_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  query_type: QueryType;
  content: string;
  cited_pages: number[];
};

const bodySchema = z.object({
  contract_id: z.string().uuid(),
  message: z.string().trim().min(1).max(LIMITS.chatMessageMax),
});

/** One slot for the user message, one for the reply (Spec 02 cap of 200). */
const MAX_COUNT_BEFORE_SEND = LIMITS.chatSessionMax - 1;

async function readBody(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    throw new AppError('INVALID_INPUT', { cause: e });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.contract_id && Object.keys(fieldErrors).length === 1) throw new AppError('NOT_FOUND');
    throw new AppError('INVALID_INPUT', { details: { fieldErrors } });
  }
  return parsed.data;
}

async function getOrCreateSession(ctx: HandlerContext, contractId: string) {
  const select = () =>
    ctx.admin
      .from('chat_sessions')
      .select('id, message_count')
      .eq('contract_id', contractId)
      .eq('user_id', ctx.userId)
      .maybeSingle();

  const existing = await select();
  if (existing.error) throw new Error(`chat_sessions select failed: ${existing.error.message}`);
  if (existing.data) return existing.data;

  const created = await ctx.admin
    .from('chat_sessions')
    .insert({ contract_id: contractId, user_id: ctx.userId })
    .select('id, message_count')
    .single();
  if (!created.error && created.data) return created.data;
  if (created.error?.code === '23505') {
    // Another request created it first.
    const again = await select();
    if (again.data) return again.data;
  }
  throw new Error(`chat_sessions insert failed: ${created.error?.message ?? 'no row'}`);
}

/**
 * A grounded answer should attribute its facts. Not a miss: the two not-found sentences, pure
 * history questions (no page to cite), and BOTH answers sourced only from the conversation.
 */
export function isCitationMiss(answer: string, cited: number[], queryType: QueryType): boolean {
  if (cited.length > 0 || queryType === 'history') return false;
  if (queryType === 'both' && hasConversationAttribution(answer)) return false;
  const text = answer.trim();
  return text !== NOT_FOUND_IN_DOCUMENT && text !== NOT_FOUND_IN_CONVERSATION;
}

export async function handleChat(ctx: HandlerContext, deps: ChatDeps = defaultDeps): Promise<Response> {
  const timings = deps.timings ?? CHAT_TIMINGS;
  const startedAt = deps.now();
  const { contract_id: contractId, message } = await readBody(ctx.req);

  const { data: contract, error: contractError } = await ctx.admin
    .from('contracts')
    .select('id, status, contract_text, page_count, contract_type')
    .eq('id', contractId)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (contractError) throw new Error(`contracts select failed: ${contractError.message}`);
  if (!contract) throw new AppError('NOT_FOUND');
  if (contract.status !== 'completed') throw new AppError('CONTRACT_NOT_READY');

  const session = await getOrCreateSession(ctx, contractId);
  if (session.message_count >= MAX_COUNT_BEFORE_SEND) throw new AppError('CHAT_LIMIT_REACHED');

  // ORDER MATTERS: load history BEFORE saving the new question. Saved first, the question would
  // appear in its own history and skew classification and context (tested in chat.test.ts).
  const { data: historyRows, error: historyError } = await ctx.admin
    .from('chat_messages')
    .select('role, content, status, created_at')
    .eq('session_id', session.id)
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: true })
    .limit(LIMITS.chatSessionMax);
  if (historyError) throw new Error(`chat_messages select failed: ${historyError.message}`);
  const history = (historyRows ?? []) as HistoryMessage[];

  const queryType: QueryType = classifyQuery(message, history);
  const { data: userMessage, error: userInsertError } = await ctx.admin
    .from('chat_messages')
    .insert({ session_id: session.id, user_id: ctx.userId, role: 'user', content: message, query_type: queryType })
    .select('id')
    .single();
  if (userInsertError || !userMessage) {
    if (userInsertError?.message.includes('CHAT_LIMIT_REACHED')) throw new AppError('CHAT_LIMIT_REACHED');
    throw new Error(`chat_messages insert failed: ${userInsertError?.message ?? 'no row'}`);
  }

  const messages = buildChatMessages({
    queryType,
    contractType: contract.contract_type,
    contractText: contract.contract_text,
    history,
    question: message,
  });

  const abort = new AbortController();
  let timedOut = false;
  let clientGone = false;
  const totalTimer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, timings.totalMs);
  const onClientAbort = () => {
    clientGone = true;
    abort.abort();
  };
  ctx.req.signal?.addEventListener('abort', onClientAbort, { once: true });

  let model: string | null = null;
  let attempts = 0;
  let usage: TokenUsage = { prompt: 0, cached: 0, completion: 0 };
  let callStarted = 0;
  let callEnded = 0;

  const saveAssistant = async (status: 'complete' | 'error', content: string, cited: number[]) => {
    const { data, error } = await ctx.admin
      .from('chat_messages')
      .insert({
        session_id: session.id,
        user_id: ctx.userId,
        role: 'assistant',
        content,
        cited_pages: cited,
        query_type: queryType,
        status,
      })
      .select('id')
      .single();
    if (error) log('error', { event: 'assistant_message_save_failed', requestId: ctx.requestId, error: error.message });
    return (data as { id: string } | null)?.id ?? null;
  };

  /**
   * `errorCode` is a catalogue code, CLIENT_ABORTED when the user stopped waiting, or
   * NO_CITATION on a successful answer that cites no page (Spec 11 §11.2).
   */
  const logChat = async (success: boolean, errorCode?: ErrorCode | 'CLIENT_ABORTED' | 'NO_CITATION') => {
    const priced = model ? costUsd(model, usage.prompt, usage.cached, usage.completion) : { cost: 0, known: true };
    if (!priced.known) log('warn', { event: 'pricing_unknown_model', model });
    const { error } = await ctx.admin.from('processing_logs').insert({
      user_id: ctx.userId,
      contract_id: contractId,
      kind: 'chat',
      model,
      prompt_version: PROMPT_VERSION,
      prompt_tokens: usage.prompt,
      completion_tokens: usage.completion,
      cached_tokens: usage.cached,
      cost_usd: priced.cost,
      openai_ms: callStarted ? (callEnded || deps.now()) - callStarted : null,
      total_ms: deps.now() - startedAt,
      attempts: Math.min(Math.max(attempts, 0), 10),
      success,
      error_code: errorCode ?? null,
    });
    if (error) log('warn', { event: 'processing_log_failed', requestId: ctx.requestId, error: error.message });
  };

  try {
    const client = await deps.createComplete();
    model = client.model;
    callStarted = deps.now();

    const { result: completion, attempts: tries } = await withRetry(
      (attempt) => {
        attempts = attempt;
        return client.complete(messages, { ...CHAT_SETTINGS, json: false }, abort.signal);
      },
      { startedAt, budgetMs: timings.totalMs, now: deps.now, sleep: deps.sleep },
    );
    callEnded = deps.now();
    attempts = tries;
    usage = completion.usage;
    model = completion.model ?? model;
    if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const content = completion.content ?? '';
    if (!content.trim()) throw new AppError('AI_UNAVAILABLE', { details: devDetails('Agent returned an empty answer') });

    const cited = parseCitations(content, contract.page_count);
    const messageId = await saveAssistant('complete', content, cited);
    await logChat(true, isCitationMiss(content, cited, queryType) ? 'NO_CITATION' : undefined);

    const body: ChatResponse = {
      session_id: session.id,
      user_message_id: userMessage.id,
      assistant_message_id: messageId,
      query_type: queryType,
      content,
      cited_pages: cited,
    };
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const code: ErrorCode = timedOut ? 'AI_TIMEOUT' : e instanceof AppError ? e.code : 'AI_UNAVAILABLE';
    if (!(e instanceof AppError) && !timedOut && !clientGone) {
      log('error', { event: 'chat_agent_failed', requestId: ctx.requestId, error: upstreamMessage(e) });
    }
    // The failed answer is saved as status 'error', and excluded from future model context.
    await saveAssistant('error', '', []);
    await logChat(false, clientGone && !timedOut ? 'CLIENT_ABORTED' : code);
    const details = e instanceof AppError && e.details !== undefined ? e.details : devDetails(upstreamMessage(e));
    throw new AppError(code, { cause: e, details });
  } finally {
    clearTimeout(totalTimer);
    ctx.req.signal?.removeEventListener('abort', onClientAbort);
  }
}

/** The real failure text, returned only outside production (see exposeUpstreamErrors). */
function devDetails(upstream: string): { upstream: string } | undefined {
  return exposeUpstreamErrors() ? { upstream } : undefined;
}
