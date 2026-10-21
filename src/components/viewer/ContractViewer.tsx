'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Info } from 'lucide-react';
import type { Zoom } from '@/components/viewer/PdfViewer';
import { TextViewer } from '@/components/viewer/TextViewer';
import { stepZoom, ViewerToolbar } from '@/components/viewer/ViewerToolbar';
import { Skeleton } from '@/components/ui/Skeleton';
import { useSignedUrl } from '@/hooks/use-signed-url';
import { useViewerStore } from '@/stores/viewer-store';

// pdf.js is code-split: the results page renders without loading it (Spec 08 §8.9).
const PdfViewer = dynamic(() => import('@/components/viewer/PdfViewer'), {
  ssr: false,
  loading: () => <Skeleton className="m-4 h-[60vh] rounded-lg" />,
});

type FallbackReason = 'missing' | 'retention' | 'unavailable' | 'render_failed';

const NOTICES: Record<FallbackReason, string> = {
  missing: "The original PDF isn't available, so we're showing the extracted text.",
  unavailable: "The original PDF isn't available, so we're showing the extracted text.",
  retention: 'The original PDF was removed after 90 days of inactivity. The extracted text is still available.',
  render_failed: "We couldn't display this PDF. Showing the extracted text instead.",
};

/** Chooses the PDF or text view and owns the toolbar and fallback notices (Spec 08 §8.3). */
export function ContractViewer({
  contractId,
  hasFile,
  fileDeletedAt,
  originalFilename,
  contractText,
  pageCount,
}: {
  contractId: string;
  hasFile: boolean;
  fileDeletedAt: string | null;
  originalFilename: string;
  contractText: string;
  pageCount: number;
}) {
  const { targetPage, highlightText, focusNonce, currentPage, focus, setCurrentPage } = useViewerStore();
  const signed = useSignedUrl(contractId, hasFile);
  const [renderFailed, setRenderFailed] = useState(false);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [pdfPages, setPdfPages] = useState<number | null>(null);

  let reason: FallbackReason | null = null;
  if (!hasFile) reason = fileDeletedAt ? 'retention' : 'missing';
  else if (signed.isError) reason = 'unavailable';
  else if (renderFailed) reason = 'render_failed';

  const mode = reason ? 'text' : signed.data ? 'pdf' : 'loading';
  const totalPages = mode === 'pdf' && pdfPages ? pdfPages : pageCount;
  const onRenderError = useCallback(() => setRenderFailed(true), []);

  // Ctrl/Cmd +/- while the viewer has focus (Spec 08 §8.5).
  function onKeyDown(e: React.KeyboardEvent) {
    if (mode !== 'pdf' || !(e.ctrlKey || e.metaKey)) return;
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom((z) => stepZoom(z, 1));
    } else if (e.key === '-') {
      e.preventDefault();
      setZoom((z) => stepZoom(z, -1));
    }
  }

  return (
    <div
      onKeyDown={onKeyDown}
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg-surface"
    >
      <ViewerToolbar
        currentPage={Math.min(currentPage, totalPages)}
        pageCount={totalPages}
        onGoTo={(page) => focus(page)}
        zoom={mode === 'pdf' ? zoom : undefined}
        onZoom={mode === 'pdf' ? setZoom : undefined}
        downloadUrl={mode === 'pdf' || reason === 'render_failed' ? signed.data?.download_url : null}
        downloadName={originalFilename}
      />
      {reason ? (
        <p role="status" className="flex items-start gap-2 border-b border-info-border bg-info-bg px-3 py-2 text-body-sm text-info-text">
          <Info aria-hidden="true" className="mt-px size-4 shrink-0" />
          {NOTICES[reason]}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        {mode === 'loading' ? (
          <Skeleton className="m-4 h-[60vh] rounded-lg" />
        ) : mode === 'pdf' ? (
          <PdfViewer
            url={signed.data!.url}
            zoom={zoom}
            targetPage={targetPage}
            highlightText={highlightText}
            focusNonce={focusNonce}
            onPageChange={setCurrentPage}
            onNumPages={setPdfPages}
            onError={onRenderError}
          />
        ) : (
          <TextViewer
            contractText={contractText}
            targetPage={targetPage}
            highlightText={highlightText}
            focusNonce={focusNonce}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
    </div>
  );
}
