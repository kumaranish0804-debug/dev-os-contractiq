import { z } from 'zod';
import type { createClient } from '@/lib/supabase/server';
import { DEFAULT_SORT, RECENT_COUNT, type ListQuery } from '@/lib/validation/contract-list';
import type { Database } from '@/types/database.types';

// Server-side data access with the user-scoped client — RLS limits every query to the caller (Spec 10 §10.3).

// The client exactly as @supabase/ssr types it (its generics differ from SupabaseClient<Database>).
type Client = ReturnType<typeof createClient>;

const countSchema = z.number().int().nonnegative();

export const dashboardStatsSchema = z.object({
  total: countSchema,
  by_type: z.object({ NDA: countSchema, MSA: countSchema }),
  by_status: z.object({
    uploaded: countSchema,
    processing: countSchema,
    completed: countSchema,
    error: countSchema,
  }),
});

export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

type Tables = Database['public']['Tables'];

export const KEY_TERM_COLUMNS =
  'id, term_key, term_name, value, original_value, page_number, confidence_score, source_sentence, is_custom, is_edited, edited_at, sort_order' as const;

export type KeyTerm = Pick<
  Tables['key_terms']['Row'],
  | 'id'
  | 'term_key'
  | 'term_name'
  | 'value'
  | 'original_value'
  | 'page_number'
  | 'confidence_score'
  | 'source_sentence'
  | 'is_custom'
  | 'is_edited'
  | 'edited_at'
  | 'sort_order'
>;

export type ContractDetail = {
  contract: Pick<
    Tables['contracts']['Row'],
    | 'id'
    | 'title'
    | 'original_filename'
    | 'contract_type'
    | 'status'
    | 'error_code'
    | 'error_message'
    | 'page_count'
    | 'file_deleted_at'
    | 'detected_type_mismatch'
    | 'created_at'
    | 'processed_at'
    | 'review_completed_at'
    | 'contract_text'
  > & { has_file: boolean };
  key_terms: KeyTerm[];
  custom_terms: string[];
  feedback: { rating: 'up' | 'down'; comment: string | null } | null;
};

/**
 * Everything the results page needs, in 4 parallel queries (Spec 07 §7.8). Returns null when the
 * contract does not exist or is not the caller's (RLS). The storage path is never returned.
 */
export async function getContractDetail(supabase: Client, id: string): Promise<ContractDetail | null> {
  const [contractRes, termsRes, customRes, feedbackRes] = await Promise.all([
    supabase
      .from('contracts')
      .select(
        'id, title, original_filename, contract_type, status, error_code, error_message, page_count, file_path, file_deleted_at, detected_type_mismatch, created_at, processed_at, review_completed_at, contract_text',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('key_terms')
      .select(KEY_TERM_COLUMNS)
      .eq('contract_id', id)
      .order('is_custom')
      .order('sort_order'),
    supabase.from('custom_key_terms').select('term_name, created_at').eq('contract_id', id).order('created_at'),
    supabase.from('user_feedback').select('rating, comment').eq('contract_id', id).maybeSingle(),
  ]);

  for (const res of [contractRes, termsRes, customRes, feedbackRes]) {
    if (res.error) throw new Error(`getContractDetail failed: ${res.error.message}`);
  }
  if (!contractRes.data) return null;

  const { file_path, ...contract } = contractRes.data;
  return {
    contract: { ...contract, has_file: file_path !== null },
    key_terms: termsRes.data ?? [],
    custom_terms: (customRes.data ?? []).map((t) => t.term_name),
    feedback: feedbackRes.data ?? null,
  };
}

/** Counts for the signed-in user via get_dashboard_stats(). Throws on DB or shape errors. */
export async function getDashboardStats(supabase: Client): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('get_dashboard_stats');
  if (error) throw new Error(`get_dashboard_stats failed: ${error.message}`);
  return dashboardStatsSchema.parse(data);
}

// contract_text is never selected for lists.
const LIST_COLUMNS = 'id, title, contract_type, status, page_count, created_at, processed_at, review_completed_at' as const;

export type ContractListItem = Pick<
  Tables['contracts']['Row'],
  'id' | 'title' | 'contract_type' | 'status' | 'page_count' | 'created_at' | 'processed_at' | 'review_completed_at'
>;

export type ContractListPage = { items: ContractListItem[]; total: number };

/** One page of the caller's contracts, sorted with `id` as a stable tiebreak (Spec 10 §10.3). */
export async function listContracts(
  supabase: Client,
  { sort, dir, limit, offset }: ListQuery,
): Promise<ContractListPage> {
  const { data, error, count } = await supabase
    .from('contracts')
    .select(LIST_COLUMNS, { count: 'exact' })
    .order(sort, { ascending: dir === 'asc' })
    .order('id')
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`listContracts failed: ${error.message}`);
  return { items: data ?? [], total: count ?? 0 };
}

export type DashboardSummary = DashboardStats & { recent: ContractListItem[] };

/** Stats plus the 5 newest contracts — the `GET /api/dashboard/stats` body. */
export async function getDashboardSummary(supabase: Client): Promise<DashboardSummary> {
  const [stats, recent] = await Promise.all([
    getDashboardStats(supabase),
    listContracts(supabase, { ...DEFAULT_SORT, limit: RECENT_COUNT, offset: 0 }),
  ]);
  return { ...stats, recent: recent.items };
}
