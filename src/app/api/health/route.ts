import { createClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DB_TIMEOUT_MS = 3000;

/**
 * GET /api/health — public liveness for Uptime Robot and the in-app HealthBanner (Spec 11 §11.4).
 * Anonymous client, no cookies: health_check() reads no data. No error detail is returned.
 */
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const supabase = createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.rpc('health_check').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error || data !== true) throw new Error(error?.message ?? 'health_check returned no result');
    return Response.json({ status: 'ok', db: 'ok', time: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', route: 'GET /api/health', error: e instanceof Error ? e.message : String(e) }));
    return Response.json({ status: 'degraded', db: 'down' }, { status: 503, headers });
  }
}
