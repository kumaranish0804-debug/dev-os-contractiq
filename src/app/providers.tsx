'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { Toaster } from '@/components/ui/Toaster';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipPrimitive.Provider delayDuration={200}>
        <ToastPrimitive.Provider swipeDirection="right">
          {children}
          <Toaster />
          <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-50 flex w-96 max-w-full px-4 sm:px-0 flex-col gap-2" />
        </ToastPrimitive.Provider>
      </TooltipPrimitive.Provider>
    </QueryClientProvider>
  );
}
