# Spec 02 — Database, RLS & Storage

**Implements:** FR-13, FR-14, engineering doc §7 · **SQL:** `docs/specs/supabase-schema.sql`
**Supersedes the engineering doc on:**
- `key_terms.original_value` holds the AI value from insert onward (it is no longer null until the first edit);
- key-term edit tracking is done by a DB trigger;
- least-privilege write policies;
- the RPCs `start_processing` / `save_extraction_results`;
- the `term_correction_samples` view.

---

## 2.1 Applying the schema

| Environment | How |
|---|---|
| Hosted Supabase (first time) | SQL Editor → paste `docs/specs/supabase-schema.sql` → Run. Idempotent; safe to re-run |
| Local | `supabase start` → `supabase db reset` (applies `supabase/migrations/20261017000000_initial_schema.sql`, a copy of the same file) |
| Types | `npm run db:types` → `src/types/database.types.ts`. Regenerate after every schema change and commit the result |

**One-time post-run steps (hosted):**
1. Vault secrets used by the cron jobs:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<CRON_SECRET value>', 'cron_secret');
   ```
2. Auth → Providers → Email: **Confirm email = on**, minimum password length = 8.
3. Auth → URL Configuration: Site URL = `NEXT_PUBLIC_SITE_URL`; Redirect URLs: `<NEXT_PUBLIC_SITE_URL>/auth/callback` and `http://localhost:3000/auth/callback`.
4. Deploy the Edge Functions (Spec 03 §3.9) before the cron jobs first fire (03:00 UTC).

**Verification queries (run after applying):**
```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';           -- all true
select count(*) from pg_policies where schemaname = 'public';                         -- 15
select count(*) from pg_policies where schemaname = 'storage' and policyname like 'contracts_storage_%'; -- 3
select id, public, file_size_limit from storage.buckets where id = 'contracts';       -- false, 10485760
select jobname, schedule from cron.job where jobname like 'contractiq-%';             -- 3 rows
```

## 2.2 Entity summary

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `profiles` | 1:1 app user record | trigger `handle_new_user`; user (settings columns) | user |
| `contracts` | Uploaded document, `[PAGE N]` text, status | `upload-contract`, `start_processing`, `save_extraction_results`; user (title, last_accessed_at, review_completed_at); `retention-cleanup` | user, functions |
| `key_terms` | Extracted terms + corrections | `save_extraction_results`; user (value only) | user |
| `custom_key_terms` | Requested custom terms (≤ 5) | `start_processing` | user, `process-contract` |
| `chat_sessions` | One per contract | `chat` | user |
| `chat_messages` | Q&A history (≤ 200 per session) | `chat` | user, `chat` |
| `user_feedback` | Thumbs + comment | user | user |
| `processing_logs` | Latency/tokens/cost per upload, extraction and chat call | functions | user (own), `daily-alerts` |
| `rate_limits` | Fixed-window counters | `check_rate_limit()` | — |

Enums: `contract_type (NDA, MSA)`, `contract_status (uploaded, processing, completed, error)`, `chat_role`, `chat_query_type (contract, history, both)`, `message_status (complete, error)`, `feedback_rating (up, down)`, `log_kind (upload, extraction, chat)`.

## 2.3 Contract status machine

```
            upload-contract
                 │
                 ▼
            ┌──────────┐  start_processing   ┌────────────┐  save_extraction_results  ┌───────────┐
            │ uploaded │ ──────────────────▶ │ processing │ ────────────────────────▶ │ completed │
            └──────────┘                     └────────────┘                           └───────────┘
                 ▲                              │      ▲                                   │
                 │                  AI failure  ▼      │ start_processing (retry)          │ start_processing (re-run)
                 │                           ┌───────┐ │                                   │
                 └───────────────────────────│ error │─┘◀──────────────────────────────────┘
                                             └───────┘
```
- `start_processing` raises `ALREADY_PROCESSING` if the status is `processing` and `processing_started_at` is under 2 minutes old. An older `processing` row is treated as a crashed run and can be reclaimed.
- Re-running a `completed` contract replaces all `key_terms`. This drops prior user edits; the UI confirms first (Spec 07 §7.9).

## 2.4 RLS & privilege matrix (`authenticated` role)

| Table | SELECT | INSERT | UPDATE (columns) | DELETE |
|---|---|---|---|---|
| profiles | own | — (trigger) | own: `full_name, feedback_opt_in, onboarding_completed_at` | — |
| contracts | own | — (function) | own: `title, last_accessed_at, review_completed_at` | own (cascades) |
| key_terms | own | — | own: `value` | — (cascade) |
| custom_key_terms | own | — | — | — |
| chat_sessions | own | — | — | — |
| chat_messages | own | — | — | — |
| user_feedback | own | own (contract must be own) | own: `rating, comment` | own |
| processing_logs | own | — | — | — |
| rate_limits | — | — | — | — |
| storage.objects (`contracts` bucket) | own folder | own folder | — | own folder |

"own" = `user_id = auth.uid()` (`profiles`: `id`). `anon` has no access to any table. Edge Functions use the service role (bypasses RLS) and must filter every query by the JWT user id (Spec 03 §3.5).

