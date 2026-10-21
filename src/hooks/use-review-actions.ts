'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { contractKey } from '@/hooks/use-contract';
import { apiFetch } from '@/lib/api/http';
import type { ContractDetail } from '@/lib/data/contracts';
import { contractsKey, dashboardStatsKey } from '@/lib/query-keys';
import type { Feedback, FeedbackBody } from '@/lib/validation/feedback';
import { toast } from '@/stores/toast-store';

// Results-page writes that update the cached detail on success (Spec 07 §7.6–7.7).

/** POST /api/feedback; the widget shows its own inline error, so no toast here. */
export function useSubmitFeedback(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<FeedbackBody, 'contract_id'>) =>
      apiFetch<{ feedback: Feedback }>('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ ...body, contract_id: contractId }),
      }),
    onSuccess: ({ feedback }) => {
      queryClient.setQueryData<ContractDetail>(contractKey(contractId), (d) =>
        d ? { ...d, feedback: { rating: feedback.rating, comment: feedback.comment } } : d,
      );
    },
  });
}

/** POST /api/contracts/{id}/complete; the dashboard's "Reviewed ✓" follows via invalidation. */
export function useCompleteReview(contractId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ review_completed_at: string }>(`/api/contracts/${contractId}/complete`, { method: 'POST' }),
    onSuccess: ({ review_completed_at }) => {
      queryClient.setQueryData<ContractDetail>(contractKey(contractId), (d) =>
        d ? { ...d, contract: { ...d.contract, review_completed_at } } : d,
      );
      void queryClient.invalidateQueries({ queryKey: contractsKey });
      void queryClient.invalidateQueries({ queryKey: dashboardStatsKey });
      toast({ variant: 'success', title: 'Review marked complete' });
    },
    onError: () => {
      toast({
        variant: 'error',
        title: "Couldn't mark the review complete.",
        action: { label: 'Retry', altText: 'Retry marking the review complete', onClick: () => mutation.mutate() },
      });
    },
  });
  return mutation;
}
