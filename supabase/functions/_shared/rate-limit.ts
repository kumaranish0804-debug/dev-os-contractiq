import { AppError } from './errors.ts';
import { log } from './logging.ts';
import { retryAfterSeconds, type RateLimitRule } from './pure/request-rules.ts';
import type { TypedClient } from './supabase.ts';

export { RATE_LIMITS, type RateLimitRule } from './pure/request-rules.ts';

/**
 * Fixed-window rate limit via check_rate_limit() (Spec 03 §3.6).
 * Over the limit → 429 RATE_LIMITED with Retry-After. If the limiter itself fails,
 * the request is allowed (fail open) and `rate_limit_unavailable` is logged.
 */
export async function enforceRateLimit(
  admin: TypedClient,
  userId: string,
  rule: RateLimitRule,
  requestId?: string,
): Promise<void> {
  const { data: allowed, error } = await admin.rpc('check_rate_limit', {
    p_user_id: userId,
    p_bucket: rule.bucket,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });

  if (error) {
    log('warn', { event: 'rate_limit_unavailable', requestId, userId, bucket: rule.bucket });
    return;
  }

  if (allowed === false) {
    throw new AppError('RATE_LIMITED', {
      headers: { 'Retry-After': String(retryAfterSeconds(rule.windowSeconds)) },
    });
  }
}
