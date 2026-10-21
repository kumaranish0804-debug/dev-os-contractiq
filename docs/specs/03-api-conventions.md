# Spec 03 — API Conventions, Errors, Auth, Rate Limits

**Implements:** engineering doc §6.4, §9 (shared rules) · **Applies to:** every Next.js route handler and Edge Function

---

## 3.1 Transport

| Surface | Base URL | Auth | Body |
|---|---|---|---|
| Next.js route handlers | `/api/*` (same origin) | Supabase session cookie (`@supabase/ssr`) | JSON |
| Edge Functions | `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/<name>` | `Authorization: Bearer <access_token>` + `apikey: <anon key>` | JSON, `multipart/form-data` (upload), SSE response (chat) |

- All IDs are UUID v4 and are validated with `z.string().uuid()`. An invalid ID returns `404 NOT_FOUND` (not 400), so the API never reveals whether a resource exists.
- Unowned or missing resources → `404 NOT_FOUND`, never 403.
- Timestamps are ISO-8601 UTC strings.
- JSON keys are `snake_case`, mirroring DB columns.

## 3.2 Error envelope

Every non-2xx JSON response:
```json
{ "error": { "code": "SCANNED_PDF", "message": "Scanned PDFs are not supported yet. Please upload a PDF with selectable text.", "requestId": "b1f4…", "details": { } } }
```
`details` is optional and only present for `INVALID_INPUT` (zod field errors: `{ "fieldErrors": { "custom_terms": ["…"] } }`). Messages are user-safe. Stack traces and raw provider errors are logged, never returned.

## 3.3 Error code catalogue

| Code | HTTP | User message (shown verbatim in the UI) |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Your session has expired. Please sign in again. |
| `NOT_FOUND` | 404 | We couldn't find that contract. |
| `INVALID_INPUT` | 400 | Some of the information provided is invalid. *(field errors shown inline)* |
| `FILE_TOO_LARGE` | 413 | This file is larger than 10 MB. Please upload a smaller PDF. |
| `UNSUPPORTED_FILE_TYPE` | 415 | Only PDF files are supported. |
| `TOO_MANY_PAGES` | 422 | This contract has more than 20 pages. ContractIQ currently supports contracts up to 20 pages. |
| `SCANNED_PDF` | 422 | Scanned PDFs are not supported yet. Please upload a PDF with selectable text. |
| `CONTRACT_TOO_LONG` | 422 | This contract is too long to analyse (over ~15,000 tokens). Support for longer contracts is coming. |
| `INVALID_PDF` | 422 | We couldn't read this PDF. It may be corrupted — try exporting it again. |
| `PDF_PASSWORD_PROTECTED` | 422 | This PDF is password-protected. Remove the password and upload it again. |
| `ALREADY_PROCESSING` | 409 | This contract is already being analysed. |
| `CONTRACT_NOT_READY` | 409 | This contract hasn't finished processing yet. |
| `CUSTOM_TERM_LIMIT` | 400 | You can add up to 5 custom terms. |
| `CHAT_LIMIT_REACHED` | 409 | This conversation has reached its 200-message limit. |
| `FILE_NOT_AVAILABLE` | 404 | The original PDF isn't available. Showing the extracted text instead. |
| `RATE_LIMITED` | 429 | You're doing that too often. Please try again in a few minutes. |
| `AI_UNAVAILABLE` | 502 | Our AI service is busy. Try again in a few minutes. |
| `AI_TIMEOUT` | 504 | The analysis took too long. Try again in a few minutes. |
| `AI_INVALID_OUTPUT` | 502 | We couldn't read the AI's response. Try again in a few minutes. |
| `INTERNAL` | 500 | Something went wrong on our side. Please try again. |

The catalogue lives in `supabase/functions/_shared/errors.ts` (`ERROR_CATALOGUE`) and is mirrored in `src/lib/utils/errors.ts` (`ERROR_MESSAGES`). A unit test asserts the two key sets are equal.

## 3.4 Next.js route handler pattern

```ts
// src/lib/api/http.ts
export class ApiError extends Error {
  constructor(public code: ErrorCode, public status: number, message?: string, public details?: unknown) {
    super(message ?? ERROR_MESSAGES[code]);
  }
}
export function errorResponse(e: unknown, requestId = crypto.randomUUID()) {
  const err = e instanceof ApiError ? e : new ApiError('INTERNAL', 500);
  if (!(e instanceof ApiError)) console.error(JSON.stringify({ level: 'error', requestId, error: String(e) }));
  return Response.json({ error: { code: err.code, message: err.message, requestId, details: err.details } }, { status: err.status });
}
export async function requireUser() {
  const supabase = createClient();                       // src/lib/supabase/server.ts
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ApiError('UNAUTHENTICATED', 401);
  return { supabase, user };
}
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError('INVALID_INPUT', 400, undefined, { fieldErrors: r.error.flatten().fieldErrors });
  return r.data;
}
```
Every handler body is `try { … } catch (e) { return errorResponse(e); }`. Handlers use the **user-scoped** client only, so RLS is always enforced. Every route file exports `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'`.

## 3.5 Edge Function pattern — `_shared/handler.ts`

