# Spec 01 — Project Setup & Conventions

**Implements:** Engineering doc §5, §6.1, §11, §12 · **Used by:** Stage 3 (`/frontend-setup`) and every later spec
**Supersedes the engineering doc on:** shared pure modules (§1.6), `daily-alerts` function (§1.5)

---

## 1.1 Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 20.x LTS (Netlify build image uses `NODE_VERSION=20`) | Next.js |
| npm | 10.x | Package manager (lockfile: `package-lock.json`) |
| Supabase CLI | ≥ 2.0 | Local stack, migrations, Edge Function deploy, type generation |
| Deno | 2.x | Edge Function tests and the eval harness |
| Docker Desktop | Latest | Required by `supabase start` |

## 1.2 `package.json`

```json
{
  "name": "contractiq",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=20 <21" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:functions": "deno test --allow-env --allow-read --allow-net supabase/functions",
    "test:e2e": "playwright test",
    "eval": "deno run --allow-env --allow-read --allow-write --allow-net evals/run-eval.ts",
    "fixtures": "node scripts/generate-fixtures.mjs",
    "db:types": "supabase gen types typescript --local > src/types/database.types.ts",
    "postinstall": "node scripts/copy-pdf-worker.mjs"
  },
  "dependencies": {
    "next": "14.2.15",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@supabase/supabase-js": "^2.45.0",
    "@supabase/ssr": "^0.5.1",
    "@tanstack/react-query": "^5.59.0",
    "zustand": "^4.5.5",
    "zod": "^3.23.8",
    "react-hook-form": "^7.53.0",
    "@hookform/resolvers": "^3.9.0",
    "@radix-ui/react-dialog": "^1.1.2",
    "@radix-ui/react-dropdown-menu": "^2.1.2",
    "@radix-ui/react-tabs": "^1.1.1",
    "@radix-ui/react-tooltip": "^1.1.3",
    "@radix-ui/react-toast": "^1.2.2",
    "react-dropzone": "^14.2.9",
    "react-pdf": "^9.1.1",
    "react-markdown": "^9.0.1",
    "unist-util-visit": "^5.0.0",
    "lucide-react": "^0.453.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "@types/node": "^20.16.0",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "tailwindcss": "^3.4.14",
    "postcss": "^8.4.47",
    "autoprefixer": "^10.4.20",
    "eslint": "^8.57.1",
    "eslint-config-next": "14.2.15",
    "eslint-config-prettier": "^9.1.0",
    "prettier": "^3.3.3",
    "prettier-plugin-tailwindcss": "^0.6.8",
    "vitest": "^2.1.3",
    "@vitejs/plugin-react": "^4.3.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@testing-library/jest-dom": "^6.6.2",
    "jsdom": "^25.0.1",
    "@playwright/test": "^1.48.1",
    "@axe-core/playwright": "^4.10.0",
    "pdf-lib": "^1.17.1",
    "supabase": "^2.0.0"
  }
}
```

Edge Function dependencies are declared in `supabase/functions/deno.json` (§1.5), not here.

## 1.3 Config files

**`tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["./supabase/functions/_shared/pure/*"]
    }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", "supabase/functions/_shared/pure/**/*.ts", "tests/unit/**/*.ts", "tests/unit/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "supabase/functions/**/index.ts", "evals"]
}
```

**`next.config.mjs`**
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack: (config) => {
    // react-pdf: pdfjs optionally requires `canvas` in Node; never bundle it
    config.resolve.alias.canvas = false;
    return config;
  },
};
export default nextConfig;
```

**`netlify.toml`**
```toml
[build]
  command = "npm run build"
  publish = ".next"

[build.environment]
  NODE_VERSION = "20"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

**`scripts/copy-pdf-worker.mjs`** copies `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` to `public/pdf.worker.min.mjs`. It overwrites the existing file and exits with code 0 if the source is missing, so `npm ci` never fails. Add `public/pdf.worker.min.mjs` to `.gitignore`.

**`.eslintrc.json`**: `{ "extends": ["next/core-web-vitals", "prettier"], "rules": { "no-restricted-syntax": ["error", { "selector": "Literal[value=/#[0-9a-fA-F]{6}\\b/]", "message": "Use design tokens, not hex colours." }] } }`. The hex-colour rule enforces `/design-system`.

**`.prettierrc`**: `{ "singleQuote": true, "semi": true, "printWidth": 100, "plugins": ["prettier-plugin-tailwindcss"] }`

**`.gitignore`** additions: `.env.local`, `supabase/functions/.env`, `public/pdf.worker.min.mjs`, `evals/reports/*.json`, `playwright-report/`, `test-results/`.

## 1.4 Design tokens → Tailwind

