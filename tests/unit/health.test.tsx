import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcResult = vi.fn();
const abortSignal = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (fn: string) => ({
      abortSignal: (signal: AbortSignal) => (abortSignal(fn, signal), rpcResult()),
    }),
  }),
}));
vi.mock('@/lib/env', () => ({
  publicEnv: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-anon-key-anon' },
}));

import { GET } from '@/app/api/health/route';
import { HealthBanner, OUTAGE_MESSAGE } from '@/components/shared/HealthBanner';

describe('GET /api/health', () => {
  beforeEach(() => {
    rpcResult.mockReset();
    abortSignal.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('200 ok when health_check answers, never cached, with a 3 s timeout', async () => {
    rpcResult.mockResolvedValue({ data: true, error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    expect(abortSignal.mock.calls[0]![0]).toBe('health_check');
    expect(abortSignal.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it('503 degraded on a DB error, a timeout or an unreachable host — with no detail', async () => {
    for (const outcome of [
      () => rpcResult.mockResolvedValue({ data: null, error: { message: 'relation secret' } }),
      () => rpcResult.mockRejectedValue(new DOMException('timed out', 'TimeoutError')),
      () => rpcResult.mockRejectedValue(new TypeError('fetch failed')),
    ]) {
      outcome();
      const res = await GET();
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ status: 'degraded', db: 'down' });
    }
  });
});

describe('HealthBanner', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const ok = () => Promise.resolve(new Response('{}', { status: 200 }));
  const down = () => Promise.resolve(new Response('{}', { status: 503 }));
  const flush = () => act(async () => {});
  const tick = () => act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));

  it('shows the outage banner only after two failed checks in a row, and hides on recovery', async () => {
    fetchMock.mockImplementationOnce(down).mockImplementationOnce(ok).mockImplementationOnce(down).mockImplementationOnce(down).mockImplementation(ok);
    render(<HealthBanner manualNotice="" />);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', { cache: 'no-store' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // 1 failure

    await tick(); // ok → reset
    await tick(); // failure 1
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await tick(); // failure 2
    expect(screen.getByRole('alert')).toHaveTextContent(OUTAGE_MESSAGE);

    await tick(); // healthy again
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats network errors as failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    render(<HealthBanner manualNotice="" />);
    await flush();
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent(OUTAGE_MESSAGE);
  });

  it('pauses polling while the tab is hidden and re-checks when it returns', async () => {
    fetchMock.mockImplementation(ok);
    render(<HealthBanner manualNotice="" />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await tick();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it('shows a manual incident notice regardless of health', async () => {
    fetchMock.mockImplementation(ok);
    render(<HealthBanner manualNotice="Scheduled maintenance at 18:00 UTC." />);
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Scheduled maintenance at 18:00 UTC.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders nothing when healthy and there is no notice', async () => {
    fetchMock.mockImplementation(ok);
    const { container } = render(<HealthBanner manualNotice="" />);
    await flush();
    expect(container).toBeEmptyDOMElement();
  });
});
