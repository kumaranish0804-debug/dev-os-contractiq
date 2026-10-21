# Spec 11 — Data Retention, Alerts, Health & Observability

**Implements:**
- PRD §5: 90-day retention, 99.5% uptime, no silent failures;
- PRD §8: correction-rate trigger;
- PRD §10: monitoring;
- PRD §11: reliability.

**Phase:** 2 (F18)
**Supersedes the engineering doc on:** the daily cost / correction-rate / error-rate checks run in a separate `daily-alerts` Edge Function.

---

## 11.1 Edge Function `retention-cleanup`

**Trigger:** pg_cron `contractiq-retention-cleanup`, daily 03:00 UTC → `invoke_edge_function('retention-cleanup')` (Spec 02 §2.9).
**Auth:** `verify_jwt = false`. The function requires the header `x-cron-secret === Deno.env.get('CRON_SECRET')`, compared in constant time; otherwise it returns 401. It is not wrapped in `createHandler` (there is no user).

**Steps:**
1. `admin.from('contracts').select('id, user_id, file_path').not('file_path', 'is', null).lt('last_accessed_at', now − 90 days).limit(500)`
2. Process in batches of 100:
   - `admin.storage.from('contracts').remove(paths)`;
   - for the successfully removed paths (and those reported as not found), `update({ file_path: null, file_deleted_at: now })` with `.in('id', ids)`.
3. Loop until fewer than 500 rows are returned, or 50 s have elapsed.
4. Log `{ fn: 'retention-cleanup', scanned, deleted, failed, ms }`. If `failed > 0`, post a Slack alert (§11.3).
5. Respond `200 { "deleted": n, "failed": m }`.

**Scope:** only PDF bytes in Storage are deleted. The extracted text, key terms and chat history stay until the user deletes the contract. This matches PRD §11 ("uploaded PDFs stored for 90 days… then auto-deleted"). `last_accessed_at` is bumped by every results-page view (Spec 07 §7.1).

## 11.2 Edge Function `daily-alerts`

**Trigger:** pg_cron `contractiq-daily-alerts`, daily 08:00 UTC. Same `x-cron-secret` auth.

| Check | Query (service role) | Alert when |
|---|---|---|
| OpenAI spend | `sum(cost_usd)` from `processing_logs` where `created_at >= date_trunc('month', now())` | `≥ 0.8 × MONTHLY_OPENAI_BUDGET_USD` → "OpenAI spend at {pct}% of monthly budget (${sum} / ${budget})" |
| Correction rate (7-day) | `sum(corrected_terms)/sum(total_terms)` from `term_corrections` where `day >= current_date - 7` | `> 0.12` and `total ≥ 50` → "Correction rate {pct}% over 7 days — trigger prompt review" (PRD §8) |
| Extraction failure rate (24 h) | `count(*) filter (where not success)/count(*)` from `processing_logs` where `kind='extraction'` and the last 24 h | `> 0.05` and `count ≥ 20` |
| Latency P95 (24 h) | `percentile_cont(0.95) within group (order by total_ms)` for `kind='extraction'` | `> 30000` ms |
| Chat citation misses (24 h) | `count(*) filter (where error_code = 'NO_CITATION')` / chat count | `> 0.10` and `count ≥ 20` |
| Average cost per contract (7-day) | extraction + chat `sum(cost_usd)` / distinct `contract_id` | `> 0.25` |

**Implementation:** each check is a service-role supabase-js `select` of the raw columns it needs (`cost_usd`, `success`, `total_ms`, `error_code`, `contract_id` from `processing_logs`; `total_terms`, `corrected_terms` from `term_corrections`) over its time window, aggregated in TypeScript (`_shared/metrics.ts`, pure functions, unit-tested). No extra SQL function is added, so no staff-only RPC is exposed over PostgREST. At projected scale (~2,000 contracts/month) each window is ≤ 10k rows. If the 24 h `processing_logs` count exceeds 50k, the function logs `daily_alerts_sampled` and uses the most recent 50k rows.

