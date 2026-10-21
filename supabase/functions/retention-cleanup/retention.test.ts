import { assert, assertEquals } from 'std/assert';
import { fakeSupabase, type Call, type FakeOptions } from '../_shared/test-utils/fake-supabase.ts';
import { RETENTION, runRetention } from './retention.ts';

const NOW = Date.parse('2026-10-21T03:00:00Z');
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const id = `c-${String(i).padStart(4, '0')}`;
    return { id, file_path: `u1/${id}/file.pdf` };
  });

/** Serves `all` like Postgres would for `id > cursor order by id limit 500`. */
function withCandidates(all: { id: string; file_path: string }[], extra: FakeOptions = {}) {
  return fakeSupabase({
    ...extra,
    query: {
      contracts: (call) => {
        if (call.op !== 'select') return undefined;
        const after = call.filters.find(([f]) => f === 'gt:id')?.[1] as string | undefined;
        return { data: all.filter((r) => !after || r.id > after).slice(0, RETENTION.scanLimit) };
      },
    },
  });
}

const slack = () => {
  const messages: string[] = [];
  return { messages, postSlack: (t: string) => (messages.push(t), Promise.resolve()) };
};

Deno.test('removes files idle for 90 days and clears their references', async () => {
  const { client, calls } = withCandidates(rows(3));
  const s = slack();
  const result = await runRetention({ admin: client, postSlack: s.postSlack, now: () => NOW });

  assertEquals(result, { deleted: 3, failed: 0 });
  const scan = calls.find((c): c is Extract<Call, { op: 'select' }> => c.op === 'select')!;
  assertEquals(scan.filters, [
    ['not.is:file_path', null],
    ['lt:last_accessed_at', '2026-07-23T03:00:00.000Z'],
  ]);
  const remove = calls.find((c) => c.op === 'remove') as Extract<Call, { op: 'remove' }>;
  assertEquals(remove.bucket, 'contracts');
  assertEquals(remove.paths, ['u1/c-0000/file.pdf', 'u1/c-0001/file.pdf', 'u1/c-0002/file.pdf']);
  const update = calls.find((c) => c.op === 'update') as Extract<Call, { op: 'update' }>;
  assertEquals(update.values, { file_path: null, file_deleted_at: new Date(NOW).toISOString() });
  assertEquals(update.filters, [['in:id', ['c-0000', 'c-0001', 'c-0002']]]);
  assertEquals(s.messages, []);
});

Deno.test('works in batches of 100 and pages past 500 rows by id', async () => {
  const { client, calls } = withCandidates(rows(650));
  const result = await runRetention({ admin: client, postSlack: slack().postSlack, now: () => NOW });

  assertEquals(result, { deleted: 650, failed: 0 });
  assertEquals(calls.filter((c) => c.op === 'remove').length, 7);
  const scans = calls.filter((c): c is Extract<Call, { op: 'select' }> => c.op === 'select');
  assertEquals(scans.length, 2);
  assertEquals(scans[1]!.filters.at(-1), ['gt:id', 'c-0499']);
});

Deno.test('a failed storage batch is counted, left referenced, not rescanned, and alerts Slack', async () => {
  const { client, calls } = withCandidates(rows(150), { removeErrors: ['storage unavailable', null] });
  const s = slack();
  const result = await runRetention({ admin: client, postSlack: s.postSlack, now: () => NOW });

  assertEquals(result, { deleted: 50, failed: 100 });
  const updates = calls.filter((c): c is Extract<Call, { op: 'update' }> => c.op === 'update');
  assertEquals(updates.length, 1);
  assertEquals((updates[0]!.filters[0]![1] as string[]).length, 50);
  assertEquals(s.messages.length, 1);
  assert(s.messages[0]!.includes('100 stored file(s) could not be deleted'));
  assert(!s.messages[0]!.includes('u1/'), 'alert must not contain paths or user ids');
});

Deno.test('stops scanning after the 50 s budget', async () => {
  let t = NOW;
  const { client, calls } = withCandidates(rows(1500));
  const result = await runRetention({
    admin: client,
    postSlack: slack().postSlack,
    now: () => (t += 30_000),
  });
  assertEquals(calls.filter((c) => c.op === 'select').length, 1);
  assertEquals(result.deleted, 500);
});

Deno.test('nothing to do → no storage calls', async () => {
  const { client, calls } = withCandidates([]);
  assertEquals(await runRetention({ admin: client, postSlack: slack().postSlack, now: () => NOW }), { deleted: 0, failed: 0 });
  assertEquals(calls.filter((c) => c.op === 'remove').length, 0);
});
