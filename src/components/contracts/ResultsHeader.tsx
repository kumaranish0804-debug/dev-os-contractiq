'use client';

import Link from 'next/link';
import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react';
import { DeleteContractDialog } from '@/components/shared/DeleteContractDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useCompleteReview } from '@/hooks/use-review-actions';
import { formatDate } from '@/lib/utils/dates';

const itemClass =
  'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-body-lg outline-none transition-colors duration-fast ease-out data-[highlighted]:bg-bg-subtle';

/** "Mark review complete" → "Reviewed ✓ {date}" (Spec 07 §7.7). */
function CompleteReviewButton({ contractId, completedAt }: { contractId: string; completedAt: string | null }) {
  const complete = useCompleteReview(contractId);
  if (completedAt) {
    return (
      <Button variant="secondary" disabled className="shrink-0">
        <span suppressHydrationWarning>Reviewed ✓ {formatDate(completedAt)}</span>
      </Button>
    );
  }
  return (
    <Button variant="secondary" className="shrink-0" loading={complete.isPending} onClick={() => complete.mutate()}>
      Mark review complete
    </Button>
  );
}

// Title row with review completion and the overflow menu: re-run (Spec 07 §7.9), delete (Spec 10 §10.6).
export function ResultsHeader({
  contractId,
  title,
  contractType,
  editedCount,
  reviewCompletedAt,
  canCompleteReview,
  onRerun,
  onDeleted,
}: {
  contractId: string;
  title: string;
  contractType: 'NDA' | 'MSA';
  editedCount: number;
  reviewCompletedAt: string | null;
  /** Only an analysed contract can be marked reviewed. */
  canCompleteReview: boolean;
  onRerun: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <header className="flex flex-col gap-3">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 self-start rounded-sm text-body-sm text-text-secondary transition-colors duration-fast ease-out hover:text-text-primary"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Dashboard
      </Link>
      {/* On narrow screens the title takes the full row and the actions wrap below it. */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 basis-60 flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-h5 text-text-primary">{title}</h1>
          <Badge variant="info">{contractType}</Badge>
        </div>
        {canCompleteReview ? <CompleteReviewButton contractId={contractId} completedAt={reviewCompletedAt} /> : null}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label="More actions"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg-primary text-text-primary transition-colors duration-fast ease-out hover:bg-bg-subtle"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-50 flex min-w-48 flex-col rounded-lg border border-border bg-bg-primary p-1"
            >
              <DropdownMenu.Item onSelect={() => setConfirming(true)} className={`${itemClass} text-text-primary`}>
                <RefreshCw aria-hidden="true" className="size-4" />
                Re-run analysis
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => setDeleting(true)} className={`${itemClass} text-error-text`}>
                <Trash2 aria-hidden="true" className="size-4" />
                Delete…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Re-run analysis?"
        description={
          editedCount > 0
            ? `Re-running replaces all extracted terms, including your ${editedCount} ${editedCount === 1 ? 'edit' : 'edits'}. Continue?`
            : 'Re-running replaces all extracted terms. Continue?'
        }
        confirmLabel="Re-run analysis"
        onConfirm={onRerun}
      />
      <DeleteContractDialog
        contract={deleting ? { id: contractId, title } : null}
        onOpenChange={setDeleting}
        onDeleted={onDeleted}
      />
    </header>
  );
}
