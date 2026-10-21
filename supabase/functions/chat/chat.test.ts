import { assert, assertEquals, assertRejects } from 'std/assert';
import { buildChatMessages, CONTEXT_TOKEN_BUDGET, lastTurns, type HistoryMessage } from '../_shared/chat-context.ts';
import { AppError } from '../_shared/errors.ts';
import { NOT_FOUND_IN_CONVERSATION, NOT_FOUND_IN_DOCUMENT } from '../_shared/pure/prompts.ts';
import { fakeContext, fakeSupabase, type Call, type FakeOptions } from '../_shared/test-utils/fake-supabase.ts';
import { apiError, raw, scriptedComplete, type Step } from '../_shared/test-utils/llm-mock.ts';
import { CHAT_TIMINGS, handleChat, isCitationMiss, type ChatDeps, type ChatResponse } from './chat.ts';

const CONTRACT_ID = '88888888-8888-4888-8888-888888888888';
const CONTRACT = {
  id: CONTRACT_ID,
  status: 'completed',
  page_count: 3,
  contract_type: 'NDA',
  contract_text: '[PAGE 1]\nParties.\n\n[PAGE 3]\nThis Agreement is governed by the laws of New York.',
};
const HISTORY = [
  { role: 'user', content: 'Who are the parties?', status: 'complete', created_at: '1' },
  { role: 'assistant', content: 'Based on the document, Acme and Beta [Page 1].', status: 'complete', created_at: '2' },
  { role: 'user', content: 'And the term?', status: 'complete', created_at: '3' },
  { role: 'assistant', content: 'partial', status: 'error', created_at: '4' },
];

let messageIds = 0;

function setup(
  steps: Step[],
  over: {
    contract?: unknown;
    session?: unknown;
    history?: unknown[];
    sessionInsert?: { data?: unknown; error?: { message: string; code?: string } };
    timings?: Partial<typeof CHAT_TIMINGS>;
  } = {},
) {
  const sessionSelects: unknown[] = [over.session === undefined ? { id: 's-1', message_count: 4 } : over.session];
  const options: FakeOptions = {
    query: {
      contracts: () => ({ data: over.contract === undefined ? CONTRACT : over.contract }),
      chat_sessions: (call) =>
        call.op === 'select'
          ? { data: sessionSelects.length > 1 ? sessionSelects.shift() : sessionSelects[0] }
          : (over.sessionInsert ?? { data: { id: 's-new', message_count: 0 } }),
      chat_messages: (call) =>
        call.op === 'select' ? { data: over.history ?? HISTORY } : { data: { id: `m-${++messageIds}` } },
    },
  };
  const fake = fakeSupabase(options);
  const agent = scriptedComplete(steps);
  const deps: ChatDeps = {
    createComplete: async () => ({ complete: agent.complete, model: null }),
    now: () => Date.now(),
    sleep: () => Promise.resolve(),
    timings: { ...CHAT_TIMINGS, ...over.timings },
  };
  return { fake, agent, deps, sessionSelects };
}

const request = (body: unknown, signal?: AbortSignal) =>
  new Request('http://localhost/chat', { method: 'POST', body: JSON.stringify(body), signal });
const ask = (message: string) => ({ contract_id: CONTRACT_ID, message });

const chat = async (fake: ReturnType<typeof fakeSupabase>, deps: ChatDeps, body: unknown, signal?: AbortSignal) =>
  (await (await handleChat(fakeContext(request(body, signal), fake.client), deps)).json()) as ChatResponse;

const inserts = (calls: Call[], table: string) =>
  calls.filter((c): c is Extract<Call, { op: 'insert' }> => c.op === 'insert' && c.table === table);

