'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { contractKey } from '@/hooks/use-contract';
import { ApiError } from '@/lib/api/api-error';
import { apiFetch } from '@/lib/api/http';
import type { ContractListPage, DashboardSummary } from '@/lib/data/contracts';
import { chatKey, contractsKey, dashboardStatsKey } from '@/lib/query-keys';
import { toast } from '@/stores/toast-store';

/**
 * DELETE /api/contracts/{id} (Spec 10 §10.6). On success the row disappears at once, the lists and
 * stats refetch, and the contract's cached detail and chat are dropped. A 404 means it was already
 * gone, which is treated the same way.
 */
export function useDeleteContract({ onDeleted }: { onDeleted?: () => void } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/contracts/${id}`, { method: 'DELETE' }).catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'NOT_FOUND') return;
        throw e;
      }),
    onSuccess: (_data, id) => {
      queryClient.setQueriesData<InfiniteData<ContractListPage>>({ queryKey: contractsKey }, (data) => {
        if (!data?.pages.some((p) => p.items.some((c) => c.id === id))) return data;
        return {
          ...data,
          pages: data.pages.map((p) => ({ items: p.items.filter((c) => c.id !== id), total: Math.max(0, p.total - 1) })),
        };
      });
      queryClient.setQueryData<DashboardSummary>(dashboardStatsKey, (s) =>
        s ? { ...s, recent: s.recent.filter((c) => c.id !== id) } : s,
      );
      void queryClient.invalidateQueries({ queryKey: contractsKey });
      void queryClient.invalidateQueries({ queryKey: dashboardStatsKey });
      toast({ variant: 'success', title: 'Contract deleted' });
      onDeleted?.();
      queryClient.removeQueries({ queryKey: contractKey(id) });
      queryClient.removeQueries({ queryKey: chatKey(id) });
      queryClient.removeQueries({ queryKey: ['file-url', id] });
    },
  });
}
