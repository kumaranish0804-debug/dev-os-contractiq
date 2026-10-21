import Link from 'next/link';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Badge } from '@/components/ui/Badge';
import type { ContractListItem } from '@/lib/data/contracts';
import { formatRelative, formatTimestamp } from '@/lib/utils/dates';

// The 5 newest contracts as compact cards (Spec 10 §10.2).
export function RecentContracts({ items }: { items: ContractListItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-4">
      <h2 id="recent-title" className="text-body-lg font-medium text-text-primary">
        Recent
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((c) => (
          <li key={c.id} className="min-w-0">
            <Link
              href={`/contracts/${c.id}`}
              className="flex h-full flex-col gap-3 rounded-lg border border-border bg-bg-primary p-4 transition-colors duration-fast ease-out hover:border-border-strong hover:bg-bg-subtle"
            >
              <span className="truncate text-body-lg font-medium text-text-primary" title={c.title}>
                {c.title}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant="info">{c.contract_type}</Badge>
                <StatusBadge status={c.status} reviewCompletedAt={c.review_completed_at} />
              </span>
              <time
                dateTime={c.created_at}
                title={formatTimestamp(c.created_at)}
                suppressHydrationWarning
                className="text-body-sm text-text-secondary"
              >
                {formatRelative(c.created_at)}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
