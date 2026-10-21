import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

// Integration + RLS tests (Spec 12 §12.2). They run against a real Supabase project — the one in
// .env.local (Stage 5 decision: the hosted project, with throwaway users removed after each run).
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'supabase/functions/_shared/pure'),
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/rls/**/*.test.ts'],
    env: loadEnv(mode, process.cwd(), ''),
    globalSetup: ['tests/integration/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
}));
