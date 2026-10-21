import { authenticate } from './auth.ts';
import { corsHeaders } from './cors.ts';
import { AppError, errorJson } from './errors.ts';
import { log } from './logging.ts';
import { enforceRateLimit, type RateLimitRule } from './rate-limit.ts';
import { createAdminClient, type TypedClient } from './supabase.ts';

export type HandlerContext = {
  req: Request;
  userId: string;
  requestId: string;
  /** Service role — bypasses RLS. Always filter by userId. */
  admin: TypedClient;
  /** Acts as the caller — RLS applies. */
  userClient: TypedClient;
};

type HandlerOptions = {
  /** Function name, used in logs. */
  name: string;
  method: 'POST';
  rateLimit?: RateLimitRule;
};

/**
 * Wraps a user-facing Edge Function (Spec 03 §3.5): CORS preflight, method check,
 * JWT auth, rate limit, §3.2 error envelope and one structured log line per request.
 * Cron functions (retention-cleanup, daily-alerts) authenticate differently and do not use this.
 */
export function createHandler(
  opts: HandlerOptions,
  fn: (ctx: HandlerContext) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const started = performance.now();
    const requestId = crypto.randomUUID();
    const cors = corsHeaders(req);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    let userId: string | undefined;
    let response: Response;
    let errorCode: string | undefined;

    try {
      if (req.method !== opts.method) throw new AppError('NOT_FOUND');
      const auth = await authenticate(req);
      userId = auth.userId;
      const admin = createAdminClient();
      if (opts.rateLimit) await enforceRateLimit(admin, userId, opts.rateLimit, requestId);

      response = await fn({ req, userId, requestId, admin, userClient: auth.userClient });
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      response.headers.set('x-request-id', requestId);
    } catch (e) {
      errorCode = e instanceof AppError ? e.code : 'INTERNAL';
      response = errorJson(e, requestId, cors, opts.name);
    }

    log(response.status >= 500 ? 'error' : 'info', {
      fn: opts.name,
      requestId,
      userId,
      status: response.status,
      ms: Math.round(performance.now() - started),
      errorCode,
    });
    return response;
  };
}
