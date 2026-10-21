# ContractIQ — Implementation Specs (Stage 2)

Derived from `docs/engineering/engineering-doc.md`. Each spec is self-contained. Where a spec refines the engineering doc, it says so at the top, and **the spec wins**.

## Files

| # | File | Specifies | PRD / FR coverage |
|---|---|---|---|
| — | [`supabase-schema.sql`](supabase-schema.sql) | Paste-and-run SQL: tables, enums, indexes, triggers, RLS, RPCs, views, storage bucket + policies, realtime, cron | FR-13, FR-14 |
| — | [`../../.env.example`](../../.env.example) | Every environment variable, grouped by service | — |
| 01 | [`01-project-setup.md`](01-project-setup.md) | Dependencies, config files, design tokens → Tailwind, Supabase clients, middleware, folder structure, landing page | Stage 3 scope |
| 02 | [`02-database.md`](02-database.md) | How to apply the schema, status machine, RLS/privilege matrix, RPCs, storage, realtime, cron | FR-13, FR-14 |
| 03 | [`03-api-conventions.md`](03-api-conventions.md) | Error envelope + code catalogue, route-handler and Edge-Function patterns, CORS, rate limits, OpenAI retry, deploy | §5 reliability |
| 04 | [`04-auth.md`](04-auth.md) | Sign up / verify / sign in / sign out, route protection, open-redirect guard | US-001, FR-01 |
| 05 | [`05-upload-and-text-extraction.md`](05-upload-and-text-extraction.md) | Upload wizard, `upload-contract` function, `[PAGE N]` text extraction and rejections | US-002, FR-02, FR-03 |
| 06 | [`06-ai-extraction.md`](06-ai-extraction.md) | Term library, preview + custom terms, `process-contract`, prompts + few-shot, post-processing, cost | US-002–005, FR-04, FR-05, FR-11 |
| 07 | [`07-results-page.md`](07-results-page.md) | Results layout, key-terms panel, confidence UI, inline edit, feedback, review completion | US-003, US-004, US-009, US-010, FR-04, FR-11, FR-12 |
| 08 | [`08-contract-viewer.md`](08-contract-viewer.md) | PDF.js viewer, text fallback, signed URLs, page navigation + sentence highlight | US-003, US-006, FR-06, FR-07 |
| 09 | [`09-chat.md`](09-chat.md) | Chat UI, SSE protocol, `chat` function, grounding prompts, classifier, citations, persistence | US-007, US-012, FR-08, FR-09 |
| 10 | [`10-dashboard.md`](10-dashboard.md) | Stats, sortable history, empty state, delete with cascade | US-008, FR-10 |
| 11 | [`11-retention-and-monitoring.md`](11-retention-and-monitoring.md) | 90-day PDF retention, daily alerts, health endpoint + banner, logging rules | §5, §8, §10, §11 |
| 12 | [`12-testing-and-evals.md`](12-testing-and-evals.md) | Unit / function / integration / RLS / E2E / a11y tests, fixtures, eval harness + launch gates, CI | §10, §11 |

Out of MVP (no spec yet): US-011 export (Phase 3), billing, team workspaces, OCR.

## Build order (Stage 4)

1. Spec 01 (scaffold), then Spec 02 (apply the schema, generate types)
2. Spec 03 (shared API/function plumbing)
3. Spec 04 (auth), then Spec 10 empty state
4. Spec 05 (upload), then Spec 06 (extraction), then Spec 07 (results panel)
5. Spec 08 (viewer), then Spec 09 (chat), then Spec 10 (full dashboard)
6. Spec 07 §7.6–7.7 (feedback, review complete), then Spec 11 (retention, alerts, health)
7. Spec 12 runs alongside every step. Its exit gates belong to Stage 5.

## Changes vs. the engineering doc

