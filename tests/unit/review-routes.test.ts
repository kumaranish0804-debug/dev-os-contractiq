// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const lookup = vi.fn();
const feedbackUpdate = vi.fn();
const feedbackInsert = vi.fn();
const contractUpdate = vi.fn();
const writes: { table: string; op: string; values: unknown; filters: unknown[][] }[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser },
    from: (table: string) => {
      const filters: unknown[][] = [];
      let op = 'select';
      let values: unknown;
      const chain = {
        select: () => chain,
        update: (v: unknown) => ((op = 'update'), (values = v), chain),
        insert: (v: unknown) => ((op = 'insert'), (values = v), chain),
        eq: (...a: unknown[]) => (filters.push(['eq', ...a]), chain),
        is: (...a: unknown[]) => (filters.push(['is', ...a]), chain),
        maybeSingle: () => run(),
        single: () => run(),
      };
      const run = () => {
        if (op !== 'select') writes.push({ table, op, values, filters });
        if (op === 'select') return lookup(table);
        if (table === 'user_feedback') return op === 'update' ? feedbackUpdate() : feedbackInsert();
        return contractUpdate();
      };
      return chain;
    },
  }),
}));

import { POST as COMPLETE } from '@/app/api/contracts/[id]/complete/route';
import { POST as FEEDBACK } from '@/app/api/feedback/route';

const ID = '99999999-9999-4999-8999-999999999999';
const SAVED = { id: 'f1', rating: 'down', comment: 'Wrong term', updated_at: '2026-10-21T10:00:00Z' };

const feedback = (body: unknown) =>
  FEEDBACK(new Request('http://x/api/feedback', { method: 'POST', body: JSON.stringify(body) }));
const complete = (id = ID) => COMPLETE(new Request(`http://x/api/contracts/${id}/complete`, { method: 'POST' }), { params: { id } });

beforeEach(() => {
  writes.length = 0;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
  lookup.mockReset().mockResolvedValue({ data: { id: ID, status: 'completed', review_completed_at: null }, error: null });
  feedbackUpdate.mockReset().mockResolvedValue({ data: null, error: null });
  feedbackInsert.mockReset().mockResolvedValue({ data: SAVED, error: null });
  contractUpdate.mockReset().mockResolvedValue({ data: { review_completed_at: '2026-10-21T10:00:00Z' }, error: null });
});

describe('POST /api/feedback', () => {
  it('inserts the first rating for the caller, trimming the comment', async () => {
    const res = await feedback({ contract_id: ID, rating: 'down', comment: '  Wrong term  ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feedback: SAVED });
    const insert = writes.find((w) => w.op === 'insert');
    expect(insert?.values).toEqual({ user_id: 'u1', contract_id: ID, rating: 'down', comment: 'Wrong term' });
  });

  it('updates only rating and comment when feedback exists (one row per contract)', async () => {
    feedbackUpdate.mockResolvedValue({ data: { ...SAVED, rating: 'up', comment: null }, error: null });
    const res = await feedback({ contract_id: ID, rating: 'up', comment: '' });
    expect((await res.json()).feedback.rating).toBe('up');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ op: 'update', values: { rating: 'up', comment: null } });
    expect(writes[0]!.filters).toEqual([
      ['eq', 'contract_id', ID],
      ['eq', 'user_id', 'u1'],
    ]);
  });

  it('applies a concurrent submit as an update after a unique violation', async () => {
    feedbackInsert.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    feedbackUpdate
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: SAVED, error: null });
    const res = await feedback({ contract_id: ID, rating: 'down' });
    expect(res.status).toBe(200);
    expect(writes.map((w) => w.op)).toEqual(['update', 'insert', 'update']);
  });

  it('400 for a bad rating, an over-long comment or a malformed id', async () => {
    for (const body of [
      { contract_id: ID, rating: 'meh' },
      { contract_id: ID, rating: 'up', comment: 'x'.repeat(1001) },
      { contract_id: 'nope', rating: 'up' },
    ]) {
      const res = await feedback(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_INPUT');
    }
    expect(writes).toHaveLength(0);
  });

  it("404 for another user's contract (invisible under RLS)", async () => {
    lookup.mockResolvedValue({ data: null, error: null });
    const res = await feedback({ contract_id: ID, rating: 'up' });
    expect(res.status).toBe(404);
    expect(writes).toHaveLength(0);
  });

  it('401 when signed out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await feedback({ contract_id: ID, rating: 'up' })).status).toBe(401);
  });
});

describe('POST /api/contracts/[id]/complete', () => {
  it('stamps review_completed_at once, guarded by IS NULL', async () => {
    const res = await complete();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ review_completed_at: '2026-10-21T10:00:00Z' });
    expect(writes[0]!.filters).toContainEqual(['is', 'review_completed_at', null]);
    expect(Object.keys(writes[0]!.values as object)).toEqual(['review_completed_at']);
  });

  it('is idempotent: an already-reviewed contract returns the existing time without writing', async () => {
    lookup.mockResolvedValue({ data: { id: ID, status: 'completed', review_completed_at: '2026-10-01T09:00:00Z' }, error: null });
    const res = await complete();
    expect(await res.json()).toEqual({ review_completed_at: '2026-10-01T09:00:00Z' });
    expect(writes).toHaveLength(0);
  });

  it('returns the winning value when a concurrent call stamped it first', async () => {
    contractUpdate.mockResolvedValue({ data: null, error: null });
    lookup
      .mockResolvedValueOnce({ data: { id: ID, status: 'completed', review_completed_at: null }, error: null })
      .mockResolvedValueOnce({ data: { review_completed_at: '2026-10-21T09:59:59Z' }, error: null });
    expect(await (await complete()).json()).toEqual({ review_completed_at: '2026-10-21T09:59:59Z' });
  });

  it('409 CONTRACT_NOT_READY before analysis has finished', async () => {
    lookup.mockResolvedValue({ data: { id: ID, status: 'processing', review_completed_at: null }, error: null });
    const res = await complete();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONTRACT_NOT_READY');
  });

  it('404 for unknown, unowned or malformed ids; 401 signed out', async () => {
    lookup.mockResolvedValue({ data: null, error: null });
    expect((await complete()).status).toBe(404);
    expect((await complete('bad')).status).toBe(404);
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await complete()).status).toBe(401);
  });
});
