// RLS & privilege matrix (Spec 02 §2.4, Spec 12 §12.4) against the real database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  anon,
  createTestUser,
  deleteTestUser,
  fixture,
  seedContract,
  type Client,
  type SeededContract,
  type TestUser,
} from '../integration/helpers';

let A: TestUser;
let B: TestUser;
let seeded: SeededContract;

type Table =
  | 'profiles'
  | 'contracts'
  | 'key_terms'
  | 'custom_key_terms'
  | 'chat_sessions'
  | 'chat_messages'
  | 'user_feedback'
  | 'processing_logs'
  | 'rate_limits';

/** Each table: how to find A's row, a plausible update, and a plausible insert aimed at A's data. */
function targets(): Record<Table, { filter: [string, string]; update: Record<string, unknown>; insert: Record<string, unknown> }> {
  const c = seeded.contractId;
  return {
    profiles: { filter: ['id', A.id], update: { full_name: 'Hacked' }, insert: { id: A.id, email: 'x@example.com' } },
    contracts: {
      filter: ['id', c],
      update: { title: 'Hacked' },
      insert: {
        user_id: A.id, title: 'Forged', original_filename: 'f.pdf', contract_type: 'NDA', contract_text: 'x',
        page_count: 1, word_count: 100, token_count: 1, file_size_bytes: 1,
      },
    },
    key_terms: {
      filter: ['id', seeded.keyTermIds[0]!],
      update: { value: 'Hacked' },
      insert: { contract_id: c, user_id: A.id, term_key: 'forged', term_name: 'Forged', confidence_score: 99 },
    },
    custom_key_terms: { filter: ['id', seeded.customTermId], update: { term_name: 'Hacked' }, insert: { contract_id: c, user_id: A.id, term_name: 'Forged' } },
    chat_sessions: { filter: ['id', seeded.sessionId], update: { message_count: 0 }, insert: { contract_id: c, user_id: A.id } },
    chat_messages: {
      filter: ['id', seeded.messageIds[0]!],
      update: { content: 'Hacked' },
      insert: { session_id: seeded.sessionId, user_id: A.id, role: 'assistant', content: 'Forged answer' },
    },
    user_feedback: { filter: ['id', seeded.feedbackId], update: { rating: 'down' }, insert: { contract_id: c, user_id: A.id, rating: 'down' } },
    processing_logs: {
      filter: ['id', seeded.logId],
      update: { cost_usd: 0 },
      insert: { contract_id: c, user_id: A.id, kind: 'chat', total_ms: 1, success: true },
    },
    rate_limits: {
      filter: ['user_id', A.id],
      update: { count: 0 },
      insert: { user_id: A.id, bucket: 'upload', window_start: new Date().toISOString(), count: 0 },
    },
  };
}

const TABLES = Object.keys({
  profiles: 0, contracts: 0, key_terms: 0, custom_key_terms: 0, chat_sessions: 0,
  chat_messages: 0, user_feedback: 0, processing_logs: 0, rate_limits: 0,
}) as Table[];

/** A's rows as the admin sees them — compared before/after every attack. */
async function snapshot() {
  const out: Record<string, unknown> = {};
  for (const table of TABLES) {
    const [col, val] = targets()[table].filter;
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (admin.from(table) as any).select('*').eq(col, val).order(col);
    if (error) throw error;
    out[table] = data;
  }
  return out;
}

/** "Denied" = an error (42501 permission / RLS) or no rows affected. */
function expectDenied(res: { data: unknown; error: { code?: string } | null }) {
  if (res.error) expect(res.error.code).toBe('42501');
  else expect(res.data ?? []).toEqual([]);
}

beforeAll(async () => {
  [A, B] = await Promise.all([createTestUser(), createTestUser()]);
  seeded = await seedContract(A.id);
  const { error } = await admin
    .from('rate_limits')
    .insert({ user_id: A.id, bucket: 'chat', window_start: new Date(Date.now() - 60_000).toISOString(), count: 3 });
  if (error) throw error;
});

afterAll(async () => {
  await Promise.all([A && deleteTestUser(A.id), B && deleteTestUser(B.id)]);
});

describe.each([
  ['user B', () => B.client],
  ['anon', () => anon],
] as [string, () => Client][])('%s against user A’s rows', (_who, client) => {
  it.each(TABLES)('%s: select / insert / update / delete are all denied, and A’s data is unchanged', async (table) => {
    const before = await snapshot();
    const t = targets()[table];
    // deno-lint-ignore no-explicit-any
    const from = () => client().from(table) as any;

    expectDenied(await from().select('*').eq(t.filter[0], t.filter[1]));
    const insert = await from().insert(t.insert).select();
    expect(insert.error, `${table} insert must fail`).not.toBeNull();
    expect(insert.error!.code).toMatch(/^(42501|23503|23505)$/);
    expectDenied(await from().update(t.update).eq(t.filter[0], t.filter[1]).select());
    expectDenied(await from().delete().eq(t.filter[0], t.filter[1]).select());

    expect(await snapshot()).toEqual(before);
  });
});