All token values come from `docs/design.md`. `src/app/globals.css` declares the primitives and semantic tokens exactly as listed in design.md's "CSS Custom Properties Setup", plus these semantic status tokens (needed for confidence badges and states):

```css
:root {
  /* …all primitives + semantic tokens from docs/design.md… */
  --border-default: var(--color-grey-100);
  --border-strong:  var(--color-grey-200);
  --focus-ring:     var(--color-blue-500);

  --success-bg: var(--color-green-50);  --success-border: var(--color-green-200);  --success-text: var(--color-green-700);
  --warning-bg: var(--color-yellow-50); --warning-border: var(--color-yellow-200); --warning-text: var(--color-yellow-900);
  --error-bg:   var(--color-red-50);    --error-border:   var(--color-red-200);    --error-text:   var(--color-red-700);
  --info-bg:    var(--color-blue-50);   --info-border:    var(--color-blue-200);   --info-text:    var(--color-blue-700);
  --highlight-bg: var(--color-yellow-100);

  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px;
  --duration-fast: 100ms; --duration-base: 150ms; --duration-panel: 200ms;
}
```

> **Contrast note:** design.md's badge pattern uses `[Color] 700` text. Yellow 700 (`#DB8000`) on Yellow 50 fails WCAG AA (≈ 2.6:1), so warning text uses **Yellow 900** (`#854D00`, ≈ 7:1). Green 700 and Red 700 on their 50 tints pass AA.

**`tailwind.config.ts`** maps only semantic tokens, so components can't use raw primitives:

```ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        text: { primary: 'var(--text-primary)', secondary: 'var(--text-secondary)' },
        bg: { primary: 'var(--bg-primary)', surface: 'var(--bg-surface)', subtle: 'var(--bg-subtle)' },
        brand: { DEFAULT: 'var(--brand)', hover: 'var(--color-blue-600)', subtle: 'var(--color-blue-50)' },
        border: { DEFAULT: 'var(--border-default)', strong: 'var(--border-strong)' },
        success: { bg: 'var(--success-bg)', border: 'var(--success-border)', text: 'var(--success-text)' },
        warning: { bg: 'var(--warning-bg)', border: 'var(--warning-border)', text: 'var(--warning-text)' },
        error: { bg: 'var(--error-bg)', border: 'var(--error-border)', text: 'var(--error-text)' },
        info: { bg: 'var(--info-bg)', border: 'var(--info-border)', text: 'var(--info-text)' },
        highlight: 'var(--highlight-bg)',
      },
      fontFamily: { sans: ['var(--font-inter-display)', 'Inter', 'system-ui', 'sans-serif'] },
      fontSize: {
        h1: ['48px', { lineHeight: '56px', fontWeight: '700' }],
        h2: ['36px', { lineHeight: '44px', fontWeight: '700' }],
        h3: ['30px', { lineHeight: '38px', fontWeight: '600' }],
        h5: ['24px', { lineHeight: '32px', fontWeight: '500' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '500' }],
        'body-sm': ['12px', { lineHeight: '18px', fontWeight: '400' }],
      },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)' },
      ringColor: { DEFAULT: 'var(--focus-ring)' },
      transitionDuration: { fast: '100ms', base: '150ms', panel: '200ms' },
    },
  },
  plugins: [],
} satisfies Config;
```

Spacing uses Tailwind's default 4px scale (`p-1` = 4px … `p-28` = 112px), which matches design.md. Arbitrary values (`p-[13px]`) are forbidden.

**Font:** `src/app/fonts/InterDisplay-{Regular,Medium,SemiBold,Bold}.woff2`, from the official Inter release (rsms/inter, SIL OFL), loaded in `layout.tsx`:
```ts
import localFont from 'next/font/local';
const interDisplay = localFont({
  src: [
    { path: './fonts/InterDisplay-Regular.woff2', weight: '400' },
    { path: './fonts/InterDisplay-Medium.woff2', weight: '500' },
    { path: './fonts/InterDisplay-SemiBold.woff2', weight: '600' },
    { path: './fonts/InterDisplay-Bold.woff2', weight: '700' },
  ],
  variable: '--font-inter-display',
  display: 'swap',
});
```

## 1.5 Supabase project files

**`supabase/config.toml`** (functions section; keep the rest of the `supabase init` defaults):
```toml
[functions.upload-contract]
verify_jwt = true
[functions.process-contract]
verify_jwt = true
[functions.chat]
verify_jwt = true
[functions.retention-cleanup]
verify_jwt = false   # authenticated by x-cron-secret header
[functions.daily-alerts]
verify_jwt = false   # authenticated by x-cron-secret header

[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
[auth.email]
enable_confirmations = true
```

