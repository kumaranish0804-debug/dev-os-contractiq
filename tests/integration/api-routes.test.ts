// Next.js route handlers against the real database (Spec 12 §12.7). Handlers are imported and
// called directly; `cookies()` serves the session cookies of whichever user the test acts as.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { admin, createTestUser, deleteTestUser, seedContract, type SeededContract, type TestUser } from './helpers';

const jar = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }));
vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => jar.cookies,
    get: (name: string) => jar.cookies.find((c) => c.name === name),
    set: () => undefined,
  }),
}));

import { GET as fileUrl } from '@/app/api/contracts/[id]/file-url/route';
import { GET as chatHistory } from '@/app/api/contracts/[id]/chat/route';
import { POST as complete } from '@/app/api/contracts/[id]/complete/route';
import { DELETE as deleteContract, GET as detail } from '@/app/api/contracts/[id]/route';
import { GET as list } from '@/app/api/contracts/route';
import { GET as stats } from '@/app/api/dashboard/stats/route';
import { POST as feedback } from '@/app/api/feedback/route';
import { GET as health } from '@/app/api/health/route';
import { PATCH as patchTerm } from '@/app/api/key-terms/[id]/route';

let A: TestUser;
let B: TestUser;
let main: SeededContract;

const as = (user: TestUser | null) => (jar.cookies = user ? user.cookies : []);
const params = (id: string) => ({ params: { id } });
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  [A, B] = await Promise.all([createTestUser(), createTestUser()]);
  main = await seedContract(A.id, { title: 'Bravo NDA', createdAt: '2026-10-03T10:00:00Z' });
  await seedContract(A.id, { title: 'alpha MSA', type: 'MSA', withFile: false, createdAt: '2026-10-02T10:00:00Z' });
  await seedContract(A.id, { title: 'Charlie NDA', withFile: false, createdAt: '2026-10-01T10:00:00Z' });
});

afterAll(async () => {
  await Promise.all([A && deleteTestUser(A.id), B && deleteTestUser(B.id)]);
});

beforeEach(() => as(A));

describe('every endpoint: 401 without a session', () => {
  it.each([
    ['GET /api/contracts', () => list(new Request('http://x/api/contracts'))],
    ['GET /api/dashboard/stats', () => stats()],
    ['GET /api/contracts/[id]', () => detail(new Request('http://x'), params(main.contractId))],
    ['DELETE /api/contracts/[id]', () => deleteContract(new Request('http://x'), params(main.contractId))],
    ['GET file-url', () => fileUrl(new Request('http://x'), params(main.contractId))],
    ['GET chat', () => chatHistory(new Request('http://x'), params(main.contractId))],
    ['POST complete', () => complete(new Request('http://x'), params(main.contractId))],
    ['PATCH key term', () => patchTerm(new Request('http://x', { method: 'PATCH', body: '{"value":"x"}' }), params(main.keyTermIds[0]!))],
    ['POST feedback', () => feedback(new Request('http://x', json({ contract_id: main.contractId, rating: 'up' })))],
  ])('%s', async (_name, call) => {
    as(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(await code(res)).toBe('UNAUTHENTICATED');
  });
});

describe('dashboard (Spec 10)', () => {
  it('stats count the caller’s contracts; recent is newest first', async () => {
    const body = await (await stats()).json();
    expect(body).toMatchObject({ total: 3, by_type: { NDA: 2, MSA: 1 }, by_status: { completed: 3 } });
    expect(body.recent.map((c: { title: string }) => c.title)).toEqual(['Bravo NDA', 'alpha MSA', 'Charlie NDA']);
  });

  it('lists with sort and paging; never returns contract_text', async () => {
    const res = await list(new Request('http://x/api/contracts?sort=title&dir=asc&limit=2&offset=0'));
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.items.map((c: { title: string }) => c.title)).toEqual(['alpha MSA', 'Bravo NDA']);
    expect(JSON.stringify(body)).not.toContain('contract_text');
    expect((await list(new Request('http://x/api/contracts?sort=contract_text'))).status).toBe(400);
  });

  it('user B sees nothing', async () => {
    as(B);
    expect(await (await list(new Request('http://x/api/contracts'))).json()).toEqual({ items: [], total: 0 });
    expect((await (await stats()).json()).total).toBe(0);
  });
});

