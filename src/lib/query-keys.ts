import type { ListSort } from '@/lib/validation/contract-list';

// React Query keys shared across hooks, and with the server render (dashboard prefetch).

export const chatKey = (contractId: string) => ['chat', contractId] as const;
export const dashboardStatsKey = ['dashboard-stats'] as const;
export const contractsKey = ['contracts'] as const;
export const contractsListKey = ({ sort, dir }: ListSort) => ['contracts', sort, dir] as const;
