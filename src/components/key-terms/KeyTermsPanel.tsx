'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { needsReview } from '@shared/confidence';
import { KeyTermRow } from '@/components/key-terms/KeyTermRow';
import { Alert } from '@/components/ui/Alert';
import { useKeyTermEdit } from '@/hooks/use-key-term-edit';
import { useSlowNotice } from '@/hooks/use-slow-notice';
import type { KeyTerm } from '@/lib/data/contracts';
import { cn } from '@/lib/utils/cn';
import { useViewerStore } from '@/stores/viewer-store';

type Filter = 'all' | 'review' | 'edited' | 'custom';

const FILTERS: { id: Filter; label: string; test: (t: KeyTerm) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'review', label: 'Needs review', test: needsReview },
  { id: 'edited', label: 'Edited', test: (t) => t.is_edited },
  { id: 'custom', label: 'Custom', test: (t) => t.is_custom },
];

/** Shows a "Saving…" note only when a save is slower than the 2 s target (Spec 07 §7.5). */
const SAVING_NOTICE_AFTER_MS = 2000;

// Key terms list with filters (Spec 07 §7.3). Terms arrive ordered standard → custom.
export function KeyTermsPanel({
  contractId,
  contractType,
  terms,
}: {
  contractId: string;
  contractType: 'NDA' | 'MSA';
  terms: KeyTerm[];
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const edit = useKeyTermEdit(contractId);
  const slowSave = useSlowNotice(edit.isPending, SAVING_NOTICE_AFTER_MS);
  const focus = useViewerStore((s) => s.focus);

  const reviewCount = useMemo(() => terms.filter(needsReview).length, [terms]);
  const visible = useMemo(() => terms.filter(FILTERS.find((f) => f.id === filter)!.test), [terms, filter]);
  const nothingFound = terms.length > 0 && terms.every((t) => t.value === null);

  // PRD: auto-highlight the first low-confidence term's source once, on first render.
  const autoFocused = useRef(false);
  useEffect(() => {
    if (autoFocused.current) return;
    autoFocused.current = true;
    const first = terms.find(needsReview);
    // Not a user action: highlight, but don't switch tabs on mobile.
    if (first?.page_number) focus(first.page_number, first.source_sentence, { reveal: false });
  }, [terms, focus]);

  return (
    <section aria-labelledby="key-terms-title" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="key-terms-title" className="text-h5 text-text-primary">
          Key terms
        </h2>
        <p className="text-body-sm text-text-secondary">
          {terms.length} terms · {reviewCount} need review
        </p>
      </header>

      {nothingFound ? (
        <Alert variant="warning">
          We couldn&apos;t find the standard terms in this document. Check that it is an NDA or MSA.
        </Alert>
      ) : null}

      <div role="group" aria-label="Filter terms" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-body-sm transition-colors duration-fast ease-out',
              filter === f.id
                ? 'border-brand bg-brand-subtle text-brand'
                : 'border-border bg-bg-primary text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-body-sm text-text-secondary">No terms match this filter.</p>
      ) : (
        <ul className="flex flex-col">
          {visible.map((term) => (
            <KeyTermRow
              key={term.id}
              term={term}
              contractType={contractType}
              saving={slowSave && edit.variables?.termId === term.id}
              onSave={(value) => edit.mutate({ termId: term.id, value })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
