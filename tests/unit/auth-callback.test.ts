// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchangeCodeForSession = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from '@/app/auth/callback/route';

const call = async (query: string) => {
  const res = await GET(new Request(`http://localhost:3000/auth/callback${query}`));
  return { status: res.status, location: res.headers.get('location') };
};

describe('GET /auth/callback', () => {
  beforeEach(() => exchangeCodeForSession.mockReset());

  it('exchanges the code and redirects to /dashboard by default', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    expect(await call('?code=abc')).toEqual({
      status: 307,
      location: 'http://localhost:3000/dashboard',
    });
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it('honours a safe next path', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    expect((await call('?code=abc&next=%2Fcontracts%2F123')).location).toBe(
      'http://localhost:3000/contracts/123',
    );
  });

  it('never redirects off-site', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    expect((await call('?code=abc&next=%2F%2Fevil.com')).location).toBe(
      'http://localhost:3000/dashboard',
    );
  });

  it('sends expired or invalid links to the login banner', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { code: 'flow_state_expired' } });
    expect((await call('?code=old')).location).toBe(
      'http://localhost:3000/login?error=link_invalid',
    );
  });

  it('handles a missing code without calling Supabase', async () => {
    expect((await call('?error=access_denied')).location).toBe(
      'http://localhost:3000/login?error=link_invalid',
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
