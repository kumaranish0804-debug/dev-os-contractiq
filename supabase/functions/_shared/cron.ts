// Shared plumbing for pg_cron-triggered functions (Spec 11 §11.1–11.2). There is no user, so these
// don't use createHandler: they authenticate with the x-cron-secret header instead of a JWT.
import { log } from './logging.ts';

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Constant-time comparison: both sides are hashed to equal length, then compared without early exit. */
export async function secretsMatch(given: string | null, expected: string): Promise<boolean> {
  if (!given) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * POST-only, x-cron-secret-authenticated handler. A wrong or missing secret gets 401 before `run`
 * is called, so it has no side effects. Logs one line per invocation.
 */
export function cronHandler(
  name: string,
  cronSecret: string | undefined,
  run: () => Promise<Record<string, unknown>>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const started = performance.now();
    if (!cronSecret) {
      log('error', { fn: name, event: 'cron_secret_missing' });
      return json(500, { error: 'not configured' });
    }
    if (req.method !== 'POST' || !(await secretsMatch(req.headers.get('x-cron-secret'), cronSecret))) {
      log('warn', { fn: name, event: 'cron_unauthorized', method: req.method });
      return json(401, { error: 'unauthorized' });
    }
    try {
      const body = await run();
      return json(200, body);
    } catch (e) {
      log('error', { fn: name, event: 'cron_failed', error: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - started) });
      return json(500, { error: 'failed' });
    }
  };
}
