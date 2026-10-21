import { z } from 'zod';

// Dashboard list query (Spec 10 §10.3). Offset pagination because the sort column is user-selectable.

export const SORT_COLUMNS = ['created_at', 'title', 'contract_type', 'status'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDir = 'asc' | 'desc';
export type ListSort = { sort: SortColumn; dir: SortDir };

export const DEFAULT_SORT: ListSort = { sort: 'created_at', dir: 'desc' };
export const PAGE_SIZE = 25;
export const RECENT_COUNT = 5;

/** `GET /api/contracts` query. Unknown or out-of-range values are rejected (400 INVALID_INPUT). */
export const listQuerySchema = z
  .object({
    sort: z.enum(SORT_COLUMNS).default(DEFAULT_SORT.sort),
    dir: z.enum(['asc', 'desc']).default(DEFAULT_SORT.dir),
    limit: z.coerce.number().int().min(1).max(100).default(PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * Sort from page URL params (`?sort=title&dir=asc`). Lenient: a hand-edited or stale URL falls
 * back to the default rather than erroring, so the server render and the client agree.
 */
export function parseListSort(params: { get(name: string): string | null }): ListSort {
  const sort = SORT_COLUMNS.find((c) => c === params.get('sort'));
  if (!sort) return DEFAULT_SORT;
  const dir = params.get('dir');
  return { sort, dir: dir === 'asc' || dir === 'desc' ? dir : defaultDir(sort) };
}

/** Newest first for dates; A→Z for everything else. */
export function defaultDir(sort: SortColumn): SortDir {
  return sort === 'created_at' ? 'desc' : 'asc';
}

/** The page URL query for a sort; the default sort has no params. */
export function sortSearch({ sort, dir }: ListSort): string {
  if (sort === DEFAULT_SORT.sort && dir === DEFAULT_SORT.dir) return '';
  return `?${new URLSearchParams({ sort, dir }).toString()}`;
}
