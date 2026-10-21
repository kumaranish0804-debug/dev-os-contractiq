import { assert, assertEquals, assertRejects } from 'std/assert';
import { buildChatMessages, CONTEXT_TOKEN_BUDGET, type HistoryMessage } from '../_shared/chat-context.ts';
import { AppError } from '../_shared/errors.ts';
import { NOT_FOUND_IN_CONVERSATION, NOT_FOUND_IN_DOCUMENT } from '../_shared/pure/prompts-v1.ts';
import { fakeContext, fakeSupabase, type Call, type FakeOptions } from '../_shared/test-utils/fake-supabase.ts';
import { apiError, readSseEvents, scriptedStream, type StreamStep } from '../_shared/test-utils/openai-mock.ts';
import { CHAT_TIMINGS, handleChat, isCitationMiss, type ChatDeps } from './chat.ts';

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
  steps: StreamStep[],
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
  const openai = scriptedStream(steps);
  const deps: ChatDeps = {
    createStream: async () => ({ stream: openai.stream, model: 'gpt-4o-mini' }),
    now: () => Date.now(),
    sleep: () => Promise.resolve(),
    timings: { ...CHAT_TIMINGS, ...over.timings },
  };
  return { fake, openai, deps, sessionSelects };
}

const request = (body: unknown, signal?: AbortSignal) =>
  new Request('http://localhost/chat', { method: 'POST', body: JSON.stringify(body), signal });
const ask = (message: string) => ({ contract_id: CONTRACT_ID, message });

const inserts = (calls: Call[], table: string) =>
  calls.filter((c): c is Extract<Call, { op: 'insert' }> => c.op === 'insert' && c.table === table);

Deno.test('streams a grounded answer: meta → deltas → done, saves both messages and logs', async () => {
  const { fake, openai, deps } = setup([
    { deltas: ['Based on the document, ', 'the governing law is New York ', '[Page 3].'] },
  ]);
  const res = await handleChat(fakeContext(request(ask('What law governs this?')), fake.client), deps);
  assertEquals(res.headers.get('content-type'), 'text/event-stream');
  assertEquals(res.headers.get('cache-control'), 'no-cache');

  const events = await readSseEvents(res);
  assertEquals(events.map((e) => e.event), ['meta', 'delta', 'delta', 'delta', 'done']);
  assertEquals((events[0]!.data as Record<string, unknown>).query_type, 'contract');
  assertEquals((events.at(-1)!.data as Record<string, unknown>).cited_pages, [3]);

  const [userMsg, assistantMsg] = inserts(fake.calls, 'chat_messages');
  assertEquals(userMsg!.row, { session_id: 's-1', user_id: 'user-1', role: 'user', content: 'What law governs this?', query_type: 'contract' });
  assertEquals(assistantMsg!.row.content, 'Based on the document, the governing law is New York [Page 3].');
  assertEquals(assistantMsg!.row.cited_pages, [3]);
  assertEquals(assistantMsg!.row.status, 'complete');

  const [log] = inserts(fake.calls, 'processing_logs');
  assertEquals(log!.row.kind, 'chat');
  assertEquals(log!.row.success, true);
  assertEquals(log!.row.model, 'gpt-4o-mini');
  assert((log!.row.cost_usd as number) > 0);

  // Context: system with the contract, completed history only, then the question.
  const sent = openai.calls[0]!.messages;
  assert(sent[0]!.content.includes('<contract>\n[PAGE 1]\nParties.'));
  assertEquals(sent.slice(1).map((m) => m.role), ['user', 'assistant', 'user', 'user']);
  assertEquals(sent.at(-1), { role: 'user', content: 'What law governs this?' });
  assert(!sent.some((m) => m.content === 'partial'));
});

Deno.test('an off-document question gets the exact not-found reply with no citations', async () => {
  const { fake, deps } = setup([{ deltas: [NOT_FOUND_IN_DOCUMENT] }]);
  const events = await readSseEvents(
    await handleChat(fakeContext(request(ask("What's the capital of France?")), fake.client), deps),
  );
  const done = events.at(-1)!;
  assertEquals(done.event, 'done');
  assertEquals((done.data as Record<string, unknown>).cited_pages, []);
  assertEquals(inserts(fake.calls, 'chat_messages')[1]!.row.content, NOT_FOUND_IN_DOCUMENT);
});

Deno.test('"What did you say earlier about termination?" is classified both', async () => {
  const { fake, openai, deps } = setup([{ deltas: ['Based on the document, ...'] }]);
  const events = await readSseEvents(
    await handleChat(fakeContext(request(ask('What did you say earlier about termination?')), fake.client), deps),
  );
  assertEquals((events[0]!.data as Record<string, unknown>).query_type, 'both');
  assert(openai.calls[0]!.messages[0]!.content.includes('</contract> and our previous messages in this conversation.'));
});

Deno.test('creates the session on first message, and re-selects after a creation race', async () => {
  const first = setup([{ deltas: ['ok'] }], { session: null });
  await readSseEvents(await handleChat(fakeContext(request(ask('Q')), first.fake.client), first.deps));
  assertEquals(inserts(first.fake.calls, 'chat_sessions')[0]!.row, { contract_id: CONTRACT_ID, user_id: 'user-1' });
  assertEquals(inserts(first.fake.calls, 'chat_messages')[0]!.row.session_id, 's-new');

  const race = setup([{ deltas: ['ok'] }], {
    session: null,
    sessionInsert: { error: { message: 'duplicate', code: '23505' } },
  });
  race.sessionSelects.push({ id: 's-raced', message_count: 2 });
  await readSseEvents(await handleChat(fakeContext(request(ask('Q')), race.fake.client), race.deps));
  assertEquals(inserts(race.fake.calls, 'chat_messages')[0]!.row.session_id, 's-raced');
});

