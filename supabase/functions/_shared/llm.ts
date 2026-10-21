import { AppError } from './errors.ts';
import { log } from './logging.ts';

// Model access contract and retry policy (Spec 03 §3.7). Callers receive a `CompleteFn`, so tests
// and the eval harness can substitute a fake without touching the network. The production
// implementation is the Azure AI Foundry agent client in azure-agent.ts.

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type TokenUsage = { prompt: number; cached: number; completion: number };

export type Completion = {
  content: string | null;
  /** 'stop', or 'length' when the output was cut off at the token limit. */
  finishReason: string | null;
  usage: TokenUsage;
  /** The model that served the call, as reported by the provider (used for pricing). */
  model: string | null;
};

export type CompletionOptions = { temperature: number; maxTokens: number; json: boolean };

export type CompleteFn = (
  messages: ChatMessage[],
  options: CompletionOptions,
  signal?: AbortSignal,
) => Promise<Completion>;

export type ErrorClass = 'retryable' | 'timeout' | 'fatal';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Classifies OpenAI-SDK-shaped errors by name/status so plain test doubles classify the same way. */
export function classifyLlmError(e: unknown): ErrorClass {
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

/** The provider's own error text, for logs and (outside production) the error envelope. */
export function upstreamMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Up to 3 attempts with 1 s / 2 s backoff (+0–250 ms jitter) on 429/5xx/timeouts.
 * Final failure → AI_TIMEOUT (last error was a timeout) or AI_UNAVAILABLE; 4xx → INTERNAL.
 * The provider's message rides along as `details.upstream` (see exposeUpstreamErrors).
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
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return { result: await call(attempt), attempts: attempt };
    } catch (e) {
      lastError = e;
      lastClass = classifyLlmError(e);
      if (lastClass === 'fatal') {
        log('error', {
          event: 'llm_fatal_error',
          status: (e as { status?: number })?.status ?? null,
          error: upstreamMessage(e),
        });
        throw new AppError('INTERNAL', { cause: e, details: upstreamDetails(e) });
      }
      log('warn', { event: 'llm_retryable_error', attempt, errorClass: lastClass, error: upstreamMessage(e) });

      if (attempt === maxAttempts) break;
      const delay = (BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)!) + Math.floor(random() * JITTER_MS);
      // Spec 06 §6.5: once the 55 s budget is spent, skip the remaining retries.
      if (now() - startedAt + delay >= budgetMs) {
        throw new AppError('AI_TIMEOUT', { cause: e, details: upstreamDetails(e) });
      }
      await sleep(delay);
    }
  }
  throw new AppError(lastClass === 'timeout' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', {
    cause: lastError,
    details: upstreamDetails(lastError),
  });
}

/**
 * The real provider error is what diagnoses a bad key, endpoint or api-version, so it is returned
 * to the client — but only when ENVIRONMENT=development, never in production responses.
 */
export function exposeUpstreamErrors(): boolean {
  return Deno.env.get('ENVIRONMENT') === 'development';
}

function upstreamDetails(e: unknown): { upstream: string } | undefined {
  return e !== undefined && exposeUpstreamErrors() ? { upstream: upstreamMessage(e) } : undefined;
}
