import { Check } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import type { ContractListItem } from '@/lib/data/contracts';

/** Status → label + tokens (Spec 10 §10.4). */
export function statusLabel(status: ContractListItem['status'], reviewCompletedAt: string | null): string {
  switch (status) {
    case 'uploaded':
      return 'Not processed';
    case 'processing':
      return 'Processing';
    case 'completed':
      return reviewCompletedAt ? 'Reviewed' : 'Ready';
    case 'error':
      return 'Failed';
  }
}

const VARIANTS: Record<ContractListItem['status'], BadgeVariant> = {
  uploaded: 'warning',
  processing: 'info',
  completed: 'success',
  error: 'error',
};

export function StatusBadge({
  status,
  reviewCompletedAt,
}: {
  status: ContractListItem['status'];
  reviewCompletedAt: string | null;
}) {
  return (
    <Badge variant={VARIANTS[status]}>
      {status === 'processing' ? <Spinner className="size-3 motion-reduce:animate-none" /> : null}
      {status === 'completed' && reviewCompletedAt ? <Check aria-hidden="true" className="size-3" /> : null}
      {statusLabel(status, reviewCompletedAt)}
    </Badge>
  );
}
