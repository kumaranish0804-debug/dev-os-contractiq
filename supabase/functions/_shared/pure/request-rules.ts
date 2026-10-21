// Rate-limit window maths and CORS origin rules (Spec 03 §3.5–3.6).
// Pure module: zero imports, so Vitest can test the logic the Deno wrappers rely on.

export type RateLimitBucket = 'upload' | 'process' | 'chat';

export type RateLimitRule = { bucket: RateLimitBucket; limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  upload: { bucket: 'upload', limit: 20, windowSeconds: 3600 },
  process: { bucket: 'process', limit: 20, windowSeconds: 3600 },
  chat: { bucket: 'chat', limit: 30, windowSeconds: 600 },
} as const satisfies Record<RateLimitBucket, RateLimitRule>;

/** Seconds until the current fixed window ends — matches check_rate_limit()'s window start. */
export function retryAfterSeconds(windowSeconds: number, nowMs: number = Date.now()): number {
  const nowSeconds = Math.floor(nowMs / 1000);
  return windowSeconds - (nowSeconds % windowSeconds);
}

/** Parses the comma-separated ALLOWED_ORIGINS value; trailing slashes are ignored. */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}

/** Returns the origin to echo in Access-Control-Allow-Origin, or null for unknown origins. */
export function matchCorsOrigin(origin: string | null, allowed: readonly string[]): string | null {
  if (!origin) return null;
  return allowed.includes(origin) ? origin : null;
}

export const CORS_ALLOW_HEADERS = 'authorization, apikey, content-type, x-client-info';
export const CORS_ALLOW_METHODS = 'POST, OPTIONS';
