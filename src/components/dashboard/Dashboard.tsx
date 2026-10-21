'use client';

import { ContractsTable } from '@/components/dashboard/ContractsTable';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { RecentContracts } from '@/components/dashboard/RecentContracts';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { LinkButton } from '@/components/ui/LinkButton';
import { useDashboardSummary } from '@/hooks/use-dashboard';
import type { ListSort } from '@/lib/validation/contract-list';

/**
 * Dashboard body (Spec 10 §10.2). Data arrives hydrated from the server render; deleting the last
 * contract brings the empty state back without a reload.
 */
export function Dashboard({ initialSort }: { initialSort: ListSort }) {
  const { data: summary } = useDashboardSummary();
  // Hydrated by the page, so data is always present here; a later refetch error keeps it.
  if (!summary) return null;
  const isEmpty = summary.total === 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-h5 text-text-primary">Your contracts</h1>
        {isEmpty ? null : <LinkButton href="/contracts/new">Review a Contract</LinkButton>}
      </div>
      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <StatsCards stats={summary} />
          <RecentContracts items={summary.recent} />
          <ContractsTable initialSort={initialSort} />
        </>
      )}
    </>
  );
}
