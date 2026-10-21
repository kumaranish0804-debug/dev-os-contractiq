# Spec 08 — Contract Viewer (PDF.js + Text Fallback)

**Implements:** US-003, US-006, FR-06, FR-07, low-confidence auto-highlight · **Phase:** 2 (F9, F10)

---

## 8.1 Components

| File | Purpose |
|---|---|
| `src/components/viewer/ContractViewer.tsx` | Chooses `PdfViewer` or `TextViewer`; owns the toolbar and fallback logic |
| `src/components/viewer/PdfViewer.tsx` | `react-pdf`, lazy page rendering, zoom, highlights. Loaded with `next/dynamic({ ssr: false })` |
| `src/components/viewer/TextViewer.tsx` | Renders `contract_text` split by `[PAGE N]` |
| `src/components/viewer/ViewerToolbar.tsx` | Page indicator, zoom controls, "Download PDF" |
| `src/stores/viewer-store.ts` | Cross-panel navigation state |
| `src/lib/viewer/highlight.ts` | Sentence → match ranges (shared by both viewers) |
| `src/hooks/use-signed-url.ts` | Fetches and refreshes the signed URL |
| `src/app/api/contracts/[id]/file-url/route.ts` | Signed URL endpoint |

## 8.2 Shared contract

```ts
export interface ContractViewerProps {
  targetPage?: number;          // 1-indexed; change ⇒ scroll
  highlightText?: string | null;// source sentence to mark on targetPage
  focusNonce?: number;          // increments on every focus() so re-clicking the same page re-scrolls
  onPageChange?(page: number): void;
}
```
**`viewer-store.ts`** (Zustand):
```ts
{ targetPage: number | null; highlightText: string | null; focusNonce: number; currentPage: number;
  focus(page: number, text?: string | null): void;   // sets both, focusNonce++
  setCurrentPage(p: number): void }
```
`PageLink` (Spec 07), `CitationChip` (Spec 09) and the low-confidence auto-focus all call `focus()`. `ContractViewer` reads the store and passes props through.

## 8.3 Selection & fallback logic — `ContractViewer`

```
mode = 'loading'
if (!contract.has_file)                 → mode = 'text', reason = file_deleted_at ? 'retention' : 'missing'
else useSignedUrl(id):
   success → mode = 'pdf'
   error (404 FILE_NOT_AVAILABLE / network) → mode = 'text', reason = 'unavailable'
PdfViewer onLoadError / onSourceError     → mode = 'text', reason = 'render_failed', show Download link (if url)
```
**Notice bar above the text viewer** (info tint, `body-sm`):

| reason | Copy |
|---|---|
| `missing` / `unavailable` | "The original PDF isn't available, so we're showing the extracted text." |
| `retention` | "The original PDF was removed after 90 days of inactivity. The extracted text is still available." |
| `render_failed` | "We couldn't display this PDF. Showing the extracted text instead." + "Download PDF" |

## 8.4 Signed URL

**API:** `GET /api/contracts/[id]/file-url`
- `requireUser()` → select `file_path` from contracts by id. Missing row → 404 `NOT_FOUND`. `file_path` null → 404 `FILE_NOT_AVAILABLE`.
- `supabase.storage.from('contracts').createSignedUrl(file_path, 3600)`. This uses the user-scoped client, so the storage SELECT policy applies. On error → 404 `FILE_NOT_AVAILABLE`.
- Response `200 { "url": string, "expires_at": ISO (now + 3600 s) }`. Header `Cache-Control: no-store`.

**`useSignedUrl(id, enabled)`:** React Query key `['file-url', id]`, `staleTime: 50 min`, `refetchInterval: 50 min`, `retry: 1`. The PDF document is loaded once, so URL refreshes only matter for the Download link.

## 8.5 PdfViewer

- **Setup:**
  ```ts
  import { Document, Page, pdfjs } from 'react-pdf';
  import 'react-pdf/dist/Page/TextLayer.css';
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  ```
- **`<Document file={url} onLoadSuccess={({ numPages }) => …} onLoadError={fallback} loading={<ViewerSkeleton/>}>`**
- **Lazy pages:**
  - Render a placeholder `<div id="pdf-page-{n}" data-page={n} style={{ height: estimatedHeight }}>` for every page.
  - `estimatedHeight` = page 1's viewport height × scale, measured on page 1 load (initial guess 1100 px × scale).
  - An `IntersectionObserver` (rootMargin `800px 0px`) marks pages visible; render `<Page>` for visible pages ±2. Others stay placeholders.
  - `renderAnnotationLayer={false}`, `renderTextLayer` true for rendered pages.
