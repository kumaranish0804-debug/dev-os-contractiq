// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Captures the cookie adapters the app hands to @supabase/ssr, and lets each test choose the user.
const getUser = vi.fn();
const ssr = vi.hoisted(() => ({ adapters: [] as { getAll: () => unknown; setAll: (c: unknown[]) => void }[] }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: (typeof ssr.adapters)[number] }) => {
    ssr.adapters.push(opts.cookies);
    return { auth: { getUser } };
  },
  createBrowserClient: (url: string, key: string) => ({ url, key }),
}));

const cookieStore = { getAll: vi.fn(() => [{ name: 'sb', value: '1' }]), set: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => cookieStore }));

import { createClient as createBrowser } from '@/lib/supabase/client';
import { updateSession } from '@/lib/supabase/middleware';
import { createClient as createServer } from '@/lib/supabase/server';
import { config } from '@/middleware';

const req = (path: string) => new NextRequest(new URL(path, 'http://app.test'));
const signedIn = () => getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
const signedOut = () => getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

beforeEach(() => {
  ssr.adapters.length = 0;
  getUser.mockReset();
  cookieStore.set.mockReset();
});

describe('updateSession (route guard, Spec 04 §4.9)', () => {
  it('sends signed-out users from protected pages to /login with a return path', async () => {
    signedOut();
    for (const [path, next] of [
      ['/dashboard', '/dashboard'],
      ['/contracts/abc?tab=chat', '/contracts/abc?tab=chat'],
      ['/contracts/new', '/contracts/new'],
    ]) {
      const res = await updateSession(req(path!));
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get('location')!);
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('next')).toBe(next);
    }
  });

  it('lets signed-in users through protected pages', async () => {
    signedIn();
    const res = await updateSession(req('/dashboard?sort=title'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('sends signed-in users away from /login and /signup', async () => {
    signedIn();
    for (const path of ['/login?next=/x', '/signup']) {
      const location = new URL((await updateSession(req(path))).headers.get('location')!);
      expect(location.pathname).toBe('/dashboard');
      expect(location.search).toBe('');
    }
  });

  it('leaves auth pages open to signed-out users, and does not treat look-alike paths as protected', async () => {
    signedOut();
    for (const path of ['/login', '/signup', '/dashboards-public']) {
      expect((await updateSession(req(path))).headers.get('location')).toBeNull();
    }
  });

  it('writes refreshed session cookies onto the response', async () => {
    getUser.mockImplementation(async () => {
      ssr.adapters[0]!.setAll([{ name: 'sb-token', value: 'fresh', options: { httpOnly: true, path: '/' } }]);
      return { data: { user: { id: 'u1' } } };
    });
    const res = await updateSession(req('/dashboard'));
    expect(res.cookies.get('sb-token')?.value).toBe('fresh');
  });

  it('runs only on app and auth pages — never on /api (health stays public)', () => {
    expect(config.matcher).toEqual(['/dashboard/:path*', '/contracts/:path*', '/login', '/signup']);
  });
});

describe('Supabase client factories', () => {
  it('server client reads and writes request cookies', () => {
    createServer();
    const adapter = ssr.adapters[0]!;
    expect(adapter.getAll()).toEqual([{ name: 'sb', value: '1' }]);
    adapter.setAll([{ name: 'a', value: 'b', options: { path: '/' } }]);
    expect(cookieStore.set).toHaveBeenCalledWith('a', 'b', { path: '/' });
  });

  it('server client tolerates read-only cookies in Server Components', () => {
    cookieStore.set.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler');
    });
    createServer();
    expect(() => ssr.adapters[0]!.setAll([{ name: 'a', value: 'b', options: {} }])).not.toThrow();
  });

  it('browser client uses the public URL and anon key', () => {
    expect(createBrowser()).toEqual({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  });
});

describe('env validation (Spec 01 §1.8)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  it('exposes the public values and the functions URL', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'a'.repeat(40);
    const env = await import('@/lib/env');
    expect(env.publicEnv.NEXT_PUBLIC_SUPABASE_URL).toBe('https://abc.supabase.co');
    expect(env.functionsUrl).toBe('https://abc.supabase.co/functions/v1');
  });

  it('fails fast, naming the missing or invalid variables', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SITE_URL = 'not a url';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    await expect(import('@/lib/env')).rejects.toThrow(/NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
