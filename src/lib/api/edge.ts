import { createClient } from '@/lib/supabase/client';
import { functionsUrl, publicEnv } from '@/lib/env';
import { ApiError, parseErrorResponse } from '@/lib/api/api-error';
import { redirectToLogin } from '@/lib/api/http';

// Browser client for Supabase Edge Functions (Spec 03 §3.8).

export type EdgeFunctionName = 'upload-contract' | 'process-contract' | 'chat';

type SupabaseBrowserClient = ReturnType<typeof createClient>;

async function send(
  name: EdgeFunctionName,
  body: object | FormData,
  accessToken: string,
  init: Pick<RequestInit, 'signal'>,
): Promise<Response> {
  const headers = new Headers({
    authorization: `Bearer ${accessToken}`,
    apikey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  const isForm = body instanceof FormData;
  if (!isForm) headers.set('content-type', 'application/json');

  try {
    return await fetch(`${functionsUrl}/${name}`, {
      method: 'POST',
      headers,
      body: isForm ? body : JSON.stringify(body),
      signal: init.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError('INTERNAL', { status: 0 });
  }
}

/**
 * Calls an Edge Function and returns the raw successful Response (JSON or SSE).
 * A 401 refreshes the session and retries once, then redirects to /login.
 */
export async function callEdgeRaw(
  name: EdgeFunctionName,
  body: object | FormData,
  init: Pick<RequestInit, 'signal'> = {},
  supabase: SupabaseBrowserClient = createClient(),
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirectToLogin();
    throw new ApiError('UNAUTHENTICATED');
  }

  let response = await send(name, body, session.access_token, init);

  if (response.status === 401) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      redirectToLogin();
      throw new ApiError('UNAUTHENTICATED');
    }
    response = await send(name, body, data.session.access_token, init);
  }

  if (!response.ok) {
    const error = await parseErrorResponse(response);
    if (error.status === 401) redirectToLogin();
    throw error;
  }
  return response;
}

export async function callEdge<T>(
  name: EdgeFunctionName,
  body: object | FormData,
  init: Pick<RequestInit, 'signal'> = {},
  supabase?: SupabaseBrowserClient,
): Promise<T> {
  const response = await callEdgeRaw(name, body, init, supabase);
  return (await response.json()) as T;
}
