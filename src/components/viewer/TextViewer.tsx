'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { splitPages } from '@shared/page-markers';
import { findRange } from '@/lib/viewer/highlight';
import { cn } from '@/lib/utils/cn';

const PULSE_MS = 1500;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The extracted text, one card per page (Spec 08 §8.6). Scrolls to `targetPage` whenever
 * `focusNonce` changes, pulses the page and marks the source sentence when it can be found.
 */
export function TextViewer({
  contractText,
  targetPage,
  highlightText,
  focusNonce,
  onPageChange,
}: {
  contractText: string;
  targetPage: number | null;
  highlightText: string | null;
  focusNonce: number;
  onPageChange: (page: number) => void;
}) {
  const pages = useMemo(() => splitPages(contractText), [contractText]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pulsePage, setPulsePage] = useState<number | null>(null);

  const clampedTarget =
    targetPage === null ? null : Math.min(Math.max(targetPage, 1), Math.max(pages.length, 1));
  const range = useMemo(() => {
    const page = pages.find((p) => p.page === clampedTarget);
    return page ? findRange(page.text, highlightText) : null;
  }, [pages, clampedTarget, highlightText]);

  useEffect(() => {
    if (clampedTarget === null || focusNonce === 0) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`#text-page-${clampedTarget}`);
    el?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    if (prefersReducedMotion()) return;
    setPulsePage(clampedTarget);
    const timer = setTimeout(() => setPulsePage(null), PULSE_MS);
    return () => clearTimeout(timer);
  }, [clampedTarget, focusNonce]);

  // Current page = the most visible section.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(Number((entry.target as HTMLElement).dataset.page), entry.intersectionRatio);
        }
        let best = 1;
        let bestRatio = -1;
        for (const [page, ratio] of ratios) {
          if (ratio > bestRatio) [best, bestRatio] = [page, ratio];
        }
        onPageChange(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    root.querySelectorAll('[data-page]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pages, onPageChange]);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto p-4" tabIndex={0} aria-label="Contract text">
      {pages.map(({ page, text }) => {
        const marked = page === clampedTarget && range;
        return (
          <section
            key={page}
            id={`text-page-${page}`}
            data-page={page}
            aria-label={`Page ${page}`}
            className={cn(
              'mb-4 flex flex-col gap-2 rounded-lg border border-border bg-bg-primary p-6 transition-[outline-color] duration-panel',
              pulsePage === page ? 'outline outline-2 outline-brand' : 'outline-transparent',
            )}
          >
            <p className="text-body-sm text-text-secondary">Page {page}</p>
            {text ? (
              <p className="whitespace-pre-wrap text-body-lg font-normal text-text-primary">
                {marked ? (
                  <>
                    {text.slice(0, range.start)}
                    <mark className="rounded-sm bg-highlight text-text-primary">{text.slice(range.start, range.end)}</mark>
                    {text.slice(range.end)}
                  </>
                ) : (
                  text
                )}
              </p>
            ) : (
              <p className="text-body-sm italic text-text-secondary">No selectable text on this page.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