Then it posts one Slack message listing all breached checks, or posts nothing if all are green. It responds `200 { "alerts": string[] }`.

**Chat `NO_CITATION` logging:** when the chat function (Spec 09 §9.5) saves an assistant message with no citations whose content isn't the not-found sentence, it sets `processing_logs.error_code = 'NO_CITATION'` while keeping `success = true`.

## 11.3 Slack helper — `_shared/alerts.ts`

```ts
export async function postSlack(text: string) {
  const url = Deno.env.get('SLACK_ALERT_WEBHOOK_URL');
  if (!url) { console.warn(JSON.stringify({ level: 'warn', msg: 'slack_webhook_missing', text })); return; }
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ text: `:rotating_light: ContractIQ — ${text}` }) });
}
```
Alerts never include contract content or user emails. They contain aggregate numbers only.

## 11.4 Health endpoint — `GET /api/health`

- Public: there is no `requireUser`, and `middleware` doesn't match it.
- It calls `supabase.rpc('health_check')` with a 3 s timeout.
- `200 { "status": "ok", "db": "ok", "time": ISO }`, or `503 { "status": "degraded", "db": "down" }`.
- Header: `Cache-Control: no-store`.

**Maintenance banner:**
- `(app)/layout.tsx` renders `<HealthBanner />` (client). It fetches `/api/health` on mount and every 60 s while the tab is visible.
- On 503 or a network failure twice in a row, it shows an error-tint banner: "ContractIQ is having trouble connecting. Your data is safe — some features may be unavailable for a few minutes."
- It hides once health returns ok.

## 11.5 Uptime monitoring

| Monitor (Uptime Robot) | URL | Interval | Alert |
|---|---|---|---|
| Web app | `${NEXT_PUBLIC_SITE_URL}/` | 5 min | Slack (team channel integration) |
| Health | `${NEXT_PUBLIC_SITE_URL}/api/health` (keyword `"ok"`) | 5 min | Slack |

Configure these in the Uptime Robot dashboard. No code is needed.

## 11.6 Logging standard

- Edge Functions write one JSON line per request (Spec 03 §3.5), plus `warn`/`error` lines for handled failures. Viewed in Supabase → Edge Functions → Logs.
- Next.js route handlers log only unexpected errors (`errorResponse`) as JSON. Viewed in Netlify function logs.
- **Never logged:** contract text, extracted values, prompts, model responses, chat content, emails, JWTs, API keys.

## 11.7 Incident communication (operational, PRD §11)

| Severity | Action | Timing |
|---|---|---|
| P0 (data exposure, full outage) | In-app banner (`HealthBanner` shows on outage automatically) + email to affected users + status page | Banner/status within 30 min; email within 1 h |
| P1 (degraded performance) | In-app banner | Within 2 h |

**Manual banner runbook (MVP):** set the `MANUAL_NOTICE` string constant in `src/components/shared/HealthBanner.tsx` to the incident message and deploy (Netlify deploys take ~2 min). When `MANUAL_NOTICE` is non-empty it is shown as a warning-tint banner on every app page. Clear it and redeploy to remove it. A runtime-editable banner (DB-backed) is deferred to v1.1.

## 11.8 Acceptance criteria

- With a contract whose `last_accessed_at` is 91 days old and a stored file, invoking `retention-cleanup` with the correct secret removes the storage object and sets `file_path = null`, `file_deleted_at`. The results page then shows the retention notice (Spec 08 §8.3).
- Calling `retention-cleanup` without, or with a wrong, `x-cron-secret` returns 401 and has no side effects.
- `daily-alerts` with seeded logs over budget posts exactly one Slack message listing the breach. With no breaches, it posts nothing.
- `/api/health` returns 200 when the DB is reachable and 503 when `NEXT_PUBLIC_SUPABASE_URL` points at an unreachable host.
