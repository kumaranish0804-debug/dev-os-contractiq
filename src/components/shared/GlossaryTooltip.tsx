'use client';

import { Info } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';

// Focusable info icon explaining a term in plain English (Spec 06 §6.3, Spec 07 §7.4).
export function GlossaryTooltip({ term, text }: { term: string; text: string }) {
  return (
    <Tooltip content={text}>
      <button
        type="button"
        aria-label={`What is ${term}?`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-text-secondary transition-colors duration-fast ease-out hover:text-text-primary"
      >
        <Info aria-hidden="true" className="size-4" />
      </button>
    </Tooltip>
  );
}
