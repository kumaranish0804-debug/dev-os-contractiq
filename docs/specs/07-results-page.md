# Spec 07 — Results Page: Key Terms Panel, Inline Edit, Feedback, Review Completion

**Implements:**
- the key-terms half of US-002;
- US-003, US-004, US-009, US-010, US-011-partial;
- FR-04, FR-11, FR-12;
- Flow 3 steps 5–9.

**Phase:** 1 (F6) + 2 (F11, F15, F17)
**Related:** viewer in Spec 08, chat in Spec 09

---

## 7.1 Route & data loading — `src/app/(app)/contracts/[id]/page.tsx`

- A Server Component. It calls `getContractDetail(supabase, id)` from `src/lib/data/contracts.ts`; that function is shared with `GET /api/contracts/[id]`.
- If the result is null, it calls `notFound()`.
- It then bumps `last_accessed_at`, fire-and-forget: `supabase.from('contracts').update({ last_accessed_at: new Date().toISOString() }).eq('id', id)`.
- It renders `<ResultsView initial={detail} />` (client), passing `detail` as React Query `initialData` for the key `['contract', id]`.

**Rendering by `contract.status`:**

| Status | Renders |
|---|---|
| `uploaded` | `ResumeProcessingPanel`: TermPreviewCard (Spec 06 §6.3, with the type pre-selected from the contract) + Process button. Lets users resume an upload they never processed |
| `processing` | `ProcessingStepper` (Spec 06 §6.4), subscribed via Realtime; refetches `['contract', id]` on change |
| `error` | `ErrorState` with `ERROR_MESSAGES[error_code]` + "Try again" (calls `process-contract` with the stored type and custom terms) |
| `completed` | `ResultsLayout` (§7.2) |

## 7.2 Layout — `ResultsLayout.tsx`

```
┌ Header: ← Dashboard | {title} [NDA badge] [status] | Mark review complete | ⋯ (Re-run analysis, Delete) ┐
├ LegalDisclaimer (always visible, info tint) ─────────────────────────────────────────────────────────────┤
├ TypeMismatchBanner (only if detected_type_mismatch) ─────────────────────────────────────────────────────┤
│ ┌ ContractViewer (55%) ───────────────┐ ┌ RightPanel (45%) ───────────────────────────┐ │
│ │ Spec 08                             │ │ Tabs: [Key Terms] [Chat]                   │ │
│ │                                     │ │  KeyTermsPanel / ChatPanel                 │ │
│ │                                     │ │ FeedbackWidget (bottom of Key Terms tab)   │ │
│ └─────────────────────────────────────┘ └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **≥ 1024 px:** side by side, both panels scroll independently, with height `calc(100vh - header)`.
- **768–1023 px:** viewer on top (60vh), tabs below.
- **< 768 px:** a three-tab layout (Document / Key Terms / Chat). Selecting a page link switches to the Document tab.
- **Tab state** lives in the URL: `?tab=terms|chat` (default `terms`).

**LegalDisclaimer** (`src/components/shared/LegalDisclaimer.tsx`): this text exactly — "This is an AI-assisted review tool, not legal advice. Always verify critical terms with a qualified lawyer." It is shown on every results page and is not dismissible.

**TypeMismatchBanner** (warning tint): "This document doesn't look like a typical {selected}. Some terms may be missing." It has two actions:
- "Re-run as {other}": confirm dialog → `process-contract` with the other type and the same custom terms;
- "Keep results": hides the banner for the session.

## 7.3 KeyTermsPanel

- **Header:** "Key terms" (H5), the count "{n} terms · {k} need review", where k = count of confidence < 50.
- **Filter chips:** All · Needs review (< 50) · Edited · Custom.
- **Rows:** standard terms first, then custom (`sort_order`).
- **Low-confidence highlight on load:** if any term has confidence < 50, the first such term's page and source sentence are sent to the viewer once, on first render: `viewerStore.focus(page, sentence)`. This is the PRD's "auto-highlights the nearest matching page span".
- **Empty case:** not possible after `completed`. If all values are null, show the banner "We couldn't find the standard terms in this document. Check that it is an NDA or MSA."

## 7.4 KeyTermRow anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│ Governing Law ⓘ                       [Custom] [Edited]   p.4 →  93% High │
│ Laws of the State of New York.                         ✎ (edit)        │
│ ▸ Why?                                                                    │
└──────────────────────────────────────────────────────────────────────┘
```
| Element | Spec |
|---|---|
| Term name | `body-lg`, `text-primary`. Then a `GlossaryTooltip` (glossary from the term library; for custom terms, "Custom term you added") |
| Value | `body-lg` weight 400. If null: italic `text-secondary` "Not found in this document" |
| Page link | `PageLink`: button "p.{n}" with `aria-label="Go to page {n}"`. Calls `viewerStore.focus(n, source_sentence)`. Hidden when `page_number` is null |
| ConfidenceBadge | `confidenceLevel(score)` → `high`: success tokens, label "High"; `medium`: warning tokens, "Medium"; `low`: error tokens, "Low" + ⚠️ icon. Text: "{score}% {label}". Badge: `rounded-sm border px-2 py-0.5 body-sm`. Not-found terms (value null) show a neutral grey badge "—" |
| LowConfidenceWarning | For score < 50 with a non-null value: a ⚠️ icon with a Radix Tooltip that is **always visible** (no dismiss), plus inline text under the value in `error-text body-sm`: "Low confidence — we recommend verifying this in the document directly." |
| Custom badge | `info` tokens, "Custom" |
| Edited badge | `brand-subtle` / `brand`, "Edited". Tooltip: "AI extracted: {original_value ?? 'Not found'}" |
| WhyDisclosure | `<button aria-expanded>` "Why?". Expands a blockquote with the verbatim `source_sentence` and "— Page {n}". If null: "No supporting sentence was found in the document." |

