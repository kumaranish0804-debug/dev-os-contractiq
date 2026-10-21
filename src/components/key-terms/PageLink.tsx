'use client';

import { ArrowRight } from 'lucide-react';
import { useViewerStore } from '@/stores/viewer-store';

// "p.{n} →" — scrolls the viewer to the page and highlights the source sentence (Spec 07 §7.4).
export function PageLink({ page, sentence }: { page: number; sentence: string | null }) {
  const focus = useViewerStore((s) => s.focus);
  return (
    <button
      type="button"
      // Starts with the visible "p.{n}" so voice users can say what they see (WCAG 2.5.3).
      aria-label={`p.${page}, go to page ${page}`}
      onClick={() => focus(page, sentence)}
      className="inline-flex items-center gap-1 rounded-sm px-1 text-body-sm text-brand underline-offset-2 transition-colors duration-fast ease-out hover:bg-brand-subtle hover:underline"
    >
      p.{page}
      <ArrowRight aria-hidden="true" className="size-3" />
    </button>
  );
}