```ts
type Ctx = { req: Request; userId: string; requestId: string; admin: SupabaseClient; userClient: SupabaseClient };
export function createHandler(opts: { method: 'POST'; rateLimit?: { bucket: 'upload'|'process'|'chat'; limit: number; windowSeconds: number } },
                              fn: (ctx: Ctx) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const cors = corsHeaders(req);                       // _shared/cors.ts
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (req.method !== opts.method) throw new AppError('NOT_FOUND');
      const { userId, userClient } = await authenticate(req);   // _shared/auth.ts → 401 UNAUTHENTICATED
      const admin = createAdminClient();                         // service role, _shared/supabase.ts
      if (opts.rateLimit) await enforceRateLimit(admin, userId, opts.rateLimit); // 429 + Retry-After
      const res = await fn({ req, userId, requestId, admin, userClient });
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return errorJson(e, requestId, cors);                      // envelope §3.2, logs non-AppErrors
    }
  };
}
```
- **`authenticate(req)`**: reads `Authorization: Bearer <jwt>` and builds a client with the anon key and that header, then calls `auth.getUser()`. A missing or invalid token gives `UNAUTHENTICATED`. Returns `user.id`.
- **Service-role rule:** every `admin` query on a user-owned table includes `.eq('user_id', userId)`, or calls an RPC that takes `p_user_id`. Code review rejects any admin query without the filter.
- **`corsHeaders(req)`**: if the `Origin` is in `ALLOWED_ORIGINS`, echoes it in `Access-Control-Allow-Origin`, with `Vary: Origin`, `Access-Control-Allow-Headers: authorization, apikey, content-type, x-client-info`, `Access-Control-Allow-Methods: POST, OPTIONS`. Unknown origins get no ACAO header.
- **Logging (`_shared/logging.ts`)**: one JSON line per request: `{ level, fn, requestId, userId, status, ms, errorCode }`. Contract text, prompts and model output are **never** logged.

## 3.6 Rate limits

| Bucket | Limit | Window | Endpoint |
|---|---|---|---|
| `upload` | 20 | 3600 s | `upload-contract` |
| `process` | 20 | 3600 s | `process-contract` |
| `chat` | 30 | 600 s | `chat` |

`enforceRateLimit` calls `rpc('check_rate_limit', { p_user_id, p_bucket, p_limit, p_window_seconds })`. If it returns `false`, the function throws `RATE_LIMITED` with the header `Retry-After: <seconds until window end>` (= `windowSeconds - (now_epoch % windowSeconds)`). If the RPC errors, the request fails open: it is allowed, and `rate_limit_unavailable` is logged.

## 3.7 OpenAI client — `_shared/openai.ts`

```ts
const client = new OpenAI({ apiKey: env('OPENAI_API_KEY'), baseURL: Deno.env.get('OPENAI_BASE_URL') || undefined,
                            timeout: 20_000, maxRetries: 0 });
export async function withRetry<T>(call: (attempt: number) => Promise<T>): Promise<{ result: T; attempts: number }>
```
- Up to **3 attempts**. Retry on HTTP 429, 500, 502, 503, 504, connection errors and `APIConnectionTimeoutError`. The delay before attempt 2 is 1 s and before attempt 3 is 2 s, each plus random jitter of 0–250 ms.
- Do not retry on 400/401/403/404 (configuration errors). These map to `INTERNAL` and are logged at `error` level.
- After the final failure: a timeout gives `AI_TIMEOUT`, anything else gives `AI_UNAVAILABLE`.
- `user` param = `hex(SHA-256(OPENAI_USER_HASH_SALT + userId))`.

## 3.8 Client API layer

- **`src/lib/api/edge.ts`**: `callEdge<T>(name, body: object | FormData): Promise<T>`. It gets the access token from `supabase.auth.getSession()`, sets the `Authorization` and `apikey` headers, and parses the error envelope into `ApiError`. A 401 triggers `supabase.auth.refreshSession()` and one retry, then redirects to `/login?next=…`.
- **`src/lib/api/http.ts`** (client half): `apiFetch<T>(path, init)` for `/api/*`, with the same envelope parsing.
- **`src/lib/api/sse.ts`**: see Spec 09 §9.7.
- UI copy for errors always comes from `ERROR_MESSAGES[code]`. Unknown codes fall back to `INTERNAL`.

## 3.9 Deploying Edge Functions

```bash
supabase link --project-ref <ref>
supabase secrets set --env-file supabase/functions/.env   # OPENAI_*, ALLOWED_ORIGINS, PROMPT_VERSION, CRON_SECRET, SLACK_ALERT_WEBHOOK_URL, MONTHLY_OPENAI_BUDGET_USD
supabase functions deploy upload-contract process-contract chat retention-cleanup daily-alerts
```
`verify_jwt` settings come from `supabase/config.toml` (Spec 01 §1.5).

## 3.10 Acceptance criteria

- Every endpoint returns the §3.2 envelope for every error path (asserted in the integration tests).
- No handler or function returns 403. Unowned resources return 404.
- Rate-limit exhaustion returns 429 with a numeric `Retry-After`.
- A grep for `.from('` in `supabase/functions/**` shows a `user_id` filter or an RPC on every user-owned table. This is checked by the `tests/unit/service-role-filter.test.ts` static scan.
