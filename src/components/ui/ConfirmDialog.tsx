'use client';

import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';

// Confirmation for consequential actions. Cancel is focused by default (safe choice).
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
            <Dialog.Title className="text-h5 text-text-primary">{title}</Dialog.Title>
            <Dialog.Description className="text-body-lg text-text-secondary">{description}</Dialog.Description>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button ref={cancelRef} variant="secondary">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              className={cn(destructive && 'bg-error-text hover:bg-error-text hover:opacity-90')}
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
