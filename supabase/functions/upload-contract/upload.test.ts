import { assert, assertEquals, assertRejects } from 'std/assert';
import { AppError } from '../_shared/errors.ts';
import { fakeContext, fakeSupabase, type FakeOptions } from '../_shared/test-utils/fake-supabase.ts';
import { handleUpload, type UploadDeps, type UploadResponse } from './upload.ts';
import { countTokens, extractPdf } from '../_shared/pdf-text.ts';

const FIXTURES = new URL('../../../tests/fixtures/', import.meta.url);
const fixture = (name: string) => Deno.readFile(new URL(name, FIXTURES));

const deps: UploadDeps = {
  extract: extractPdf,
  countTokens,
  sleep: () => Promise.resolve(),
  newId: () => '11111111-1111-4111-8111-111111111111',
};

function formRequest(
  file: Uint8Array<ArrayBuffer> | null,
  fields: Record<string, string> = { contract_type: 'NDA' },
  fileName = 'Acme NDA.pdf',
  headers: Record<string, string> = {},
) {
  const form = new FormData();
  if (file) form.set('file', new File([file], fileName, { type: 'application/pdf' }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request('http://localhost/upload-contract', { method: 'POST', body: form, headers });
}

async function run(req: Request, options: FakeOptions = {}, overrides: Partial<UploadDeps> = {}) {
  const fake = fakeSupabase(options);
  const res = await handleUpload(fakeContext(req, fake.client), { ...deps, ...overrides });
  return { res, calls: fake.calls };
}

async function rejectsWith(code: string, req: Request, overrides: Partial<UploadDeps> = {}) {
  const fake = fakeSupabase();
  const error = await assertRejects(
    () => handleUpload(fakeContext(req, fake.client), { ...deps, ...overrides }),
    AppError,
  );
  assertEquals(error.code, code);
  // No contract row on any rejection; one failed upload log.
  assertEquals(fake.calls.filter((c) => c.op === 'insert' && c.table === 'contracts').length, 0);
  const logs = fake.calls.filter((c) => c.op === 'insert' && c.table === 'processing_logs');
  assertEquals(logs.length, 1);
  assertEquals(logs[0]!.op === 'insert' && logs[0]!.row.error_code, code);
  assertEquals(logs[0]!.op === 'insert' && logs[0]!.row.success, false);
}

Deno.test('uploads a 3-page NDA: page markers, counts, storage and log', async () => {
  const { res, calls } = await run(formRequest(await fixture('nda-3-pages.pdf')));
  assertEquals(res.status, 201);
  const body: UploadResponse = await res.json();
  assertEquals(body.contract_id, '11111111-1111-4111-8111-111111111111');
  assertEquals(body.page_count, 3);
  assertEquals(body.file_stored, true);
  assert(body.word_count > 500, `word_count ${body.word_count}`);
  assert(body.token_count > 500 && body.token_count < 15_000);

  const insert = calls.find((c) => c.op === 'insert' && c.table === 'contracts');
  assert(insert?.op === 'insert');
  assertEquals(insert.row.user_id, 'user-1');
  assertEquals(insert.row.title, 'Acme NDA');
  assertEquals(insert.row.contract_type, 'NDA');
  const text = String(insert.row.contract_text);
  assertEquals([...text.matchAll(/^\[PAGE (\d+)\]$/gm)].map((m) => m[1]), ['1', '2', '3']);
  assert(text.includes('laws of the State of New York'));

  const upload = calls.find((c) => c.op === 'upload');
  assert(upload?.op === 'upload');
  assertEquals(upload.bucket, 'contracts');
  assertEquals(upload.path, 'user-1/11111111-1111-4111-8111-111111111111/acme-nda.pdf');

  const update = calls.find((c) => c.op === 'update');
  assert(update?.op === 'update');
  assertEquals(update.values, { file_path: upload.path });
  assertEquals(update.filters, [
    ['id', '11111111-1111-4111-8111-111111111111'],
    ['user_id', 'user-1'],
  ]);

  const log = calls.find((c) => c.op === 'insert' && c.table === 'processing_logs');
  assert(log?.op === 'insert');
  assertEquals(log.row.success, true);
  assertEquals(log.row.kind, 'upload');
});

Deno.test('uses a custom title when given', async () => {
  const { calls } = await run(
    formRequest(await fixture('msa-6-pages.pdf'), { contract_type: 'MSA', title: '  Northwind MSA ' }),
  );
  const insert = calls.find((c) => c.op === 'insert' && c.table === 'contracts');
  assert(insert?.op === 'insert');
  assertEquals(insert.row.title, 'Northwind MSA');
  assertEquals(insert.row.page_count, 6);
});

Deno.test('storage failure is retried once, then non-blocking', async () => {
  const { res, calls } = await run(formRequest(await fixture('nda-3-pages.pdf')), {
    uploadErrors: ['bucket not found', 'bucket not found'],
  });
  assertEquals(res.status, 201);
  assertEquals((await res.json()).file_stored, false);
  assertEquals(calls.filter((c) => c.op === 'upload').length, 2);
  assertEquals(calls.filter((c) => c.op === 'update').length, 0);
});

Deno.test('storage succeeds on the retry', async () => {
  const { res, calls } = await run(formRequest(await fixture('nda-3-pages.pdf')), {
    uploadErrors: ['timeout'],
  });
  assertEquals((await res.json()).file_stored, true);
  assertEquals(calls.filter((c) => c.op === 'upload').length, 2);
});

Deno.test('rejects 21 pages', async () => {
  await rejectsWith('TOO_MANY_PAGES', formRequest(await fixture('pages-21.pdf')));
});

Deno.test('rejects an image-only PDF as scanned', async () => {
  await rejectsWith('SCANNED_PDF', formRequest(await fixture('scanned.pdf')));
});

Deno.test('rejects a password-protected PDF', async () => {
  await rejectsWith('PDF_PASSWORD_PROTECTED', formRequest(await fixture('encrypted.pdf')));
});

Deno.test('rejects a truncated PDF', async () => {
  await rejectsWith('INVALID_PDF', formRequest(await fixture('truncated.pdf')));
});

Deno.test('rejects a non-PDF by magic bytes even when named .pdf', async () => {
  await rejectsWith('UNSUPPORTED_FILE_TYPE', formRequest(new TextEncoder().encode('hello world')));
});

Deno.test('rejects an empty file', async () => {
  await rejectsWith('INVALID_PDF', formRequest(new Uint8Array()));
});

Deno.test('rejects over 10 MB by Content-Length before reading the body', async () => {
  await rejectsWith(
    'FILE_TOO_LARGE',
    formRequest(await fixture('nda-3-pages.pdf'), undefined, 'x.pdf', {
      'content-length': '11000000',
    }),
  );
});

Deno.test('rejects an 11 MB file by size', async () => {
  await rejectsWith('FILE_TOO_LARGE', formRequest(await fixture('large-11mb.pdf')));
});

Deno.test('rejects contracts over 15,000 tokens', async () => {
  await rejectsWith('CONTRACT_TOO_LONG', formRequest(await fixture('nda-3-pages.pdf')), {
    countTokens: () => 15_001,
  });
});

Deno.test('rejects missing file or bad contract type as INVALID_INPUT', async () => {
  await rejectsWith('INVALID_INPUT', formRequest(null));
  await rejectsWith('INVALID_INPUT', formRequest(await fixture('nda-3-pages.pdf'), { contract_type: 'SOW' }));
});

Deno.test('a failed contract insert surfaces as an internal error', async () => {
  const fake = fakeSupabase({ insertErrorFor: 'contracts' });
  const req = formRequest(await fixture('nda-3-pages.pdf'));
  await assertRejects(() => handleUpload(fakeContext(req, fake.client), deps), Error, 'contracts insert failed');
  assertEquals(fake.calls.filter((c) => c.op === 'upload').length, 0);
});
