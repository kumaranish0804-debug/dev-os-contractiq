import { assertEquals, assertStringIncludes } from 'std/assert';
import {
  avgCostCheck,
  citationMissCheck,
  correctionRateCheck,
  failureRateCheck,
  latencyCheck,
  percentileCont,
  spendCheck,
} from './metrics.ts';

const log = (o: Partial<{ kind: string; success: boolean; total_ms: number; error_code: string | null }>) => ({
  kind: 'extraction',
  success: true,
  total_ms: 10_000,
  error_code: null,
  ...o,
});
const many = <T>(n: number, row: T) => Array.from({ length: n }, () => row);

Deno.test('percentileCont matches Postgres linear interpolation', () => {
  assertEquals(percentileCont([], 0.95), null);
  assertEquals(percentileCont([5], 0.95), 5);
  assertEquals(percentileCont([1, 2, 3, 4], 0.5), 2.5);
  assertEquals(percentileCont(Array.from({ length: 101 }, (_, i) => i), 0.95), 95);
});

Deno.test('spend: alerts at 80% of budget', () => {
  assertEquals(spendCheck([100, 219.99], 400), null);
  const alert = spendCheck([200, 120], 400);
  assertEquals(alert, 'OpenAI spend at 80% of monthly budget ($320.00 / $400.00)');
  assertEquals(spendCheck([1000], 0), null);
});

Deno.test('correction rate: > 12% with at least 50 terms', () => {
  assertEquals(correctionRateCheck([{ total_terms: 40, corrected_terms: 20 }]), null); // too few terms
  assertEquals(correctionRateCheck([{ total_terms: 100, corrected_terms: 12 }]), null); // exactly 12%
  const alert = correctionRateCheck([{ total_terms: 60, corrected_terms: 8 }, { total_terms: 40, corrected_terms: 5 }]);
  assertEquals(alert, 'Correction rate 13.0% over 7 days (13/100 terms) — trigger prompt review');
});

Deno.test('failure rate: > 5% of at least 20 extractions; chat rows ignored', () => {
  assertEquals(failureRateCheck([...many(18, log({})), ...many(1, log({ success: false }))]), null);
  assertEquals(failureRateCheck([...many(19, log({})), log({ success: false })]), null); // 5%
  const rows = [...many(18, log({})), ...many(2, log({ success: false })), ...many(30, log({ kind: 'chat', success: false }))];
  assertEquals(failureRateCheck(rows), 'Extraction failure rate 10.0% over 24 h (2/20 runs)');
});

Deno.test('latency: P95 over 30 s', () => {
  assertEquals(latencyCheck(many(20, log({ total_ms: 29_000 }))), null);
  assertEquals(latencyCheck([]), null);
  const alert = latencyCheck([...many(18, log({ total_ms: 10_000 })), ...many(2, log({ total_ms: 60_000 }))]);
  assertStringIncludes(alert!, 'Extraction latency P95');
  assertStringIncludes(alert!, 'target ≤ 30 s');
});

Deno.test('citation misses: > 10% of at least 20 chats', () => {
  const chat = (error_code: string | null) => log({ kind: 'chat', error_code });
  assertEquals(citationMissCheck([...many(18, chat(null)), ...many(2, chat('NO_CITATION'))]), null); // 10%
  assertEquals(citationMissCheck(many(10, chat('NO_CITATION'))), null); // too few
  assertEquals(
    citationMissCheck([...many(17, chat(null)), ...many(3, chat('NO_CITATION')), ...many(5, chat('AI_TIMEOUT'))]),
    'Chat answers without citations 12.0% over 24 h (3/25)',
  );
});

Deno.test('average cost per contract: > $0.25, deleted contracts left out', () => {
  assertEquals(avgCostCheck([]), null);
  assertEquals(avgCostCheck([{ cost_usd: 0.2, contract_id: 'a' }, { cost_usd: 0.05, contract_id: 'a' }]), null);
  assertEquals(avgCostCheck([{ cost_usd: 0.2, contract_id: 'a' }, { cost_usd: 9, contract_id: null }]), null);
  assertEquals(
    avgCostCheck([{ cost_usd: 0.3, contract_id: 'a' }, { cost_usd: 0.1, contract_id: 'a' }, { cost_usd: 0.2, contract_id: 'b' }]),
    'Average cost per contract $0.30 over 7 days (target ≤ $0.25)',
  );
});