describe('positive controls (the denials above are not vacuous)', () => {
  it('A can read every own row except rate_limits, and edit a key term value', async () => {
    for (const table of TABLES.filter((t) => t !== 'rate_limits')) {
      const [col, val] = targets()[table].filter;
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (A.client.from(table) as any).select('id').eq(col, val);
      expect(error, table).toBeNull();
      expect(data.length, table).toBeGreaterThan(0);
    }
    const { data } = await A.client.from('key_terms').update({ value: 'Four years' }).eq('id', seeded.keyTermIds[1]!).select('value, is_edited');
    expect(data).toEqual([{ value: 'Four years', is_edited: true }]);
  });
});

describe('column privileges for the owner', () => {
  it.each([
    ['key_terms', 'confidence_score', 100],
    ['key_terms', 'original_value', 'forged'],
    ['contracts', 'status', 'error'],
    ['contracts', 'contract_text', 'forged'],
    ['contracts', 'user_id', '00000000-0000-4000-8000-000000000000'],
    ['profiles', 'email', 'evil@example.com'],
    ['user_feedback', 'contract_id', '00000000-0000-4000-8000-000000000000'],
  ] as const)('A updating %s.%s → 42501', async (table, column, value) => {
    const [col, val] = targets()[table as Table].filter;
    // deno-lint-ignore no-explicit-any
    const { error } = await (A.client.from(table) as any).update({ [column]: value }).eq(col, val);
    expect(error?.code).toBe('42501');
  });

  it('A cannot insert contracts, terms or chat directly (functions only)', async () => {
    for (const table of ['contracts', 'key_terms', 'custom_key_terms', 'chat_sessions', 'chat_messages', 'processing_logs'] as const) {
      // deno-lint-ignore no-explicit-any
      const { error } = await (A.client.from(table) as any).insert(targets()[table].insert);
      expect(error?.code, table).toMatch(/^(42501|23505)$/);
    }
  });

  it('A cannot read the staff-only correction views', async () => {
    for (const view of ['term_corrections', 'term_correction_samples'] as const) {
      const { error } = await A.client.from(view).select('*').limit(1);
      expect(error?.code, view).toBe('42501');
    }
  });
});

describe('storage (contracts bucket)', () => {
  const path = () => seeded.filePath!;

  it.each([
    ['user B', () => B.client],
    ['anon', () => anon],
  ] as [string, () => Client][])('%s cannot sign, download, remove or overwrite A’s file', async (_who, client) => {
    const bucket = client().storage.from('contracts');
    expect((await bucket.createSignedUrl(path(), 60)).error).not.toBeNull();
    expect((await bucket.download(path())).error).not.toBeNull();
    await bucket.remove([path()]);
    const upload = await bucket.upload(`${A.id}/${seeded.contractId}/planted.pdf`, fixture('nda-3-pages.pdf'), {
      contentType: 'application/pdf',
    });
    expect(upload.error).not.toBeNull();

    const { data: files } = await admin.storage.from('contracts').list(`${A.id}/${seeded.contractId}`);
    expect(files?.map((f) => f.name)).toEqual(['nda-3-pages.pdf']);
  });

  it('A can sign and download their own file', async () => {
    const { data, error } = await A.client.storage.from('contracts').createSignedUrl(path(), 60);
    expect(error).toBeNull();
    const res = await fetch(data!.signedUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });
});

describe('RPCs', () => {
  it.each([
    ['check_rate_limit', { p_user_id: 'A', p_bucket: 'upload', p_limit: 20, p_window_seconds: 3600 }],
    ['start_processing', { p_user_id: 'A', p_contract_id: 'C', p_contract_type: 'NDA', p_custom_terms: [] }],
    ['save_extraction_results', { p_user_id: 'A', p_contract_id: 'C', p_terms: [], p_type_mismatch: false, p_prompt_version: 'v1' }],
    ['invoke_edge_function', { p_function_name: 'retention-cleanup' }],
  ] as const)('authenticated %s → permission denied', async (fn, rawArgs) => {
    const args = JSON.parse(JSON.stringify(rawArgs).replaceAll('"A"', `"${A.id}"`).replaceAll('"C"', `"${seeded.contractId}"`));
    // deno-lint-ignore no-explicit-any
    const { error } = await (A.client.rpc as any)(fn, args);
    expect(error, fn).not.toBeNull();
    expect(error!.code).toMatch(/^(42501|PGRST202)$/);
  });

  it('get_dashboard_stats: own counts for A, zero for B, denied for anon', async () => {
    const own = await A.client.rpc('get_dashboard_stats');
    expect((own.data as { total: number }).total).toBe(1);
    const other = await B.client.rpc('get_dashboard_stats');
    expect((other.data as { total: number }).total).toBe(0);
    const { error } = await anon.rpc('get_dashboard_stats');
    expect(error).not.toBeNull();
  });

  it('health_check is callable anonymously and reads nothing', async () => {
    expect(await anon.rpc('health_check')).toMatchObject({ data: true, error: null });
  });
});
