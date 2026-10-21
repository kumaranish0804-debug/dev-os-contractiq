import { assert, assertEquals, assertRejects } from 'std/assert';
import { AppError } from '../_shared/errors.ts';
import { extractPdf } from '../_shared/pdf-text.ts';
import { PROMPT_VERSION } from '../_shared/pure/prompts.ts';
import { fakeContext, fakeSupabase, type FakeOptions } from '../_shared/test-utils/fake-supabase.ts';
import {
  apiError,
  completionFromExpected,
  fixtureBytes,
  loadExpected,
  scriptedComplete,
  type Step,
} from '../_shared/test-utils/llm-mock.ts';
import { handleProcess, type ProcessDeps } from './process.ts';

const CONTRACT_ID = '22222222-2222-4222-8222-222222222222';
const ndaText = (await extractPdf(await fixtureBytes('nda-3-pages.pdf'))).contractText;
const expected = await loadExpected('nda-3-pages');

const request = (body: unknown) =>
  new Request('http://localhost/process-contract', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const validBody = { contract_id: CONTRACT_ID, contract_type: 'NDA', custom_terms: ['Audit rights'] };

function setup(steps: Step[], options: FakeOptions = {}, overrides: Partial<ProcessDeps> = {}) {
  const fake = fakeSupabase({
    ...options,
    rpc: {
      start_processing: { data: { id: CONTRACT_ID, contract_text: ndaText, page_count: 3 } },
      save_extraction_results: (args) => ({ data: args.p_terms }),
      ...options.rpc,
    },
  });
  const openai = scriptedComplete(steps);
  const deps: ProcessDeps = {
    createComplete: async () => ({ complete: openai.complete, model: 'gpt-4o-mini' }),
    now: () => Date.now(),
    sleep: () => Promise.resolve(),
    ...overrides,
  };
  return { fake, openai, deps };
}

const callsOf = (calls: ReturnType<typeof fakeSupabase>['calls'], op: string, name?: string) =>
  calls.filter((c) => c.op === op && (!name || ('fn' in c ? c.fn === name : 'table' in c && c.table === name)));

Deno.test('processes a contract: start → extract → save → log → 200', async () => {
  const { fake, deps } = setup([completionFromExpected(expected)]);
  const res = await handleProcess(fakeContext(request(validBody), fake.client), deps);
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.status, 'completed');
  assertEquals(body.detected_type_mismatch, false);
  assertEquals(body.key_terms.length, 11);
  assertEquals(body.key_terms.at(-1).term_key, 'custom_audit_rights');

  const [start] = callsOf(fake.calls, 'rpc', 'start_processing');
  assert(start?.op === 'rpc');
  assertEquals(start.args, {
    p_contract_id: CONTRACT_ID,
    p_user_id: 'user-1',
    p_contract_type: 'NDA',
    p_custom_terms: ['Audit rights'],
  });
  const [save] = callsOf(fake.calls, 'rpc', 'save_extraction_results');
  assert(save?.op === 'rpc');
  assertEquals(save.args.p_user_id, 'user-1');
  assertEquals(save.args.p_prompt_version, PROMPT_VERSION);

  const [log] = callsOf(fake.calls, 'insert', 'processing_logs');
  assert(log?.op === 'insert');
  assertEquals(log.row.success, true);
  assertEquals(log.row.kind, 'extraction');
  assertEquals(log.row.model, 'gpt-4o-mini');
  assertEquals(log.row.prompt_tokens, 4000);
  assertEquals(log.row.cached_tokens, 1000);
  assertEquals(log.row.attempts, 1);
  assert((log.row.cost_usd as number) > 0);
  assertEquals(callsOf(fake.calls, 'update').length, 0);
});

