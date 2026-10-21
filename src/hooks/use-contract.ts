'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/http';
import type { ContractDetail } from '@/lib/data/contracts';

export const contractKey = (id: string) => ['contract', id] as const;

const PROCESSING_REFETCH_MS = 3000;
/** The server render is fresh: don't refetch it immediately on mount. */
const FRESH_MS = 30_000;

/**
 * The results-page detail, seeded from the server render (Spec 07 §7.1). While the contract is
 * processing it re-checks every 3 s, so the page moves on as soon as the run finishes.
 */
export function useContract(id: string, initial: ContractDetail) {
  return useQuery({
    queryKey: contractKey(id),
    queryFn: () => apiFetch<ContractDetail>(`/api/contracts/${id}`),
    initialData: initial,
    staleTime: FRESH_MS,
    refetchInterval: (query) =>
      query.state.data?.contract.status === 'processing' ? PROCESSING_REFETCH_MS : false,
  });
}
