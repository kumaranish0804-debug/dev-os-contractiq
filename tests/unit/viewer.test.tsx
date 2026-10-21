import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// react-pdf double: Document reports 3 pages; Page reports its text items and renders the
// customTextRenderer output, so highlighting can be asserted in jsdom.
// ---------------------------------------------------------------------------
const PAGE_TEXT: Record<number, string[]> = {
  1: ['The parties are Acme', 'and Beta.'],
  2: ['This Agreement is governed by', 'the laws of Ohio.', 'Other text.'],
  3: ['Signatures.'],
};
const docBehaviour = { fail: false };

vi.mock('react-pdf', async () => {
  const React = await import('react');
  return {
    pdfjs: { GlobalWorkerOptions: {} },
    Document: ({ children, onLoadSuccess, onLoadError }: Record<string, never> & { children: React.ReactNode; onLoadSuccess: (d: { numPages: number }) => void; onLoadError: () => void }) => {
      React.useEffect(() => {
        if (docBehaviour.fail) onLoadError();
        else onLoadSuccess({ numPages: 3 });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="pdf-document">{children}</div>;
    },
    Page: ({ pageNumber, onGetTextSuccess, customTextRenderer }: { pageNumber: number; onGetTextSuccess?: (t: { items: { str: string }[] }) => void; customTextRenderer?: (p: { str: string; itemIndex: number }) => string }) => {
      const items = PAGE_TEXT[pageNumber]!.map((str) => ({ str }));
      React.useEffect(() => {
        onGetTextSuccess?.({ items });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      const html = items.map((it, i) => (customTextRenderer ? customTextRenderer({ str: it.str, itemIndex: i }) : it.str)).join(' ');
      return <div data-testid={`pdf-page-content-${pageNumber}`} dangerouslySetInnerHTML={{ __html: html }} />;
    },
  };
});
vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}));

// next/dynamic → the real PdfViewer module, rendered synchronously.
vi.mock('next/dynamic', async () => {
  const mod = await import('@/components/viewer/PdfViewer');
  return { default: () => mod.default };
});

const apiFetch = vi.fn();
vi.mock('@/lib/api/http', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), redirectToLogin: vi.fn() }));

import { ContractViewer } from '@/components/viewer/ContractViewer';
import PdfViewer from '@/components/viewer/PdfViewer';
import { stepZoom } from '@/components/viewer/ViewerToolbar';
import { escapeHtml, matchTextItems } from '@/lib/viewer/highlight';
import { useViewerStore } from '@/stores/viewer-store';

const TEXT = '[PAGE 1]\nThe parties are Acme and Beta.\n\n[PAGE 2]\nThis Agreement is governed by the laws of Ohio.\n\n[PAGE 3]\nSignatures.';

function renderViewer(props: Partial<React.ComponentProps<typeof ContractViewer>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContractViewer
        contractId="c-1"
        hasFile
        fileDeletedAt={null}
        originalFilename="Acme NDA.pdf"
        contractText={TEXT}
        pageCount={3}
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  docBehaviour.fail = false;
  useViewerStore.getState().reset();
});

describe('highlight helpers', () => {
  it('maps a sentence range onto overlapping text items', () => {
    const items = PAGE_TEXT[2]!.map((str) => ({ str }));
    expect([...matchTextItems(items, 'This Agreement is governed by the laws of Ohio.')]).toEqual([0, 1]);
    expect(matchTextItems(items, 'Nothing like this exists here.').size).toBe(0);
    expect(matchTextItems([], 'This Agreement is governed').size).toBe(0);
  });

  it('escapes HTML in text-layer strings', () => {
    expect(escapeHtml(`<b>"a" & 'b'</b>`)).toBe('&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;');
  });

  it('steps zoom by 25% within 50–200%, treating Fit as 100%', () => {
    expect(stepZoom('fit', 1)).toBe(1.25);
    expect(stepZoom('fit', -1)).toBe(0.75);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(1.75, 1)).toBe(2);
  });
});