Deno.test('AI failure flips the contract to error and logs it, then rethrows', async () => {
  const { fake, deps } = setup([apiError(503), apiError(503), apiError(503)]);
  const error = await assertRejects(
    () => handleProcess(fakeContext(request(validBody), fake.client), deps),
    AppError,
  );
  assertEquals(error.code, 'AI_UNAVAILABLE');

  const [update] = callsOf(fake.calls, 'update', 'contracts');
  assert(update?.op === 'update');
  assertEquals(update.values.status, 'error');
  assertEquals(update.values.error_code, 'AI_UNAVAILABLE');
  assertEquals(update.values.error_message, 'Our AI service is busy. Try again in a few minutes.');
  assertEquals(update.filters, [['id', CONTRACT_ID], ['user_id', 'user-1']]);

  const [log] = callsOf(fake.calls, 'insert', 'processing_logs');
  assert(log?.op === 'insert');
  assertEquals(log.row.success, false);
  assertEquals(log.row.error_code, 'AI_UNAVAILABLE');
  assertEquals(log.row.attempts, 3);
  assertEquals(callsOf(fake.calls, 'rpc', 'save_extraction_results').length, 0);
});

Deno.test('missing Azure configuration still marks the contract as error', async () => {
  const { fake, deps } = setup([], {}, {
    createComplete: () => Promise.reject(new AppError('INTERNAL')),
  });
  const error = await assertRejects(
    () => handleProcess(fakeContext(request(validBody), fake.client), deps),
    AppError,
  );
  assertEquals(error.code, 'INTERNAL');
  const [update] = callsOf(fake.calls, 'update', 'contracts');
  assert(update?.op === 'update');
  assertEquals(update.values.error_code, 'INTERNAL');
});

Deno.test('a failed save marks the contract as error (INTERNAL)', async () => {
  const { fake, deps } = setup([completionFromExpected(expected)], {
    rpc: { save_extraction_results: { error: { message: 'deadlock' } } },
  });
  await assertRejects(() => handleProcess(fakeContext(request(validBody), fake.client), deps), Error, 'deadlock');
  const [update] = callsOf(fake.calls, 'update', 'contracts');
  assert(update?.op === 'update');
  assertEquals(update.values.error_code, 'INTERNAL');
});

for (const [sqlState, code] of [
  ['P0002', 'NOT_FOUND'],
  ['P0001', 'ALREADY_PROCESSING'],
  ['23514', 'CUSTOM_TERM_LIMIT'],
  ['23505', 'INVALID_INPUT'],
] as const) {
  Deno.test(`start_processing ${sqlState} → ${code}, contract status untouched`, async () => {
    const { fake, openai, deps } = setup([], {
      rpc: { start_processing: { error: { message: 'x', code: sqlState } } },
    });
    const error = await assertRejects(
      () => handleProcess(fakeContext(request(validBody), fake.client), deps),
      AppError,
    );
    assertEquals(error.code, code);
    assertEquals(callsOf(fake.calls, 'update').length, 0);
    assertEquals(openai.calls.length, 0);
  });
}

Deno.test('rejects bad input before touching the database', async () => {
  const cases: [unknown, string][] = [
    ['{not json', 'INVALID_INPUT'],
    [{ ...validBody, contract_type: 'SOW' }, 'INVALID_INPUT'],
    [{ ...validBody, custom_terms: ['a'] }, 'INVALID_INPUT'],
    [{ ...validBody, custom_terms: ['Audit', 'audit'] }, 'INVALID_INPUT'],
    [{ ...validBody, custom_terms: ['1', '2', '3', '4', '5', '6'].map((n) => `Term ${n}`) }, 'INVALID_INPUT'],
    [{ ...validBody, custom_terms: [' governing LAW '] }, 'INVALID_INPUT'],
    [{ ...validBody, contract_id: 'not-a-uuid' }, 'NOT_FOUND'],
  ];
  for (const [body, code] of cases) {
    const { fake, deps } = setup([]);
    const error = await assertRejects(
      () => handleProcess(fakeContext(request(body), fake.client), deps),
      AppError,
    );
    assertEquals(error.code, code, JSON.stringify(body));
    assertEquals(fake.calls.length, 0);
  }
});

Deno.test('custom terms may reuse a standard name from the other contract type', async () => {
  const { fake, deps } = setup([completionFromExpected(expected)]);
  const res = await handleProcess(
    fakeContext(request({ ...validBody, custom_terms: ['Payment Terms'] }), fake.client),
    deps,
  );
  assertEquals(res.status, 200);
});