Deno.test('returns a grounded answer as JSON, saves both messages and logs', async () => {
  const { fake, agent, deps } = setup([raw('Based on the document, the governing law is New York [Page 3].')]);
  const res = await handleChat(fakeContext(request(ask('What law governs this?')), fake.client), deps);
  assertEquals(res.headers.get('content-type'), 'application/json');
  assertEquals(res.headers.get('cache-control'), 'no-store');

  const body = (await res.json()) as ChatResponse;
  assertEquals(body.query_type, 'contract');
  assertEquals(body.content, 'Based on the document, the governing law is New York [Page 3].');
  assertEquals(body.cited_pages, [3]);
  assertEquals(body.session_id, 's-1');
  assert(body.user_message_id && body.assistant_message_id);

  const [userMsg, assistantMsg] = inserts(fake.calls, 'chat_messages');
  assertEquals(userMsg!.row, { session_id: 's-1', user_id: 'user-1', role: 'user', content: 'What law governs this?', query_type: 'contract' });
  assertEquals(assistantMsg!.row.content, body.content);
  assertEquals(assistantMsg!.row.cited_pages, [3]);
  assertEquals(assistantMsg!.row.status, 'complete');

  const [log] = inserts(fake.calls, 'processing_logs');
  assertEquals(log!.row.kind, 'chat');
  assertEquals(log!.row.success, true);
  assertEquals(log!.row.model, 'gpt-4o-mini'); // as reported by the agent response
  assert((log!.row.cost_usd as number) > 0);

  // Context: system with the contract, completed history only, then the question.
  const sent = agent.calls[0]!.messages;
  assert(sent[0]!.content.includes('<contract>\n[PAGE 1]\nParties.'));
  assertEquals(sent.slice(1).map((m) => m.role), ['user', 'assistant', 'user', 'user']);
  assertEquals(sent.at(-1), { role: 'user', content: 'What law governs this?' });
  assert(!sent.some((m) => m.content === 'partial'));
  assertEquals(agent.calls[0]!.options.json, false);
});

Deno.test('an off-document question gets the exact not-found reply with no citations', async () => {
  const { fake, deps } = setup([raw(NOT_FOUND_IN_DOCUMENT)]);
  const body = await chat(fake, deps, ask("What's the capital of France?"));
  assertEquals(body.cited_pages, []);
  assertEquals(inserts(fake.calls, 'chat_messages')[1]!.row.content, NOT_FOUND_IN_DOCUMENT);
});

Deno.test('"What did you say earlier about termination?" is classified both', async () => {
  const { fake, agent, deps } = setup([raw('Based on the document, ...')]);
  const body = await chat(fake, deps, ask('What did you say earlier about termination?'));
  assertEquals(body.query_type, 'both');
  const system = agent.calls[0]!.messages[0]!.content;
  assert(system.includes('Attribute every fact to its source'));
  assert(system.includes('<contract>\n[PAGE 1]\nParties.'));
});

Deno.test('history is loaded BEFORE the new question is saved, so the question never classifies itself', async () => {
  // A stateful chat_messages table: selects see exactly what has been inserted so far.
  const table: Record<string, unknown>[] = [];
  const fake = fakeSupabase({
    query: {
      contracts: () => ({ data: CONTRACT }),
      chat_sessions: () => ({ data: { id: 's-1', message_count: 0 } }),
      chat_messages: (call) => {
        if (call.op === 'select') return { data: table.map((r) => ({ ...r, status: r.status ?? 'complete' })) };
        if (call.op === 'insert') {
          table.push(call.row);
          return { data: { id: `m-${table.length}` } };
        }
        return undefined;
      },
    },
  });
  const agent = scriptedComplete([raw('Based on the document, nothing earlier [Page 1].')]);
  const deps: ChatDeps = {
    createComplete: async () => ({ complete: agent.complete, model: null }),
    now: () => Date.now(),
    sleep: () => Promise.resolve(),
  };

  // First message of a session, phrased like a history question. Saved before loading, it would be
  // its own history and classify as HISTORY; loaded first, there is no history, so it is CONTRACT.
  const body = await chat(fake, deps, ask('What did you say earlier?'));
  assertEquals(body.query_type, 'contract');

  const order = fake.calls
    .filter((c) => (c.op === 'select' || c.op === 'insert') && 'table' in c && c.table === 'chat_messages')
    .map((c) => c.op);
  assertEquals(order.slice(0, 2), ['select', 'insert']);

  const sent = agent.calls[0]!.messages;
  assertEquals(sent.filter((m) => m.content === 'What did you say earlier?').length, 1);
  assertEquals(sent.at(-1), { role: 'user', content: 'What did you say earlier?' });
});

