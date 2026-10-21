'use client';

import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useDeleteContract } from '@/hooks/use-delete-contract';
import { ApiError } from '@/lib/api/api-error';
import { ERROR_MESSAGES } from '@/lib/utils/errors';

/**
 * Confirm + delete (Spec 10 §10.6), used by the dashboard and the results page. The dialog stays
 * open while the request runs and shows a failure inline, so the user can retry or cancel.
 */
export function DeleteContractDialog({
  contract,
  onOpenChange,
  onDeleted,
}: {
  /** The contract to delete; null closes the dialog. */
  contract: { id: string; title: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mutation = useDeleteContract({
    onDeleted: () => {
      onOpenChange(false);
      onDeleted?.();
    },
  });

  const errorMessage = mutation.isError
    ? mutation.error instanceof ApiError
      ? ERROR_MESSAGES[mutation.error.code]
      : ERROR_MESSAGES.INTERNAL
    : null;

  return (
    <Dialog.Root
      open={contract !== null}
      onOpenChange={(open) => {
        if (mutation.isPending) return;
        if (!open) mutation.reset();
        onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary opacity-40" />
        <Dialog.Content
          role="alertdialog"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancelRef.current?.focus();
          }}
          className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-6 rounded-xl border border-border bg-bg-primary p-6"
        >
          <div className="flex flex-col gap-2">
            <Dialog.Title className="text-h5 text-text-primary">Delete this contract?</Dialog.Title>
            <Dialog.Description className="break-words text-body-lg text-text-secondary">
              <strong className="font-medium text-text-primary">{contract?.title}</strong> and all its extracted
              terms, edits, chat history and feedback will be permanently deleted. This can&apos;t be undone.
            </Dialog.Description>
          </div>
          {errorMessage ? <Alert variant="error">{errorMessage}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button ref={cancelRef} variant="secondary" disabled={mutation.isPending}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              loading={mutation.isPending}
              className="bg-error-text hover:bg-error-text hover:opacity-90"
              onClick={() => contract && mutation.mutate(contract.id)}
            >
              Delete contract
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
