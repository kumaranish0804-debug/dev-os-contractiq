// Shared setup for integration, RLS and E2E tests against a real Supabase project (Spec 12 §12.4).
// Every user created here has an email matching TEST_EMAIL_RE so a crashed run can be swept up.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database.types';

export type Client = SupabaseClient<Database>;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests (set it in .env.local)`);
  return value;
}

export const SUPABASE_URL = required('NEXT_PUBLIC_SUPABASE_URL');
export const ANON_KEY = required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

export const admin: Client = createClient<Database>(SUPABASE_URL, SERVICE_KEY, noSession);
export const anon: Client = createClient<Database>(SUPABASE_URL, ANON_KEY, noSession);

export const TEST_EMAIL_RE = /^cq-(test|live|e2e)-[a-z0-9-]+@example\.com$/;
export const FIXTURES = resolve(__dirname, '../fixtures');
export const fixture = (name: string) => readFileSync(resolve(FIXTURES, name));

export type TestUser = {
  id: string;
  email: string;
  password: string;
  /** supabase-js client signed in as this user (RLS applies). */
  client: Client;
  accessToken: string;
  /** Session cookies exactly as @supabase/ssr writes them, for route handlers and the browser. */
  cookies: { name: string; value: string }[];
};

export async function createTestUser(tag = 'test'): Promise<TestUser> {
  const email = `cq-${tag}-${randomUUID().slice(0, 12)}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  // One sign-in per user (the hosted auth endpoint is rate-limited): it yields the SSR cookies, and
  // the same access token backs the supabase-js client.
  const jar = new Map<string, string>();
  const ssr = createServerClient<Database>(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const session = await withAuthBackoff(async () => {
    const { data: signIn, error } = await ssr.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return signIn.session;
  });

  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });

  return {
    id: data.user.id,
    email,
    password,
    client,
    accessToken: session.access_token,
    cookies: [...jar].map(([name, value]) => ({ name, value })),
  };
}

/** Retries auth calls that hit the project's rate limit (429), backing off 5 s, 10 s, 20 s. */
async function withAuthBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status !== 429 || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
    }
  }
}

/** Removes the user's storage objects, then the user (cascades profile → contracts → children). */
export async function deleteTestUser(userId: string): Promise<void> {
  const bucket = admin.storage.from('contracts');
  const { data: folders } = await bucket.list(userId, { limit: 1000 });
  for (const folder of folders ?? []) {
    const { data: files } = await bucket.list(`${userId}/${folder.name}`, { limit: 1000 });
    if (files?.length) await bucket.remove(files.map((f) => `${userId}/${folder.name}/${f.name}`));
  }
  await admin.auth.admin.deleteUser(userId);
}

/** Deletes test users left behind by crashed runs (older than `olderThanMs`). */
export async function sweepStaleTestUsers(olderThanMs = 60 * 60 * 1000): Promise<number> {
  let removed = 0;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const stale = data.users.filter(
      (u) => u.email && TEST_EMAIL_RE.test(u.email) && Date.now() - Date.parse(u.created_at) > olderThanMs,
    );
    for (const u of stale) {
      await deleteTestUser(u.id);
      removed++;
    }
    if (data.users.length < 1000) return removed;
  }
}

const CONTRACT_TEXT = [
  '[PAGE 1]',
  'MUTUAL NON-DISCLOSURE AGREEMENT between Acme Corp and Beta LLC. ' + 'Confidential information terms. '.repeat(20),
  '',
  '[PAGE 2]',
  'The obligations of confidentiality survive for three years. ' + 'Further provisions apply. '.repeat(20),
  '',
  '[PAGE 3]',
  'This Agreement is governed by the laws of the State of New York. ' + 'Miscellaneous terms. '.repeat(20),
].join('\n');

export type SeededContract = {
  contractId: string;
  keyTermIds: string[];
  customTermId: string;
  sessionId: string;
  messageIds: string[];
  feedbackId: string;
  logId: string;
  filePath: string | null;
};

/**
 * A completed contract with every child row (Spec 12 §12.4): key terms, a custom term, a chat
 * session with messages, feedback, a processing log and (optionally) the stored PDF.
 */
