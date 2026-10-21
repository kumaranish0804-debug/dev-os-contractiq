import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
const callEdgeRaw = vi.fn();
const router = { replace: vi.fn(), push: vi.fn() };
let searchParams = new URLSearchParams();

vi.mock('@/lib/api/http', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), redirectToLogin: vi.fn() }));
vi.mock('@/lib/api/edge', () => ({ callEdgeRaw: (...a: unknown[]) => callEdgeRaw(...a) }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/contracts/c-1',
  useSearchParams: () => searchParams,
}));

import { ChatPanel } from '@/components/chat/ChatPanel';
import { ResultsPanels } from '@/components/contracts/ResultsPanels';
import { ApiError } from '@/lib/api/api-error';
import type { ContractDetail } from '@/lib/data/contracts';
import { ERROR_MESSAGES } from '@/lib/utils/errors';
import { useToastStore } from '@/stores/toast-store';
import { useViewerStore } from '@/stores/viewer-store';

const EMPTY = { session_id: null, message_count: 0, messages: [] };

/** An SSE response whose events can be pushed one by one. */
function sseResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const res = new Response(new ReadableStream({ start: (c) => (controller = c) }));
  const push = (event: string, data: unknown) =>
    controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  return { res, push, close: () => controller.close() };
}

function renderChat(type: 'NDA' | 'MSA' = 'NDA') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChatPanel contractId="c-1" contractType={type} />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  apiFetch.mockReset();
  callEdgeRaw.mockReset();
  router.replace.mockReset();
  searchParams = new URLSearchParams();
  useToastStore.setState({ toasts: [] });
  useViewerStore.getState().reset();
});

