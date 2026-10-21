'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/http';
import type { ContractListPage, DashboardSummary } from '@/lib/data/contracts';
import { contractsListKey, dashboardStatsKey } from '@/lib/query-keys';
import { PAGE_SIZE, type ListSort } from '@/lib/validation/contract-list';

// Dashboard queries (Spec 10 §10.3–10.4). The server render seeds both via HydrationBoundary.

/** While anything is processing, re-check every 5 s so statuses move on without a reload. */
export const PROCESSING_REFETCH_MS = 5000;

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardStatsKey,
    queryFn: () => apiFetch<DashboardSummary>('/api/dashboard/stats'),
    refetchInterval: (query) => ((query.state.data?.by_status.processing ?? 0) > 0 ? PROCESSING_REFETCH_MS : false),
  });
}

export function fetchContractsPage({ sort, dir }: ListSort, offset: number) {
  const params = new URLSearchParams({ sort, dir, limit: String(PAGE_SIZE), offset: String(offset) });
  return apiFetch<ContractListPage>(`/api/contracts?${params.toString()}`);
}

/** Loaded count, or undefined once every row is loaded. */
export function nextOffset(pages: ContractListPage[]): number | undefined {
  const loaded = pages.reduce((n, p) => n + p.items.length, 0);
  const total = pages.at(-1)?.total ?? 0;
  return loaded < total ? loaded : undefined;
}

/** Pages of 25 with "Load more"; the previous sort stays on screen while a new one loads. */
export function useContractsList(sort: ListSort) {
  return useInfiniteQuery({
    queryKey: contractsListKey(sort),
    queryFn: ({ pageParam }) => fetchContractsPage(sort, pageParam),
    initialPageParam: 0,
    getNextPageParam: (_last, pages) => nextOffset(pages),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some((c) => c.status === 'processing'))
        ? PROCESSING_REFETCH_MS
        : false,
  });
}