**Defence in depth (triggers):**
- `enforce_contract_owner`: child rows (`key_terms`, `custom_key_terms`, `chat_sessions`, `user_feedback`, `processing_logs`) must have `user_id` = the contract owner. A violation raises SQLSTATE 42501, even for the service role.
- `before_chat_message_insert`: the message `user_id` must equal the session owner. It also enforces the 200-message cap (`CHAT_LIMIT_REACHED`, 23514) and increments `message_count`.
- `enforce_custom_term_limit`: at most 5 rows per contract (`CUSTOM_TERM_LIMIT`, 23514). A unique index on `(contract_id, lower(btrim(term_name)))` blocks duplicates.
- `track_key_term_edit`:
  - on INSERT it sets `original_value := value`, `is_edited := false`;
  - on UPDATE it keeps `original_value` immutable and sets `is_edited := value IS DISTINCT FROM original_value`, with `edited_at` = now() when edited (null when reverted).

## 2.5 RPC functions

| Function | Callable by | Purpose |
|---|---|---|
| `get_dashboard_stats() → jsonb` | authenticated | `{ total, by_type: {NDA, MSA}, by_status: {uploaded, processing, completed, error} }` for `auth.uid()` |
| `check_rate_limit(user_id, bucket, limit, window_seconds) → boolean` | service_role | Increments the counter for the current fixed window; returns `count <= limit` |
| `start_processing(contract_id, user_id, contract_type, custom_terms text[]) → contracts` | service_role | Locks the row, rejects a concurrent run, replaces `custom_key_terms`, sets `status='processing'`, `contract_type`, `processing_started_at`. Errors: `NOT_FOUND` (P0002), `ALREADY_PROCESSING` (P0001), `CUSTOM_TERM_LIMIT` (23514), duplicate (23505) |
| `save_extraction_results(contract_id, user_id, terms jsonb, detected_type_mismatch, prompt_version) → setof key_terms` | service_role | In one transaction: delete old terms, insert new, set `status='completed'`, `processed_at`. Returns the terms ordered by `is_custom, sort_order` |
| `health_check() → boolean` | anon, authenticated | DB liveness for `/api/health` |
| `invoke_edge_function(name) → bigint` | postgres (cron) | `net.http_post` to `<project_url>/functions/v1/<name>` with `x-cron-secret` |

`terms jsonb` element shape: `{ "term_key": "governing_law", "term_name": "Governing Law", "value": "…" | null, "page_number": 4 | null, "confidence_score": 0-100, "source_sentence": "…" | null, "is_custom": false, "sort_order": 0 }`.

## 2.6 Views (staff only; not granted to anon/authenticated)

- `term_corrections`: `day, contract_type, term_key, is_custom, total_terms, corrected_terms`. Counts only, all users. Feeds the 7-day correction-rate alert (Spec 11).
- `term_correction_samples`: corrected values with `original_value`, the corrected value, page, confidence and source sentence. **Only users with `feedback_opt_in = true`** are included. Feeds the weekly drift check.

## 2.7 Storage

- Bucket `contracts`: private, `file_size_limit = 10485760`, `allowed_mime_types = {application/pdf}`.
- Object key: `{user_id}/{contract_id}/{safe_filename}.pdf` (full path `contracts/{user_id}/…`, per FR-14).
- `safe_filename` = the original name lower-cased, with `[^a-z0-9._-]` → `-`, repeated `-` collapsed, truncated to 100 chars, and `.pdf` ensured at the end.
- Policies: INSERT/SELECT/DELETE only when `(storage.foldername(name))[1] = auth.uid()::text`.
- Signed URLs: `createSignedUrl(path, 3600)` (1 hour), created server-side with the user-scoped client.

## 2.8 Realtime

`public.contracts` is in the `supabase_realtime` publication, and Realtime enforces RLS, so users only receive their own rows. Clients subscribe to `UPDATE` on `contracts` filtered `id=eq.<id>` and read **only** `status`, `error_code` and `error_message` from the payload. When the status changes, they refetch the contract through the API. Large columns (`contract_text`) are never read from Realtime payloads.

## 2.9 Scheduled jobs

| Job | Schedule (UTC) | Action |
|---|---|---|
| `contractiq-retention-cleanup` | `0 3 * * *` | `invoke_edge_function('retention-cleanup')` (Spec 11 §11.1) |
| `contractiq-daily-alerts` | `0 8 * * *` | `invoke_edge_function('daily-alerts')` (Spec 11 §11.2) |
| `contractiq-rate-limit-purge` | `15 * * * *` | Delete `rate_limits` rows older than 1 day |

## 2.10 Acceptance criteria

- The schema runs on a fresh Supabase project without errors, and a second run also succeeds (idempotent).
- All RLS / privilege rows in §2.4 are covered by `tests/rls/*.test.ts` (Spec 12 §12.4) and pass.
- Deleting a contract as its owner removes its `key_terms`, `custom_key_terms`, `chat_sessions`, `chat_messages` and `user_feedback`, and nulls `processing_logs.contract_id`.
- `npm run db:types` produces types with no manual edits.

> **Validated:** this SQL was executed against PostgreSQL (PGlite) with stubbed Supabase `auth` / `storage` / `vault` / `cron` / `net` schemas. It ran twice (idempotent), and 38 behavioural checks passed, covering RLS isolation, column privileges, triggers, RPCs, the rate limiter, the chat cap, storage folder policies and cascades.
