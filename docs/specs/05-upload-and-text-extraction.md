# Spec 05 — Contract Upload & Text Extraction

**Implements:** US-002 (upload half), FR-02, FR-03, Flow 3 steps 1–2 · **Phase:** 1 (F4) + 2 (F8 preview)

---

## 5.1 User flow

```
/contracts/new
  [1] Select contract type (NDA | MSA)              ← dropzone disabled until chosen
  [2] Drop / pick PDF  → client checks → upload starts immediately
        ↳ Term preview card + custom terms are shown WHILE the upload/extraction runs (Spec 06 §6.3)
  [3] Upload succeeds → "Process Contract" enabled
  [4] Process → Spec 06
```

## 5.2 Files

| File | Purpose |
|---|---|
| `src/app/(app)/contracts/new/page.tsx` | Server page: auth check, renders `<ReviewWizard />` |
| `src/components/contracts/ReviewWizard.tsx` | `'use client'` orchestrator; reads/writes `useReviewSessionStore` |
| `src/components/contracts/ContractTypeSelect.tsx` | Radio-card group: NDA / MSA, each with a one-line description |
| `src/components/contracts/PdfDropzone.tsx` | `react-dropzone`; shows client validation + upload progress |
| `src/components/contracts/UploadStatus.tsx` | File name, size, page count, "Remove" |
| `src/stores/review-session-store.ts` | Zustand store (§5.4) |
| `src/hooks/use-upload-contract.ts` | Upload mutation (XHR for progress) |
| `supabase/functions/upload-contract/index.ts` | Edge Function (§5.6) |
| `supabase/functions/_shared/pdf-text.ts` | PDF → pages → `[PAGE N]` text, counts (§5.7) |

## 5.3 UI spec

- **Page header:** H5 "Review a contract"; subtext "Upload an NDA or MSA (PDF, up to 20 pages / 10 MB)." in `text-text-secondary body-sm`.
- **ContractTypeSelect:** two radio cards (`role="radiogroup"`), keyboard-navigable with arrow keys.
  - NDA: "Non-Disclosure Agreement — confidentiality between parties."
  - MSA: "Master Service Agreement — terms for ongoing services."
  - Selected state: `border-brand bg-brand-subtle`.
- **PdfDropzone:**
  - Idle: dashed `border-strong` box, icon, "Drag and drop your PDF here, or **browse**". Accepts `{ 'application/pdf': ['.pdf'] }`, `maxFiles: 1`.
  - Disabled until a type is selected, with tooltip "Choose a contract type first".
  - Drag-over: `border-brand bg-brand-subtle`.
  - Uploading: progress bar (`role="progressbar"`, aria-valuenow), "Uploading… 42%". At 100% (bytes sent, server extracting) the label switches to "Extracting text…".
  - Success: `UploadStatus` shows the filename, "{page_count} pages", and a "Remove" link that resets the file and keeps the type.
  - Error: `error` state colours with the message from `ERROR_MESSAGES[code]` and a "Choose another file" button.
- **Mobile (< 768 px):** info banner "ContractIQ works best on a desktop browser."
- The type can be changed after upload but before processing. The new type is sent to `process-contract` (Spec 06).

## 5.4 Store — `useReviewSessionStore`

```ts
type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; progress: number }          // 0–100 bytes sent
  | { kind: 'extracting' }                           // bytes sent, awaiting response
  | { kind: 'uploaded'; contractId: string; pageCount: number; fileStored: boolean }
  | { kind: 'error'; code: ErrorCode };
interface ReviewSessionState {
  contractType: 'NDA' | 'MSA' | null;
  file: File | null;
  upload: UploadState;
  customTerms: string[];                             // Spec 06 §6.3
  processing: { kind: 'idle' } | { kind: 'running'; step: 2 | 3 } | { kind: 'error'; code: ErrorCode };
  setContractType(t): void; setFile(f): void; setUpload(s): void;
  addCustomTerm(name): { ok: true } | { ok: false; reason: string };
  removeCustomTerm(name): void; reset(): void;
}
```
The store is in-memory only (no persistence). `reset()` runs on wizard unmount and after successful processing.

