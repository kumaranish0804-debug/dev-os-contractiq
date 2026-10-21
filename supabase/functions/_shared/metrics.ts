// Daily alert checks (Spec 11 §11.2) as pure functions over raw rows: each returns the alert text
// when its threshold is breached, otherwise null. Zero imports so they unit-test in isolation.

export const ALERT_THRESHOLDS = {
  spendShare: 0.8,
  correctionRate: 0.12,
  correctionMinTerms: 50,
  failureRate: 0.05,
  failureMinRuns: 20,
  latencyP95Ms: 30_000,
  citationMissRate: 0.1,
  citationMinChats: 20,
  avgCostPerContractUsd: 0.25,
} as const;

const pct = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** Linear-interpolated percentile, matching Postgres `percentile_cont`. */
export function percentileCont(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

/** Month-to-date OpenAI spend vs budget. */
export function spendCheck(costs: number[], budgetUsd: number): string | null {
  const sum = costs.reduce((a, c) => a + c, 0);
  if (budgetUsd <= 0 || sum < ALERT_THRESHOLDS.spendShare * budgetUsd) return null;
  return `OpenAI spend at ${Math.round((sum / budgetUsd) * 100)}% of monthly budget (${usd(sum)} / ${usd(budgetUsd)})`;
}

/** 7-day share of extracted terms that users corrected (PRD §8 prompt-review trigger). */
export function correctionRateCheck(rows: { total_terms: number; corrected_terms: number }[]): string | null {
  const total = rows.reduce((a, r) => a + r.total_terms, 0);
  const corrected = rows.reduce((a, r) => a + r.corrected_terms, 0);
  if (total < ALERT_THRESHOLDS.correctionMinTerms || corrected / total <= ALERT_THRESHOLDS.correctionRate) return null;
  return `Correction rate ${pct(corrected / total)} over 7 days (${corrected}/${total} terms) — trigger prompt review`;
}

type LogRow = { kind: string; success: boolean; total_ms: number; error_code: string | null };

/** 24 h extraction failure rate. */
export function failureRateCheck(rows: LogRow[]): string | null {
  const runs = rows.filter((r) => r.kind === 'extraction');
  const failed = runs.filter((r) => !r.success).length;
  if (runs.length < ALERT_THRESHOLDS.failureMinRuns || failed / runs.length <= ALERT_THRESHOLDS.failureRate) return null;
  return `Extraction failure rate ${pct(failed / runs.length)} over 24 h (${failed}/${runs.length} runs)`;
}

/** 24 h extraction latency P95. */
export function latencyCheck(rows: LogRow[]): string | null {
  const p95 = percentileCont(rows.filter((r) => r.kind === 'extraction').map((r) => r.total_ms), 0.95);
  if (p95 === null || p95 <= ALERT_THRESHOLDS.latencyP95Ms) return null;
  return `Extraction latency P95 ${(p95 / 1000).toFixed(1)} s over 24 h (target ≤ ${ALERT_THRESHOLDS.latencyP95Ms / 1000} s)`;
}

/** 24 h share of chat answers saved without a page citation. */
export function citationMissCheck(rows: LogRow[]): string | null {
  const chats = rows.filter((r) => r.kind === 'chat');
  const misses = chats.filter((r) => r.error_code === 'NO_CITATION').length;
  if (chats.length < ALERT_THRESHOLDS.citationMinChats || misses / chats.length <= ALERT_THRESHOLDS.citationMissRate) {
    return null;
  }
  return `Chat answers without citations ${pct(misses / chats.length)} over 24 h (${misses}/${chats.length})`;
}

/** 7-day extraction + chat cost per contract. Logs of deleted contracts (null id) are left out. */
export function avgCostCheck(rows: { cost_usd: number; contract_id: string | null }[]): string | null {
  const known = rows.filter((r) => r.contract_id !== null);
  const contracts = new Set(known.map((r) => r.contract_id)).size;
  if (contracts === 0) return null;
  const avg = known.reduce((a, r) => a + r.cost_usd, 0) / contracts;
  if (avg <= ALERT_THRESHOLDS.avgCostPerContractUsd) return null;
  return `Average cost per contract ${usd(avg)} over 7 days (target ≤ ${usd(ALERT_THRESHOLDS.avgCostPerContractUsd)})`;
}
