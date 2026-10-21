// Generates the Database types from the Supabase schema into src/types/ (Next.js) and
// supabase/functions/_shared/ (Edge Functions are bundled from supabase/functions only).
// Usage: node scripts/gen-db-types.mjs [--local]   (default: hosted project)
// Writes the files only when generation succeeds, so a CLI error never replaces the types.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'kmzofljbuisyxwjbdhsw';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destinations = [
  resolve(root, 'src/types/database.types.ts'),
  resolve(root, 'supabase/functions/_shared/database.types.ts'),
];
const target = process.argv.includes('--local') ? ['--local'] : ['--project-id', PROJECT_ID];
// All arguments are constants, so a single command string is safe to run through the shell.
const command = ['npx', 'supabase', 'gen', 'types', 'typescript', ...target, '--schema', 'public'].join(' ');

let output;
try {
  output = execSync(command, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (error) {
  console.error(`[gen-db-types] supabase CLI failed${error.stdout ? `: ${error.stdout.trim()}` : ''}`);
  process.exit(1);
}

if (!output.includes('export type Database')) {
  console.error(`[gen-db-types] unexpected CLI output; types not written:\n${output.slice(0, 500)}`);
  process.exit(1);
}

for (const dest of destinations) {
  writeFileSync(dest, output);
  console.log(`[gen-db-types] wrote ${dest}`);
}
