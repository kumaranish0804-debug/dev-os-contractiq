// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const rpc = vi.fn();
const range = vi.fn();
const lookup = vi.fn();
const remove = vi.fn();
const deleteResult = vi.fn();
const calls: { order: unknown[][]; range?: unknown[]; deleteEq?: unknown[]; deleteOpts?: unknown } = { order: [] };

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser },
    rpc,
    from: () => {
      const chain = {
        select: () => chain,
        order: (...a: unknown[]) => (calls.order.push(a), chain),
        range: (...a: unknown[]) => ((calls.range = a), range()),
        eq: () => ({ maybeSingle: lookup }),
        delete: (opts: unknown) => ((calls.deleteOpts = opts), { eq: (...a: unknown[]) => ((calls.deleteEq = a), deleteResult()) }),
      };
      return chain;
    },
    storage: { from: () => ({ remove }) },
  }),
}));

import { DELETE } from '@/app/api/contracts/[id]/route';
import { GET as LIST } from '@/app/api/contracts/route';
import { GET as STATS } from '@/app/api/dashboard/stats/route';

const ID = '88888888-8888-4888-8888-888888888888';
const STATS_BODY = {
  total: 2,
  by_type: { NDA: 1, MSA: 1 },
  by_status: { uploaded: 0, processing: 0, completed: 2, error: 0 },
};
const ROW = { id: ID, title: 'Acme NDA', contract_type: 'NDA', status: 'completed' };

const list = (query = '') => LIST(new Request(`http://x/api/contracts${query}`));
const del = (id = ID) => DELETE(new Request(`http://x/api/contracts/${id}`, { method: 'DELETE' }), { params: { id } });

beforeEach(() => {
  calls.order = [];
  calls.range = undefined;
  calls.deleteEq = undefined;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
  rpc.mockReset().mockResolvedValue({ data: STATS_BODY, error: null });
  range.mockReset().mockResolvedValue({ data: [ROW], error: null, count: 1 });
  lookup.mockReset().mockResolvedValue({ data: { id: ID, file_path: 'u1/c/acme.pdf' }, error: null });
  remove.mockReset().mockResolvedValue({ data: [], error: null });
  deleteResult.mockReset().mockResolvedValue({ error: null, count: 1 });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /api/contracts', () => {
  it('lists with defaults, never cached', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ items: [ROW], total: 1 });
    expect(calls.order).toEqual([['created_at', { ascending: false }], ['id']]);
    expect(calls.range).toEqual([0, 24]);
  });

  it('applies sort, direction, limit and offset', async () => {
    await list('?sort=status&dir=asc&limit=10&offset=20');
    expect(calls.order[0]).toEqual(['status', { ascending: true }]);
    expect(calls.range).toEqual([20, 29]);
  });

  it('400 INVALID_INPUT for unknown columns or out-of-range paging', async () => {
    for (const q of ['?sort=contract_text', '?dir=sideways', '?limit=500', '?offset=-5', '?user_id=u2']) {
      const res = await list(q);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_INPUT');
    }
    expect(range).not.toHaveBeenCalled();
  });

  it('401 when signed out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await list()).status).toBe(401);
  });

  it('500 INTERNAL without leaking database errors', async () => {
    range.mockResolvedValue({ data: null, error: { message: 'relation secret_table' }, count: null });
    const res = await list();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret_table');
  });
});

describe('GET /api/dashboard/stats', () => {
  it('returns counts plus the 5 newest', async () => {
    const res = await STATS();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...STATS_BODY, recent: [ROW] });
    expect(calls.order[0]).toEqual(['created_at', { ascending: false }]);
    expect(calls.range).toEqual([0, 4]);
  });

  it('401 when signed out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await STATS()).status).toBe(401);
  });
});

describe('DELETE /api/contracts/[id]', () => {
  it('removes the stored file, then the row, and returns 204', async () => {
    const res = await del();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(remove).toHaveBeenCalledWith(['u1/c/acme.pdf']);
    expect(calls.deleteEq).toEqual(['id', ID]);
    expect(calls.deleteOpts).toEqual({ count: 'exact' });
  });

  it('skips storage when the file is already gone', async () => {
    lookup.mockResolvedValue({ data: { id: ID, file_path: null }, error: null });
    expect((await del()).status).toBe(204);
    expect(remove).not.toHaveBeenCalled();
  });

  it('still deletes the row when storage removal fails, and logs it', async () => {
    remove.mockResolvedValue({ data: null, error: { message: 'storage down' } });
    expect((await del()).status).toBe(204);
    expect(deleteResult).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('storage down'));
  });

  it('404 for unknown, unowned (RLS) or malformed ids', async () => {
    lookup.mockResolvedValue({ data: null, error: null });
    const res = await del();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect(remove).not.toHaveBeenCalled();
    expect(deleteResult).not.toHaveBeenCalled();

    expect((await del('not-a-uuid')).status).toBe(404);
  });

  it('404 when the row vanished between lookup and delete', async () => {
    deleteResult.mockResolvedValue({ error: null, count: 0 });
    expect((await del()).status).toBe(404);
  });

  it('401 when signed out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await del()).status).toBe(401);
  });
});
