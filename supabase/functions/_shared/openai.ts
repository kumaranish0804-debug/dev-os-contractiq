import OpenAI from 'openai';
import { AppError } from './errors.ts';
import { log } from './logging.ts';

// OpenAI access and retry policy (Spec 03 §3.7). Callers receive a `CompleteFn`, so tests and
// the eval harness can substitute a fake without touching the network.

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type TokenUsage = { prompt: number; cached: number; completion: number };

export type Completion = {
  content: string | null;
  finishReason: string | null;
  usage: TokenUsage;
};

export type CompletionOptions = { temperature: number; maxTokens: number; json: boolean };

export type CompleteFn = (messages: ChatMessage[], options: CompletionOptions) => Promise<Completion>;

const REQUEST_TIMEOUT_MS = 20_000;

/** Chat Completions with the SDK's own retries off — withRetry owns the policy. */
export function createOpenAIComplete(config: {
  apiKey: string;
  model: string;
  baseURL?: string;
  userHash: string;
}): CompleteFn {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL || undefined,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });

  return async (messages, options) => {
    const response = await client.chat.completions.create({
      model: config.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      response_format: options.json ? { type: 'json_object' } : undefined,
      user: config.userHash,
    });
    const choice = response.choices[0];
    return {
      content: choice?.message?.content ?? null,
      finishReason: choice?.finish_reason ?? null,
      usage: {
        prompt: response.usage?.prompt_tokens ?? 0,
        cached: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        completion: response.usage?.completion_tokens ?? 0,
      },
    };
  };
}

export type StreamChunk = { text?: string; usage?: TokenUsage };

/**
 * Opens a streamed completion. The returned promise settles once the HTTP stream is open (so
 * connection errors and 429/5xx are retryable); chunks then arrive through the iterable.
 */
export type StreamFn = (
  messages: ChatMessage[],
  options: { temperature: number; maxTokens: number },
  signal: AbortSignal,
) => Promise<AsyncIterable<StreamChunk>>;

export function createOpenAIStream(config: {
  apiKey: string;
  model: string;
  baseURL?: string;
  userHash: string;
}): StreamFn {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL || undefined,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });

  return async (messages, options, signal) => {
    const stream = await client.chat.completions.create(
      {
        model: config.model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        user: config.userHash,
      },
      { signal },
    );
    return (async function* () {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? undefined;
        const usage = chunk.usage
          ? {
              prompt: chunk.usage.prompt_tokens ?? 0,
              cached: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
              completion: chunk.usage.completion_tokens ?? 0,
            }
          : undefined;
        if (text || usage) yield { text: text || undefined, usage };
      }
    })();
  };
}

/** hex(SHA-256(salt + userId)) — sent as the OpenAI `user` param instead of the raw id. */
export async function hashUserId(userId: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + userId));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type ErrorClass = 'retryable' | 'timeout' | 'fatal';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Classifies SDK errors by name/status so plain test doubles classify the same way. */
export function classifyOpenAIError(e: unknown): ErrorClass {
  const { name, status } = (e ?? {}) as { name?: unknown; status?: unknown };
  if (name === 'APIConnectionTimeoutError' || name === 'TimeoutError') return 'timeout';
  if (name === 'APIConnectionError') return 'retryable';
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status) ? 'retryable' : 'fatal';
  return 'fatal';
}

export type RetryOptions = {
  maxAttempts?: number;
  /** Start of the whole request; retries stop once the budget would be exceeded. */
  startedAt?: number;
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

const BACKOFF_MS = [1000, 2000];
const JITTER_MS = 250;

/**
 * Up to 3 attempts with 1 s / 2 s backoff (+0–250 ms jitter) on 429/5xx/timeouts.
 * Final failure → AI_TIMEOUT (last error was a timeout) or AI_UNAVAILABLE; 4xx → INTERNAL.
 */
export async function withRetry<T>(
  call: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<{ result: T; attempts: number }> {
  const {
    maxAttempts = 3,
    budgetMs = 55_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    random = Math.random,
  } = options;
  const startedAt = options.startedAt ?? now();

  let lastClass: ErrorClass = 'retryable';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return { result: await call(attempt), attempts: attempt };
    } catch (e) {
      lastClass = classifyOpenAIError(e);
      if (lastClass === 'fatal') {
        log('error', {
          event: 'openai_fatal_error',
          status: (e as { status?: number })?.status ?? null,
          error: (e as Error)?.message ?? String(e),
        });
        throw new AppError('INTERNAL', { cause: e });
      }
      log('warn', { event: 'openai_retryable_error', attempt, errorClass: lastClass });

      if (attempt === maxAttempts) break;
      const delay = (BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)!) + Math.floor(random() * JITTER_MS);
      // Spec 06 §6.5: once the 55 s budget is spent, skip the remaining retries.
      if (now() - startedAt + delay >= budgetMs) {
        throw new AppError('AI_TIMEOUT', { cause: e });
      }
      await sleep(delay);
    }
  }
  throw new AppError(lastClass === 'timeout' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
}
