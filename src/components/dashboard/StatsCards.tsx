import type { DashboardStats } from '@/lib/data/contracts';

function StatCard({ label, value, subtext }: { label: string; value: number; subtext?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-primary p-6">
      <dt className="text-body-sm text-text-secondary">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="text-h3 text-text-primary">{value}</span>
        {subtext ? <span className="text-body-sm text-text-secondary">{subtext}</span> : null}
      </dd>
    </div>
  );
}

// Total reviewed / NDAs / MSAs (Spec 10 §10.2). "Total reviewed" counts completed contracts.
export function StatsCards({ stats }: { stats: DashboardStats }) {
  const reviewed = stats.by_status.completed;
  return (
    <dl className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <StatCard
        label="Total reviewed"
        value={reviewed}
        subtext={stats.total !== reviewed ? `${stats.total} uploaded` : undefined}
      />
      <StatCard label="NDAs" value={stats.by_type.NDA} />
      <StatCard label="MSAs" value={stats.by_type.MSA} />
    </dl>
  );
}
