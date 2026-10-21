'use client';

import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

// "Why?" — the verbatim supporting sentence (Spec 07 §7.4).
export function WhyDisclosure({ sentence, page }: { sentence: string | null; page: number | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 self-start rounded-sm text-body-sm text-text-secondary transition-colors duration-fast ease-out hover:text-text-primary"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-4 transition-transform duration-fast ease-out', open && 'rotate-90')}
        />
        Why?
      </button>
      {open ? (
        <div id={panelId}>
          {sentence ? (
            <blockquote className="flex flex-col gap-1 border-l-2 border-border-strong pl-3">
              <p className="whitespace-pre-wrap text-body-sm text-text-primary">{sentence}</p>
              {page ? <footer className="text-body-sm text-text-secondary">— Page {page}</footer> : null}
            </blockquote>
          ) : (
            <p className="text-body-sm text-text-secondary">No supporting sentence was found in the document.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