describe('results page (Spec 07)', () => {
  it('detail returns terms (standard then custom), custom terms and feedback, without the storage path', async () => {
    const res = await detail(new Request('http://x'), params(main.contractId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toMatchObject({ id: main.contractId, status: 'completed', has_file: true });
    expect(body.key_terms.map((t: { term_key: string }) => t.term_key)).toEqual([
      'parties', 'confidentiality_period', 'governing_law', 'custom_audit_rights',
    ]);
    expect(body.custom_terms).toEqual(['Audit rights']);
    expect(body.feedback).toEqual({ rating: 'up', comment: null });
    expect(JSON.stringify(body)).not.toContain(`${A.id}/`);
  });

  it('404 for another user’s contract or a malformed id', async () => {
    as(B);
    expect((await detail(new Request('http://x'), params(main.contractId))).status).toBe(404);
    as(A);
    expect((await detail(new Request('http://x'), params('not-a-uuid'))).status).toBe(404);
  });

  it('PATCH key term: sets is_edited, keeps the AI value; reverting clears Edited; clearing stores null', async () => {
    const id = main.keyTermIds[2]!;
    const patch = (value: unknown) =>
      patchTerm(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ value }) }), params(id));

    let body = await (await patch('State of Delaware')).json();
    expect(body.key_term).toMatchObject({ value: 'State of Delaware', original_value: 'State of New York', is_edited: true });
    expect(body.key_term.edited_at).not.toBeNull();

    body = await (await patch('State of New York')).json();
    expect(body.key_term).toMatchObject({ value: 'State of New York', is_edited: false });

    body = await (await patch('   ')).json();
    expect(body.key_term.value).toBeNull();
    await patch('State of New York');

    expect((await patch('x'.repeat(2001))).status).toBe(400);
    as(B);
    expect((await patch('Hacked')).status).toBe(404);
  });

  it('feedback: insert then update keeps one row; 404 for B', async () => {
    const post = (body: unknown) => feedback(new Request('http://x', json(body)));
    expect((await post({ contract_id: main.contractId, rating: 'down', comment: 'Missed a term' })).status).toBe(200);
    expect((await (await post({ contract_id: main.contractId, rating: 'up' })).json()).feedback).toMatchObject({ rating: 'up', comment: null });
    const { data } = await admin.from('user_feedback').select('rating').eq('contract_id', main.contractId).eq('user_id', A.id);
    expect(data).toEqual([{ rating: 'up' }]);
    expect((await post({ contract_id: main.contractId, rating: 'meh' })).status).toBe(400);
    as(B);
    expect((await post({ contract_id: main.contractId, rating: 'down' })).status).toBe(404);
  });

  it('mark review complete is idempotent; 404 for B', async () => {
    as(B);
    expect((await complete(new Request('http://x'), params(main.contractId))).status).toBe(404);
    as(A);
    const first = await (await complete(new Request('http://x'), params(main.contractId))).json();
    const second = await (await complete(new Request('http://x'), params(main.contractId))).json();
    expect(first.review_completed_at).toBeTruthy();
    expect(second).toEqual(first);
  });
});

describe('viewer + chat (Specs 08, 09)', () => {
  it('file-url returns working signed URLs; 404 for B; FILE_NOT_AVAILABLE without a file', async () => {
    const body = await (await fileUrl(new Request('http://x'), params(main.contractId))).json();
    const view = await fetch(body.url);
    expect(view.status).toBe(200);
    expect(view.headers.get('content-type')).toBe('application/pdf');
    const download = await fetch(body.download_url);
    expect(download.headers.get('content-disposition')).toContain('attachment');

    as(B);
    expect((await fileUrl(new Request('http://x'), params(main.contractId))).status).toBe(404);
    as(A);
    const noFile = await seedContract(A.id, { title: 'No file', withFile: false });
    const res = await fileUrl(new Request('http://x'), params(noFile.contractId));
    expect(res.status).toBe(404);
    expect(await code(res)).toBe('FILE_NOT_AVAILABLE');
    await deleteContract(new Request('http://x'), params(noFile.contractId));
  });

  it('chat history returns saved messages oldest first; 404 for B', async () => {
    const body = await (await chatHistory(new Request('http://x'), params(main.contractId))).json();
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(body.messages[1].cited_pages).toEqual([3]);
    as(B);
    expect((await chatHistory(new Request('http://x'), params(main.contractId))).status).toBe(404);
  });
});

describe('DELETE (Spec 10 §10.6)', () => {
  it('B cannot delete A’s contract', async () => {
    as(B);
    expect((await deleteContract(new Request('http://x'), params(main.contractId))).status).toBe(404);
    const { data } = await admin.from('contracts').select('id').eq('id', main.contractId).eq('user_id', A.id);
    expect(data).toHaveLength(1);
  });

  it('cascades to every child row, removes the file and keeps the log (contract_id nulled)', async () => {
    const res = await deleteContract(new Request('http://x'), params(main.contractId));
    expect(res.status).toBe(204);

    for (const [table, column] of [
      ['contracts', 'id'], ['key_terms', 'contract_id'], ['custom_key_terms', 'contract_id'],
      ['chat_sessions', 'contract_id'], ['user_feedback', 'contract_id'],
    ] as const) {
      const { data } = await admin.from(table).select('id').eq(column, main.contractId).eq('user_id', A.id);
      expect(data, table).toEqual([]);
    }
    const { data: messages } = await admin.from('chat_messages').select('id').eq('session_id', main.sessionId).eq('user_id', A.id);
    expect(messages).toEqual([]);
    const { data: log } = await admin.from('processing_logs').select('contract_id').eq('id', main.logId).eq('user_id', A.id).single();
    expect(log).toEqual({ contract_id: null });
    const { data: files } = await admin.storage.from('contracts').list(`${A.id}/${main.contractId}`);
    expect(files).toEqual([]);

    expect((await detail(new Request('http://x'), params(main.contractId))).status).toBe(404);
    expect((await (await stats()).json()).total).toBe(2);
  });
});

describe('GET /api/health (Spec 11 §11.4)', () => {
  it('is ok without a session', async () => {
    as(null);
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });
});
