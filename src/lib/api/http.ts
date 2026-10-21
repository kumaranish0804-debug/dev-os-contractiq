import { ApiError, parseErrorResponse } from '@/lib/api/api-error';

// Browser half of the API layer (Spec 03 §3.8): same-origin calls to /api/*.

export function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError('INTERNAL', { status: 0 });
  }

  if (!response.ok) {
    const error = await parseErrorResponse(response);
    if (error.status === 401) redirectToLogin();
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
