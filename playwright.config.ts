import { defineConfig, devices } from '@playwright/test';

// E2E (Spec 12 §12.2, §12.8). Locally: a production build on :3000 (or a running dev server) against the Supabase project in
// .env.local (Stage 5 decision). In CI: E2E_BASE_URL points at the deploy preview.
try {
  process.loadEnvFile('.env.local');
} catch {
  // CI provides the environment directly.
}

// :3000 is the origin the deployed Edge Functions allow (ALLOWED_ORIGINS); other ports fail CORS.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)/.test(baseURL);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] }, grep: /@smoke/ },
  ],
  webServer: isLocal
    ? {
        // Never run this while `npm run dev` is up: building corrupts the dev server's .next.
        command: 'npm run build && npx next start -p 3000',
        url: `${baseURL}/login`,
        reuseExistingServer: true,
        timeout: 300_000,
      }
    : undefined,
});
