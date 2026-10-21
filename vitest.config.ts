import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'supabase/functions/_shared/pure'),
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Unit tests never reach a real project; fixed placeholders keep them independent of .env.local.
    env: {
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      NEXT_PUBLIC_SUPABASE_URL: 'https://unit-test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'unit-test-anon-key-not-a-real-key',
    },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/components/**', 'src/middleware.ts', 'supabase/functions/_shared/pure/**'],
      // Spec 12 §12.1: CI fails below these line thresholds.
      thresholds: {
        'src/lib/**': { lines: 90 },
        'supabase/functions/_shared/pure/**': { lines: 90 },
        'src/components/**': { lines: 70 },
      },
    },
  },
});
