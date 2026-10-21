import { cn } from '@/lib/utils/cn';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error';

// Design system "Semantic Status Badge": tint 50, border 200, text 700, 4px radius.
const variants: Record<BadgeVariant, string> = {
  neutral: 'border-border bg-bg-subtle text-text-secondary',
  info: 'border-info-border bg-info-bg text-info-text',
  success: 'border-success-border bg-success-bg text-success-text',
  warning: 'border-warning-border bg-warning-bg text-warning-text',
  error: 'border-error-border bg-error-bg text-error-text',
};

export function Badge({
  variant = 'neutral',
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-body-sm font-medium',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
