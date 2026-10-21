import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractDetail, KeyTerm } from '@/lib/data/contracts';

const apiFetch = vi.fn();
const callEdge = vi.fn();
const supabase = {
  channel: () => {
    const ch = { on: () => ch, subscribe: () => ch };
    return ch;
  },
  removeChannel: vi.fn(),
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: vi.fn() }) }) }),
};

vi.mock('@/lib/api/http', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), redirectToLogin: vi.fn() }));
vi.mock('@/lib/api/edge', () => ({ callEdge: (...a: unknown[]) => callEdge(...a) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabase }));
const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => '/contracts/x',
  useSearchParams: () => new URLSearchParams(),
}));

import { ResultsView } from '@/components/contracts/ResultsView';
import { LEGAL_DISCLAIMER } from '@/components/shared/LegalDisclaimer';
import { ApiError } from '@/lib/api/api-error';
import { TextViewer } from '@/components/viewer/TextViewer';
import { ERROR_MESSAGES } from '@/lib/utils/errors';
import { useToastStore } from '@/stores/toast-store';
import { useViewerStore } from '@/stores/viewer-store';

const ID = '66666666-6666-4666-8666-666666666666';
const TEXT = '[PAGE 1]\nThe parties are Acme and Beta.\n\n[PAGE 2]\nThis Agreement is governed by the laws of Ohio.\n\n[PAGE 3]\n';

const term = (o: Partial<KeyTerm>): KeyTerm => ({
  id: 't-x',
  term_key: 'governing_law',
  term_name: 'Governing Law',
  value: 'Ohio',
  original_value: 'Ohio',
  page_number: 2,
  confidence_score: 93,
  source_sentence: 'This Agreement is governed by the laws of Ohio.',
  is_custom: false,
  is_edited: false,
  edited_at: null,
  sort_order: 5,
  ...o,
});

const TERMS: KeyTerm[] = [
  term({ id: 't-parties', term_key: 'parties', term_name: 'Parties', value: 'Acme and Beta', original_value: 'Acme and Beta', page_number: 1, confidence_score: 62, source_sentence: 'The parties are Acme and Beta.', sort_order: 0 }),
  term({ id: 't-law' }),
  term({ id: 't-jur', term_key: 'jurisdiction', term_name: 'Jurisdiction', value: 'Maybe Ohio courts', original_value: 'Maybe Ohio courts', confidence_score: 40, page_number: 2, source_sentence: 'Courts of the moon.', sort_order: 6 }),
  term({ id: 't-ns', term_key: 'non_solicitation', term_name: 'Non-Solicitation', value: null, original_value: null, page_number: null, confidence_score: 0, source_sentence: null, sort_order: 8 }),
  term({ id: 't-audit', term_key: 'custom_audit_rights', term_name: 'Audit rights', value: 'Annual audit', original_value: 'Quarterly audit', is_edited: true, is_custom: true, confidence_score: 85, page_number: 1, source_sentence: null, sort_order: 100 }),
];

function detail(overrides: Partial<ContractDetail['contract']> = {}, terms = TERMS): ContractDetail {
  return {
    contract: {
      id: ID,
      title: 'Acme NDA',
      original_filename: 'Acme NDA.pdf',
      contract_type: 'NDA',
      status: 'completed',
      error_code: null,
      error_message: null,
      page_count: 3,
      file_deleted_at: null,
      detected_type_mismatch: false,
      created_at: '2026-10-18T10:00:00Z',
      processed_at: '2026-10-18T10:00:20Z',
      review_completed_at: null,
      contract_text: TEXT,
      // Text mode keeps the viewer off the network; the PDF path is covered in viewer.test.tsx.
      has_file: false,
      ...overrides,
    },
    key_terms: terms,
    custom_terms: ['Audit rights'],
    feedback: null,
  };
}

function renderView(d: ContractDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ResultsView initial={d} />
    </QueryClientProvider>,
  );
  return client;
}

const row = (name: string) => screen.getByRole('listitem', { name });

