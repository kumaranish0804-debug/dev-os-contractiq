import type { Metadata } from 'next';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { getDashboardSummary, listContracts } from '@/lib/data/contracts';
import { contractsListKey, dashboardStatsKey } from '@/lib/query-keys';
import { createClient } from '@/lib/supabase/server';
import { PAGE_SIZE, parseListSort } from '@/lib/validation/contract-list';

export const metadata: Metadata = { title: 'Your contracts — ContractIQ' };
export const dynamic = 'force-dynamic';

/**
 * Spec 10 §10.2. Loads the summary and the first page for the URL's sort, then hands both to
 * React Query, which keeps them current (delete, processing refetch) on the client. A failed query
 * throws to the error boundary (retry there).
 */
export default async function DashboardPage({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = createClient();
  const sort = parseListSort({ get: (name) => (typeof searchParams[name] === 'string' ? searchParams[name] : null) });

  const queryClient = new QueryClient();
  const summary = await queryClient.fetchQuery({
    queryKey: dashboardStatsKey,
    queryFn: () => getDashboardSummary(supabase),
  });
  if (summary.total > 0) {
    await queryClient.fetchInfiniteQuery({
      queryKey: contractsListKey(sort),
      queryFn: () => listContracts(supabase, { ...sort, limit: PAGE_SIZE, offset: 0 }),
      initialPageParam: 0,
    });
  }

  return (
    <main className="flex flex-col gap-10 px-4 py-8 lg:px-28 lg:py-24">
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Dashboard initialSort={sort} />
      </HydrationBoundary>
    </main>
  );
}