**`supabase/functions/deno.json`**
```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.45.4",
    "openai": "npm:openai@4.68.1",
    "zod": "npm:zod@3.23.8",
    "unpdf": "npm:unpdf@0.12.1",
    "gpt-tokenizer/model/gpt-4o": "npm:gpt-tokenizer@2.5.1/model/gpt-4o",
    "std/assert": "jsr:@std/assert@1"
  }
}
```

**Migrations:** `supabase/migrations/20261017000000_initial_schema.sql` is a byte-for-byte copy of `docs/specs/supabase-schema.sql`. Later schema changes are new timestamped migrations, and each one is also appended to `supabase-schema.sql` so the single-file guarantee (FR-14) still holds.

## 1.6 Shared pure modules (both runtimes)

Logic needed by both Next.js and Deno lives in `supabase/functions/_shared/pure/`. **Files in `pure/` must have zero imports**, so they compile in both runtimes. Next.js imports them as `@shared/<file>`; Deno imports them by relative path.

| File | Exports |
|---|---|
| `term-library.ts` | `TERM_LIBRARY`, `getStandardTerms(type)`, `toCustomTermKey(name)` (Spec 06 §6.2) |
| `page-markers.ts` | `PAGE_MARKER_RE`, `splitPages(contractText): { page: number; text: string }[]`, `buildContractText(pages: string[])` |
| `text-normalise.ts` | `normaliseForMatch(s)`, `findSentencePage(pages, sentence, preferredPage)` (Spec 06 §6.6) |
| `citations.ts` | `CITATION_RE`, `parseCitations(text, pageCount): number[]` (Spec 09 §9.6) |
| `confidence.ts` | `confidenceLevel(score): 'high' \| 'medium' \| 'low'` (≥ 80 high, 50–79 medium, < 50 low) |
| `limits.ts` | `LIMITS = { maxFileBytes: 10485760, maxPages: 20, minWords: 100, maxTokens: 15000, maxCustomTerms: 5, customTermMin: 2, customTermMax: 60, chatMessageMax: 2000, chatSessionMax: 200, feedbackCommentMax: 1000, termValueMax: 2000, titleMax: 200 }` |

This supersedes engineering doc §11's `src/lib/terms/term-library.ts`; that file is not created.

## 1.7 Folder structure (authoritative)

```
contractiq/
├── src/
│   ├── app/
│   │   ├── (marketing)/page.tsx
│   │   ├── (auth)/login/page.tsx
│   │   ├── (auth)/signup/page.tsx
│   │   ├── auth/callback/route.ts
│   │   ├── (app)/layout.tsx
│   │   ├── (app)/dashboard/page.tsx
│   │   ├── (app)/contracts/new/page.tsx
│   │   ├── (app)/contracts/[id]/page.tsx
│   │   ├── api/contracts/route.ts
│   │   ├── api/contracts/[id]/route.ts
│   │   ├── api/contracts/[id]/file-url/route.ts
│   │   ├── api/contracts/[id]/chat/route.ts
│   │   ├── api/contracts/[id]/complete/route.ts
│   │   ├── api/key-terms/[id]/route.ts
│   │   ├── api/feedback/route.ts
│   │   ├── api/dashboard/stats/route.ts
│   │   ├── api/health/route.ts
│   │   ├── fonts/                       # Inter Display woff2
│   │   ├── layout.tsx  globals.css  error.tsx  not-found.tsx  providers.tsx
│   ├── components/{ui,marketing,auth,dashboard,contracts,key-terms,viewer,chat,shared}/
│   ├── hooks/                           # use-*.ts
│   ├── stores/                          # review-session-store.ts, viewer-store.ts
│   ├── lib/
│   │   ├── supabase/{client,server,middleware}.ts
│   │   ├── api/{http,edge,sse}.ts
│   │   ├── data/{contracts,key-terms,chat}.ts   # server-side queries shared by RSC + route handlers
│   │   ├── validation/{auth,contract,key-term,chat,feedback}.ts
│   │   ├── viewer/{highlight}.ts
│   │   ├── utils/{cn,errors,format}.ts
│   │   └── env.ts
│   ├── types/{database.types,api,domain}.ts
│   └── middleware.ts
├── supabase/
│   ├── config.toml  seed.sql  migrations/
│   └── functions/
│       ├── deno.json
│       ├── _shared/{handler,auth,cors,errors,rate-limit,openai,schemas,pdf-text,prompt-builder,
│       │            extraction,extraction-postprocess,query-classifier,chat-context,cost,logging,
│       │            supabase,alerts,metrics}.ts
│       ├── _shared/pure/{term-library,page-markers,text-normalise,citations,confidence,limits}.ts
│       ├── _shared/test-utils/openai-mock.ts
│       ├── upload-contract/index.ts
│       ├── process-contract/index.ts
│       ├── chat/index.ts
│       ├── retention-cleanup/index.ts
│       └── daily-alerts/index.ts
├── prompts/v1/{extraction-system.md,few-shot-nda.json,few-shot-msa.json,chat-system.md,chat-system-history.md,CHANGELOG.md}
├── evals/{datasets/,run-eval.ts,metrics.ts,reports/}
├── tests/{unit/,integration/,rls/,e2e/,mocks/,fixtures/,load/}
├── scripts/{copy-pdf-worker.mjs,generate-fixtures.mjs}
├── .github/workflows/{ci.yml,eval.yml}
├── public/
├── docs/
├── .env.example  netlify.toml  next.config.mjs  tailwind.config.ts  postcss.config.mjs
├── vitest.config.ts  vitest.integration.config.ts  playwright.config.ts  tsconfig.json  package.json
```

