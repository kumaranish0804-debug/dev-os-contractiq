import { create } from 'zustand';

export type ToastVariant = 'info' | 'success' | 'error';

export type Toast = {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  /** Optional button, e.g. "Retry". `altText` describes it for screen readers. */
  action?: { label: string; altText: string; onClick: () => void };
};

type ToastState = {
  toasts: Toast[];
  show: (toast: Omit<Toast, 'id' | 'variant'> & { variant?: ToastVariant }) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

// App-wide toasts, rendered by <Toaster /> in providers.tsx.
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: ({ variant = 'info', ...toast }) =>
    set((state) => ({ toasts: [...state.toasts, { id: nextId++, variant, ...toast }] })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Shows a toast from anywhere (hooks, callbacks, non-React code). */
export const toast = (t: Parameters<ToastState['show']>[0]) => useToastStore.getState().show(t);
