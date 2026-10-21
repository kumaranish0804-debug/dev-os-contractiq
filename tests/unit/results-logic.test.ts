// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confidenceLevel, needsReview } from '@shared/confidence';
import { buildSentenceRegex, findRange } from '@/lib/viewer/highlight';
import { keyTermPatchSchema } from '@/lib/validation/key-term';

// ---------------------------------------------------------------------------
// Supabase server client double: records the chain, resolves per table.
// ---------------------------------------------------------------------------
type Result = { data: unknown; error: { message: string } | null };
const results = new Map<string, Result>();
const chains: { table: string; ops: [string, unknown[]][] }[] = [];
const getUser = vi.fn();

function builder(table: string) {
  const chain = { table, ops: [] as [string, unknown[]][] };
  chains.push(chain);
  const proxy: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'order', 'update', 'is']) {
    proxy[op] = (...args: unknown[]) => {
      chain.ops.push([op, args]);
      return proxy;
    };
  }
  const settle = () => Promise.resolve(results.get(table) ?? { data: null, error: null });
  proxy.maybeSingle = () => settle();
  proxy.single = () => settle();
  proxy.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject);
  return proxy;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser }, from: (table: string) => builder(table) }),
}));

import { GET as getContract } from '@/app/api/contracts/[id]/route';
import { PATCH as patchKeyTerm } from '@/app/api/key-terms/[id]/route';
import { getContractDetail } from '@/lib/data/contracts';
import { createClient } from '@/lib/supabase/server';

const ID = '44444444-4444-4444-8444-444444444444';
const TERM_ID = '55555555-5555-4555-8555-555555555555';

const CONTRACT_ROW = {
  id: ID,
  title: 'Acme NDA',
  original_filename: 'Acme NDA.pdf',
  contract_type: 'NDA',
  status: 'completed',
  error_code: null,
  error_message: null,
  page_count: 3,
  file_path: 'user/contract/acme-nda.pdf',
  file_deleted_at: null,
  detected_type_mismatch: false,
  created_at: '2026-10-18T10:00:00Z',
  processed_at: '2026-10-18T10:00:20Z',
  review_completed_at: null,
  contract_text: '[PAGE 1]\nHello',
};

beforeEach(() => {
  results.clear();
  chains.length = 0;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
});

describe('confidence bands', () => {
  it.each([
    [100, 'high'],
    [80, 'high'],
    [79, 'medium'],
    [50, 'medium'],
    [49, 'low'],
    [0, 'low'],
  ] as const)('%i → %s', (score, level) => {
    expect(confidenceLevel(score)).toBe(level);
  });

  it('needs review only when found and below 50', () => {
    expect(needsReview({ value: 'x', confidence_score: 49 })).toBe(true);
    expect(needsReview({ value: 'x', confidence_score: 50 })).toBe(false);
    expect(needsReview({ value: null, confidence_score: 0 })).toBe(false);
  });
});

describe('highlight', () => {
  const page = 'Section 9.\nThis Agreement shall be governed by the laws\nof the State of “New York”, and the non-\ndisclosure terms — survive.';

  it('matches across line breaks', () => {
    const r = findRange(page, 'This Agreement shall be governed by the laws of the State of "New York"');
    expect(r).not.toBeNull();
    expect(page.slice(r!.start, r!.end)).toMatch(/^This Agreement[\s\S]*New York/);
  });

  it('folds curly quotes and dashes without shifting indices', () => {
    const r = findRange(page, 'the non-disclosure terms - survive.');
    expect(page.slice(r!.start, r!.end)).toBe('the non-\ndisclosure terms — survive.');
  });

  it('returns null for no match, short or empty sentences', () => {
    expect(findRange(page, 'The governing law is Mars and nowhere else.')).toBeNull();
    expect(findRange(page, 'New York')).toBeNull();
    expect(findRange(page, null)).toBeNull();
    expect(buildSentenceRegex('a b')).toBeNull();
  });

  it('escapes regex characters in the sentence', () => {
    const text = 'Fees (net 30) apply [see Schedule 1] at $5.00 per hour.';
    expect(findRange(text, 'Fees (net 30) apply [see Schedule 1] at $5.00 per hour.')).toEqual({ start: 0, end: text.length });
  });
});