beforeEach(() => {
  apiFetch.mockReset();
  callEdge.mockReset();
  useViewerStore.getState().reset();
  useToastStore.setState({ toasts: [] });
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('completed results', () => {
  it('shows the exact disclaimer and every term with value, page and confidence text', () => {
    renderView(detail());
    expect(screen.getByText(LEGAL_DISCLAIMER)).toBeInTheDocument();
    expect(LEGAL_DISCLAIMER).toBe(
      'This is an AI-assisted review tool, not legal advice. Always verify critical terms with a qualified lawyer.',
    );
    expect(screen.getByText('5 terms · 1 need review')).toBeInTheDocument();

    const law = row('Governing Law');
    expect(within(law).getByText('93% High')).toBeInTheDocument();
    expect(within(law).getByRole('button', { name: /go to page 2/i })).toBeInTheDocument();
    expect(within(row('Parties')).getByText('62% Medium')).toBeInTheDocument();
  });

  it('flags low confidence with visible warning text, never hiding the term', () => {
    renderView(detail());
    const jur = row('Jurisdiction');
    expect(within(jur).getByText('40% Low')).toBeInTheDocument();
    expect(within(jur).getByText(/Low confidence — we recommend verifying this/)).toBeInTheDocument();
    expect(within(row('Governing Law')).queryByText(/Low confidence/)).not.toBeInTheDocument();
  });

  it('renders not-found terms in italics with a neutral badge and no page link', () => {
    renderView(detail());
    const ns = row('Non-Solicitation');
    expect(within(ns).getByText('Not found in this document')).toHaveClass('italic');
    expect(within(ns).getByText('No confidence: not found')).toBeInTheDocument();
    expect(within(ns).queryByRole('button', { name: /Go to page/ })).not.toBeInTheDocument();
    expect(within(ns).queryByText(/Low confidence/)).not.toBeInTheDocument();
  });

  it('shows Custom and Edited badges, with the AI value in the Edited label', () => {
    renderView(detail());
    const audit = row('Audit rights');
    expect(within(audit).getByText('Custom')).toBeInTheDocument();
    expect(within(audit).getByRole('button', { name: 'Edited. AI extracted: Quarterly audit' })).toBeInTheDocument();
  });

  it('filters by needs review, edited and custom', async () => {
    const user = userEvent.setup();
    renderView(detail());
    await user.click(screen.getByRole('button', { name: 'Needs review' }));
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-labelledby'))).toEqual(['term-t-jur-name']);
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('auto-focuses the first low-confidence term in the viewer once', () => {
    renderView(detail());
    expect(useViewerStore.getState()).toMatchObject({ targetPage: 2, highlightText: 'Courts of the moon.', focusNonce: 1 });
  });

  it('page links focus the viewer, which marks the source sentence', async () => {
    const user = userEvent.setup();
    renderView(detail());
    await user.click(within(row('Governing Law')).getByRole('button', { name: /go to page 2/i }));
    expect(useViewerStore.getState().highlightText).toBe('This Agreement is governed by the laws of Ohio.');
    const page2 = screen.getByRole('region', { name: 'Page 2' });
    expect(within(page2).getByText('This Agreement is governed by the laws of Ohio.').tagName).toBe('MARK');
  });

  it('"Why?" reveals the verbatim source sentence, or explains its absence', async () => {
    const user = userEvent.setup();
    renderView(detail());
    const law = row('Governing Law');
    await user.click(within(law).getByRole('button', { name: 'Why?' }));
    expect(within(law).getByRole('button', { name: 'Why?' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(law).getByText('— Page 2')).toBeInTheDocument();

    const audit = row('Audit rights');
    await user.click(within(audit).getByRole('button', { name: 'Why?' }));
    expect(within(audit).getByText('No supporting sentence was found in the document.')).toBeInTheDocument();
  });

  it('warns when nothing at all was found', () => {
    renderView(detail({}, [term({ id: 'a', value: null, confidence_score: 0, page_number: null, source_sentence: null })]));
    expect(screen.getByText(/couldn't find the standard terms in this document/)).toBeInTheDocument();
  });
});

describe('inline edit', () => {
  it('saves on Enter optimistically and keeps the server row', async () => {
    apiFetch.mockResolvedValue({ key_term: { ...TERMS[1], value: 'Delaware', is_edited: true } });
    const user = userEvent.setup();
    const client = renderView(detail());

    await user.click(within(row('Governing Law')).getByRole('button', { name: /Edit value for Governing Law/ }));
    const box = screen.getByRole('textbox', { name: 'Edit value for Governing Law' });
    await user.clear(box);
    await user.type(box, 'Delaware{Enter}');

    expect(apiFetch).toHaveBeenCalledWith('/api/key-terms/t-law', { method: 'PATCH', body: '{"value":"Delaware"}' });
    expect(within(row('Governing Law')).getByText('Delaware')).toBeInTheDocument();
    expect(within(row('Governing Law')).getByRole('button', { name: /Edit value/ })).toHaveFocus();
    await waitFor(() =>
      expect(client.getQueryData<ContractDetail>(['contract', ID])!.key_terms[1]!.is_edited).toBe(true),
    );
  });

  it('Esc cancels without saving', async () => {
    const user = userEvent.setup();
    renderView(detail());
    await user.click(within(row('Governing Law')).getByRole('button', { name: /Edit value/ }));
    await user.type(screen.getByRole('textbox'), ' extra{Escape}');
    expect(apiFetch).not.toHaveBeenCalled();
    expect(within(row('Governing Law')).getByText('Ohio')).toBeInTheDocument();
  });

  it('rolls back and offers Retry when the save fails', async () => {
    apiFetch.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderView(detail());
    await user.click(within(row('Governing Law')).getByRole('button', { name: /Edit value/ }));
    const box = screen.getByRole('textbox');
    await user.clear(box);
    await user.type(box, 'Texas{Enter}');

    await waitFor(() => expect(within(row('Governing Law')).getByText('Ohio')).toBeInTheDocument());
    const [t] = useToastStore.getState().toasts;
    expect(t).toMatchObject({ title: "Couldn't save your edit. Retry?", action: { label: 'Retry' } });

    apiFetch.mockResolvedValue({ key_term: { ...TERMS[1], value: 'Texas', is_edited: true } });
    act(() => t!.action!.onClick());
    await waitFor(() => expect(within(row('Governing Law')).getByText('Texas')).toBeInTheDocument());
  });

  it('clearing the value saves null ("Not found")', async () => {
    apiFetch.mockResolvedValue({ key_term: { ...TERMS[1], value: null, is_edited: true } });
    const user = userEvent.setup();
    renderView(detail());
    await user.click(within(row('Governing Law')).getByRole('button', { name: /Edit value/ }));
    await user.clear(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');
    expect(apiFetch).toHaveBeenCalledWith('/api/key-terms/t-law', { method: 'PATCH', body: '{"value":null}' });
  });
});

describe('status-specific views', () => {
  it('uploaded: resume panel with the stored type pre-selected', async () => {
    callEdge.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderView(detail({ status: 'uploaded', contract_type: 'MSA' }, []));
    expect(screen.getByText(/hasn't been analysed yet/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /MSA/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Process Contract' }));
    expect(callEdge).toHaveBeenCalledWith(
      'process-contract',
      { contract_id: ID, contract_type: 'MSA', custom_terms: [] },
      expect.anything(),
    );
    expect(screen.getByText(/Analysing with AI/)).toBeInTheDocument();
  });

  it('processing: shows the stepper', () => {
    renderView(detail({ status: 'processing' }, []));
    expect(screen.getByRole('heading', { name: 'Analysing your contract' })).toBeInTheDocument();
  });

  it('error: shows the stored error and retries with the stored type and custom terms', async () => {
    callEdge.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderView(detail({ status: 'error', error_code: 'AI_TIMEOUT' }, []));
    expect(screen.getByRole('alert')).toHaveTextContent(ERROR_MESSAGES.AI_TIMEOUT);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(callEdge.mock.calls[0]![1]).toEqual({ contract_id: ID, contract_type: 'NDA', custom_terms: ['Audit rights'] });
  });
});

describe('re-running', () => {
  it('type mismatch: "Keep results" hides the banner; "Re-run as MSA" confirms first', async () => {
    callEdge.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderView(detail({ detected_type_mismatch: true }));
    expect(screen.getByText(/doesn't look like a typical NDA/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Re-run as MSA' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/including your 1 edit\./)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Re-run as MSA' }));
    expect(callEdge.mock.calls[0]![1]).toMatchObject({ contract_type: 'MSA', custom_terms: ['Audit rights'] });
  });

  it('Keep results dismisses the mismatch banner', async () => {
    const user = userEvent.setup();
    renderView(detail({ detected_type_mismatch: true }));
    await user.click(screen.getByRole('button', { name: 'Keep results' }));
    expect(screen.queryByText(/doesn't look like a typical/)).not.toBeInTheDocument();
  });

  it('overflow menu "Re-run analysis" confirms with the edit count', async () => {
    callEdge.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderView(detail());
    const trigger = screen.getByRole('button', { name: 'More actions' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Re-run analysis' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('including your 1 edit. Continue?');
    await user.click(within(dialog).getByRole('button', { name: 'Re-run analysis' }));
    expect(callEdge.mock.calls[0]![1]).toMatchObject({ contract_type: 'NDA' });
  });
});

describe('feedback widget', () => {
  it('rating reveals the comment box; submit shows thanks; Edit reopens prefilled', async () => {
    apiFetch.mockResolvedValue({ feedback: { id: 'f1', rating: 'down', comment: 'Missed the term', updated_at: 'x' } });
    const user = userEvent.setup();
    const client = renderView(detail());
    expect(screen.getByRole('heading', { name: 'Were these extracted terms accurate?' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Anything we got wrong? (optional)')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'No, not accurate' }));
    expect(screen.getByRole('button', { name: 'No, not accurate' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(screen.getByLabelText('Anything we got wrong? (optional)'), 'Missed the term');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Thanks for your feedback.')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ rating: 'down', comment: 'Missed the term', contract_id: ID }),
    });
    expect(client.getQueryData<ContractDetail>(['contract', ID])?.feedback).toEqual({ rating: 'down', comment: 'Missed the term' });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'No, not accurate' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Anything we got wrong? (optional)')).toHaveValue('Missed the term');
  });

  it('starts in the submitted state when feedback already exists', () => {
    renderView({ ...detail(), feedback: { rating: 'up', comment: null } });
    expect(screen.getByText('Thanks for your feedback.')).toBeInTheDocument();
  });

  it('allows a rating with no comment, and keeps the form with an error on failure', async () => {
    apiFetch.mockRejectedValue(new ApiError('INTERNAL'));
    const user = userEvent.setup();
    renderView(detail());
    await user.click(screen.getByRole('button', { name: 'Yes, accurate' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(apiFetch.mock.calls[0]![1]).toMatchObject({ body: JSON.stringify({ rating: 'up', comment: '', contract_id: ID }) });
    expect(await screen.findByText(ERROR_MESSAGES.INTERNAL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });
});

describe('mark review complete', () => {
  it('marks complete, then shows the disabled reviewed state', async () => {
    apiFetch.mockResolvedValue({ review_completed_at: '2026-10-21T10:00:00Z' });
    const user = userEvent.setup();
    renderView(detail());
    await user.click(screen.getByRole('button', { name: 'Mark review complete' }));
    expect(apiFetch).toHaveBeenCalledWith(`/api/contracts/${ID}/complete`, { method: 'POST' });
    const done = await screen.findByRole('button', { name: /Reviewed ✓ 21 Oct 2026/ });
    expect(done).toBeDisabled();
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Review marked complete');
  });

  it('shows the reviewed state on load and hides the button before analysis completes', () => {
    renderView(detail({ review_completed_at: '2026-10-05T10:00:00Z' }));
    expect(screen.getByRole('button', { name: /Reviewed ✓ 5 Oct 2026/ })).toBeDisabled();
    cleanup();
    renderView(detail({ status: 'error', error_code: 'AI_TIMEOUT' }));
    expect(screen.queryByRole('button', { name: 'Mark review complete' })).not.toBeInTheDocument();
  });

  it('offers Retry when marking fails', async () => {
    apiFetch.mockRejectedValue(new ApiError('INTERNAL'));
    const user = userEvent.setup();
    renderView(detail());
    await user.click(screen.getByRole('button', { name: 'Mark review complete' }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]).toMatchObject({ title: "Couldn't mark the review complete." }),
    );
    expect(screen.getByRole('button', { name: 'Mark review complete' })).toBeEnabled();
  });
});

describe('deleting from the results page', () => {
  it('confirms, deletes and returns to the dashboard', async () => {
    apiFetch.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const client = renderView(detail());
    const trigger = screen.getByRole('button', { name: 'More actions' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this contract?' });
    expect(dialog).toHaveTextContent('Acme NDA and all its extracted terms');
    await user.click(within(dialog).getByRole('button', { name: 'Delete contract' }));

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/dashboard'));
    expect(apiFetch).toHaveBeenCalledWith(`/api/contracts/${ID}`, { method: 'DELETE' });
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Contract deleted');
    expect(client.getQueryCache().find({ queryKey: ['chat', ID] })).toBeUndefined();
  });
});

describe('TextViewer', () => {
  it('renders a section per page and notes empty pages', () => {
    render(<TextViewer contractText={TEXT} targetPage={null} highlightText={null} focusNonce={0} onPageChange={() => {}} />);
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(within(screen.getByRole('region', { name: 'Page 3' })).getByText('No selectable text on this page.')).toBeInTheDocument();
  });

  it('clamps an out-of-range target to the last page', () => {
    render(
      <TextViewer contractText={TEXT} targetPage={9} highlightText={null} focusNonce={1} onPageChange={() => {}} />,
    );
    expect(document.getElementById('text-page-3')).toHaveClass('outline-brand');
  });
});
