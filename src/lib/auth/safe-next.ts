export const DEFAULT_AFTER_LOGIN = '/dashboard';

/**
 * Returns a same-origin path to redirect to after sign-in, or /dashboard.
 * Blocks open redirects such as //evil.com, /\evil.com and absolute URLs (Spec 04 §4.7).
 */
export function safeNext(next?: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return DEFAULT_AFTER_LOGIN;
  }
  return next;
}