describe('ChatPanel', () => {
  it('shows the empty state with type-specific suggestions', async () => {
    apiFetch.mockResolvedValue(EMPTY);
    renderChat('MSA');
    expect(await screen.findByRole('heading', { name: 'Ask anything about this contract' })).toBeInTheDocument();
    expect(screen.getByText(/cite the page they're based on/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is the liability cap?' })).toBeInTheDocument();
    expect(screen.getByText('AI answers can be wrong. Not legal advice.')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/contracts/c-1/chat');
  });

  it('streams an answer with citation chips that focus the viewer', async () => {
    apiFetch.mockResolvedValue(EMPTY);
    const sse = sseResponse();
    callEdgeRaw.mockResolvedValue(sse.res);
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'How long do confidentiality obligations last?' }));
    expect(callEdgeRaw).toHaveBeenCalledWith(
      'chat',
      { contract_id: 'c-1', message: 'How long do confidentiality obligations last?' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop answering' })).toBeInTheDocument();

    await act(async () => {
      sse.push('meta', { user_message_id: 'u-1', session_id: 's-1', query_type: 'contract' });
      sse.push('delta', { text: 'Based on the document, three years ' });
      sse.push('delta', { text: '[Page 2].' });
      sse.push('done', { message_id: 'a-1', cited_pages: [2] });
      sse.close();
    });

    const answer = await screen.findByText(/Based on the document, three years/);
    const bubble = answer.closest('li')!;
    const chips = within(bubble).getAllByRole('button', { name: 'Go to page 2' });
    expect(chips).toHaveLength(2); // inline chip + "Sources:" chip
    await user.click(chips[0]!);
    expect(useViewerStore.getState()).toMatchObject({ targetPage: 2, revealNonce: 1 });
    expect(screen.getByRole('textbox')).not.toBeDisabled();
  });

  it('warns when a factual answer cites no page, but not for the not-found reply', async () => {
    apiFetch.mockResolvedValue({
      session_id: 's',
      message_count: 4,
      messages: [
        { id: '1', role: 'user', content: 'Q1', cited_pages: [], status: 'complete', created_at: '2026-10-18T10:00:00Z' },
        { id: '2', role: 'assistant', content: 'Based on the document, yes.', cited_pages: [], status: 'complete', created_at: '2026-10-18T10:00:01Z' },
        { id: '3', role: 'user', content: 'Q2', cited_pages: [], status: 'complete', created_at: '2026-10-18T10:01:00Z' },
        { id: '4', role: 'assistant', content: 'I cannot find this in the document.', cited_pages: [], status: 'complete', created_at: '2026-10-18T10:01:01Z' },
      ],
    });
    renderChat();
    expect(await screen.findAllByText('No page cited — verify this in the document.')).toHaveLength(1);
  });

  it('attributes each answer to its source: label + Conversation chips; conversation answers need no page', async () => {
    const msg = (id: string, role: 'user' | 'assistant', content: string, query_type: string | null, cited_pages: number[] = []) => ({
      id, role, content, cited_pages, status: 'complete', query_type, created_at: '2026-10-18T10:00:00Z',
    });
    apiFetch.mockResolvedValue({
      session_id: 's',
      message_count: 6,
      messages: [
        msg('1', 'user', 'How long is the term?', 'contract'),
        msg('2', 'assistant', 'Based on the document, two years [Page 2].', 'contract', [2]),
        msg('3', 'user', 'What did you say earlier?', 'history'),
        msg('4', 'assistant', 'I said the term is two years [Page 2]. [From conversation]', 'history', [2]),
        msg('5', 'user', 'Earlier you mentioned renewal — what does the contract say?', 'both'),
        msg('6', 'assistant', 'You asked about renewal [From conversation].', 'both'),
      ],
    });
    renderChat();
    await screen.findByText(/Based on the document, two years/);

    const bubble = (text: RegExp) => screen.getByText(text).closest('li')!;
    expect(within(bubble(/Based on the document, two years/)).getByText('From the contract')).toBeInTheDocument();
    const history = bubble(/I said the term is two years/);
    expect(within(history).getByText('From our conversation')).toBeInTheDocument();
    expect(within(history).getByText('Conversation')).toHaveAttribute('title', 'From earlier in this conversation');
    expect(within(history).queryByText(/\[From conversation\]/)).not.toBeInTheDocument();
    expect(within(bubble(/You asked about renewal/)).getByText('Contract + conversation')).toBeInTheDocument();

    // The BOTH answer is sourced from the conversation only, so no "no page cited" warning anywhere.
    expect(screen.queryByText('No page cited — verify this in the document.')).not.toBeInTheDocument();
    // User bubbles carry no source label.
    expect(within(screen.getByText('How long is the term?').closest('li')!).queryByText('From the contract')).not.toBeInTheDocument();
  });

  it('labels a streamed answer as soon as the meta event classifies the question', async () => {
    apiFetch.mockResolvedValue(EMPTY);
    const sse = sseResponse();
    callEdgeRaw.mockResolvedValue(sse.res);
    const user = userEvent.setup();
    renderChat();
    await user.type(await screen.findByRole('textbox'), 'What did you say earlier?{Enter}');
    await act(async () => {
      sse.push('meta', { user_message_id: 'u-1', session_id: 's-1', query_type: 'history' });
      sse.push('delta', { text: 'You asked about the term. [From conversation]' });
    });
    expect(await screen.findByText('From our conversation')).toBeInTheDocument();
    await act(async () => {
      sse.push('done', { message_id: 'a-1', cited_pages: [] });
      sse.close();
    });
    expect(screen.queryByText('No page cited — verify this in the document.')).not.toBeInTheDocument();
  });

  it('renders only safe markdown: no links or raw HTML', async () => {
    apiFetch.mockResolvedValue({
      session_id: 's',
      message_count: 2,
      messages: [
        { id: '1', role: 'user', content: 'Q', cited_pages: [], status: 'complete', created_at: 'x' },
        { id: '2', role: 'assistant', content: '**Bold** [click](https://evil.example) <img src=x onerror=alert(1)> [Page 1]', cited_pages: [1], status: 'complete', created_at: 'x' },
      ],
    });
    renderChat();
    const bold = await screen.findByText('Bold');
    expect(bold.tagName).toBe('STRONG');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('click')).toBeInTheDocument();
  });

  it('shows a streamed error with Retry, which asks the same question again', async () => {
    apiFetch.mockResolvedValue(EMPTY);
    const first = sseResponse();
    const second = sseResponse();
    callEdgeRaw.mockResolvedValueOnce(first.res).mockResolvedValueOnce(second.res);
    const user = userEvent.setup();
    renderChat();

    await user.type(await screen.findByRole('textbox'), 'What is the term?{Enter}');
    await act(async () => {
      first.push('meta', { user_message_id: 'u-1' });
      first.push('delta', { text: 'Based on' });
      first.push('error', { code: 'AI_UNAVAILABLE' });
      first.close();
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_MESSAGES.AI_UNAVAILABLE);
    expect(screen.getByText('What is the term?')).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(callEdgeRaw.mock.calls[1]![1]).toEqual({ contract_id: 'c-1', message: 'What is the term?' });
    await act(async () => {
      second.push('delta', { text: 'Based on the document, two years [Page 1].' });
      second.push('done', { message_id: 'a-2', cited_pages: [1] });
      second.close();
    });
    expect(await screen.findByText(/two years/)).toBeInTheDocument();
    expect(screen.getAllByText('What is the term?')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Stop aborts the stream and keeps the partial answer marked Stopped', async () => {
    apiFetch.mockResolvedValue(EMPTY);
    const sse = sseResponse();
    callEdgeRaw.mockImplementation((_n, _b, { signal }: { signal: AbortSignal }) => {
      signal.addEventListener('abort', () => sse.res.body?.cancel().catch(() => {}));
      return Promise.resolve(sse.res);
    });
    const user = userEvent.setup();
    renderChat();
    await user.type(await screen.findByRole('textbox'), 'Q{Enter}');
    await act(async () => sse.push('delta', { text: 'Based on the doc' }));

    await user.click(screen.getByRole('button', { name: 'Stop answering' }));
    expect(await screen.findByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Based on the doc')).toBeInTheDocument();
  });

  it('a deleted contract (404) toasts and returns to the dashboard', async () => {
    apiFetch.mockResolvedValue(EMPTY);
    callEdgeRaw.mockRejectedValue(new ApiError('NOT_FOUND'));
    const user = userEvent.setup();
    renderChat();
    await user.type(await screen.findByRole('textbox'), 'Q{Enter}');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'));
    expect(useToastStore.getState().toasts[0]).toMatchObject({ title: 'This contract no longer exists.' });
  });

  it('replaces the input at the message cap', async () => {
    apiFetch.mockResolvedValue({ session_id: 's', message_count: 198, messages: [] });
    renderChat();
    expect(await screen.findByText('This conversation has reached its limit.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Enter sends, Shift+Enter adds a newline, blank input cannot be sent', async () => {
    apiFetch.mockResolvedValue(EMPTY);
    callEdgeRaw.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderChat();
    const box = await screen.findByRole('textbox');
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
    await user.type(box, '   {Enter}');
    expect(callEdgeRaw).not.toHaveBeenCalled();
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(box).toHaveValue('   line one\nline two');
    await user.keyboard('{Enter}');
    expect(callEdgeRaw.mock.calls[0]![1].message).toBe('line one\nline two');
  });
});

describe('ResultsPanels tabs', () => {
  const detail = {
    contract: {
      id: 'c-1',
      title: 'Acme',
      original_filename: 'a.pdf',
      contract_type: 'NDA',
      status: 'completed',
      error_code: null,
      error_message: null,
      page_count: 1,
      file_deleted_at: null,
      detected_type_mismatch: false,
      created_at: 'x',
      processed_at: 'x',
      review_completed_at: null,
      contract_text: '[PAGE 1]\nHello world.',
      has_file: false,
    },
    key_terms: [],
    custom_terms: [],
    feedback: null,
  } as unknown as ContractDetail;

  const renderPanels = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ResultsPanels detail={detail} />
      </QueryClientProvider>,
    );

  it('defaults to Key Terms and writes the tab to the URL', async () => {
    apiFetch.mockResolvedValue(EMPTY);
    const user = userEvent.setup();
    renderPanels();
    expect(screen.getByRole('tab', { name: 'Key Terms' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(router.replace).toHaveBeenCalledWith('/contracts/c-1?tab=chat', { scroll: false });
  });

  it('opens the Chat tab from ?tab=chat', async () => {
    searchParams = new URLSearchParams('tab=chat');
    apiFetch.mockResolvedValue(EMPTY);
    renderPanels();
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Ask anything about this contract' })).toBeInTheDocument();
  });

  it('on mobile, a user page link switches to the Document tab; auto-focus does not', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    window.matchMedia = matchMedia;
    renderPanels();

    act(() => useViewerStore.getState().focus(1, null, { reveal: false }));
    expect(router.replace).not.toHaveBeenCalled();
    act(() => useViewerStore.getState().focus(1));
    expect(router.replace).toHaveBeenCalledWith('/contracts/c-1?tab=document', { scroll: false });
    vi.unstubAllGlobals();
  });
});
