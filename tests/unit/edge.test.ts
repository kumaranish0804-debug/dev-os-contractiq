import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  publicEnv: { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' },
  functionsUrl: 'https://project.supabase.co/functions/v1',
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { callEdge } from '@/lib/api/edge';

function mockSupabase(opts: { session?: string | null; refreshed?: string | null }) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: opts.session ? { access_token: opts.session } : null },
      }),
      refreshSession: vi.fn().mockResolvedValue(
        opts.refreshed
          ? { data: { session: { access_token: opts.refreshed } }, error: null }
          : { data: { session: null }, error: new Error('refresh failed') },
      ),
    },
  } as unknown as Parameters<typeof callEdge>[3];
}

const unauthorized = () =>
  Response.json({ error: { code: 'UNAUTHENTICATED', requestId: 'r' } }, { status: 401 });

describe('callEdge', () => {
  const fetchMock = vi.fn();
  const assign = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      pathname: '/contracts/new',
      search: '?type=NDA',
      assign,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    assign.mockReset();
  });

  it('sends the bearer token, anon key and JSON body', async () => {
    fetchMock.mockResolvedValue(Response.json({ contract_id: 'c1' }));
    const result = await callEdge('process-contract', { a: 1 }, {}, mockSupabase({ session: 't1' }));

    expect(result).toEqual({ contract_id: 'c1' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/functions/v1/process-contract');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer t1');
    expect(headers.get('apikey')).toBe('anon-key');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('sends FormData as-is so the browser sets the multipart boundary', async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    const form = new FormData();
    await callEdge('upload-contract', form, {}, mockSupabase({ session: 't1' }));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });

  it('refreshes the session and retries once on 401', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(Response.json({ ok: 1 }));
    const supabase = mockSupabase({ session: 'old', refreshed: 'new' });

    await expect(callEdge('chat', {}, {}, supabase)).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retry = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(new Headers(retry.headers).get('authorization')).toBe('Bearer new');
    expect(assign).not.toHaveBeenCalled();
  });

  it('redirects to login when the refresh fails', async () => {
    fetchMock.mockResolvedValue(unauthorized());
    await expect(
      callEdge('chat', {}, {}, mockSupabase({ session: 'old', refreshed: null })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fcontracts%2Fnew%3Ftype%3DNDA');
  });

  it('redirects to login when the retry is also 401', async () => {
    fetchMock.mockResolvedValue(unauthorized());
    await expect(
      callEdge('chat', {}, {}, mockSupabase({ session: 'old', refreshed: 'new' })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenCalledOnce();
  });

  it('redirects without calling the function when there is no session', async () => {
    await expect(callEdge('chat', {}, {}, mockSupabase({ session: null }))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledOnce();
  });

  it('surfaces error envelopes as ApiError', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { code: 'RATE_LIMITED', requestId: 'r1' } }, { status: 429 }),
    );
    await expect(
      callEdge('chat', {}, {}, mockSupabase({ session: 't1' })),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, requestId: 'r1' });
  });

  it('lets aborts propagate untouched', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(
      callEdge('chat', {}, {}, mockSupabase({ session: 't1' })),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
