import { FileText } from 'lucide-react';
import { LinkButton } from '@/components/ui/LinkButton';

// First-run dashboard (Spec 10 §10.2, PRD Flow 1 step 4).
export function EmptyState() {
  return (
    <section
      aria-labelledby="empty-state-title"
      className="flex flex-col items-center gap-6 rounded-lg border border-border bg-bg-primary px-4 py-24 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-brand-subtle">
        <FileText aria-hidden="true" className="size-6 text-brand" />
      </div>
      <div className="flex flex-col gap-2">
        <h2 id="empty-state-title" className="text-h5 text-text-primary">
          No contracts reviewed yet
        </h2>
        <p className="text-body-lg text-text-secondary">Upload your first contract to begin</p>
      </div>
      <LinkButton href="/contracts/new" size="lg">
        Review a Contract
      </LinkButton>
    </section>
  );
}
