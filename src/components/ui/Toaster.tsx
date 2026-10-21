'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useToastStore, type ToastVariant } from '@/stores/toast-store';

const variants: Record<ToastVariant, string> = {
  info: 'border-info-border bg-info-bg text-info-text',
  success: 'border-success-border bg-success-bg text-success-text',
  error: 'border-error-border bg-error-bg text-error-text',
};

// Renders queued toasts into the Radix viewport declared in providers.tsx.
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <>
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          type={t.variant === 'error' ? 'foreground' : 'background'}
          duration={t.variant === 'error' ? 8000 : 6000}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
          className={cn('flex items-start gap-3 rounded-lg border p-4', variants[t.variant])}
        >
          <div className="flex flex-1 flex-col gap-1">
            <ToastPrimitive.Title className="text-body-lg">{t.title}</ToastPrimitive.Title>
            {t.description ? (
              <ToastPrimitive.Description className="text-body-sm">
                {t.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          {t.action ? (
            <ToastPrimitive.Action
              altText={t.action.altText}
              onClick={t.action.onClick}
              className="rounded-md border border-current px-3 py-1 text-body-sm font-medium transition-colors duration-fast ease-out hover:bg-bg-primary"
            >
              {t.action.label}
            </ToastPrimitive.Action>
          ) : null}
          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="rounded-sm p-1 transition-colors duration-fast ease-out hover:bg-bg-primary"
          >
            <X aria-hidden="true" className="size-4" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
    </>
  );
}
