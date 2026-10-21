'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { contractKey } from '@/hooks/use-contract';
import { apiFetch } from '@/lib/api/http';
import type { ContractDetail, KeyTerm } from '@/lib/data/contracts';
import { toast } from '@/stores/toast-store';

type Variables = { termId: string; value: string | null };

const normalise = (value: string | null) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

function replaceTerm(detail: ContractDetail, termId: string, update: (t: KeyTerm) => KeyTerm): ContractDetail {
  return { ...detail, key_terms: detail.key_terms.map((t) => (t.id === termId ? update(t) : t)) };
}

/**
 * Optimistic inline edit (Spec 07 §7.5): the cache updates immediately, rolls back with a
 * "Retry" toast on failure, and is replaced by the server row (trigger-maintained flags) on success.
 */
export function useKeyTermEdit(contractId: string) {
  const queryClient = useQueryClient();
  const key = contractKey(contractId);

  const mutation = useMutation({
    mutationFn: ({ termId, value }: Variables) =>
      apiFetch<{ key_term: KeyTerm }>(`/api/key-terms/${termId}`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      }),

    onMutate: async ({ termId, value }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ContractDetail>(key);
      const next = normalise(value);
      queryClient.setQueryData<ContractDetail>(key, (detail) =>
        detail
          ? replaceTerm(detail, termId, (t) => ({ ...t, value: next, is_edited: next !== t.original_value }))
          : detail,
      );
      return { previous };
    },

    onError: (_error, variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast({
        variant: 'error',
        title: "Couldn't save your edit. Retry?",
        action: { label: 'Retry', altText: 'Retry saving your edit', onClick: () => mutation.mutate(variables) },
      });
    },

    onSuccess: ({ key_term }) => {
      queryClient.setQueryData<ContractDetail>(key, (detail) =>
        detail ? replaceTerm(detail, key_term.id, () => key_term) : detail,
      );
    },
  });

  return mutation;
}