Deno.test('creates the session on first message, and re-selects after a creation race', async () => {
  const first = setup([raw('ok')], { session: null });
  await chat(first.fake, first.deps, ask('Q'));
  assertEquals(inserts(first.fake.calls, 'chat_sessions')[0]!.row, { contract_id: CONTRACT_ID, user_id: 'user-1' });
  assertEquals(inserts(first.fake.calls, 'chat_messages')[0]!.row.session_id, 's-new');

  const race = setup([raw('ok')], {
    session: null,
    sessionInsert: { error: { message: 'duplicate', code: '23505' } },
  });
  race.sessionSelects.push({ id: 's-raced', message_count: 2 });
  await chat(race.fake, race.deps, ask('Q'));
  assertEquals(inserts(race.fake.calls, 'chat_messages')[0]!.row.session_id, 's-raced');
});

Deno.test('pre-call errors throw the envelope code (no message stored)', async () => {
  const cases: [Parameters<typeof setup>[1], unknown, string][] = [
    [{ contract: null }, ask('Q'), 'NOT_FOUND'],
    [{ contract: { ...CONTRACT, status: 'processing' } }, ask('Q'), 'CONTRACT_NOT_READY'],
    [{ session: { id: 's-1', message_count: 199 } }, ask('Q'), 'CHAT_LIMIT_REACHED'],
    [{}, ask('   '), 'INVALID_INPUT'],
    [{}, ask('x'.repeat(2001)), 'INVALID_INPUT'],
    [{}, { contract_id: 'nope', message: 'Q' }, 'NOT_FOUND'],
  ];
  for (const [over, body, code] of cases) {
    const { fake, deps } = setup([], over);
    const error = await assertRejects(() => handleChat(fakeContext(request(body), fake.client), deps), AppError);
    assertEquals(error.code, code, JSON.stringify(body));
    assertEquals(inserts(fake.calls, 'chat_messages').length, 0);
  }
});

Deno.test('the contract query is scoped to the caller', async () => {
  const { fake, deps } = setup([raw('ok')]);
  await chat(fake, deps, ask('Q'));
  const select = fake.calls.find((c) => c.op === 'select' && c.table === 'contracts');
  assert(select?.op === 'select');
  assertEquals(select.filters, [['id', CONTRACT_ID], ['user_id', 'user-1']]);
});

Deno.test('retries transient agent errors (503 → 503 → answer)', async () => {
  const { fake, agent, deps } = setup([apiError(503), apiError(503), raw('Based on the document, fine [Page 1].')]);
  const body = await chat(fake, deps, ask('Q'));
  assertEquals(body.cited_pages, [1]);
  assertEquals(agent.calls.length, 3);
  assertEquals(inserts(fake.calls, 'processing_logs')[0]!.row.attempts, 3);
});

Deno.test('an agent failure saves an error answer, logs failure and throws AI_UNAVAILABLE', async () => {
  const { fake, deps } = setup([apiError(502), apiError(502), apiError(502)]);
  const error = await assertRejects(() => handleChat(fakeContext(request(ask('Q')), fake.client), deps), AppError);
  assertEquals(error.code, 'AI_UNAVAILABLE');

  const assistant = inserts(fake.calls, 'chat_messages')[1]!;
  assertEquals(assistant.row.status, 'error');
  assertEquals(assistant.row.content, '');
  const [log] = inserts(fake.calls, 'processing_logs');
  assertEquals(log!.row.success, false);
  assertEquals(log!.row.error_code, 'AI_UNAVAILABLE');
});

Deno.test('a 4xx from the agent (bad key, endpoint or api-version) is not retried', async () => {
  const { fake, agent, deps } = setup([apiError(401)]);
  const error = await assertRejects(() => handleChat(fakeContext(request(ask('Q')), fake.client), deps), AppError);
  assertEquals(error.code, 'INTERNAL');
  assertEquals(agent.calls.length, 1);
});