describe('ContractViewer modes', () => {
  it('no stored file → text view with the "isn\'t available" notice, no signed-URL call', () => {
    renderViewer({ hasFile: false });
    expect(screen.getByRole('status')).toHaveTextContent("The original PDF isn't available");
    expect(screen.getByRole('region', { name: 'Page 1' })).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
  });

  it('removed by retention → retention notice', () => {
    renderViewer({ hasFile: false, fileDeletedAt: '2026-10-01T00:00:00Z' });
    expect(screen.getByRole('status')).toHaveTextContent('removed after 90 days of inactivity');
  });

  it('signed URL fails → text view with the unavailable notice', async () => {
    apiFetch.mockRejectedValue(new Error('FILE_NOT_AVAILABLE'));
    renderViewer();
    // useSignedUrl retries once (Spec 08 §8.4) before falling back.
    expect(await screen.findByRole('status', {}, { timeout: 4000 })).toHaveTextContent(
      "The original PDF isn't available",
    );
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Signatures.')).toBeInTheDocument();
  });

  it('PDF mode: renders pages, zoom controls and a Download link', async () => {
    apiFetch.mockResolvedValue({ url: 'https://s/view', download_url: 'https://s/dl', expires_at: 'x' });
    renderViewer();
    expect(await screen.findByTestId('pdf-document')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/contracts/c-1/file-url');
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', 'https://s/dl');
    expect(screen.getByRole('button', { name: 'Fit width' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('zoom buttons and Ctrl/Cmd +/- change the zoom', async () => {
    apiFetch.mockResolvedValue({ url: 'https://s/view', download_url: 'https://s/dl', expires_at: 'x' });
    renderViewer();
    await screen.findByTestId('pdf-document');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('pdf-document'), { key: '-', ctrlKey: true });
    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fit width' }));
    expect(screen.getByText('Fit')).toBeInTheDocument();
  });

  it('a PDF render failure falls back to text and keeps Download', async () => {
    docBehaviour.fail = true;
    apiFetch.mockResolvedValue({ url: 'https://s/view', download_url: 'https://s/dl', expires_at: 'x' });
    renderViewer();
    expect(await screen.findByRole('status')).toHaveTextContent("We couldn't display this PDF");
    expect(screen.getByRole('link', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Page 2' })).toBeInTheDocument();
  });

  it('toolbar prev/next focus neighbouring pages and arrow keys move between controls', () => {
    renderViewer({ hasFile: false });
    act(() => useViewerStore.getState().setCurrentPage(2));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(useViewerStore.getState().targetPage).toBe(3);

    const prev = screen.getByRole('button', { name: 'Previous page' });
    prev.focus();
    fireEvent.keyDown(prev, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveFocus();
  });
});

describe('PdfViewer', () => {
  const baseProps = {
    url: 'https://s/view',
    zoom: 'fit' as const,
    highlightText: null,
    onPageChange: () => {},
    onNumPages: vi.fn(),
    onError: vi.fn(),
  };

  it('renders a placeholder per page and real pages near the viewport', async () => {
    render(<PdfViewer {...baseProps} targetPage={null} focusNonce={0} />);
    await waitFor(() => expect(baseProps.onNumPages).toHaveBeenCalledWith(3));
    expect(document.getElementById('pdf-page-1')).toBeInTheDocument();
    expect(document.getElementById('pdf-page-3')).toBeInTheDocument();
    // Without IntersectionObserver only page 1 (±2) renders: pages 1–3.
    expect(screen.getByTestId('pdf-page-content-3')).toBeInTheDocument();
  });

  it('marks the source sentence on the target page', async () => {
    const { rerender } = render(<PdfViewer {...baseProps} targetPage={null} focusNonce={0} />);
    await screen.findByTestId('pdf-page-content-2');
    rerender(
      <PdfViewer
        {...baseProps}
        targetPage={2}
        highlightText="This Agreement is governed by the laws of Ohio."
        focusNonce={1}
      />,
    );
    const page2 = screen.getByTestId('pdf-page-content-2');
    await waitFor(() => expect(page2.querySelectorAll('mark.cq-mark')).toHaveLength(2));
    expect(within(page2).getByText('Other text.', { exact: false })).toBeInTheDocument();
    expect(page2.querySelector('mark')!.textContent).toBe('This Agreement is governed by');
    expect(document.getElementById('pdf-page-2')).toHaveClass('outline-brand');
  });

  it('reports load errors to the parent', async () => {
    docBehaviour.fail = true;
    const onError = vi.fn();
    render(<PdfViewer {...baseProps} onError={onError} targetPage={null} focusNonce={0} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