export async function seedContract(
  userId: string,
  opts: { title?: string; type?: 'NDA' | 'MSA'; withFile?: boolean; createdAt?: string; status?: 'completed' | 'uploaded' } = {},
): Promise<SeededContract> {
  const contractId = randomUUID();
  const filePath = opts.withFile === false ? null : `${userId}/${contractId}/nda-3-pages.pdf`;
  if (filePath) {
    const { error } = await admin.storage
      .from('contracts')
      .upload(filePath, fixture('nda-3-pages.pdf'), { contentType: 'application/pdf' });
    if (error) throw error;
  }

  const now = new Date().toISOString();
  const status = opts.status ?? 'completed';
  const { error: cErr } = await admin.from('contracts').insert({
    id: contractId,
    user_id: userId,
    title: opts.title ?? 'Acme NDA',
    original_filename: 'Acme NDA.pdf',
    contract_type: opts.type ?? 'NDA',
    status,
    contract_text: CONTRACT_TEXT,
    page_count: 3,
    word_count: 200,
    token_count: 400,
    file_size_bytes: 4000,
    file_path: filePath,
    processed_at: status === 'completed' ? now : null,
    prompt_version: 'v1',
    created_at: opts.createdAt ?? now,
    last_accessed_at: now,
  });
  if (cErr) throw cErr;
  if (status !== 'completed') {
    return { contractId, keyTermIds: [], customTermId: '', sessionId: '', messageIds: [], feedbackId: '', logId: '', filePath };
  }

  const { data: terms, error: tErr } = await admin
    .from('key_terms')
    .insert([
      {
        contract_id: contractId, user_id: userId, term_key: 'parties', term_name: 'Parties', value: 'Acme Corp and Beta LLC',
        original_value: 'Acme Corp and Beta LLC', page_number: 1, confidence_score: 95, sort_order: 0, is_custom: false,
        source_sentence: 'MUTUAL NON-DISCLOSURE AGREEMENT between Acme Corp and Beta LLC.',
      },
      {
        contract_id: contractId, user_id: userId, term_key: 'confidentiality_period', term_name: 'Confidentiality Period',
        value: 'Three years', original_value: 'Three years', page_number: 2, confidence_score: 42, sort_order: 1, is_custom: false,
        source_sentence: 'The obligations of confidentiality survive for three years.',
      },
      {
        contract_id: contractId, user_id: userId, term_key: 'governing_law', term_name: 'Governing Law',
        value: 'State of New York', original_value: 'State of New York', page_number: 3, confidence_score: 88, sort_order: 2, is_custom: false,
        source_sentence: 'This Agreement is governed by the laws of the State of New York.',
      },
      {
        contract_id: contractId, user_id: userId, term_key: 'custom_audit_rights', term_name: 'Audit rights', value: null,
        original_value: null, page_number: null, confidence_score: 0, sort_order: 100, is_custom: true, source_sentence: null,
      },
    ])
    .select('id');
  if (tErr) throw tErr;

  const { data: custom, error: ctErr } = await admin
    .from('custom_key_terms')
    .insert({ contract_id: contractId, user_id: userId, term_name: 'Audit rights' })
    .select('id')
    .single();
  if (ctErr) throw ctErr;

  const { data: session, error: sErr } = await admin
    .from('chat_sessions')
    .insert({ contract_id: contractId, user_id: userId })
    .select('id')
    .single();
  if (sErr) throw sErr;

  const { data: messages, error: mErr } = await admin
    .from('chat_messages')
    .insert([
      { session_id: session.id, user_id: userId, role: 'user', content: 'What law governs this?', query_type: 'contract', cited_pages: [] },
      {
        session_id: session.id, user_id: userId, role: 'assistant', cited_pages: [3], query_type: null,
        content: 'Based on the document, the governing law is the State of New York [Page 3].',
      },
    ])
    .select('id');
  if (mErr) throw mErr;

  const { data: feedback, error: fErr } = await admin
    .from('user_feedback')
    .insert({ contract_id: contractId, user_id: userId, rating: 'up', comment: null })
    .select('id')
    .single();
  if (fErr) throw fErr;

  const { data: log, error: lErr } = await admin
    .from('processing_logs')
    .insert({ contract_id: contractId, user_id: userId, kind: 'extraction', model: 'gpt-4o-mini', total_ms: 12_000, success: true, cost_usd: 0.01 })
    .select('id')
    .single();
  if (lErr) throw lErr;

  return {
    contractId,
    keyTermIds: terms.map((t) => t.id),
    customTermId: custom.id,
    sessionId: session.id,
    messageIds: messages.map((m) => m.id),
    feedbackId: feedback.id,
    logId: log.id,
    filePath,
  };
}