Deno.test('upstream error text is returned only when ENVIRONMENT=development', async () => {
  const previous = Deno.env.get('ENVIRONMENT');
  try {
    Deno.env.set('ENVIRONMENT', 'development');
    const dev = setup([apiError(405)]);
    const devError = await assertRejects(() => handleChat(fakeContext(request(ask('Q')), dev.fake.client), dev.deps), AppError);
    assertEquals(devError.details, { upstream: 'HTTP 405' });

    Deno.env.set('ENVIRONMENT', 'production');
    const prod = setup([apiError(405)]);
    const prodError = await assertRejects(() => handleChat(fakeContext(request(ask('Q')), prod.fake.client), prod.deps), AppError);
    assertEquals(prodError.details, undefined);
  } finally {
    if (previous === undefined) Deno.env.delete('ENVIRONMENT');
    else Deno.env.set('ENVIRONMENT', previous);
  }
});

Deno.test('an empty agent answer is an error, not a blank reply', async () => {
  const { fake, deps } = setup([raw('   ')]);
  const error = await assertRejects(() => handleChat(fakeContext(request(ask('Q')), fake.client), deps), AppError);
  assertEquals(error.code, 'AI_UNAVAILABLE');
  assertEquals(inserts(fake.calls, 'chat_messages')[1]!.row.status, 'error');
});

Deno.test('no answer in time → AI_TIMEOUT', async () => {
  const { fake, deps } = setup(['hang'], { timings: { totalMs: 30 } });
  const error = await assertRejects(() => handleChat(fakeContext(request(ask('Q')), fake.client), deps), AppError);
  assertEquals(error.code, 'AI_TIMEOUT');
  assertEquals(inserts(fake.calls, 'processing_logs')[0]!.row.error_code, 'AI_TIMEOUT');
});

Deno.test('missing Azure configuration surfaces as an error, not a crash', async () => {
  const { fake, deps } = setup([]);
  deps.createComplete = () => Promise.reject(new AppError('INTERNAL'));
  const error = await assertRejects(() => handleChat(fakeContext(request(ask('Q')), fake.client), deps), AppError);
  assertEquals(error.code, 'INTERNAL');
  assertEquals(inserts(fake.calls, 'chat_messages')[1]!.row.status, 'error');
});

Deno.test('client disconnect aborts the agent call and logs CLIENT_ABORTED', async () => {
  const controller = new AbortController();
  const { fake, deps } = setup(['hang']);
  const pending = assertRejects(() => handleChat(fakeContext(request(ask('Q'), controller.signal), fake.client), deps), AppError);
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();
  await pending;
  assertEquals(inserts(fake.calls, 'chat_messages')[1]!.row.status, 'error');
  assertEquals(inserts(fake.calls, 'processing_logs')[0]!.row.error_code, 'CLIENT_ABORTED');
});

// ---------------------------------------------------------------------------
// Message assembly
// ---------------------------------------------------------------------------

const history = (pairs: number): HistoryMessage[] =>
  Array.from({ length: pairs }, (_, i) => [
    { role: 'user' as const, content: `q${i}`, status: 'complete' as const },
    { role: 'assistant' as const, content: `a${i}`, status: 'complete' as const },
  ]).flat();

Deno.test('history-only questions omit the contract and must end with [From conversation]', () => {
  const messages = buildChatMessages({ queryType: 'history', contractType: 'NDA', contractText: 'SECRET TEXT', history: history(1), question: 'What did you say before?' });
  assert(!messages[0]!.content.includes('SECRET TEXT'));
  assert(messages[0]!.content.includes('earlier conversation'));
  assert(messages[0]!.content.includes('End your answer with [From conversation].'));
});

Deno.test('turn caps: CONTRACT and BOTH send the last 10 turns, HISTORY up to 20', () => {
  const sentHistory = (queryType: 'contract' | 'both' | 'history', pairs: number) =>
    buildChatMessages({ queryType, contractType: 'NDA', contractText: 'C', history: history(pairs), question: 'Q' })
      .slice(1, -1)
      .map((m) => m.content);

  for (const type of ['contract', 'both'] as const) {
    const kept = sentHistory(type, 15);
    assertEquals(kept.length, 20);
    assertEquals([kept[0], kept.at(-1)], ['q5', 'a14']);
    assertEquals(sentHistory(type, 3).length, 6); // fewer than the cap → everything
  }
  const kept = sentHistory('history', 25);
  assertEquals(kept.length, 40);
  assertEquals([kept[0], kept.at(-1)], ['q5', 'a24']);
});