- **Zoom:** 50%–200% in 25% steps (buttons `−` / `+`, a "Fit width" button, and `Ctrl/Cmd +/-` while the viewer is focused). Width = `containerWidth × zoom`. Default is "Fit width".
- **Current page:** the page with the largest intersection ratio → `setCurrentPage`. The toolbar shows "Page {current} of {n}".
- **Navigation on `targetPage`/`focusNonce` change:**
  1. Ensure the page is rendered (add it to the render set).
  2. `document.getElementById('pdf-page-'+n).scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })`.
  3. Add a page-level pulse: a 2px `--focus-ring` outline that fades over 1.5 s (no pulse under `prefers-reduced-motion`).
  4. Run the sentence highlight (§8.7) on that page.
- **Text-layer highlight:** on `<Page onGetTextSuccess={({ items }) => …}>`, compute the indices of text items overlapping the match range. Then pass `customTextRenderer={({ str, itemIndex }) => matched.has(itemIndex) ? `<mark class="cq-mark">${escapeHtml(str)}</mark>` : escapeHtml(str)}`. `.cq-mark { background: var(--highlight-bg); color: transparent; }` — the text layer is transparent over the canvas.
- **No match:** the page-level pulse only (PRD "nearest matching page span" falls back to the page).

## 8.6 TextViewer

- `pages = splitPages(contract_text)` (`@shared/page-markers`).
- Each page is `<section id="text-page-{n}" aria-label="Page {n}" className="bg-bg-primary border rounded-lg p-6 mb-4">` containing a header "Page {n}" (`body-sm text-secondary`) and the text in `whitespace-pre-wrap body-lg font-normal`.
- An empty page shows "No selectable text on this page."
- The same `targetPage`/`focusNonce` behaviour: scroll, pulse, and highlight via §8.7 (wraps the matched substring in `<mark className="bg-highlight">`).
- The current page is tracked with an `IntersectionObserver`, as in §8.5.
- The zoom toolbar is hidden. The page indicator is shown.

## 8.7 Highlight algorithm — `src/lib/viewer/highlight.ts`

```ts
export function buildSentenceRegex(sentence: string): RegExp | null {
  const words = normaliseForMatch(sentence).split(' ').filter(Boolean).slice(0, 40);   // cap length
  if (words.length < 3) return null;
  const body = words.map(escapeRegExp).join('[\\s\\S]{0,3}?\\s*');                       // tolerate line breaks/punctuation
  return new RegExp(body, 'i');
}
export function findRange(pageText: string, sentence: string): { start: number; end: number } | null
```
- `findRange` normalises quotes and dashes in `pageText` while keeping a mapping of index → original index (single pass, same length). It runs the regex and maps back.
- **PDF:** `pageText` = `items.map(i => i.str).join(' ')`, with a running offset per item → the items intersecting `[start, end)`.
- **Text:** the matched range is split into before / `<mark>` / after.

## 8.8 Toolbar

`[◀ prev] Page 3 of 12 [next ▶] | [−] 100% [+] [Fit] | [⬇ Download PDF]`
- Prev/next call `focus(current ± 1)`.
- Download is an `<a href={url} download={original_filename}>`, shown only in pdf mode or for `render_failed` with a URL.
- All controls are buttons with `aria-label`s. The toolbar has `role="toolbar"` and arrow-key navigation.

## 8.9 Performance

- The worker is served from `/public` (no CDN).
- Only visible ±2 pages are rendered, so memory stays bounded for 20-page / 10 MB files.
- The `PdfViewer` chunk is code-split (`next/dynamic`), so the results page shell renders without loading pdfjs.

## 8.10 Edge cases

| Case | Behaviour |
|---|---|
| A page in the PDF without a text layer | It renders. The highlight falls back to the page pulse |
| `page_number` > numPages (should not happen) | Clamp to the last page |
| The signed URL expires mid-session | The document is already loaded. Download uses the refreshed URL |
| The user clicks the same page link twice | `focusNonce` changes, so it re-scrolls and re-highlights |
| Mobile | Selecting a page link switches to the Document tab first (Spec 07 §7.2), then scrolls |

## 8.11 Acceptance criteria

- With Storage available, the PDF renders, scroll and zoom work (50–200%), and "Page x of n" updates while scrolling.
- Clicking a key term's page link scrolls to that page and highlights the source sentence (when it's in the text layer) within 1 s.
- With `file_path` null, the text viewer renders every page with "Page n" headers, and page links still navigate.
- If PDF.js fails to load the file (a corrupted PDF in a test), the viewer falls back to text and shows "Download PDF".
- Unit: `highlight.test.ts` covers line breaks, curly quotes, hyphenated words and no-match. E2E: `results.spec.ts` asserts that clicking the page link brings `#pdf-page-4` (or `#text-page-4`) into the viewport.
