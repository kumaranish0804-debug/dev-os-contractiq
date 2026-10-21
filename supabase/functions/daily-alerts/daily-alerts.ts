import type { PostSlack } from '../_shared/alerts.ts';
import { log } from '../_shared/logging.ts';
import {
  avgCostCheck,
  citationMissCheck,
  correctionRateCheck,
  failureRateCheck,
  latencyCheck,
  spendCheck,
} from '../_shared/metrics.ts';
import type { TypedClient } from '../_shared/supabase.ts';

/** PostgREST returns at most 1000 rows per request; windows larger than the cap are sampled. */
export const FETCH = { pageSize: 1000, maxRows: 50_000 } as const;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Reads a window page by page, newest first, up to FETCH.maxRows. */
export async function fetchWindow<T>(
  name: string,
  page: (from: number, to: number) => Page<T>,
): Promise<{ rows: T[]; sampled: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += FETCH.pageSize) {
    const { data, error } = await page(from, from + FETCH.pageSize - 1);
    if (error) throw new Error(`${name} query failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < FETCH.pageSize) return { rows, sampled: false };
    if (rows.length >= FETCH.maxRows) return { rows: rows.slice(0, FETCH.maxRows), sampled: true };
  }
}

export type DailyAlertsDeps = {
  admin: TypedClient;
  postSlack: PostSlack;
  /** MONTHLY_OPENAI_BUDGET_USD as configured; the spend check is skipped if it isn't a positive number. */
  budgetUsd: string | undefined;
  now?: () => number;
};

/**
 * Runs the six daily checks (Spec 11 §11.2) over raw service-role reads, aggregating in TypeScript
 * so no staff-only RPC is exposed. Posts one Slack message listing every breach, or nothing.
 */
export async function runDailyAlerts({ admin, postSlack, budgetUsd, now = Date.now }: DailyAlertsDeps) {
  const t = new Date(now());
  const monthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)).toISOString();
  const dayAgo = new Date(now() - 86_400_000).toISOString();
  const weekAgo = new Date(now() - 7 * 86_400_000).toISOString();
  const weekAgoDay = weekAgo.slice(0, 10);

  const [month, corrections, day, week] = await Promise.all([
    fetchWindow<{ cost_usd: number | null }>('monthly spend', (from, to) =>
      // cross-user: aggregate spend across all users; only cost is read.
      admin.from('processing_logs').select('cost_usd').gte('created_at', monthStart).order('created_at', { ascending: false }).range(from, to),
    ),
    fetchWindow<{ total_terms: number | null; corrected_terms: number | null }>('corrections', (from, to) =>
      // cross-user: per-day/term counts from the term_corrections view; no values are read.
      admin.from('term_corrections').select('total_terms, corrected_terms').gte('day', weekAgoDay).order('day', { ascending: false }).range(from, to),
    ),
    fetchWindow<{ kind: string; success: boolean; total_ms: number; error_code: string | null }>('24h logs', (from, to) =>
      // cross-user: aggregate reliability metrics across all users.
      admin.from('processing_logs').select('kind, success, total_ms, error_code').gte('created_at', dayAgo).order('created_at', { ascending: false }).range(from, to),
    ),
    fetchWindow<{ cost_usd: number | null; contract_id: string | null }>('7d cost', (from, to) =>
      // cross-user: aggregate cost per contract across all users.
      admin.from('processing_logs').select('cost_usd, contract_id').in('kind', ['extraction', 'chat']).gte('created_at', weekAgo).order('created_at', { ascending: false }).range(from, to),
    ),
  ]);

  for (const [name, window] of Object.entries({ month, corrections, day, week })) {
    if (window.sampled) log('warn', { fn: 'daily-alerts', event: 'daily_alerts_sampled', window: name, rows: window.rows.length });
  }

  const budget = Number(budgetUsd);
  if (!(budget > 0)) log('warn', { fn: 'daily-alerts', event: 'budget_not_configured' });

  const num = (v: unknown) => Number(v) || 0;
  const alerts = [
    budget > 0 ? spendCheck(month.rows.map((r) => num(r.cost_usd)), budget) : null,
    correctionRateCheck(corrections.rows.map((r) => ({ total_terms: num(r.total_terms), corrected_terms: num(r.corrected_terms) }))),
    failureRateCheck(day.rows),
    latencyCheck(day.rows),
    citationMissCheck(day.rows),
    avgCostCheck(week.rows.map((r) => ({ cost_usd: num(r.cost_usd), contract_id: r.contract_id }))),
  ].filter((a): a is string => a !== null);

  log('info', { fn: 'daily-alerts', alerts: alerts.length, ms: now() - t.getTime() });
  if (alerts.length > 0) {
    await postSlack(`Daily checks: ${alerts.length} alert${alerts.length === 1 ? '' : 's'}\n${alerts.map((a) => `• ${a}`).join('\n')}`);
  }
  return { alerts };
}
