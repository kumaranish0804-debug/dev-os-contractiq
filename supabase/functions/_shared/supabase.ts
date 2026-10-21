import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import { AppError } from './errors.ts';

export type TypedClient = SupabaseClient<Database>;

/** Reads a required secret. A missing value is a deployment error, surfaced as INTERNAL. */
export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new AppError('INTERNAL', { cause: new Error(`Missing env var ${name}`) });
  return value;
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

/**
 * Service-role client: bypasses RLS. Every query on a user-owned table MUST filter by
 * user_id (or call an RPC that takes p_user_id) — Spec 03 §3.5, enforced by
 * tests/unit/service-role-filter.test.ts.
 */
export function createAdminClient(): TypedClient {
  return createClient<Database>(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), clientOptions);
}

/** Client that acts as the caller: RLS applies with their JWT. */
export function createUserClient(accessToken: string): TypedClient {
  return createClient<Database>(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