## 5.5 Client-side validation (before any network call)

| Check | Error code shown |
|---|---|
| MIME `application/pdf` or extension `.pdf` | `UNSUPPORTED_FILE_TYPE` |
| `file.size <= 10_485_760` | `FILE_TOO_LARGE` |
| `file.size > 0` | `INVALID_PDF` |

The page count is not checked client-side; the server is authoritative.

## 5.6 Edge Function `upload-contract`

**Request:** `POST /functions/v1/upload-contract`, `multipart/form-data`

| Field | Type | Rules |
|---|---|---|
| `file` | File | required; ≤ 10,485,760 bytes; first 5 bytes = `%PDF-` |
| `contract_type` | string | `NDA` \| `MSA` |
| `title` | string | optional, trimmed, 1–200 chars; default = filename without `.pdf`, truncated to 200 |

**Handler:** `createHandler({ method: 'POST', rateLimit: { bucket: 'upload', limit: 20, windowSeconds: 3600 } }, …)`

**Steps:**
1. If `Content-Length` > 10,600,000 (10 MB plus multipart overhead) → `FILE_TOO_LARGE` before the body is parsed.
2. `await req.formData()`. Validate the fields with zod. If `file.size > 10_485_760` → `FILE_TOO_LARGE`.
3. `bytes = new Uint8Array(await file.arrayBuffer())`. If the magic bytes aren't `%PDF-` → `UNSUPPORTED_FILE_TYPE`.
4. `extractPdf(bytes)` (§5.7). It throws `PDF_PASSWORD_PROTECTED`, `INVALID_PDF` or `TOO_MANY_PAGES`.
5. `wordCount < 100` → `SCANNED_PDF`.
6. `tokenCount = encode(contractText).length` (gpt-tokenizer `gpt-4o` model, o200k). If it is > 15,000 → `CONTRACT_TOO_LONG`.
7. `contractId = crypto.randomUUID()`.
8. Insert:
   ```ts
   admin.from('contracts').insert({ id: contractId, user_id: userId, title, original_filename: file.name.slice(0, 255),
     contract_type, contract_text: contractText, page_count, word_count, token_count, file_size_bytes: file.size })
   ```
9. **Storage (non-blocking):**
   ```ts
   const path = `${userId}/${contractId}/${safeFilename(file.name)}`;
   const up = await admin.storage.from('contracts').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
   if (up.error) { retry once after 500 ms; if still failing → log warn 'storage_upload_failed', fileStored = false }
   else { await admin.from('contracts').update({ file_path: path }).eq('id', contractId).eq('user_id', userId); fileStored = true }
   ```
10. Insert a `processing_logs` row: `{ kind: 'upload', total_ms, success: true, attempts: 1 }`. On rejections after auth, insert `success: false, error_code` with `contract_id` null.
11. Respond `201`:
   ```json
   { "contract_id": "uuid", "page_count": 12, "word_count": 5310, "token_count": 9412, "file_stored": true }
   ```

**Errors:** 400 `INVALID_INPUT`, 401, 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_FILE_TYPE`, 422 `TOO_MANY_PAGES` | `SCANNED_PDF` | `CONTRACT_TOO_LONG` | `INVALID_PDF` | `PDF_PASSWORD_PROTECTED`, 429, 500. No `contracts` row is created on any rejection ("no partial output stored").

**Performance target:** ≤ 5 s P95 for a 20-page / 10 MB PDF (upload transfer excluded).

## 5.7 `_shared/pdf-text.ts`

```ts
import { getDocumentProxy, extractText } from 'unpdf';
import { buildContractText } from './pure/page-markers.ts';
import { LIMITS } from './pure/limits.ts';

