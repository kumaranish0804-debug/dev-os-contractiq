import { assert, assertEquals, assertRejects, assertStringIncludes } from 'std/assert';
import { fakeSupabase, type Call } from '../_shared/test-utils/fake-supabase.ts';
import { FETCH, fetchWindow, runDailyAlerts } from './daily-alerts.ts';

const NOW = Date.parse('2026-10-21T08:00:00Z');
type Select = Extract<Call, { op: 'select' }>;

/** Returns `rows` for a table/column set, paged by the recorded range. */
function seeded(data: { month?: unknown[]; corrections?: unknown[]; day?: unknown[]; week?: unknown[] }) {
  const page = (all: unknown[], call: Select) => {
    const [from, to] = (call.filters.find(([f]) => f === 'range')?.[1] as [number, number]) ?? [0, 999];
    return { data: all.slice(from, to + 1) };
  };
  return fakeSupabase({
    query: {
      processing_logs: (call) => {
        if (call.op !== 'select') return undefined;
        if (call.columns === 'cost_usd') return page(data.month ?? [], call);
        if (call.columns === 'cost_usd, contract_id') return page(data.week ?? [], call);
        return page(data.day ?? [], call);
      },
      term_corrections: (call) => (call.op === 'select' ? page(data.corrections ?? [], call) : undefined),
    },
  });
}

const slack = () => {
  const messages: string[] = [];
  return { messages, postSlack: (t: string) => (messages.push(t), Promise.resolve()) };
};

Deno.test('all green → posts nothing', async () => {
  const { client } = seeded({
    month: [{ cost_usd: 10 }],
    corrections: [{ total_terms: 100, corrected_terms: 2 }],
    day: Array.from({ length: 30 }, () => ({ kind: 'extraction', success: true, total_ms: 12_000, error_code: null })),
    week: [{ cost_usd: 0.05, contract_id: 'a' }],
  });
  const s = slack();
  assertEquals(await runDailyAlerts({ admin: client, postSlack: s.postSlack, budgetUsd: '400', now: () => NOW }), { alerts: [] });
  assertEquals(s.messages, []);
});

Deno.test('over budget → exactly one Slack message listing the breach', async () => {
  const { client } = seeded({ month: [{ cost_usd: 250 }, { cost_usd: 100 }] });
  const s = slack();
  const { alerts } = await runDailyAlerts({ admin: client, postSlack: s.postSlack, budgetUsd: '400', now: () => NOW });
  assertEquals(alerts, ['OpenAI spend at 88% of monthly budget ($350.00 / $400.00)']);
  assertEquals(s.messages.length, 1);
  assertStringIncludes(s.messages[0]!, '• OpenAI spend at 88%');
});

Deno.test('several breaches share one message', async () => {
  const { client } = seeded({
    corrections: [{ total_terms: 50, corrected_terms: 10 }],
    day: [
      ...Array.from({ length: 15 }, () => ({ kind: 'extraction', success: true, total_ms: 45_000, error_code: null })),
      ...Array.from({ length: 5 }, () => ({ kind: 'extraction', success: false, total_ms: 45_000, error_code: 'AI_TIMEOUT' })),
      ...Array.from({ length: 20 }, () => ({ kind: 'chat', success: true, total_ms: 3000, error_code: 'NO_CITATION' })),
    ],
    week: [{ cost_usd: 0.6, contract_id: 'a' }],
  });
  const s = slack();
  const { alerts } = await runDailyAlerts({ admin: client, postSlack: s.postSlack, budgetUsd: '400', now: () => NOW });
  assertEquals(alerts.length, 5);
  assertEquals(s.messages.length, 1);
  assertStringIncludes(s.messages[0]!, 'Daily checks: 5 alerts');
});

Deno.test('queries the right windows', async () => {
  const { client, calls } = seeded({});
  await runDailyAlerts({ admin: client, postSlack: slack().postSlack, budgetUsd: '400', now: () => NOW });
  const selects = calls.filter((c): c is Select => c.op === 'select');
  const byColumns = Object.fromEntries(selects.map((c) => [c.columns, c.filters]));
  assertEquals(byColumns['cost_usd']![0], ['gte:created_at', '2026-10-01T00:00:00.000Z']);
  assertEquals(byColumns['total_terms, corrected_terms']![0], ['gte:day', '2026-10-14']);
  assertEquals(byColumns['kind, success, total_ms, error_code']![0], ['gte:created_at', '2026-10-20T08:00:00.000Z']);
  assertEquals(byColumns['cost_usd, contract_id']!.slice(0, 2), [
    ['in:kind', ['extraction', 'chat']],
    ['gte:created_at', '2026-10-14T08:00:00.000Z'],
  ]);
});

Deno.test('a missing budget skips only the spend check', async () => {
  const { client } = seeded({ month: [{ cost_usd: 1_000_000 }], week: [{ cost_usd: 1, contract_id: 'a' }] });
  const { alerts } = await runDailyAlerts({ admin: client, postSlack: slack().postSlack, budgetUsd: undefined, now: () => NOW });
  assertEquals(alerts.length, 1);
  assertStringIncludes(alerts[0]!, 'Average cost per contract');
});

Deno.test('fetchWindow pages past 1000 rows and caps (samples) at 50k', async () => {
  const pageOf = (n: number) => (from: number, to: number) =>
    Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(to + 1, n) - from) }, (_, i) => from + i), error: null });

  const small = await fetchWindow('t', pageOf(2500));
  assertEquals(small.rows.length, 2500);
  assertEquals(small.sampled, false);

  const huge = await fetchWindow('t', pageOf(80_000));
  assertEquals(huge.rows.length, FETCH.maxRows);
  assert(huge.sampled);

  await assertRejects(() => fetchWindow('t', () => Promise.resolve({ data: null, error: { message: 'boom' } })), Error, 't query failed');
});
