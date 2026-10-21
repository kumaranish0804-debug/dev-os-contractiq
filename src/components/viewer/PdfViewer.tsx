'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import { Skeleton } from '@/components/ui/Skeleton';
import { escapeHtml, matchTextItems } from '@/lib/viewer/highlight';
import { cn } from '@/lib/utils/cn';

// Same-origin worker copied to /public on install (Spec 08 §8.9).
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export type Zoom = number | 'fit';

const RENDER_AROUND = 2;
const DEFAULT_PAGE_HEIGHT = 1100;
const PULSE_MS = 1500;
const PAGE_GAP_PX = 16;
const SIDE_PADDING_PX = 32;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Props = {
  url: string;
  zoom: Zoom;
  targetPage: number | null;
  highlightText: string | null;
  focusNonce: number;
  onPageChange: (page: number) => void;
  onNumPages: (n: number) => void;
  onError: () => void;
};

/**
 * PDF.js viewer (Spec 08 §8.5): placeholders for every page, real pages only near the viewport,
 * scroll + pulse + text-layer highlight on focus. Load errors hand over to the text fallback.
 */
export default function PdfViewer({
  url,
  zoom,
  targetPage,
  highlightText,
  focusNonce,
  onPageChange,
  onNumPages,
  onError,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [aspect, setAspect] = useState<number | null>(null); // height / width of page 1
  const [visible, setVisible] = useState<Set<number>>(() => new Set([1]));
  const [forced, setForced] = useState<number | null>(null);
  const [pulsePage, setPulsePage] = useState<number | null>(null);
  const [matches, setMatches] = useState<{ page: number; items: Set<number> } | null>(null);
  // Text items per rendered page: a page already on screen won't report its text again.
  const textItems = useRef(new Map<number, { str: string }[]>());

  const pageWidth = Math.max(200, (containerWidth - SIDE_PADDING_PX) * (zoom === 'fit' ? 1 : zoom));
  const estimatedHeight = aspect ? Math.round(pageWidth * aspect) : DEFAULT_PAGE_HEIGHT * (zoom === 'fit' ? 1 : zoom);
  const target = targetPage && numPages ? Math.min(Math.max(targetPage, 1), numPages) : null;

  // Track the scroll container width (Fit width + zoom both derive from it).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Which pages are near the viewport, and which one is most visible.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !numPages || typeof IntersectionObserver === 'undefined') return;
    const ratios = new Map<number, number>();

    const near = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const page = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        });
      },
      { root, rootMargin: '800px 0px' },
    );
    const current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio);
        let best = 1;
        let bestRatio = -1;
        for (const [page, ratio] of ratios) if (ratio > bestRatio) [best, bestRatio] = [page, ratio];
        onPageChange(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    root.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
      near.observe(el);
      current.observe(el);
    });
    return () => {
      near.disconnect();
      current.disconnect();
    };
  }, [numPages, onPageChange]);

  // Navigate on every focus(): render the page, scroll to it, pulse it.
  useEffect(() => {
    if (!target || focusNonce === 0) return;
    setForced(target);
    const cached = textItems.current.get(target);
    setMatches(cached ? { page: target, items: matchTextItems(cached, highlightText) } : null);
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`pdf-page-${target}`)
        ?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
    if (prefersReducedMotion()) return () => cancelAnimationFrame(frame);
    setPulsePage(target);
    const timer = setTimeout(() => setPulsePage(null), PULSE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // highlightText always changes together with focusNonce (viewer-store focus()).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, focusNonce]);

  const rendered = useMemo(() => {
    const set = new Set<number>();
    for (const page of [...visible, ...(forced ? [forced] : [])]) {
      for (let p = page - RENDER_AROUND; p <= page + RENDER_AROUND; p++) {
        if (p >= 1 && p <= numPages) set.add(p);
      }
    }
    return set;
  }, [visible, forced, numPages]);

  const handleText = useCallback(
    (page: number, items: { str: string }[]) => {
      textItems.current.set(page, items);
      if (page !== target) return;
      setMatches({ page, items: matchTextItems(items, highlightText) });
    },
    [target, highlightText],
  );

  return (
    // Focusable so keyboard users can scroll the document (matches TextViewer).
    <div ref={scrollRef} tabIndex={0} role="region" aria-label="Contract PDF" className="h-full overflow-auto bg-bg-subtle px-4 py-4">
      <Document
        file={url}
        loading={<Skeleton className="mx-auto h-[70vh] w-full max-w-3xl rounded-lg" />}
        onLoadSuccess={({ numPages: n }) => {
          setNumPages(n);
          onNumPages(n);
        }}
        onLoadError={onError}
        onSourceError={onError}
        error={<span className="sr-only">The PDF could not be displayed.</span>}
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => {
          const highlighted = matches?.page === page ? matches.items : null;
          return (
            <div
              key={page}
              id={`pdf-page-${page}`}
              data-page={page}
              aria-label={`Page ${page}`}
              role="region"
              style={{ minHeight: estimatedHeight, marginBottom: PAGE_GAP_PX }}
              className={cn(
                'mx-auto w-fit bg-bg-primary outline outline-2 transition-[outline-color] duration-panel',
                pulsePage === page ? 'outline-brand' : 'outline-transparent',
              )}
            >
              {rendered.has(page) ? (
                <Page
                  pageNumber={page}
                  width={pageWidth}
                  renderAnnotationLayer={false}
                  renderTextLayer
                  loading={<div style={{ width: pageWidth, height: estimatedHeight }} />}
                  onLoadSuccess={(p) => {
                    if (page === 1) setAspect(p.originalHeight / p.originalWidth);
                  }}
                  onGetTextSuccess={({ items }) =>
                    handleText(page, items.map((it) => ({ str: 'str' in it ? it.str : '' })))
                  }
                  customTextRenderer={
                    highlighted && highlighted.size > 0
                      ? ({ str, itemIndex }) =>
                          highlighted.has(itemIndex) ? `<mark class="cq-mark">${escapeHtml(str)}</mark>` : escapeHtml(str)
                      : undefined
                  }
                />
              ) : (
                <div style={{ width: pageWidth, height: estimatedHeight }} />
              )}
            </div>
          );
        })}
      </Document>
    </div>
  );
}