describe('keyTermPatchSchema', () => {
  it('trims, and saves empty as null', () => {
    expect(keyTermPatchSchema.parse({ value: '  New York  ' })).toEqual({ value: 'New York' });
    expect(keyTermPatchSchema.parse({ value: '   ' })).toEqual({ value: null });
    expect(keyTermPatchSchema.parse({ value: null })).toEqual({ value: null });
    expect(keyTermPatchSchema.safeParse({ value: 'x'.repeat(2001) }).success).toBe(false);
    expect(keyTermPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe('getContractDetail', () => {
  it('runs the 4 queries, hides the storage path and maps custom terms', async () => {
    results.set('contracts', { data: CONTRACT_ROW, error: null });
    results.set('key_terms', { data: [{ id: TERM_ID }], error: null });
    results.set('custom_key_terms', { data: [{ term_name: 'Audit rights' }], error: null });
    results.set('user_feedback', { data: { rating: 'up', comment: null }, error: null });

    const detail = await getContractDetail(createClient(), ID);
    expect(detail!.contract.has_file).toBe(true);
    expect(detail!.contract).not.toHaveProperty('file_path');
    expect(detail!.custom_terms).toEqual(['Audit rights']);
    expect(detail!.feedback).toEqual({ rating: 'up', comment: null });
    expect(chains.map((c) => c.table)).toEqual(['contracts', 'key_terms', 'custom_key_terms', 'user_feedback']);
    expect(chains[1]!.ops.filter(([op]) => op === 'order').map(([, a]) => a[0])).toEqual(['is_custom', 'sort_order']);
  });

  it('returns null when the contract is not visible', async () => {
    expect(await getContractDetail(createClient(), ID)).toBeNull();
  });

  it('throws on query errors', async () => {
    results.set('key_terms', { data: null, error: { message: 'boom' } });
    await expect(getContractDetail(createClient(), ID)).rejects.toThrow(/boom/);
  });
});

describe('GET /api/contracts/[id]', () => {
  const call = (id: string) => getContract(new Request(`http://x/api/contracts/${id}`), { params: { id } });

  it('returns the detail with no-store caching', async () => {
    results.set('contracts', { data: CONTRACT_ROW, error: null });
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).contract.title).toBe('Acme NDA');
  });

  it('404s for unknown or malformed ids, 401 when signed out', async () => {
    expect((await call(ID)).status).toBe(404);
    expect((await call('nope')).status).toBe(404);
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call(ID)).status).toBe(401);
  });
});

describe('PATCH /api/key-terms/[id]', () => {
  const call = (id: string, body: unknown) =>
    patchKeyTerm(new Request(`http://x/api/key-terms/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), {
      params: { id },
    });

  it('updates only the value and returns the row', async () => {
    results.set('key_terms', { data: { id: TERM_ID, value: 'Ohio', is_edited: true }, error: null });
    const res = await call(TERM_ID, { value: ' Ohio ' });
    expect(res.status).toBe(200);
    expect((await res.json()).key_term).toMatchObject({ value: 'Ohio', is_edited: true });
    const ops = chains[0]!.ops;
    expect(ops[0]).toEqual(['update', [{ value: 'Ohio' }]]);
    expect(ops[1]).toEqual(['eq', ['id', TERM_ID]]);
  });

  it('404 when RLS hides the row; 400 for bad input; 401 signed out', async () => {
    expect((await call(TERM_ID, { value: 'x' })).status).toBe(404);
    expect((await call(TERM_ID, { value: 7 })).status).toBe(400);
    expect((await call('bad-id', { value: 'x' })).status).toBe(404);
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call(TERM_ID, { value: 'x' })).status).toBe(401);
  });
});