## 7.5 Inline edit (US-009)

**Component:** `EditableValue.tsx`
- Click the value or ✎ (or press Enter on a focused row) → `<textarea>` (auto-grow, max 2000 chars, character counter shown after 1800).
- **Save:** Enter (without Shift) or blur. **Cancel:** Esc restores the old value. **Clear value:** allowed; an empty string is saved as null ("Not found").
- **Optimistic update** through the `useKeyTermEdit` mutation:
  - `onMutate`: update `['contract', id]` cache;
  - `onError`: roll back + toast "Couldn't save your edit. Retry?" with a Retry action;
  - `onSuccess`: replace the row with the server response.
- If the request exceeds 2 s, a "Saving…" indicator is shown; target ≤ 2 s.

**API:** `PATCH /api/key-terms/[id]`
- Request: `{ "value": string | null }` → zod `z.object({ value: z.string().trim().max(2000).nullable().transform(v => v === '' ? null : v) })`.
- Handler: `requireUser()` → `supabase.from('key_terms').update({ value }).eq('id', id).select().single()`. RLS limits this to own rows, and the column grant to `value`. The DB trigger sets `is_edited`, `edited_at` and preserves `original_value` (Spec 02 §2.4). No row → 404.
- Response `200 { "key_term": KeyTerm }`.
- Errors: 400 `INVALID_INPUT`, 401, 404.

Edits feed `term_corrections`; no extra write is needed.

## 7.6 Feedback widget (US-010, FR-12)

**Component:** `FeedbackWidget.tsx`, at the bottom of the Key Terms tab.
- Prompt: "Were these extracted terms accurate?" with 👍 / 👎 buttons (`aria-pressed`).
- Choosing one reveals an optional textarea ("Anything we got wrong? (optional)", max 1000) and a Submit button. Submitting a rating with no comment is allowed.
- After submit: "Thanks for your feedback." plus an "Edit" link that reopens the form, prefilled.
- The initial state comes from `detail.feedback`.

**API:** `POST /api/feedback`
- Request: `{ contract_id: uuid, rating: 'up'|'down', comment?: string (trim, ≤1000, '' → null) }`.
- Handler: verifies the contract is visible via RLS (select id) or returns 404. Then upserts:
  `supabase.from('user_feedback').upsert({ user_id, contract_id, rating, comment }, { onConflict: 'user_id,contract_id' }).select().single()`
- Response `200 { "feedback": { id, rating, comment, updated_at } }`.

## 7.7 Mark review complete (North Star instrumentation)

- **Header button:** "Mark review complete" (secondary). Once done, it shows "Reviewed ✓ {date}" (disabled).
- **API:** `POST /api/contracts/[id]/complete` → `update({ review_completed_at: now })`, only `.is('review_completed_at', null)`, then select. Responds `200 { "review_completed_at": iso }`, which is idempotent: a second call returns the existing value.
- **Analytics:** North Star = `review_completed_at - created_at`. When it is null, `last_accessed_at` is used as the fallback in reporting queries.

## 7.8 `GET /api/contracts/[id]`

Response:
```json
{
  "contract": { "id": "…", "title": "…", "contract_type": "NDA", "status": "completed", "error_code": null, "error_message": null,
                "page_count": 12, "has_file": true, "file_deleted_at": null, "detected_type_mismatch": false,
                "created_at": "…", "processed_at": "…", "review_completed_at": null, "contract_text": "[PAGE 1]…" },
  "key_terms": [ { "id": "…", "term_key": "governing_law", "term_name": "Governing Law", "value": "…", "original_value": "…",
                   "page_number": 4, "confidence_score": 93, "source_sentence": "…", "is_custom": false, "is_edited": false, "sort_order": 5 } ],
  "custom_terms": ["Non-compete radius"],
  "feedback": { "rating": "up", "comment": null } 
}
```
`feedback` is `null` when no feedback exists.

`getContractDetail` runs 4 queries in parallel (contracts single, key_terms ordered by `is_custom, sort_order`, custom_key_terms, user_feedback maybeSingle). `has_file = file_path !== null`. The raw `file_path` is never returned.

## 7.9 Header overflow menu

- **Re-run analysis:**
  - confirm dialog: "Re-running replaces all extracted terms, including your {k} edits. Continue?" (k = edited count);
  - then calls `process-contract` with the current type and custom terms, and shows the stepper overlay.
- **Delete contract:** shared `DeleteContractDialog` (Spec 10 §10.6). After deletion → `router.replace('/dashboard')`.

## 7.10 Accessibility

- The terms list is a `<ul>`; each row is an `<li>` with `aria-labelledby` pointing to the term name.
- Confidence is conveyed as text (not colour only).
- The low-confidence warning text is in the DOM, not tooltip-only.
- The edit textarea has the label "Edit value for {term}".
- Focus returns to the value button after save or cancel.

## 7.11 Acceptance criteria

- Every term shows Name / Value / Page / Confidence %, colour-coded green ≥ 80, amber 50–79, red < 50.
- Terms < 50 show ⚠️ and the warning text and are never hidden.
- Clicking "p.4" scrolls the viewer to page 4 (Spec 08).
- After editing a value and reloading: the new value persists, "Edited" is shown, and the tooltip shows the AI value. Reverting to the AI value removes the badge.
- Feedback 👎 + comment is saved, and after reload the widget shows the submitted state.
- The disclaimer text is present on the results page (E2E asserts the exact string).