Deno.test('lastTurns keeps whole turns, drops failed answers first, and never starts on an answer', () => {
  const msgs = (...roles: ('user' | 'assistant')[]) => roles.map((role, i) => ({ role, content: `${role[0]}${i}` }));
  assertEquals(lastTurns(msgs('user', 'assistant', 'user', 'assistant', 'user', 'assistant'), 2).map((m) => m.content), ['u2', 'a3', 'u4', 'a5']);
  // A question whose answer failed is still a turn (question only).
  assertEquals(lastTurns(msgs('user', 'assistant', 'user', 'user', 'assistant'), 2).map((m) => m.content), ['u2', 'u3', 'a4']);
  assertEquals(lastTurns(msgs('assistant', 'user', 'assistant'), 10).map((m) => m.content), ['u1', 'a2']);
  assertEquals(lastTurns([], 10), []);

  const withFailure: HistoryMessage[] = [
    { role: 'user', content: 'q0', status: 'complete' },
    { role: 'assistant', content: 'partial', status: 'error' },
    { role: 'user', content: 'q1', status: 'complete' },
    { role: 'assistant', content: 'a1', status: 'complete' },
  ];
  const sent = buildChatMessages({ queryType: 'contract', contractType: 'NDA', contractText: 'C', history: withFailure, question: 'Q' });
  assertEquals(sent.slice(1, -1).map((m) => m.content), ['q0', 'q1', 'a1']);
});

Deno.test('over budget, the oldest history pairs are dropped; the contract is kept whole', () => {
  // Each history message costs 20k "tokens": the system + question + reply reserve leave room for 4.
  const count = (s: string) => (s.startsWith('q') || s.startsWith('a') ? 20_000 : s.includes('BIG') ? 10_000 : 1);
  const messages = buildChatMessages(
    { queryType: 'contract', contractType: 'MSA', contractText: 'BIG', history: history(5), question: 'Q' },
    count,
  );
  assert(messages[0]!.content.includes('BIG'));
  const kept = messages.slice(1, -1).map((m) => m.content);
  assertEquals(kept, ['q1', 'a1', 'q2', 'a2', 'q3', 'a3', 'q4', 'a4'].slice(-4));
  const total = messages.reduce((n, m) => n + count(m.content), 0) + 1000;
  assert(total <= CONTEXT_TOKEN_BUDGET);
});

Deno.test('NO_CITATION is logged for an uncited answer, but not for the not-found reply', async () => {
  const uncited = setup([raw('Based on the document, the term is two years.')]);
  await chat(uncited.fake, uncited.deps, ask('How long is the term?'));
  const [missLog] = inserts(uncited.fake.calls, 'processing_logs');
  assertEquals(missLog!.row.success, true);
  assertEquals(missLog!.row.error_code, 'NO_CITATION');

  const notFound = setup([raw(NOT_FOUND_IN_DOCUMENT)]);
  await chat(notFound.fake, notFound.deps, ask("What's the capital of France?"));
  assertEquals(inserts(notFound.fake.calls, 'processing_logs')[0]!.row.error_code, null);
});

Deno.test('isCitationMiss: cited, not-found and history answers are not misses', () => {
  assertEquals(isCitationMiss('Based on the document, New York.', [], 'contract'), true);
  assertEquals(isCitationMiss('Based on the document, New York [Page 3].', [3], 'contract'), false);
  assertEquals(isCitationMiss(`  ${NOT_FOUND_IN_DOCUMENT}\n`, [], 'both'), false);
  assertEquals(isCitationMiss(NOT_FOUND_IN_CONVERSATION, [], 'contract'), false);
  assertEquals(isCitationMiss('Earlier I said the term is two years.', [], 'history'), false);
  // BOTH: an answer sourced only from the conversation is attributed, not a miss; unattributed is.
  assertEquals(isCitationMiss('You asked about renewal earlier [From conversation].', [], 'both'), false);
  assertEquals(isCitationMiss('You asked about renewal earlier.', [], 'both'), true);
});
