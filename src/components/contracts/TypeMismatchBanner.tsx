'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const storageKey = (contractId: string) => `cq-mismatch-dismissed:${contractId}`;

function readDismissed(contractId: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey(contractId)) === '1';
  } catch {
    return false;
  }
}

// Soft warning when the document doesn't look like the selected type (Spec 07 §7.2).
export function TypeMismatchBanner({
  contractId,
  selected,
  editedCount,
  onRerun,
}: {
  contractId: string;
  selected: 'NDA' | 'MSA';
  editedCount: number;
  onRerun: (type: 'NDA' | 'MSA') => void;
}) {
  const other = selected === 'NDA' ? 'MSA' : 'NDA';
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => setDismissed(readDismissed(contractId)), [contractId]);

  if (dismissed) return null;

  function keepResults() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(storageKey(contractId), '1');
    } catch {
      // Storage unavailable: hidden for this page view only.
    }
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-warning-text md:flex-row md:items-center"
    >
      <p className="flex flex-1 items-start gap-2 text-body-sm">
        <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
        This document doesn&apos;t look like a typical {selected}. Some terms may be missing.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Re-run as {other}
        </Button>
        <Button variant="ghost" onClick={keepResults}>
          Keep results
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Re-run as ${other}?`}
        description={
          editedCount > 0
            ? `This replaces all extracted terms, including your ${editedCount} ${editedCount === 1 ? 'edit' : 'edits'}.`
            : 'This replaces all extracted terms.'
        }
        confirmLabel={`Re-run as ${other}`}
        onConfirm={() => onRerun(other)}
      />
    </div>
  );
}
