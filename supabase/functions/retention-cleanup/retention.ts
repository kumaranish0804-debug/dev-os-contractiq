import type { PostSlack } from '../_shared/alerts.ts';
import { log } from '../_shared/logging.ts';
import type { TypedClient } from '../_shared/supabase.ts';

export const RETENTION = {
  days: 90,
  scanLimit: 500,
  batchSize: 100,
  budgetMs: 50_000,
} as const;

export type RetentionDeps = {
  admin: TypedClient;
  postSlack: PostSlack;
  now?: () => number;
};

type Row = { id: string; file_path: string };

/**
 * Deletes stored PDFs not opened for 90 days (Spec 11 §11.1, PRD §11). Only the file goes:
 * the extracted text, terms and chat stay until the user deletes the contract. Pages through
 * candidates by id so rows that fail are not rescanned, and stops after 50 s.
 */
export async function runRetention({ admin, postSlack, now = Date.now }: RetentionDeps) {
  const started = now();
  const cutoff = new Date(started - RETENTION.days * 86_400_000).toISOString();
  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  let afterId: string | null = null;

  for (;;) {
    // cross-user: retention is a system job over every user's files (Spec 11 §11.1).
    let query = admin
      .from('contracts')
      .select('id, file_path')
      .not('file_path', 'is', null)
      .lt('last_accessed_at', cutoff)
      .order('id')
      .limit(RETENTION.scanLimit);
    if (afterId) query = query.gt('id', afterId);
    const { data, error } = await query;
    if (error) throw new Error(`retention scan failed: ${error.message}`);

    const rows = (data ?? []) as Row[];
    scanned += rows.length;
    for (let i = 0; i < rows.length; i += RETENTION.batchSize) {
      const batch = rows.slice(i, i + RETENTION.batchSize);
      // Storage reports only the objects it removed; paths already gone are not an error.
      const { error: removeError } = await admin.storage.from('contracts').remove(batch.map((r) => r.file_path));
      if (removeError) {
        failed += batch.length;
        log('error', { fn: 'retention-cleanup', event: 'storage_remove_failed', count: batch.length, error: removeError.message });
        continue;
      }
      // cross-user: clears the file reference on the rows whose objects were just removed.
      const { error: updateError } = await admin
        .from('contracts')
        .update({ file_path: null, file_deleted_at: new Date(now()).toISOString() })
        .in('id', batch.map((r) => r.id));
      if (updateError) {
        failed += batch.length;
        log('error', { fn: 'retention-cleanup', event: 'contract_update_failed', count: batch.length, error: updateError.message });
      } else {
        deleted += batch.length;
      }
    }

    afterId = rows.at(-1)?.id ?? afterId;
    if (rows.length < RETENTION.scanLimit || now() - started >= RETENTION.budgetMs) break;
  }

  log(failed > 0 ? 'error' : 'info', { fn: 'retention-cleanup', scanned, deleted, failed, ms: now() - started });
  if (failed > 0) await postSlack(`Retention cleanup: ${failed} stored file(s) could not be deleted (${deleted} deleted).`);
  return { deleted, failed };
}
