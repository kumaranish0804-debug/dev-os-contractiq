import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { XhrResult } from '@/lib/api/xhr';

const xhrPost = vi.fn();
const auth = { getSession: vi.fn(), refreshSession: vi.fn() };

vi.mock('@/lib/env', () => ({
  publicEnv: { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' },
  functionsUrl: 'https://project.supabase.co/functions/v1',
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }));
vi.mock('@/lib/api/xhr', () => ({ xhrPost: (...args: unknown[]) => xhrPost(...args) }));
vi.mock('@/lib/api/http', () => ({ redirectToLogin: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { ReviewWizard } from '@/components/contracts/ReviewWizard';
import { validatePdfFile, formatBytes } from '@/lib/validation/upload';
import { useReviewSessionStore } from '@/stores/review-session-store';
import { useToastStore } from '@/stores/toast-store';
import { ERROR_MESSAGES } from '@/lib/utils/errors';

const pdf = (name = 'Acme NDA.pdf', size = 2048) =>
  new File([new Uint8Array(size)], name, { type: 'application/pdf' });

const created = (overrides: Partial<Record<string, unknown>> = {}): XhrResult => ({
  status: 201,
  body: { contract_id: 'c-1', page_count: 3, word_count: 900, token_count: 1200, file_stored: true, ...overrides },
});

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

beforeEach(() => {
  xhrPost.mockReset();
  auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 't1' } } });
  auth.refreshSession.mockReset();
  useReviewSessionStore.getState().reset();
  useToastStore.setState({ toasts: [] });
});

describe('validatePdfFile', () => {
  it.each([
    [pdf(), null],
    [new File(['x'], 'contract.PDF', { type: '' }), null],
    [new File(['x'], 'notes.docx', { type: 'application/msword' }), 'UNSUPPORTED_FILE_TYPE'],
    [pdf('big.pdf', 10_485_761), 'FILE_TOO_LARGE'],
    [pdf('empty.pdf', 0), 'INVALID_PDF'],
  ])('%#', (file, expected) => {
    expect(validatePdfFile(file)).toBe(expected);
  });

  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});

describe('ReviewWizard', () => {
  it('keeps the dropzone disabled until a type is chosen', async () => {
    const user = userEvent.setup();
    render(<ReviewWizard />);
    const dropzone = screen.getByLabelText('Upload a PDF contract');
    expect(dropzone).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Choose a contract type first.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /NDA/ }));
    expect(screen.getByLabelText('Upload a PDF contract')).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('Choose a contract type first.')).not.toBeInTheDocument();
  });

  it('uploads with progress, then shows the file summary', async () => {
    let progress: ((f: number) => void) | undefined;
    let finish: ((r: XhrResult) => void) | undefined;
    xhrPost.mockImplementation((_url, _form, options) => {
      progress = options.onUploadProgress;
      return new Promise((resolve) => (finish = resolve));
    });
    const user = userEvent.setup();
    render(<ReviewWizard />);
    await user.click(screen.getByRole('radio', { name: /MSA/ }));
    await user.upload(fileInput(), pdf('Northwind MSA.pdf'));

    await waitFor(() => expect(xhrPost).toHaveBeenCalled());
    const [url, form, options] = xhrPost.mock.calls[0]!;
    expect(url).toBe('https://project.supabase.co/functions/v1/upload-contract');
    expect((form as FormData).get('contract_type')).toBe('MSA');
    expect(options.headers).toEqual({ authorization: 'Bearer t1', apikey: 'anon-key' });

    act(() => progress!(0.42));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('Uploading… 42%')).toBeInTheDocument();
    act(() => progress!(1));
    expect(screen.getByText('Extracting text…')).toBeInTheDocument();

    await act(async () => finish!(created()));
    expect(await screen.findByText('Northwind MSA.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Uploaded · 3 pages · 2 KB/)).toBeInTheDocument();
    expect(useReviewSessionStore.getState().upload).toEqual({
      kind: 'uploaded',
      contractId: 'c-1',
      pageCount: 3,
      fileStored: true,
    });
  });

  it('rejects a non-PDF client-side without any network call', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ReviewWizard />);
    await user.click(screen.getByRole('radio', { name: /NDA/ }));
    await user.upload(fileInput(), new File(['x'], 'notes.docx', { type: 'application/msword' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.UNSUPPORTED_FILE_TYPE);
    expect(xhrPost).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(screen.getByLabelText('Upload a PDF contract')).toBeInTheDocument();
  });

  it('shows the server error message for a scanned PDF', async () => {
    xhrPost.mockResolvedValue({ status: 422, body: { error: { code: 'SCANNED_PDF', requestId: 'r' } } });
    const user = userEvent.setup();
    render(<ReviewWizard />);
    await user.click(screen.getByRole('radio', { name: /NDA/ }));
    await user.upload(fileInput(), pdf());

    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.SCANNED_PDF);
  });

  it('maps unreadable error bodies to INTERNAL', async () => {
    xhrPost.mockResolvedValue({ status: 502, body: null });
    const user = userEvent.setup();
    render(<ReviewWizard />);
    await user.click(screen.getByRole('radio', { name: /NDA/ }));
    await user.upload(fileInput(), pdf());

    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.INTERNAL);
  });

  it('refreshes the session and retries once on 401', async () => {
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: 't2' } }, error: null });
    xhrPost.mockResolvedValueOnce({ status: 401, body: null }).mockResolvedValueOnce(created());
    const user = userEvent.setup();
    render(<ReviewWizard />);
    await user.click(screen.getByRole('radio', { name: /NDA/ }));
    await user.upload(fileInput(), pdf());

    expect(await screen.findByText('Acme NDA.pdf')).toBeInTheDocument();
    expect(xhrPost).toHaveBeenCalledTimes(2);
    expect(xhrPost.mock.calls[1]![2].headers.authorization).toBe('Bearer t2');
  });

  it('toasts when the PDF could not be stored', async () => {
    xhrPost.mockResolvedValue(created({ file_stored: false }));
    const user = userEvent.setup();
    render(<ReviewWizard />);
    await user.click(screen.getByRole('radio', { name: /NDA/ }));
    await user.upload(fileInput(), pdf());

    await screen.findByText('Acme NDA.pdf');
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ title: "We couldn't store the original PDF" }),
    ]);
  });

  it('Remove clears the file but keeps the type', async () => {
    xhrPost.mockResolvedValue(created());
    const user = userEvent.setup();
    render(<ReviewWizard />);
    await user.click(screen.getByRole('radio', { name: /MSA/ }));
    await user.upload(fileInput(), pdf());

    await user.click(await screen.findByRole('button', { name: 'Remove Acme NDA.pdf' }));
    expect(screen.getByLabelText('Upload a PDF contract')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /MSA/ })).toBeChecked();
    expect(useReviewSessionStore.getState().file).toBeNull();
  });

  it('aborts an in-flight upload on unmount and resets the store', async () => {
    let signal: AbortSignal | undefined;
    xhrPost.mockImplementation((_u, _f, options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const user = userEvent.setup();
    const { unmount } = render(<ReviewWizard />);
    await user.click(screen.getByRole('radio', { name: /NDA/ }));
    await user.upload(fileInput(), pdf());
    await waitFor(() => expect(signal).toBeDefined());

    unmount();
    expect(signal!.aborted).toBe(true);
    expect(useReviewSessionStore.getState().contractType).toBeNull();
  });
});
