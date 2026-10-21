import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callEdge = vi.fn();
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
let realtimeHandler: ((payload: { new: unknown }) => void) | null = null;
const maybeSingle = vi.fn();
const supabase = {
  auth: { getSession: vi.fn(), refreshSession: vi.fn() },
  channel: vi.fn(() => {
    const ch = {
      on: (_e: string, _f: unknown, handler: typeof realtimeHandler) => {
        realtimeHandler = handler;
        return ch;
      },
      subscribe: () => ch,
    };
    return ch;
  }),
  removeChannel: vi.fn(),
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
};

vi.mock('@/lib/env', () => ({
  publicEnv: { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' },
  functionsUrl: 'https://project.supabase.co/functions/v1',
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabase }));
vi.mock('@/lib/api/edge', () => ({ callEdge: (...args: unknown[]) => callEdge(...args) }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { ReviewWizard } from '@/components/contracts/ReviewWizard';
import { ApiError } from '@/lib/api/api-error';
import { ERROR_MESSAGES } from '@/lib/utils/errors';
import { useReviewSessionStore } from '@/stores/review-session-store';

const CONTRACT_ID = '33333333-3333-4333-8333-333333333333';

function seedUploaded(type: 'NDA' | 'MSA' = 'NDA') {
  const store = useReviewSessionStore.getState();
  store.setContractType(type);
  store.setFile(new File([new Uint8Array(10)], 'Acme NDA.pdf', { type: 'application/pdf' }));
  store.setUpload({ kind: 'uploaded', contractId: CONTRACT_ID, pageCount: 3, fileStored: true });
}

beforeEach(() => {
  callEdge.mockReset();
  maybeSingle.mockReset();
  Object.values(router).forEach((fn) => fn.mockReset());
  supabase.removeChannel.mockReset();
  realtimeHandler = null;
  useReviewSessionStore.getState().reset();
});
afterEach(() => vi.useRealTimers());

describe('custom terms (store rules)', () => {
  beforeEach(() => useReviewSessionStore.getState().setContractType('NDA'));
  const add = (name: string) => useReviewSessionStore.getState().addCustomTerm(name);

  it('validates length, characters, duplicates and the limit of 5', () => {
    expect(add('a')).toEqual({ ok: false, reason: 'Use 2–60 characters' });
    expect(add('x'.repeat(61))).toEqual({ ok: false, reason: 'Use 2–60 characters' });
    expect(add('---')).toEqual({ ok: false, reason: 'Include at least one letter or number' });
    expect(add(' Governing law ')).toEqual({ ok: false, reason: 'That term is already in the list' });
    expect(add('  Audit rights ')).toEqual({ ok: true });
    expect(add('AUDIT RIGHTS')).toEqual({ ok: false, reason: 'That term is already in the list' });
    for (const n of [2, 3, 4, 5]) expect(add(`Term ${n}`)).toEqual({ ok: true });
    expect(add('Term 6')).toEqual({ ok: false, reason: 'Maximum 5 custom terms' });
    expect(useReviewSessionStore.getState().customTerms[0]).toBe('Audit rights');
  });
});

describe('TermPreviewCard in the wizard', () => {
  it('shows the standard terms as soon as a type is chosen', async () => {
    const user = userEvent.setup();
    render(<ReviewWizard />);
    expect(screen.queryByText("What we'll look for")).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /MSA/ }));
    expect(screen.getByRole('heading', { name: "What we'll look for" })).toBeInTheDocument();
    expect(screen.getByText('12 standard terms for MSA contracts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is Liability Cap?' })).toBeInTheDocument();
  });

  it('adds with Enter, cancels with Escape, removes, and enforces the limit', async () => {
    const user = userEvent.setup();
    useReviewSessionStore.getState().setContractType('NDA');
    render(<ReviewWizard />);

    await user.click(screen.getByRole('button', { name: 'Add Key Term' }));
    await user.keyboard('Audit rights{Enter}');
    expect(screen.getByText('Audit rights')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Key Term' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Add Key Term' }));
    await user.keyboard('Parties{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('That term is already in the list');
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Custom term')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Audit rights' }));
    expect(screen.queryByText('Audit rights')).not.toBeInTheDocument();

    act(() => {
      for (const n of [1, 2, 3, 4, 5]) useReviewSessionStore.getState().addCustomTerm(`Term ${n}`);
    });
    expect(screen.getByRole('button', { name: 'Add Key Term' })).toBeDisabled();
    expect(screen.getByText('Maximum 5 custom terms')).toBeInTheDocument();
  });
});

