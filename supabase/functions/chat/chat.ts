import { z } from 'zod';
import { buildChatMessages, CHAT_SETTINGS, type HistoryMessage } from '../_shared/chat-context.ts';
import { costUsd } from '../_shared/cost.ts';
import { AppError, ERROR_CATALOGUE, type ErrorCode } from '../_shared/errors.ts';
import type { HandlerContext } from '../_shared/handler.ts';
import { log } from '../_shared/logging.ts';
import { createOpenAIStream, hashUserId, withRetry, type StreamFn, type TokenUsage } from '../_shared/openai.ts';
import { parseCitations } from '../_shared/pure/citations.ts';
import { LIMITS } from '../_shared/pure/limits.ts';
import { NOT_FOUND_IN_CONVERSATION, NOT_FOUND_IN_DOCUMENT, PROMPT_VERSION } from '../_shared/pure/prompts-v1.ts';
import { classifyQuery, type QueryType } from '../_shared/pure/query-classifier.ts';
import { env } from '../_shared/supabase.ts';

// Spec 09 §9.5: pre-stream checks return the JSON error envelope; once streaming starts every
// outcome is an SSE event, and the assistant message is always saved (complete or error).

export const CHAT_TIMINGS = { heartbeatMs: 10_000, firstTokenMs: 20_000, totalMs: 45_000 };

export type ChatDeps = {
  /** Builds the model stream for this user. Reads secrets lazily, inside the stream. */
  createStream: (userId: string) => Promise<{ stream: StreamFn; model: string }>;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  timings?: typeof CHAT_TIMINGS;
};

export const defaultDeps: ChatDeps = {
  createStream: async (userId) => {
    const model = env('OPENAI_MODEL');
    const stream = createOpenAIStream({
      apiKey: env('OPENAI_API_KEY'),
      model,
      baseURL: Deno.env.get('OPENAI_BASE_URL') || undefined,
      userHash: await hashUserId(userId, env('OPENAI_USER_HASH_SALT')),
    });
    return { stream, model };
  },
  now: () => Date.now(),
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
 * A grounded answer about the document should cite a page. Not a miss: the two not-found
 * sentences, and pure history questions ("what did you say earlier?"), which have no page to cite.
 */
export function isCitationMiss(answer: string, cited: number[], queryType: QueryType): boolean {
  if (cited.length > 0 || queryType === 'history') return false;
  const text = answer.trim();
  return text !== NOT_FOUND_IN_DOCUMENT && text !== NOT_FOUND_IN_CONVERSATION;
}

const encoder = new TextEncoder();
const sseEvent = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

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
  const timeout = () => {
    timedOut = true;
    abort.abort();
  };
  const onClientAbort = () => {
    clientGone = true;
    abort.abort();
  };
  ctx.req.signal?.addEventListener('abort', onClientAbort, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: Uint8Array) => {
        if (closed || clientGone) return;
        try {
          controller.enqueue(chunk);
        } catch {
          onClientAbort();
        }
      };

      let full = '';
      let model: string | null = null;
      let attempts = 0;
      let usage: TokenUsage = { prompt: 0, cached: 0, completion: 0 };
      let streamStarted = 0;
      let streamEnded = 0;

      const heartbeat = setInterval(() => write(encoder.encode(': ping\n\n')), timings.heartbeatMs);
      const firstTokenTimer = setTimeout(timeout, timings.firstTokenMs);
      const totalTimer = setTimeout(timeout, timings.totalMs);
      const stopTimers = () => {
        clearInterval(heartbeat);
        clearTimeout(firstTokenTimer);
        clearTimeout(totalTimer);
      };

      write(sseEvent('meta', { user_message_id: userMessage.id, session_id: session.id, query_type: queryType }));

      const saveAssistant = async (status: 'complete' | 'error', cited: number[]) => {
        const { data, error } = await ctx.admin
          .from('chat_messages')
          .insert({
            session_id: session.id,
            user_id: ctx.userId,
            role: 'assistant',
            content: full,
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
       * `errorCode` is a catalogue code, CLIENT_ABORTED when the user stopped the answer, or
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
          openai_ms: streamStarted ? (streamEnded || deps.now()) - streamStarted : null,
          total_ms: deps.now() - startedAt,
          attempts: Math.min(Math.max(attempts, 0), 10),
          success,
          error_code: errorCode ?? null,
        });
        if (error) log('warn', { event: 'processing_log_failed', requestId: ctx.requestId, error: error.message });
      };

      try {
        const client = await deps.createStream(ctx.userId);
        model = client.model;
        streamStarted = deps.now();

        // Retries only before the stream opens; never once tokens have been sent.
        const { result: chunks, attempts: tries } = await withRetry(
          () => client.stream(messages, CHAT_SETTINGS, abort.signal),
          { startedAt, budgetMs: timings.firstTokenMs, now: deps.now, sleep: deps.sleep },
        );
        attempts = tries;

        for await (const chunk of chunks) {
          if (abort.signal.aborted) break;
          if (chunk.usage) usage = chunk.usage;
          if (chunk.text) {
            if (!full) {
              clearTimeout(firstTokenTimer);
              clearInterval(heartbeat);
            }
            full += chunk.text;
            write(sseEvent('delta', { text: chunk.text }));
          }
        }
        streamEnded = deps.now();
        if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        stopTimers();
        const cited = parseCitations(full, contract.page_count);
        const messageId = await saveAssistant('complete', cited);
        write(sseEvent('done', { message_id: messageId, cited_pages: cited, content_length: full.length }));
        await logChat(true, isCitationMiss(full, cited, queryType) ? 'NO_CITATION' : undefined);
      } catch (e) {
        stopTimers();
        const code: ErrorCode = timedOut ? 'AI_TIMEOUT' : e instanceof AppError ? e.code : 'AI_UNAVAILABLE';
        if (!(e instanceof AppError) && !timedOut && !clientGone) {
          log('error', {
            event: 'chat_stream_failed',
            requestId: ctx.requestId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        // The partial answer is kept (status 'error'), and excluded from future model context.
        await saveAssistant('error', []);
        await logChat(false, clientGone && !timedOut ? 'CLIENT_ABORTED' : code);
        if (!clientGone) write(sseEvent('error', { code, message: ERROR_CATALOGUE[code].message }));
      } finally {
        ctx.req.signal?.removeEventListener('abort', onClientAbort);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by a disconnected client
        }
      }
    },
    cancel() {
      onClientAbort();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
