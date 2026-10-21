# Spec 10 — Dashboard, Contract History & Delete

**Implements:** US-008, FR-10, Flow 1 step 4, Flow 2, contract deletion (PRD §5 compliance) · **Phase:** 1 (F3 empty state) + 2 (F14)

---

## 10.1 Files

| File | Purpose |
|---|---|
| `src/app/(app)/dashboard/page.tsx` | Server Component: loads stats + the first page of contracts |
| `src/components/dashboard/StatsCards.tsx` | Total / NDA / MSA cards |
| `src/components/dashboard/RecentContracts.tsx` | The last 5 contracts as compact cards |
| `src/components/dashboard/ContractsTable.tsx` | `'use client'` sortable table + load more |
| `src/components/dashboard/EmptyState.tsx` | First-run empty state |
| `src/components/dashboard/StatusBadge.tsx` | Status → label + tokens |
| `src/components/shared/DeleteContractDialog.tsx` | Confirm + delete mutation (also used by the results page) |
| `src/lib/data/contracts.ts` | `listContracts`, `getDashboardStats`, `getContractDetail` (server-side, user-scoped client) |
| `src/app/api/contracts/route.ts` | `GET` list |
| `src/app/api/contracts/[id]/route.ts` | `GET` detail (Spec 07 §7.8), `DELETE` |
| `src/app/api/dashboard/stats/route.ts` | `GET` stats |

## 10.2 Page layout

```
H5 "Your contracts"                                      [Review a Contract] (primary, → /contracts/new)
StatsCards:  [Total reviewed: 14] [NDAs: 9] [MSAs: 5]
"Recent" (H5 small): 5 compact cards (title, type badge, status, relative date)
"All contracts": ContractsTable
```
- Page wrapper: `px-28 py-24` at ≥ 1024 px, `px-4 py-8` on mobile; sections separated by `gap-10`.
- "Total reviewed" = `by_status.completed`. The card subtext shows "{total} uploaded" when it differs.
- **Empty state** (`stats.total === 0`): replaces everything below the header. It shows an illustration-free icon, the H5 "No contracts reviewed yet", the text "Upload your first contract to begin", and the primary CTA "Review a Contract".

## 10.3 Data

**`getDashboardStats(supabase)`** → `rpc('get_dashboard_stats')` → `{ total, by_type: { NDA, MSA }, by_status: {…} }`.

**`listContracts(supabase, { sort, dir, limit, offset })`**:
```ts
supabase.from('contracts')
  .select('id, title, contract_type, status, page_count, created_at, processed_at, review_completed_at', { count: 'exact' })
  .order(sort, { ascending: dir === 'asc' }).order('id')     // stable tiebreak
  .range(offset, offset + limit - 1)
```
`contract_text` is never selected for lists.

**`GET /api/contracts`**
- Query (zod):
  - `sort` ∈ `created_at | title | contract_type | status` (default `created_at`);
  - `dir` ∈ `asc | desc` (default `desc`);
  - `limit` int 1–100 (default 25);
  - `offset` int ≥ 0 (default 0).
  - Invalid values → 400 `INVALID_INPUT`.
- Response `200 { "items": ContractListItem[], "total": number }`.

**`GET /api/dashboard/stats`** → `200 { "total", "by_type", "by_status", "recent": ContractListItem[5] }`. `recent` comes from `listContracts({ sort: 'created_at', dir: 'desc', limit: 5, offset: 0 })`.

> This supersedes engineering doc §9.4's cursor pagination: with user-selectable sort columns, offset pagination is used.

## 10.4 ContractsTable

- **Columns:** Name (title, links to `/contracts/{id}`) · Type (NDA/MSA badge) · Uploaded (date `d MMM yyyy`, with a full timestamp tooltip) · Status (`StatusBadge`) · actions (⋯ menu).
- **Sorting:** header buttons for Name, Type, Uploaded and Status, with `aria-sort` and ▲/▼ icons. Sort state lives in the URL (`?sort=title&dir=asc`), so it is shareable and survives reloads.
  - The RSC reads `searchParams` for the initial data.
  - Header clicks call `router.replace` with new params (no scroll). React Query key `['contracts', sort, dir]` fetches via `GET /api/contracts`.
- **Pagination:** 25 rows, then a "Load more" button (`offset += 25`, appended) while `items.length < total`.
- **Row click:** the whole row is clickable (`onClick` → `router.push`) and the Name link is the accessible target. Keyboard users use the link; the row itself has no extra tab stop.
- **Row menu:** "Open" and "Delete…" (opens `DeleteContractDialog`).

**StatusBadge mapping:**

| status | Label | Tokens |
|---|---|---|
| `uploaded` | Not processed | warning |
| `processing` | Processing | info (spinner icon) |
| `completed` | Reviewed ✓ if `review_completed_at`, otherwise Ready | success |
| `error` | Failed | error |

Rows with status `processing` refetch the list every 5 s while any are visible (`refetchInterval` conditional).

## 10.5 Responsive

- At < 768 px the table becomes a stacked card list (title, type, status, date). Sorting moves to a `<select>` "Sort by".
- Stats cards are a 3-column grid at ≥ 768 px and stacked below that.

## 10.6 Delete contract

**`DeleteContractDialog`** (Radix Dialog, `role="alertdialog"`):
- Title: "Delete this contract?"
- Body: "**{title}** and all its extracted terms, edits, chat history and feedback will be permanently deleted. This can't be undone."
- Buttons: "Cancel" (default focus) and "Delete contract" (error/destructive style).
- The mutation is `DELETE /api/contracts/{id}`. On success: toast "Contract deleted", invalidate `['contracts']` + `['dashboard-stats']`, remove `['contract', id]`.

**`DELETE /api/contracts/[id]`**
1. `requireUser()`; `select('id, file_path')` by id → 404 if missing.
2. If `file_path`: `supabase.storage.from('contracts').remove([file_path])` (user-scoped; the storage DELETE policy applies). Errors other than not-found are logged, and the delete continues. An orphaned object is removed by retention within 90 days.
3. `supabase.from('contracts').delete().eq('id', id)`. RLS restricts this to the owner, and the FK cascades remove the children (Spec 02 §2.10).
4. `204` with no body.

## 10.7 Acceptance criteria

- A new user sees the empty state with the exact copy and CTA.
- After 3 processed contracts (2 NDA, 1 MSA), the stats show Total 3, NDAs 2, MSAs 1. Recent lists the 3 newest first.
- Sorting by Name asc orders alphabetically and the URL reflects `?sort=title&dir=asc`. A reload preserves it.
- Clicking a row opens `/contracts/{id}`.
- Deleting removes the row and decrements the stats. Afterwards `GET /api/contracts/{id}` returns 404, and the storage object no longer exists.
- User B's dashboard never shows user A's contracts (RLS test + E2E with two accounts).
