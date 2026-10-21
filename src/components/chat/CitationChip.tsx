'use client';

import { FileText } from 'lucide-react';
import { useViewerStore } from '@/stores/viewer-store';

// "Page N" chip → scrolls the viewer to that page (Spec 09 §9.3).
export function CitationChip({ page }: { page: number }) {
  const focus = useViewerStore((s) => s.focus);
  return (
    <button
      type="button"
      aria-label={`Go to page ${page}`}
      onClick={() => focus(page)}
      className="mx-0.5 inline-flex items-center gap-1 rounded-sm border border-info-border bg-info-bg px-1.5 py-px align-baseline text-body-sm font-medium text-info-text transition-colors duration-fast ease-out hover:bg-brand-subtle"
    >
      <FileText aria-hidden="true" className="size-3" />
      Page {page}
    </button>
  );
}
