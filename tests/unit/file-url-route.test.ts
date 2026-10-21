// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const contract = vi.fn();
const createSignedUrl = vi.fn();
const eqCalls: unknown[][] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: (...args: unknown[]) => {
          eqCalls.push(args);
          return { maybeSingle: contract };
        },
      }),
    }),
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));

import { GET } from '@/app/api/contracts/[id]/file-url/route';

const ID = '77777777-7777-4777-8777-777777777777';
const call = (id = ID) => GET(new Request(`http://x/api/contracts/${id}/file-url`), { params: { id } });

beforeEach(() => {
  eqCalls.length = 0;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
  contract.mockReset().mockResolvedValue({
    data: { file_path: 'u1/c/acme.pdf', original_filename: 'Acme NDA.pdf' },
    error: null,
  });
  createSignedUrl.mockReset().mockImplementation((_p: string, _s: number, opts?: { download?: string }) =>
    Promise.resolve({ data: { signedUrl: opts?.download ? 'https://s/dl' : 'https://s/view' }, error: null }),
  );
});

describe('GET /api/contracts/[id]/file-url', () => {
  it('returns 1-hour view and download URLs, never cached', async () => {
    const before = Date.now();
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.url).toBe('https://s/view');
    expect(body.download_url).toBe('https://s/dl');
    const expires = Date.parse(body.expires_at);
    expect(expires - before).toBeGreaterThanOrEqual(3600_000 - 1000);
    expect(createSignedUrl).toHaveBeenCalledWith('u1/c/acme.pdf', 3600);
    expect(createSignedUrl).toHaveBeenCalledWith('u1/c/acme.pdf', 3600, { download: 'Acme NDA.pdf' });
    expect(eqCalls[0]).toEqual(['id', ID]);
    expect(JSON.stringify(body)).not.toContain('u1/c/acme.pdf');
  });

  it('404 NOT_FOUND for unknown or malformed ids', async () => {
    contract.mockResolvedValue({ data: null, error: null });
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect((await call('nope')).status).toBe(404);
  });

  it('404 FILE_NOT_AVAILABLE when there is no stored file or signing fails', async () => {
    contract.mockResolvedValue({ data: { file_path: null, original_filename: 'x.pdf' }, error: null });
    expect((await (await call()).json()).error.code).toBe('FILE_NOT_AVAILABLE');

    contract.mockResolvedValue({ data: { file_path: 'p', original_filename: 'x.pdf' }, error: null });
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('FILE_NOT_AVAILABLE');
  });

  it('401 when signed out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call()).status).toBe(401);
  });
});
