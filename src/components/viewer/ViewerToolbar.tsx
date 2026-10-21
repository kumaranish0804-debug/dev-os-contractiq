'use client';

import { ChevronLeft, ChevronRight, Download, Maximize2, Minus, Plus } from 'lucide-react';
import type { Zoom } from '@/components/viewer/PdfViewer';
import { cn } from '@/lib/utils/cn';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.25;

/** One 25% step from the current zoom; "Fit width" counts as 100%. */
export function stepZoom(zoom: Zoom, direction: 1 | -1): number {
  const current = zoom === 'fit' ? 1 : zoom;
  const next = Math.round((current + direction * ZOOM_STEP) * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

const buttonClass =
  'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-body-sm text-text-primary transition-colors duration-fast ease-out hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40';

// `[◀] Page 3 of 12 [▶] | [−] 100% [+] [Fit] | [⬇ Download PDF]` (Spec 08 §8.8).
export function ViewerToolbar({
  currentPage,
  pageCount,
  onGoTo,
  zoom,
  onZoom,
  downloadUrl,
  downloadName,
}: {
  currentPage: number;
  pageCount: number;
  onGoTo: (page: number) => void;
  /** Omitted in text mode, which hides the zoom controls. */
  zoom?: Zoom;
  onZoom?: (zoom: Zoom) => void;
  downloadUrl?: string | null;
  downloadName?: string;
}) {
  // Arrow keys move between toolbar controls (roving focus).
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const controls = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'),
    );
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    e.preventDefault();
    const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length;
    controls[next]?.focus();
  }

  return (
    <div
      role="toolbar"
      aria-label="Document controls"
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-bg-primary px-3 py-2"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={() => onGoTo(currentPage - 1)}
          className={buttonClass}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <span aria-live="polite" className="px-1 text-body-sm text-text-secondary">
          Page {currentPage} of {pageCount}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={currentPage >= pageCount}
          onClick={() => onGoTo(currentPage + 1)}
          className={buttonClass}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>

      {zoom !== undefined && onZoom ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom !== 'fit' && zoom <= ZOOM_MIN}
            onClick={() => onZoom(stepZoom(zoom, -1))}
            className={buttonClass}
          >
            <Minus aria-hidden="true" className="size-4" />
          </button>
          <span className="w-12 text-center text-body-sm text-text-secondary">
            {zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom !== 'fit' && zoom >= ZOOM_MAX}
            onClick={() => onZoom(stepZoom(zoom, 1))}
            className={buttonClass}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Fit width"
            aria-pressed={zoom === 'fit'}
            onClick={() => onZoom('fit')}
            className={cn(buttonClass, zoom === 'fit' && 'bg-brand-subtle text-brand')}
          >
            <Maximize2 aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}

      {downloadUrl ? (
        <a href={downloadUrl} download={downloadName} className={buttonClass}>
          <Download aria-hidden="true" className="size-4" />
          Download PDF
        </a>
      ) : null}
    </div>
  );
}
