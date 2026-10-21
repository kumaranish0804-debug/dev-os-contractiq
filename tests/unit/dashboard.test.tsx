import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const range = vi.fn();
const listCalls: { select?: unknown[]; order: unknown[][]; range?: unknown[] } = { order: [] };
const fromContracts = () => {
  const chain = {
    select: (...a: unknown[]) => ((listCalls.select = a), chain),
    order: (...a: unknown[]) => (listCalls.order.push(a), chain),
    range: (...a: unknown[]) => ((listCalls.range = a), range(...a)),
  };
  return chain;
};
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc, from: fromContracts }) }));

const apiFetch = vi.fn();
vi.mock('@/lib/api/http', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), redirectToLogin: vi.fn() }));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

import DashboardPage from '@/app/(app)/dashboard/page';
import { ContractsTable } from '@/components/dashboard/ContractsTable';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { statusLabel } from '@/components/dashboard/StatusBadge';
import { ApiError } from '@/lib/api/api-error';
import {
  getDashboardStats,
  listContracts,
  type ContractListItem,
  type DashboardStats,
} from '@/lib/data/contracts';
import type { createClient } from '@/lib/supabase/server';
import { formatDate, formatRelative } from '@/lib/utils/dates';
import { DEFAULT_SORT, listQuerySchema, parseListSort, sortSearch } from '@/lib/validation/contract-list';
import { useToastStore } from '@/stores/toast-store';

const EMPTY: DashboardStats = {
  total: 0,
  by_type: { NDA: 0, MSA: 0 },
  by_status: { uploaded: 0, processing: 0, completed: 0, error: 0 },
};
const SOME: DashboardStats = {
  total: 4,
  by_type: { NDA: 3, MSA: 1 },
  by_status: { uploaded: 0, processing: 1, completed: 3, error: 0 },
};

const item = (n: number, o: Partial<ContractListItem> = {}): ContractListItem => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  title: `Contract ${n}`,
  contract_type: 'NDA',
  status: 'completed',
  page_count: 3,
  created_at: '2026-10-03T14:05:00.000Z',
  processed_at: '2026-10-03T14:06:00.000Z',
  review_completed_at: null,
  ...o,
});

const client = () => ({ rpc, from: fromContracts }) as unknown as ReturnType<typeof createClient>;

// Same staleTime as the app's provider, so hydrated server data isn't refetched on mount.
function withQueryClient(
  ui: React.ReactElement,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } }),
) {
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  rpc.mockReset();
  range.mockReset();
  apiFetch.mockReset();
  push.mockReset();
  listCalls.order = [];
  listCalls.select = undefined;
  listCalls.range = undefined;
  useToastStore.setState({ toasts: [] });
  window.history.replaceState(null, '', '/dashboard');
});

describe('getDashboardStats', () => {
  it('returns validated stats', async () => {
    rpc.mockResolvedValue({ data: SOME, error: null });
    await expect(getDashboardStats(client())).resolves.toEqual(SOME);
    expect(rpc).toHaveBeenCalledWith('get_dashboard_stats');
  });

  it('throws on a database error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(getDashboardStats(client())).rejects.toThrow(/permission denied/);
  });

  it('rejects an unexpected shape instead of rendering bad numbers', async () => {
    rpc.mockResolvedValue({ data: { total: '4' }, error: null });
    await expect(getDashboardStats(client())).rejects.toThrow();
  });
});

describe('listContracts', () => {
  it('sorts with an id tiebreak, pages by offset and never selects contract_text', async () => {
    range.mockResolvedValue({ data: [item(1)], error: null, count: 26 });
    const page = await listContracts(client(), { sort: 'title', dir: 'asc', limit: 25, offset: 25 });
    expect(page).toEqual({ items: [item(1)], total: 26 });
    expect(listCalls.order).toEqual([['title', { ascending: true }], ['id']]);
    expect(listCalls.range).toEqual([25, 49]);
    expect(listCalls.select?.[1]).toEqual({ count: 'exact' });
    expect(String(listCalls.select?.[0])).not.toContain('contract_text');
  });

  it('throws on a database error', async () => {
    range.mockResolvedValue({ data: null, error: { message: 'boom' }, count: null });
    await expect(listContracts(client(), { ...DEFAULT_SORT, limit: 25, offset: 0 })).rejects.toThrow(/boom/);
  });
});

