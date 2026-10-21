import { cn } from '@/lib/utils/cn';

// Loading placeholder block. Wrap groups in an aria-busy container with a visually hidden label.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-bg-subtle', className)} />;
}