describe('Process Contract', () => {
  it('is disabled until the upload finishes', () => {
    useReviewSessionStore.getState().setContractType('NDA');
    useReviewSessionStore.getState().setUpload({ kind: 'uploading', progress: 10 });
    render(<ReviewWizard />);
    expect(screen.getByRole('button', { name: 'Waiting for upload…' })).toBeDisabled();
  });

  it('sends type and custom terms, shows the stepper, then opens the results', async () => {
    let resolve!: (v: unknown) => void;
    callEdge.mockReturnValue(new Promise((r) => (resolve = r)));
    seedUploaded('MSA');
    useReviewSessionStore.getState().addCustomTerm('Data location');
    const user = userEvent.setup();
    render(<ReviewWizard />);

    await user.click(screen.getByRole('button', { name: 'Process Contract' }));
    expect(callEdge).toHaveBeenCalledWith(
      'process-contract',
      { contract_id: CONTRACT_ID, contract_type: 'MSA', custom_terms: ['Data location'] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText(/Analysing with AI/).closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button', { name: 'Add Key Term' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /MSA/ })).toBeDisabled();

    await act(async () => resolve({ status: 'completed', key_terms: [] }));
    expect(router.push).toHaveBeenCalledWith(`/contracts/${CONTRACT_ID}`);
    expect(supabase.removeChannel).toHaveBeenCalled();
    expect(useReviewSessionStore.getState().contractType).toBeNull();
  });

  it('moves to "Compiling results" after 15 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    callEdge.mockReturnValue(new Promise(() => {}));
    seedUploaded();
    render(<ReviewWizard />);
    act(() => screen.getByRole('button', { name: 'Process Contract' }).click());
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByText(/Compiling results/).closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('shows the error with Try again, which re-sends the same request', async () => {
    callEdge
      .mockRejectedValueOnce(new ApiError('AI_UNAVAILABLE'))
      .mockResolvedValueOnce({ status: 'completed' });
    seedUploaded();
    const user = userEvent.setup();
    render(<ReviewWizard />);

    await user.click(screen.getByRole('button', { name: 'Process Contract' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.AI_UNAVAILABLE);
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/contracts/${CONTRACT_ID}`));
    expect(callEdge.mock.calls[1]![1]).toEqual(callEdge.mock.calls[0]![1]);
  });

  it('treats a dropped connection as success when Realtime reports completed', async () => {
    callEdge.mockRejectedValue(new ApiError('INTERNAL', { status: 0 }));
    seedUploaded();
    const user = userEvent.setup();
    render(<ReviewWizard />);
    await user.click(screen.getByRole('button', { name: 'Process Contract' }));

    await waitFor(() => expect(realtimeHandler).not.toBeNull());
    act(() => realtimeHandler!({ new: { status: 'completed', error_code: null } }));
    expect(router.push).toHaveBeenCalledWith(`/contracts/${CONTRACT_ID}`);
  });

  it('reports a server-side failure delivered over Realtime', async () => {
    callEdge.mockReturnValue(new Promise(() => {}));
    seedUploaded();
    const user = userEvent.setup();
    render(<ReviewWizard />);
    await user.click(screen.getByRole('button', { name: 'Process Contract' }));

    act(() => realtimeHandler!({ new: { status: 'error', error_code: 'AI_TIMEOUT' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.AI_TIMEOUT);
  });

  it('after 75 s without a response, polls the contract status', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    callEdge.mockReturnValue(new Promise(() => {}));
    maybeSingle
      .mockResolvedValueOnce({ data: { status: 'processing', error_code: null } })
      .mockResolvedValueOnce({ data: { status: 'completed', error_code: null } });
    seedUploaded();
    render(<ReviewWizard />);
    act(() => screen.getByRole('button', { name: 'Process Contract' }).click());

    await act(async () => vi.advanceTimersByTime(75_000));
    expect(callEdge.mock.calls[0]![2].signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(router.push).toHaveBeenCalledWith(`/contracts/${CONTRACT_ID}`);
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('gives up polling after 60 s with AI_TIMEOUT', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    callEdge.mockReturnValue(new Promise(() => {}));
    maybeSingle.mockResolvedValue({ data: { status: 'processing', error_code: null } });
    seedUploaded();
    render(<ReviewWizard />);
    act(() => screen.getByRole('button', { name: 'Process Contract' }).click());

    await act(async () => vi.advanceTimersByTime(75_000 + 63_000));
    expect(screen.getByRole('alert')).toHaveTextContent(ERROR_MESSAGES.AI_TIMEOUT);
  });
});