describe('list query rules', () => {
  it('applies defaults and rejects bad values', () => {
    expect(listQuerySchema.parse({})).toEqual({ sort: 'created_at', dir: 'desc', limit: 25, offset: 0 });
    expect(listQuerySchema.parse({ sort: 'status', dir: 'asc', limit: '100', offset: '50' })).toEqual({
      sort: 'status',
      dir: 'asc',
      limit: 100,
      offset: 50,
    });
    for (const bad of [{ sort: 'contract_text' }, { dir: 'up' }, { limit: '0' }, { limit: '101' }, { offset: '-1' }, { limit: '2.5' }, { extra: '1' }]) {
      expect(listQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('reads the page URL leniently and writes only non-default sorts', () => {
    const params = (q: string) => new URLSearchParams(q);
    expect(parseListSort(params('sort=title&dir=asc'))).toEqual({ sort: 'title', dir: 'asc' });
    expect(parseListSort(params('sort=title'))).toEqual({ sort: 'title', dir: 'asc' });
    expect(parseListSort(params('sort=created_at'))).toEqual({ sort: 'created_at', dir: 'desc' });
    expect(parseListSort(params('sort=drop table&dir=asc'))).toEqual(DEFAULT_SORT);
    expect(sortSearch(DEFAULT_SORT)).toBe('');
    expect(sortSearch({ sort: 'title', dir: 'asc' })).toBe('?sort=title&dir=asc');
  });
});

describe('dates and status labels', () => {
  it('formats d MMM yyyy and relative times', () => {
    expect(formatDate(new Date(2026, 9, 3, 14, 5).toISOString())).toBe('3 Oct 2026');
    const now = Date.parse('2026-10-21T12:00:00Z');
    expect(formatRelative('2026-10-21T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-10-21T11:55:00Z', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-10-21T09:00:00Z', now)).toBe('3 hours ago');
    expect(formatRelative('2026-10-20T12:00:00Z', now)).toBe('yesterday');
    expect(formatRelative('2026-08-01T12:00:00Z', now)).toBe(formatDate('2026-08-01T12:00:00Z'));
  });

  it('maps statuses per spec', () => {
    expect(statusLabel('uploaded', null)).toBe('Not processed');
    expect(statusLabel('processing', null)).toBe('Processing');
    expect(statusLabel('completed', null)).toBe('Ready');
    expect(statusLabel('completed', '2026-10-04T00:00:00Z')).toBe('Reviewed');
    expect(statusLabel('error', null)).toBe('Failed');
  });
});

describe('EmptyState', () => {
  it('shows the spec copy and links to the review wizard', () => {
    render(<EmptyState />);
    expect(screen.getByRole('heading', { name: 'No contracts reviewed yet' })).toBeInTheDocument();
    expect(screen.getByText('Upload your first contract to begin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review a Contract' })).toHaveAttribute('href', '/contracts/new');
  });
});

describe('StatsCards', () => {
  const card = (label: string) => screen.getByText(label).closest('div')!;

  it('counts completed contracts as reviewed and notes the uploaded total', () => {
    render(<StatsCards stats={SOME} />);
    expect(within(card('Total reviewed')).getByText('3')).toBeInTheDocument();
    expect(within(card('Total reviewed')).getByText('4 uploaded')).toBeInTheDocument();
    expect(within(card('NDAs')).getByText('3')).toBeInTheDocument();
    expect(within(card('MSAs')).getByText('1')).toBeInTheDocument();
  });

  it('omits the uploaded note when everything is reviewed', () => {
    render(<StatsCards stats={{ ...SOME, total: 3, by_status: { ...SOME.by_status, processing: 0 } }} />);
    expect(screen.queryByText(/uploaded/)).not.toBeInTheDocument();
  });
});

describe('DashboardPage', () => {
  const STATS_3: DashboardStats = {
    total: 3,
    by_type: { NDA: 2, MSA: 1 },
    by_status: { uploaded: 0, processing: 0, completed: 3, error: 0 },
  };
  const THREE = [item(3, { title: 'Gamma MSA', contract_type: 'MSA' }), item(2, { title: 'Beta NDA' }), item(1, { title: 'Alpha NDA' })];

  it('shows only the empty state for a new user and skips the list query', async () => {
    rpc.mockResolvedValue({ data: EMPTY, error: null });
    range.mockResolvedValue({ data: [], error: null, count: 0 });
    withQueryClient(await DashboardPage({}));
    expect(screen.getByRole('heading', { name: 'Your contracts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No contracts reviewed yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Review a Contract' })).toHaveLength(1);
    expect(screen.queryByText('Total reviewed')).not.toBeInTheDocument();
    expect(range).toHaveBeenCalledTimes(1); // only "recent"
  });

  it('shows stats, recent (newest first) and the table once contracts exist', async () => {
    rpc.mockResolvedValue({ data: STATS_3, error: null });
    range.mockResolvedValue({ data: THREE, error: null, count: 3 });
    withQueryClient(await DashboardPage({}));
    expect(screen.getByText('Total reviewed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review a Contract' })).toBeInTheDocument();
    const recent = within(screen.getByRole('region', { name: 'Recent' })).getAllByRole('link');
    expect(recent.map((a) => a.textContent)).toEqual([
      expect.stringContaining('Gamma MSA'),
      expect.stringContaining('Beta NDA'),
      expect.stringContaining('Alpha NDA'),
    ]);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByRole('link', { name: 'Alpha NDA' })).toHaveAttribute('href', `/contracts/${item(1).id}`);
    expect(apiFetch).not.toHaveBeenCalled(); // hydrated, not refetched
  });

  it('loads the first page in the sort from the URL', async () => {
    rpc.mockResolvedValue({ data: STATS_3, error: null });
    range.mockResolvedValue({ data: THREE, error: null, count: 3 });
    withQueryClient(await DashboardPage({ searchParams: { sort: 'title', dir: 'asc' } }));
    expect(listCalls.order).toContainEqual(['title', { ascending: true }]);
    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  it('lets a failed query reach the error boundary', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    range.mockResolvedValue({ data: [], error: null, count: 0 });
    await expect(DashboardPage({})).rejects.toThrow(/timeout/);
  });
});

describe('ContractsTable', () => {
  const page = (items: ContractListItem[], total = items.length) => ({ items, total });

  function seed(queryClient: QueryClient, sort: string, dir: string, items: ContractListItem[], total = items.length) {
    queryClient.setQueryData(['contracts', sort, dir], { pages: [page(items, total)], pageParams: [0] });
  }

  it('sorts from header clicks, mirrors the sort in the URL and fetches the new order', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    seed(queryClient, 'created_at', 'desc', [item(2, { title: 'Beta' }), item(1, { title: 'Alpha' })]);
    apiFetch.mockResolvedValue(page([item(1, { title: 'Alpha' }), item(2, { title: 'Beta' })]));
    withQueryClient(<ContractsTable initialSort={DEFAULT_SORT} />, queryClient);

    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(window.location.search).toBe('?sort=title&dir=asc');
    expect(apiFetch).toHaveBeenCalledWith('/api/contracts?sort=title&dir=asc&limit=25&offset=0');
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'ascending'),
    );
    await waitFor(() => {
      const names = within(screen.getByRole('table')).getAllByRole('link').map((a) => a.textContent);
      expect(names).toEqual(['Alpha', 'Beta']);
    });

    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(window.location.search).toBe('?sort=title&dir=desc');

    await user.click(screen.getByRole('button', { name: 'Uploaded' }));
    expect(window.location.search).toBe(''); // back to the default
  });

  it('loads 25 more and stops at the total', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const first = Array.from({ length: 25 }, (_, i) => item(i + 1));
    seed(queryClient, 'created_at', 'desc', first, 27);
    apiFetch.mockResolvedValue(page([item(26), item(27)], 27));
    withQueryClient(<ContractsTable initialSort={DEFAULT_SORT} />, queryClient);

    expect(screen.getByText('(27)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(apiFetch).toHaveBeenCalledWith('/api/contracts?sort=created_at&dir=desc&limit=25&offset=25');
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(28));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('keeps loaded rows and offers a retry when loading more fails', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    seed(queryClient, 'created_at', 'desc', Array.from({ length: 25 }, (_, i) => item(i + 1)), 30);
    apiFetch.mockRejectedValue(new ApiError('INTERNAL'));
    withQueryClient(<ContractsTable initialSort={DEFAULT_SORT} />, queryClient);

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText(/Couldn.t load more contracts/)).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(26);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a retryable error when the first page fails', async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValueOnce(new ApiError('INTERNAL')).mockResolvedValue(page([item(1)]));
    withQueryClient(<ContractsTable initialSort={{ sort: 'status', dir: 'asc' }} />);
    expect(await screen.findByText(/couldn.t load your contracts/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('opens a contract from a row click but not from its menu', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    seed(queryClient, 'created_at', 'desc', [item(1, { title: 'Alpha' })]);
    withQueryClient(<ContractsTable initialSort={DEFAULT_SORT} />, queryClient);

    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByText('NDA'));
    expect(push).toHaveBeenCalledWith(`/contracts/${item(1).id}`);

    push.mockClear();
    await user.click(within(row).getByRole('button', { name: 'Actions for Alpha' }));
    expect(push).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('menuitem', { name: 'Open' }));
    expect(push).toHaveBeenCalledWith(`/contracts/${item(1).id}`);
  });

  it('shows status badges, including processing and reviewed', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    seed(queryClient, 'created_at', 'desc', [
      item(1, { status: 'processing' }),
      item(2, { status: 'completed', review_completed_at: '2026-10-04T00:00:00Z' }),
      item(3, { status: 'error' }),
      item(4, { status: 'uploaded' }),
    ]);
    withQueryClient(<ContractsTable initialSort={DEFAULT_SORT} />, queryClient);
    const table = screen.getByRole('table');
    for (const label of ['Processing', 'Reviewed', 'Failed', 'Not processed']) {
      expect(within(table).getByText(label)).toBeInTheDocument();
    }
  });

  it('deletes after confirmation: Cancel is focused, the row goes, a toast confirms', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    seed(queryClient, 'created_at', 'desc', [item(1, { title: 'Alpha' }), item(2, { title: 'Beta' })]);
    queryClient.setQueryData(['contract', item(1).id], { stale: true });
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.resolve(undefined) : Promise.resolve(page([item(2, { title: 'Beta' })])),
    );
    withQueryClient(<ContractsTable initialSort={DEFAULT_SORT} />, queryClient);

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Actions for Alpha' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this contract?' });
    expect(dialog).toHaveTextContent(
      "Alpha and all its extracted terms, edits, chat history and feedback will be permanently deleted. This can't be undone.",
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Delete contract' }));
    expect(apiFetch).toHaveBeenCalledWith(`/api/contracts/${item(1).id}`, { method: 'DELETE' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(within(screen.getByRole('table')).queryByText('Alpha')).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Contract deleted');
    expect(queryClient.getQueryData(['contract', item(1).id])).toBeUndefined();
  });

  it('keeps the dialog open with the error when the delete fails', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    seed(queryClient, 'created_at', 'desc', [item(1, { title: 'Alpha' })]);
    apiFetch.mockRejectedValue(new ApiError('INTERNAL'));
    withQueryClient(<ContractsTable initialSort={DEFAULT_SORT} />, queryClient);

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Actions for Alpha' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete contract' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Something went wrong/);
    // The modal hides the page from the accessibility tree while open.
    expect(within(screen.getByRole('table', { hidden: true })).getByText('Alpha')).toBeInTheDocument();
  });

  it('treats an already-deleted contract (404) as deleted', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    seed(queryClient, 'created_at', 'desc', [item(1, { title: 'Alpha' })]);
    apiFetch.mockImplementation((_p: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.reject(new ApiError('NOT_FOUND')) : Promise.resolve(page([])),
    );
    withQueryClient(<ContractsTable initialSort={DEFAULT_SORT} />, queryClient);

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Actions for Alpha' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete contract' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('offers a Sort by select for small screens', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    seed(queryClient, 'created_at', 'desc', [item(1)]);
    apiFetch.mockResolvedValue(page([item(1)]));
    withQueryClient(<ContractsTable initialSort={DEFAULT_SORT} />, queryClient);
    await user.selectOptions(screen.getByLabelText('Sort by'), 'title:desc');
    expect(window.location.search).toBe('?sort=title&dir=desc');
  });
});

describe('Dashboard after deleting the last contract', () => {
  it('returns to the empty state once the stats refetch', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({
      data: { total: 1, by_type: { NDA: 1, MSA: 0 }, by_status: { uploaded: 0, processing: 0, completed: 1, error: 0 } },
      error: null,
    });
    range.mockResolvedValue({ data: [item(1, { title: 'Alpha' })], error: null, count: 1 });
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Promise.resolve(undefined);
      if (path === '/api/dashboard/stats') return Promise.resolve({ ...EMPTY, recent: [] });
      return Promise.resolve(page([]));
    });
    withQueryClient(await DashboardPage({}));

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Actions for Alpha' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    await act(async () => {
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete contract' }));
    });
    expect(await screen.findByRole('heading', { name: 'No contracts reviewed yet' })).toBeInTheDocument();
  });

  function page(items: ContractListItem[]) {
    return { items, total: items.length };
  }
});
