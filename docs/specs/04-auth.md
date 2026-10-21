# Spec 04 — Authentication

**Implements:** US-001, FR-01, Flow 1 & 2 · **Phase:** 1 (F2)

---

## 4.1 User flow

```
/signup → submit → supabase.auth.signUp → "Check your inbox" → email link → /auth/callback?code=… → session cookie → /dashboard
/login  → submit → supabase.auth.signInWithPassword → /dashboard (or ?next=)
UserMenu → "Sign out" → supabase.auth.signOut() → /
```

## 4.2 Files

| File | Purpose |
|---|---|
| `src/app/(auth)/signup/page.tsx` | Renders `AuthCard` + `SignUpForm`, and a `CheckEmail` state after success |
| `src/app/(auth)/login/page.tsx` | Renders `AuthCard` + `LoginForm`; reads `searchParams.next` and `searchParams.error` |
| `src/app/auth/callback/route.ts` | Exchanges the PKCE code for a session and redirects |
| `src/components/auth/AuthCard.tsx` | Centered card (`bg-bg-primary rounded-lg border p-8 max-w-[400px]`), logo, title, footer link |
| `src/components/auth/SignUpForm.tsx` | `'use client'`; react-hook-form + zod |
| `src/components/auth/LoginForm.tsx` | `'use client'` |
| `src/components/auth/CheckEmail.tsx` | Confirmation copy + "Resend email" button |
| `src/components/auth/UserMenu.tsx` | Avatar initial + DropdownMenu: email (read-only), "Sign out" |
| `src/lib/validation/auth.ts` | zod schemas |
| `src/lib/auth/safe-next.ts` | `safeNext(next?: string): string` |
| `src/middleware.ts`, `src/lib/supabase/middleware.ts` | Session refresh + route guard (Spec 01 §1.9) |

## 4.3 Validation — `src/lib/validation/auth.ts`

```ts
export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
export const signUpSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters')
    .regex(/[A-Za-z]/, 'Include at least one letter').regex(/\d/, 'Include at least one number'),
  confirmPassword: z.string(),
  feedbackOptIn: z.boolean().default(false),
}).refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') });
```

## 4.4 Sign up

- **Fields:** Email, Password (with show/hide toggle), Confirm password, and the checkbox "Help improve ContractIQ by sharing anonymised corrections" (unchecked by default; maps to `profiles.feedback_opt_in`).
- **Submit:**
  ```ts
  await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/dashboard`,
               data: { feedback_opt_in: feedbackOptIn ? 'true' : 'false' } },
  });
  ```
- **Success:** render `CheckEmail` with the text "We sent a verification link to **{email}**. Click it to finish creating your account." Below it, a "Resend email" button calls `supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo } })`. The button is disabled for 60 s after each click and shows a countdown.
- **Errors** (map `AuthError.code`; fallback is the generic message):

| Supabase code | UI message (field) |
|---|---|
| `user_already_exists` / `email_exists` | An account with this email already exists. [Sign in instead](/login) (email) |
| `weak_password` | Choose a stronger password (password) |
| `over_email_send_rate_limit` | Too many attempts. Please wait a minute and try again (form) |
| network / other | Something went wrong. Please try again (form, with Retry) |

> Supabase returns a fake success for an existing *unconfirmed* email (enumeration protection). In that case the CheckEmail state is correct.

## 4.5 Email callback — `src/app/auth/callback/route.ts`

```ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next') ?? undefined);
  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=link_invalid', url.origin));
}
```
On `/login?error=link_invalid` the page shows a banner: "That link is invalid or has expired. Sign in, or request a new verification email."

## 4.6 Sign in

- **Fields:** Email, Password. Link to "Create an account" (`/signup`).
- **Submit:** `supabase.auth.signInWithPassword({ email, password })`. On success: `router.replace(safeNext(searchParams.next))`, then `router.refresh()`.
- **Errors:**

| Supabase code | UI message |
|---|---|
| `invalid_credentials` | Email or password is incorrect. |
| `email_not_confirmed` | Please verify your email first. + inline "Resend verification email" action |
| `over_request_rate_limit` | Too many attempts. Please wait a minute and try again. |

- The submit button shows a spinner and is disabled while the request is pending. US-001 sets a 10 s target for the auth flow. If there is no response after 10 s, show "This is taking longer than usual…" and keep waiting.

## 4.7 `safeNext`

```ts
export function safeNext(next?: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  return next;
}
```
Blocks open redirects. Unit tested with `//evil.com`, `https://evil.com`, `/\evil.com`, `/contracts/abc`.

## 4.8 Sign out

`UserMenu` → "Sign out" → `await supabase.auth.signOut()` → `router.replace('/')` → `router.refresh()`. The React Query cache is cleared (`queryClient.clear()`).

## 4.9 Route protection

- Protected: `/dashboard/**` and `/contracts/**`. Without a session, middleware redirects to `/login?next=<encoded path+search>`.
- `/login` and `/signup` redirect to `/dashboard` when a session exists.
- `(app)/layout.tsx` also calls `supabase.auth.getUser()` server-side and calls `redirect('/login')` if there is no user (defence in depth).
- API routes call `requireUser()` (Spec 03 §3.4). Edge Functions verify the JWT (Spec 03 §3.5).

## 4.10 Accessibility

- Every input has a `<label>`. Errors are linked via `aria-describedby` and announced with `role="alert"`.
- On a failed submit, focus moves to the first invalid field.
- The password toggle is a `<button aria-pressed>` labelled "Show password".

## 4.11 Out of scope (not in PRD MVP)

Password reset, OAuth/social login, magic links, account deletion UI (see engineering doc Open Question 4). The login page shows no "Forgot password" link at MVP.

## 4.12 Acceptance criteria

- Sign up → verification email (local: Mailpit at `E2E_MAILBOX_URL`) → link → lands on `/dashboard` with the empty state. A `profiles` row exists with the chosen `feedback_opt_in`.
- Wrong password shows "Email or password is incorrect." The password field is cleared and the email is kept.
- A signed-out visit to `/contracts/123` lands on `/login?next=%2Fcontracts%2F123`, and after sign-in returns to `/contracts/123`.
- Sign out returns to `/`, and `/dashboard` then redirects to `/login`.
- E2E: `tests/e2e/auth.spec.ts` (Spec 12).
