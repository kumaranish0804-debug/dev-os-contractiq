// The deployed upload-contract Edge Function (Spec 05, Spec 12 §12.6) with the committed fixtures.
// The 429 path (20 uploads/hour) was verified live in Step 5 and is not repeated on every run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, createTestUser, deleteTestUser, fixture, SUPABASE_URL, ANON_KEY, type TestUser } from './helpers';

let A: TestUser;
const URL_ = `${SUPABASE_URL}/functions/v1/upload-contract`;

function upload(file: Blob, name: string, opts: { token?: string | null; type?: string } = {}) {
  const form = new FormData();
  form.set('file', file, name);
  form.set('contract_type', opts.type ?? 'NDA');
  const headers: Record<string, string> = { apikey: ANON_KEY };
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? A.accessToken}`;
  return fetch(URL_, { method: 'POST', body: form, headers });
}
const pdf = (name: string) => new Blob([fixture(name)], { type: 'application/pdf' });

async function contractCount() {
  const { count } = await admin.from('contracts').select('id', { count: 'exact', head: true }).eq('user_id', A.id);
  return count ?? 0;
}

beforeAll(async () => {
  A = await createTestUser();
});
afterAll(async () => {
  if (A) await deleteTestUser(A.id);
});

describe('upload-contract (deployed)', () => {
  it('201: stores the row, the [PAGE N] text and the file', async () => {
    const res = await upload(pdf('nda-3-pages.pdf'), 'Acme NDA.pdf');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ page_count: 3, file_stored: true });
    expect(body.word_count).toBeGreaterThanOrEqual(100);

    const { data } = await admin
      .from('contracts')
      .select('status, title, contract_type, contract_text, file_path')
      .eq('id', body.contract_id)
      .eq('user_id', A.id)
      .single();
    expect(data).toMatchObject({ status: 'uploaded', title: 'Acme NDA', contract_type: 'NDA' });
    expect(data!.contract_text).toMatch(/^\[PAGE 1\]/);
    expect(data!.contract_text).toContain('[PAGE 3]');
    const { data: files } = await admin.storage.from('contracts').list(`${A.id}/${body.contract_id}`);
    expect(files).toHaveLength(1);
  });

  it.each([
    ['scanned.pdf', 422, 'SCANNED_PDF'],
    ['pages-21.pdf', 422, 'TOO_MANY_PAGES'],
    ['encrypted.pdf', 422, 'PDF_PASSWORD_PROTECTED'],
    ['truncated.pdf', 422, 'INVALID_PDF'],
  ])('%s → %i %s, and no row is created', async (name, status, errorCode) => {
    const before = await contractCount();
    const res = await upload(pdf(name), name);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.error.code).toBe(errorCode);
    expect(body.error.requestId).toBeTruthy();
    expect(await contractCount()).toBe(before);
  });

  it('415 for a non-PDF, 400 for a bad contract type', async () => {
    const text = await upload(new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
    expect(text.status).toBe(415);
    expect((await text.json()).error.code).toBe('UNSUPPORTED_FILE_TYPE');

    const badType = await upload(pdf('nda-3-pages.pdf'), 'a.pdf', { type: 'LEASE' });
    expect(badType.status).toBe(400);
    expect((await badType.json()).error.code).toBe('INVALID_INPUT');
  });

  it('401 without a JWT or with a forged one', async () => {
    expect((await upload(pdf('nda-3-pages.pdf'), 'a.pdf', { token: null })).status).toBe(401);
    expect((await upload(pdf('nda-3-pages.pdf'), 'a.pdf', { token: 'eyJhbGciOiJIUzI1NiJ9.e30.forged' })).status).toBe(401);
  });
});