| Area | Engineering doc | Spec decision | Why |
|---|---|---|---|
| `key_terms.original_value` | Null until the first edit | Set to the AI value on insert; immutable; `is_edited` derived by trigger | Correct when the AI value is null; can't be tampered with by clients |
| Write access | 4 RLS policies per table | Least privilege: clients write only title/access/review timestamps, term value, profile settings, feedback | Status, text and AI output can't be forged from the browser |
| Atomic writes | "transaction" in a function | RPCs `start_processing` / `save_extraction_results` | supabase-js has no multi-statement transactions |
| `process-contract` body | `{ contract_id, custom_terms }` | Adds `contract_type` | Type can be changed after upload, and supports "Re-run as MSA" |
| Contract list pagination | Cursor | Offset (`limit`/`offset`, `total`) | User-selectable sort columns |
| Confidence badge text colour | ★500 on 50 tint | Green 700 / Yellow 900 / Red 700 on 50 tint | WCAG AA contrast |
| Error codes | — | Adds `UNSUPPORTED_FILE_TYPE`, `PDF_PASSWORD_PROTECTED` | Clearer user messages |
| Cron → functions auth | Service role | `x-cron-secret` (Vault + function secret), `verify_jwt=false` | Works with non-JWT Supabase secret keys |
| Daily cost / correction alerts | Unspecified job | `daily-alerts` Edge Function | One place for all threshold alerts |
| Term library location | `src/lib/terms/` | `supabase/functions/_shared/pure/` (shared by Next + Deno) | A single source of truth |
| Model | OpenAI `gpt-4o` | `gpt-4o-mini` (`OPENAI_MODEL`); `cost.ts` prices both | Product decision (Stage 4): ~15× cheaper. Launch quality gates (Spec 12) still apply; switch back via the env var if evals miss them |
| Process status polling | `GET /api/contracts/{id}` | Direct `contracts.select(status, error_code)` with the user-scoped client (RLS) | Same data and access rules; no dependency on the Spec 07 route |
| Feedback save (Spec 07 §7.6) | `user_feedback.upsert(…, { onConflict: 'user_id,contract_id' })` | Update `(rating, comment)` for the caller's row; insert if none; on a 23505 race, update again | Verified live: the upsert is denied (`permission denied for table user_feedback`) because ON CONFLICT DO UPDATE needs UPDATE on every inserted column, and clients are granted UPDATE on `rating, comment` only. Keeps the least-privilege grant |
| Mark review complete (Spec 07 §7.7) | No status check | `409 CONTRACT_NOT_READY` unless `status = 'completed'` | A contract that was never analysed can't count towards the North Star metric |
| Chat `NO_CITATION` (Spec 11 §11.2) | Any uncited answer other than the not-found sentence | Also excludes `history`-only questions | Answers about the conversation have no page to cite; counting them would trip the citation alert falsely |
| Retention scan (Spec 11 §11.1) | Re-select up to 500 until fewer return | Same query, paged by `id > last` | Rows whose storage delete failed would otherwise be re-selected until the 50 s budget ran out |
| Service-role scope check (Spec 03 §3.10) | Every admin query filters `user_id` | Cron jobs (`retention-cleanup`, `daily-alerts`) may run cross-user, only in those two files and only on queries marked `// cross-user: <reason>` | They have no user; the static scan test enforces the allowlist |
| Test database (Spec 12 §12.1, §12.10) | Local `supabase start` (Docker) | Integration, RLS and E2E run against the project in `.env.local` / CI secrets, with throwaway `cq-test/e2e-*@example.com` users removed after each run and swept (> 1 h old) before the next | Stage 5 decision: no Docker on the dev machine. CI uses the same approach via `TEST_SUPABASE_*` secrets |
| Sign-up E2E (Spec 12 §12.8) | Mailpit email → confirmation link | Accounts created via the admin API; the sign-up form is tested up to client validation | On the hosted project, real sign-ups send emails to fake addresses (rate-limited sender; bounces risk restrictions). The email-link path needs a local stack or a test inbox |
| E2E OpenAI (Spec 12 §12.8) | Local functions + a mock OpenAI server | The review-flow and chat specs run against the deployed functions with live OpenAI, only when `E2E_AI=1`; they assert shape, not exact values | Edge Functions can't be served locally without Docker |
| E2E port | `localhost:3000` webServer | Same, and reuses a running server on :3000 | The deployed functions' CORS allows only `http://localhost:3000` |
| Page link name (Spec 07 §7.4) | `aria-label="Go to page {n}"` | `aria-label="p.{n}, go to page {n}"` | axe `label-content-name-mismatch` (WCAG 2.5.3): the accessible name must contain the visible "p.{n}" |
| Dashboard sort (Spec 10 §10.4) | Header click → `router.replace` | `history.replaceState` + React Query | `router.replace` re-renders the server page on every click; this fetches only the rows |
