// @vitest-environment node
// Static scan (Spec 03 §3.10): every table query in supabase/functions/** must be scoped to the
// caller — `.eq('user_id', …)` for reads/updates/deletes, a `user_id` value for inserts/upserts
// (`.eq('id', …)` for profiles). RPCs are exempt because they take p_user_id.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FUNCTIONS_DIR = resolve(__dirname, '../../supabase/functions');
const SKIP = new Set(['pure', 'test-utils', 'database.types.ts']);

// `.from('table')`, but not `storage.from('bucket')`.
const FROM_RE = /(?<!storage\s*)\.from\(\s*['"`](\w+)['"`]\s*\)/g;

/**
 * Cron jobs with no user (Spec 11) legitimately read or update across users. Only these files may,
 * and only for a query marked `// cross-user: <reason>` on one of the 3 lines before `.from(`.
 */
const SYSTEM_JOB_FILES = new Set(['retention-cleanup/retention.ts', 'daily-alerts/daily-alerts.ts']);
const CROSS_USER_MARK = /\/\/ cross-user: \S/;

export function findUnscopedQueries(source: string, { systemJob = false } = {}): string[] {
  const violations: string[] = [];
  for (const match of source.matchAll(FROM_RE)) {
    const table = match[1]!;
    const start = match.index!;
    const end = source.indexOf(';', start);
    const statement = source.slice(start, end === -1 ? undefined : end);

    if (systemJob) {
      const lineNo = source.slice(0, start).split('\n').length;
      const context = source.split('\n').slice(Math.max(0, lineNo - 4), lineNo).join('\n');
      if (CROSS_USER_MARK.test(context)) continue;
    }

    const ownerColumn = table === 'profiles' ? 'id' : 'user_id';
    const filtered = new RegExp(`\\.eq\\(\\s*['"\`]${ownerColumn}['"\`]`).test(statement);
    const writesOwner =
      /\.(insert|upsert)\(/.test(statement) && new RegExp(`\\b${ownerColumn}\\s*:`).test(statement);

    if (!filtered && !writesOwner) {
      const line = source.slice(0, start).split('\n').length;
      violations.push(`${table} (line ${line})`);
    }
  }
  return violations;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('findUnscopedQueries', () => {
  it('accepts queries filtered by user_id', () => {
    const src = `await admin.from('contracts').select('id').eq('id', id).eq('user_id', userId).single();`;
    expect(findUnscopedQueries(src)).toEqual([]);
  });

  it('accepts multi-line chains and inserts that set user_id', () => {
    const src = `
      const { error } = await admin
        .from('processing_logs')
        .insert({ user_id: userId, kind: 'chat', total_ms: 12, success: true });
      await admin.from('chat_messages').delete()
        .eq('session_id', sessionId)
        .eq('user_id', userId);`;
    expect(findUnscopedQueries(src)).toEqual([]);
  });

  it('uses id as the owner column for profiles', () => {
    expect(findUnscopedQueries(`admin.from('profiles').select('*').eq('id', userId);`)).toEqual([]);
    expect(findUnscopedQueries(`admin.from('profiles').select('*').eq('user_id', userId);`)).toEqual([
      'profiles (line 1)',
    ]);
  });

  it('flags unscoped reads, updates and inserts', () => {
    const src = [
      `await admin.from('contracts').select('*').eq('id', id);`,
      `await admin.from('key_terms').update({ value: 'x' }).eq('id', termId);`,
      `await admin.from('chat_messages').insert({ session_id: s, role: 'user' });`,
    ].join('\n');
    expect(findUnscopedQueries(src)).toEqual([
      'contracts (line 1)',
      'key_terms (line 2)',
      'chat_messages (line 3)',
    ]);
  });

  it('ignores storage buckets and RPCs', () => {
    const src = `await admin.storage.from('contracts').remove([path]);
      await admin.rpc('start_processing', { p_user_id: userId });`;
    expect(findUnscopedQueries(src)).toEqual([]);
  });
});

describe('cross-user exemption', () => {
  const marked = `// cross-user: retention runs over every user's files.
    const { data } = await admin
      .from('contracts')
      .select('id, file_path');`;

  it('accepts a marked query only in system-job files', () => {
    expect(findUnscopedQueries(marked, { systemJob: true })).toEqual([]);
    expect(findUnscopedQueries(marked)).toEqual(['contracts (line 3)']);
  });

  it('still flags unmarked queries in system-job files', () => {
    expect(findUnscopedQueries(`await admin.from('contracts').select('id');`, { systemJob: true })).toEqual([
      'contracts (line 1)',
    ]);
    expect(findUnscopedQueries(`// cross-user:\nawait admin.from('contracts').select('id');`, { systemJob: true })).toEqual([
      'contracts (line 2)',
    ]);
  });
});

describe('supabase/functions', () => {
  it('scopes every table query to the caller', () => {
    const violations = listSourceFiles(FUNCTIONS_DIR).flatMap((file) => {
      const rel = relative(FUNCTIONS_DIR, file).replaceAll('\\', '/');
      return findUnscopedQueries(readFileSync(file, 'utf8'), { systemJob: SYSTEM_JOB_FILES.has(rel) }).map(
        (v) => `${rel}: ${v}`,
      );
    });
    expect(violations).toEqual([]);
  });

  it('the system-job allowlist names real files', () => {
    const files = new Set(listSourceFiles(FUNCTIONS_DIR).map((f) => relative(FUNCTIONS_DIR, f).replaceAll('\\', '/')));
    for (const f of SYSTEM_JOB_FILES) expect(files.has(f)).toBe(true);
  });
});
