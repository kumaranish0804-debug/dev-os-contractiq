'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { DeleteContractDialog } from '@/components/shared/DeleteContractDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { useContractsList } from '@/hooks/use-dashboard';
import type { ContractListItem } from '@/lib/data/contracts';
import { formatDate, formatTimestamp } from '@/lib/utils/dates';
import { cn } from '@/lib/utils/cn';
import { defaultDir, sortSearch, type ListSort, type SortColumn } from '@/lib/validation/contract-list';

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: 'title', label: 'Name' },
  { key: 'contract_type', label: 'Type' },
  { key: 'created_at', label: 'Uploaded' },
  { key: 'status', label: 'Status' },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'created_at:desc', label: 'Newest first' },
  { value: 'created_at:asc', label: 'Oldest first' },
  { value: 'title:asc', label: 'Name (A–Z)' },
  { value: 'title:desc', label: 'Name (Z–A)' },
  { value: 'contract_type:asc', label: 'Type' },
  { value: 'status:asc', label: 'Status' },
];

const menuItemClass =
  'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-body-lg text-text-primary outline-none transition-colors duration-fast ease-out data-[highlighted]:bg-bg-subtle';

function RowMenu({ contract, onDelete }: { contract: ContractListItem; onDelete: () => void }) {
  const router = useRouter();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Actions for ${contract.title}`}
        className="inline-flex size-8 items-center justify-center rounded-md text-text-secondary transition-colors duration-fast ease-out hover:bg-bg-subtle hover:text-text-primary"
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 flex min-w-40 flex-col rounded-lg border border-border bg-bg-primary p-1"
        >
          <DropdownMenu.Item className={menuItemClass} onSelect={() => router.push(`/contracts/${contract.id}`)}>
            <ExternalLink aria-hidden="true" className="size-4" />
            Open
          </DropdownMenu.Item>
          <DropdownMenu.Item className={cn(menuItemClass, 'text-error-text')} onSelect={onDelete}>
            <Trash2 aria-hidden="true" className="size-4" />
            Delete…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Clicks on the row's own controls (link, menu, menu items rendered through the portal) are theirs. */
function isOwnControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest('a, button, [role="menuitem"], [role="menu"]') !== null;
}

function UploadedDate({ iso }: { iso: string }) {
  return (
    <Tooltip content={<span suppressHydrationWarning>{formatTimestamp(iso)}</span>}>
      <time dateTime={iso} tabIndex={-1} suppressHydrationWarning>
        {formatDate(iso)}
      </time>
    </Tooltip>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: ListSort['dir'] }) {
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return <Icon aria-hidden="true" className={cn('size-4', !active && 'opacity-40')} />;
}

/**
 * All contracts (Spec 10 §10.4): sortable table at ≥768px, stacked cards below. The sort is kept
 * in the URL (`?sort=title&dir=asc`) without a server round trip; React Query fetches the rows.
 */
export function ContractsTable({ initialSort }: { initialSort: ListSort }) {
  const router = useRouter();
  const [sort, setSortState] = useState<ListSort>(initialSort);
  const [deleting, setDeleting] = useState<ContractListItem | null>(null);
  const list = useContractsList(sort);

  function setSort(next: ListSort) {
    setSortState(next);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${sortSearch(next)}`);
  }

  function toggleSort(column: SortColumn) {
    setSort(
      sort.sort === column
        ? { sort: column, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { sort: column, dir: defaultDir(column) },
    );
  }

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages.at(-1)?.total ?? 0;
  const open = (id: string) => router.push(`/contracts/${id}`);

  let body: React.ReactNode;
  if (list.isPending) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Loading contracts…</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (list.isError && items.length === 0) {
    body = (
      <div role="alert" className="flex flex-col items-center gap-4 rounded-lg border border-error-border bg-bg-primary px-4 py-10 text-center">
        <AlertCircle aria-hidden="true" className="size-6 text-error-text" />
        <p className="text-body-lg text-text-secondary">We couldn&apos;t load your contracts.</p>
        <Button variant="secondary" onClick={() => void list.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else {
    body = (
      <div aria-busy={list.isPlaceholderData || undefined} className={cn('flex flex-col gap-4', list.isPlaceholderData && 'opacity-60')}>
        {/* ≥768px: table */}
        <div className="hidden overflow-x-auto rounded-lg border border-border bg-bg-primary md:block">
          <table className="w-full border-collapse text-left">
            <thead className="bg-bg-subtle">
              <tr>
                {COLUMNS.map((col) => {
                  const active = sort.sort === col.key;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="px-4 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className="inline-flex items-center gap-1 rounded-sm text-body-sm font-medium text-text-secondary transition-colors duration-fast ease-out hover:text-text-primary"
                      >
                        {col.label}
                        <SortIcon active={active} dir={sort.dir} />
                      </button>
                    </th>
                  );
                })}
                <th scope="col" className="w-12 px-4 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  onClick={(e) => {
                    if (isOwnControl(e.target) || window.getSelection()?.toString()) return;
                    open(c.id);
                  }}
                  className="cursor-pointer border-t border-border transition-colors duration-fast ease-out hover:bg-bg-subtle"
                >
                  <td className="max-w-0 px-4 py-3">
                    <Link
                      href={`/contracts/${c.id}`}
                      className="block truncate rounded-sm text-body-lg font-medium text-text-primary hover:underline"
                      title={c.title}
                    >
                      {c.title}
                    </Link>
                  </td>
                  <td className="w-24 px-4 py-3">
                    <Badge variant="info">{c.contract_type}</Badge>
                  </td>
                  <td className="w-36 whitespace-nowrap px-4 py-3 text-body-lg text-text-secondary">
                    <UploadedDate iso={c.created_at} />
                  </td>
                  <td className="w-40 px-4 py-3">
                    <StatusBadge status={c.status} reviewCompletedAt={c.review_completed_at} />
                  </td>
                  <td className="w-12 px-4 py-3 text-right">
                    <RowMenu contract={c} onDelete={() => setDeleting(c)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* <768px: stacked cards */}
        <ul className="flex flex-col gap-2 md:hidden">
          {items.map((c) => (
            <li key={c.id} className="flex items-start gap-2 rounded-lg border border-border bg-bg-primary p-4">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Link
                  href={`/contracts/${c.id}`}
                  className="truncate rounded-sm text-body-lg font-medium text-text-primary hover:underline"
                >
                  {c.title}
                </Link>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="info">{c.contract_type}</Badge>
                  <StatusBadge status={c.status} reviewCompletedAt={c.review_completed_at} />
                </span>
                <time dateTime={c.created_at} suppressHydrationWarning className="text-body-sm text-text-secondary">
                  {formatDate(c.created_at)}
                </time>
              </div>
              <RowMenu contract={c} onDelete={() => setDeleting(c)} />
            </li>
          ))}
        </ul>

        {list.isFetchNextPageError ? (
          <div role="alert" className="flex flex-wrap items-center justify-center gap-2 text-body-sm text-error-text">
            <AlertCircle aria-hidden="true" className="size-4" />
            Couldn&apos;t load more contracts.
          </div>
        ) : null}
        {list.hasNextPage ? (
          <Button
            variant="secondary"
            className="self-center"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchNextPageError ? 'Try again' : 'Load more'}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-labelledby="all-contracts-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="all-contracts-title" className="text-body-lg font-medium text-text-primary">
          All contracts
          {list.data ? <span className="ml-2 font-normal text-text-secondary">({total})</span> : null}
        </h2>
        <label className="flex items-center gap-2 text-body-sm text-text-secondary md:hidden">
          Sort by
          <select
            value={`${sort.sort}:${sort.dir}`}
            onChange={(e) => {
              const [column, dir] = e.target.value.split(':') as [SortColumn, ListSort['dir']];
              setSort({ sort: column, dir });
            }}
            className="h-10 rounded-md border border-border bg-bg-primary px-3 text-body-lg text-text-primary hover:border-border-strong focus-visible:border-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
          >
            {SORT_OPTIONS.some((o) => o.value === `${sort.sort}:${sort.dir}`) ? null : (
              <option value={`${sort.sort}:${sort.dir}`}>
                {COLUMNS.find((c) => c.key === sort.sort)?.label} ({sort.dir === 'asc' ? 'ascending' : 'descending'})
              </option>
            )}
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {body}
      <DeleteContractDialog contract={deleting} onOpenChange={(isOpen) => !isOpen && setDeleting(null)} />
    </section>
  );
}