Deno.test('pre-stream errors return the JSON envelope (no message stored)', async () => {
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
  const { fake, deps } = setup([{ deltas: ['ok'] }]);
  await readSseEvents(await handleChat(fakeContext(request(ask('Q')), fake.client), deps));
  const select = fake.calls.find((c) => c.op === 'select' && c.table === 'contracts');
  assert(select?.op === 'select');
  assertEquals(select.filters, [['id', CONTRACT_ID], ['user_id', 'user-1']]);
});

Deno.test('retries before the first token (503 → 503 → stream)', async () => {
  const { fake, openai, deps } = setup([apiError(503), apiError(503), { deltas: ['Based on the document, fine [Page 1].'] }]);
  const events = await readSseEvents(await handleChat(fakeContext(request(ask('Q')), fake.client), deps));
  assertEquals(events.at(-1)!.event, 'done');
  assertEquals(openai.calls.length, 3);
  assertEquals(inserts(fake.calls, 'processing_logs')[0]!.row.attempts, 3);
});

Deno.test('a failure mid-stream sends error, keeps the partial as status error, logs failure', async () => {
  const { fake, openai, deps } = setup([{ deltas: ['Based on the', ' document'], failAfter: apiError(502) }]);
  const events = await readSseEvents(await handleChat(fakeContext(request(ask('Q')), fake.client), deps));
  assertEquals(events.map((e) => e.event), ['meta', 'delta', 'delta', 'error']);
  assertEquals((events.at(-1)!.data as Record<string, unknown>).code, 'AI_UNAVAILABLE');
  assertEquals(openai.calls.length, 1); // no retry once tokens were sent

  const assistant = inserts(fake.calls, 'chat_messages')[1]!;
  assertEquals(assistant.row.status, 'error');
  assertEquals(assistant.row.content, 'Based on the document');
  assertEquals(inserts(fake.calls, 'processing_logs')[0]!.row.success, false);
});

Deno.test('no first token in time → AI_TIMEOUT, with heartbeats while waiting', async () => {
  const { fake, deps } = setup(['hang'], { timings: { firstTokenMs: 60, heartbeatMs: 15 } });
  const events = await readSseEvents(await handleChat(fakeContext(request(ask('Q')), fake.client), deps));
  assert(events.some((e) => e.event === 'ping'), 'expected heartbeat comments');
  const last = events.at(-1)!;
  assertEquals(last.event, 'error');
  assertEquals((last.data as Record<string, unknown>).code, 'AI_TIMEOUT');
  assertEquals(inserts(fake.calls, 'processing_logs')[0]!.row.error_code, 'AI_TIMEOUT');
});

Deno.test('missing OpenAI configuration surfaces as a streamed error, not a crash', async () => {
  const { fake, deps } = setup([]);
  deps.createStream = () => Promise.reject(new AppError('INTERNAL'));
  const events = await readSseEvents(await handleChat(fakeContext(request(ask('Q')), fake.client), deps));
  assertEquals(events.map((e) => e.event), ['meta', 'error']);
  assertEquals((events[1]!.data as Record<string, unknown>).code, 'INTERNAL');
});

Deno.test('client disconnect aborts OpenAI, stores the partial, sends nothing more', async () => {
  const controller = new AbortController();
  const { fake, deps } = setup(['hang']);
  const res = await handleChat(fakeContext(request(ask('Q'), controller.signal), fake.client), deps);
  const reader = res.body!.getReader();
  await reader.read(); // meta
  controller.abort();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += new TextDecoder().decode(value);
  }
  assert(!rest.includes('event: error'));
  await new Promise((r) => setTimeout(r, 10));
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

Deno.test('history-only questions omit the contract from the system prompt', () => {
  const messages = buildChatMessages({ queryType: 'history', contractType: 'NDA', contractText: 'SECRET TEXT', history: history(1), question: 'What did you say before?' });
  assert(!messages[0]!.content.includes('SECRET TEXT'));
  assert(messages[0]!.content.includes('earlier conversation'));
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
  const uncited = setup([{ deltas: ['Based on the document, the term is two years.'] }]);
  await readSseEvents(await handleChat(fakeContext(request(ask('How long is the term?')), uncited.fake.client), uncited.deps));
  const [missLog] = inserts(uncited.fake.calls, 'processing_logs');
  assertEquals(missLog!.row.success, true);
  assertEquals(missLog!.row.error_code, 'NO_CITATION');

  const notFound = setup([{ deltas: [NOT_FOUND_IN_DOCUMENT] }]);
  await readSseEvents(await handleChat(fakeContext(request(ask("What's the capital of France?")), notFound.fake.client), notFound.deps));
  assertEquals(inserts(notFound.fake.calls, 'processing_logs')[0]!.row.error_code, null);
});

Deno.test('isCitationMiss: cited, not-found and history answers are not misses', () => {
  assertEquals(isCitationMiss('Based on the document, New York.', [], 'contract'), true);
  assertEquals(isCitationMiss('Based on the document, New York [Page 3].', [3], 'contract'), false);
  assertEquals(isCitationMiss(`  ${NOT_FOUND_IN_DOCUMENT}\n`, [], 'both'), false);
  assertEquals(isCitationMiss(NOT_FOUND_IN_CONVERSATION, [], 'contract'), false);
  assertEquals(isCitationMiss('Earlier I said the term is two years.', [], 'history'), false);
});