export async function extractPdf(bytes: Uint8Array) {
  let pdf;
  try { pdf = await getDocumentProxy(bytes); }
  catch (e) { throw new AppError(String((e as Error)?.name) === 'PasswordException' ? 'PDF_PASSWORD_PROTECTED' : 'INVALID_PDF'); }
  if (pdf.numPages > LIMITS.maxPages) throw new AppError('TOO_MANY_PAGES');
  const { text } = await extractText(pdf, { mergePages: false });       // string[] per page
  const pages = (text as string[]).map(cleanPageText);
  const contractText = buildContractText(pages);
  const wordCount = pages.join(' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  return { pageCount: pdf.numPages, pages, contractText, wordCount };
}
export function cleanPageText(s: string): string {
  return s.replace(/\u0000/g, '')
          .replace(/[ \t]+/g, ' ')
          .replace(/ *\n */g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/\[PAGE (\d+)\]/g, '(PAGE $1)')   // neutralise marker spoofing inside the document
          .trim();
}
```

**`pure/page-markers.ts`**
```ts
export const PAGE_MARKER_RE = /^\[PAGE (\d+)\]$/gm;
export function buildContractText(pages: string[]): string {
  return pages.map((t, i) => `[PAGE ${i + 1}]\n${t}`).join('\n\n');
}
export function splitPages(contractText: string): { page: number; text: string }[] {
  const parts = contractText.split(/^\[PAGE (\d+)\]$/m);          // ['', '1', text1, '2', text2, …]
  const out: { page: number; text: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ page: Number(parts[i]), text: (parts[i + 1] ?? '').trim() });
  return out;
}
```
A page with no text still gets its marker (an empty section). This keeps page numbers aligned with the PDF.

## 5.8 `useUploadContract`

- XHR `POST ${functionsUrl}/upload-contract` (XHR rather than `fetch`, for `upload.onprogress`), with the `Authorization` and `apikey` headers.
- `onprogress` → `setUpload({ kind: 'uploading', progress })`. When it reaches 100% → `{ kind: 'extracting' }`.
- On 201 → `{ kind: 'uploaded', … }`. If `file_stored === false`, also show an info toast: "We couldn't store the original PDF, so you'll see a text view of the contract. Analysis is unaffected."
- On error → `{ kind: 'error', code }`. A 401 refreshes the session and retries once (Spec 03 §3.8).
- "Remove" or choosing a new file after a successful upload does **not** delete the previous contract. It stays on the dashboard as "Not processed" (Spec 10). This avoids a destructive action on a mis-click.

## 5.9 Edge cases

| Case | Behaviour |
|---|---|
| PDF has a text layer on some pages only | Accepted if total words ≥ 100. Image-only pages become empty sections |
| PDF with a form/XFA layer only | Usually < 100 words → `SCANNED_PDF` |
| Non-English text | Accepted (out of scope, not blocked). Extraction confidence will be low |
| Same file uploaded twice | Two independent contracts (no dedup at MVP) |
| User navigates away mid-upload | XHR aborted on unmount. If the server finished, the contract appears on the dashboard as "Not processed" |
| Storage bucket missing / policy misconfigured | `file_stored: false`, text viewer fallback (PRD assumption 13) |
| Document contains the literal text `[PAGE 3]` | Rewritten to `(PAGE 3)` by `cleanPageText` |

## 5.10 Acceptance criteria

- A 12-page text NDA uploads, and the row has `page_count = 12`, the `[PAGE 1]…[PAGE 12]` markers in order, `status='uploaded'` and `file_path` set.
- An 11 MB file is rejected client-side, and the server also returns 413 when the client check is bypassed (curl).
- A 21-page PDF → `TOO_MANY_PAGES`. An image-only PDF → `SCANNED_PDF`. A password-protected PDF → `PDF_PASSWORD_PROTECTED`. A truncated file → `INVALID_PDF`. No row is created in any of these cases.
- If Storage is made to fail (bucket renamed in a test), the upload still returns 201 with `file_stored: false`.
- Tests: `supabase/functions/upload-contract/index.test.ts`, `tests/unit/page-markers.test.ts`, `tests/e2e/review-flow.spec.ts` (Spec 12).
