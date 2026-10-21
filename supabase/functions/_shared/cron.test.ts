import { assertEquals } from 'std/assert';
import { createPostSlack } from './alerts.ts';
import { cronHandler, secretsMatch } from './cron.ts';

const SECRET = 's3cret-value-with-32-characters!';
const req = (headers: Record<string, string> = {}, method = 'POST') =>
  new Request('http://fn/retention-cleanup', { method, headers });

Deno.test('secretsMatch: exact match only', async () => {
  assertEquals(await secretsMatch(SECRET, SECRET), true);
  assertEquals(await secretsMatch(`${SECRET}x`, SECRET), false);
  assertEquals(await secretsMatch('', SECRET), false);
  assertEquals(await secretsMatch(null, SECRET), false);
});

Deno.test('cronHandler: wrong, missing secret or wrong method → 401 without running the job', async () => {
  let runs = 0;
  const handler = cronHandler('retention-cleanup', SECRET, () => {
    runs++;
    return Promise.resolve({ deleted: 0, failed: 0 });
  });
  assertEquals((await handler(req())).status, 401);
  assertEquals((await handler(req({ 'x-cron-secret': 'nope' }))).status, 401);
  assertEquals((await handler(req({ 'x-cron-secret': SECRET }, 'GET'))).status, 401);
  assertEquals(runs, 0);

  const ok = await handler(req({ 'x-cron-secret': SECRET }));
  assertEquals(ok.status, 200);
  assertEquals(await ok.json(), { deleted: 0, failed: 0 });
  assertEquals(runs, 1);
});

Deno.test('cronHandler: unconfigured secret refuses everything; job errors → 500', async () => {
  let runs = 0;
  const unconfigured = cronHandler('daily-alerts', undefined, () => (runs++, Promise.resolve({})));
  assertEquals((await unconfigured(req({ 'x-cron-secret': '' }))).status, 500);
  assertEquals(runs, 0);

  const failing = cronHandler('daily-alerts', SECRET, () => Promise.reject(new Error('db down')));
  assertEquals((await failing(req({ 'x-cron-secret': SECRET }))).status, 500);
});

Deno.test('postSlack: prefixes the message; missing webhook or failures never throw', async () => {
  const sent: { url: string; body: unknown }[] = [];
  const fakeFetch = ((url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return Promise.resolve(new Response('ok'));
  }) as typeof fetch;
  await createPostSlack('https://hooks.slack.test/x', fakeFetch)('Spend high');
  assertEquals(sent, [{ url: 'https://hooks.slack.test/x', body: { text: ':rotating_light: ContractIQ — Spend high' } }]);

  await createPostSlack(undefined, fakeFetch)('ignored');
  assertEquals(sent.length, 1);

  const broken = (() => Promise.reject(new Error('offline'))) as typeof fetch;
  await createPostSlack('https://hooks.slack.test/x', broken)('still fine');
});
