import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

// Decorative: pair it with visible text or an aria-busy container.
export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden="true" className={cn('size-4 animate-spin', className)} />;
}
