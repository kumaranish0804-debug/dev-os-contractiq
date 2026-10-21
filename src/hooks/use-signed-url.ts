'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/http';

export type SignedUrl = { url: string; download_url: string; expires_at: string };

const FIFTY_MINUTES = 50 * 60 * 1000;

/**
 * Signed URL for the original PDF, refreshed before its 1-hour expiry (Spec 08 §8.4). The PDF is
 * loaded once, so refreshes only keep the Download link valid.
 */
export function useSignedUrl(contractId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['file-url', contractId],
    queryFn: () => apiFetch<SignedUrl>(`/api/contracts/${contractId}/file-url`),
    enabled,
    staleTime: FIFTY_MINUTES,
    refetchInterval: FIFTY_MINUTES,
    retry: 1,
  });
}
