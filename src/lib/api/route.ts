import type { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ApiError } from '@/lib/api/api-error';

// Server half of the API layer (Spec 03 §3.4). Import only from route handlers.

/** Builds the §3.2 error envelope. Unexpected errors are logged and returned as INTERNAL. */
export function errorResponse(e: unknown, requestId: string = crypto.randomUUID()): Response {
  const error = e instanceof ApiError ? e : new ApiError('INTERNAL');
  if (!(e instanceof ApiError)) {
    console.error(JSON.stringify({ level: 'error', requestId, error: String(e) }));
  }
  return Response.json(error.toEnvelope(requestId), {
    status: error.status,
    headers: { 'x-request-id': requestId },
  });
}

/** Returns the user-scoped Supabase client (RLS enforced) and the signed-in user. */
export async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiError('UNAUTHENTICATED');
  return { supabase, user };
}

export function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError('INVALID_INPUT', {
      details: { fieldErrors: result.error.flatten().fieldErrors },
    });
  }
  return result.data;
}

/** Reads a JSON body; a missing or malformed body is INVALID_INPUT. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError('INVALID_INPUT');
  }
}