**Prompts:** the canonical, human-reviewed copies live in `prompts/v1/`. Edge Functions can't read files outside `supabase/functions/` at deploy time, so `_shared/prompt-builder.ts` holds the same text as TypeScript string constants. `tests/unit/prompt-parity.test.ts` fails if the two ever differ (Spec 12 §12.5).

## 1.8 Environment loading — `src/lib/env.ts`

```ts
import { z } from 'zod';
const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
export const functionsUrl = `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
```
Next.js runtime code reads no server-only variables. Edge Functions read theirs via `Deno.env.get()` inside `_shared/*` and fail fast with `INTERNAL` when a required one is missing.

## 1.9 Supabase clients

**`src/lib/supabase/client.ts`**
```ts
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database.types';
import { publicEnv } from '@/lib/env';
export const createClient = () =>
  createBrowserClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
```

**`src/lib/supabase/server.ts`**
```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database.types';
import { publicEnv } from '@/lib/env';
export function createClient() {
  const cookieStore = cookies();
  return createServerClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try { toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* called from a Server Component — middleware refreshes the session */ }
      },
    },
  });
}
```

**`src/lib/supabase/middleware.ts`** exports `updateSession(request)`. It creates a server client bound to `request.cookies` / `response.cookies` and calls `supabase.auth.getUser()`. Then:
- if the path matches `/dashboard` or `/contracts` and there is no user → redirect to `/login?next=<pathname+search>`;
- if the path is `/login` or `/signup` and there is a user → redirect to `/dashboard`.

**`src/middleware.ts`**
```ts
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
export const middleware = (req: NextRequest) => updateSession(req);
export const config = { matcher: ['/dashboard/:path*', '/contracts/:path*', '/login', '/signup'] };
```

## 1.10 Providers — `src/app/providers.tsx`

A `'use client'` component that wraps children in a `QueryClientProvider` (defaults: `staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: false`), plus the Radix `TooltipProvider` (`delayDuration: 200`) and `ToastProvider`. It is rendered in the root `layout.tsx`.

## 1.11 Root layout & landing page (Stage 3 scope)

- `layout.tsx`: `<html lang="en" className={interDisplay.variable}>`. The body uses `bg-bg-surface text-text-primary font-sans`. Metadata: title `ContractIQ — Understand your NDAs and MSAs in minutes`, plus a description.
- `(marketing)/page.tsx` (Server Component, no event handlers):
  - header: logo text "ContractIQ", plus "Sign In" (`/login`) and "Get Started Free" (`/signup`) links;
  - hero: H1 "Understand every NDA and MSA before you sign"; subcopy "Extract the terms that matter, see exactly where they are, and ask questions in plain English — no lawyer on call."; both CTAs;
  - a 3-item feature grid: Key terms with page references · Confidence you can see · Chat grounded in your document;
  - a demo GIF slot `public/demo.gif` (alt text "ContractIQ extracting key terms from an NDA");
  - footer: "Powered by OpenAI GPT-4o" and "ContractIQ is not legal advice."
- Page wrapper per design.md: `px-28 py-24` at ≥ 1024 px, `px-4 py-12` on mobile, `gap-10` between sections. Flat surfaces only: no gradients or shadows.

## 1.12 Acceptance criteria (Stage 3 done)

- `npm install && npm run dev` serves `/` at `http://localhost:3000` with the landing page using design tokens and Inter Display.
- `npm run build`, `npm run typecheck` and `npm run lint` pass with zero errors.
- Visiting `/dashboard` while signed out redirects to `/login?next=%2Fdashboard`. The login page may be a placeholder at this stage.
- `grep -rE "#[0-9a-fA-F]{6}" src --include=*.tsx` returns nothing (all colours come from tokens).
- `supabase start` runs and `supabase db reset` applies the initial migration without errors.
