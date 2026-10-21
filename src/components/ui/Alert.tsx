import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

type AlertVariant = 'error' | 'warning' | 'success' | 'info';

const styles: Record<AlertVariant, { box: string; Icon: typeof Info }> = {
  error: { box: 'border-error-border bg-error-bg text-error-text', Icon: AlertCircle },
  warning: { box: 'border-warning-border bg-warning-bg text-warning-text', Icon: AlertTriangle },
  success: { box: 'border-success-border bg-success-bg text-success-text', Icon: CheckCircle2 },
  info: { box: 'border-info-border bg-info-bg text-info-text', Icon: Info },
};

// Inline status message. Errors are announced immediately (role="alert"); others politely.
export function Alert({
  variant = 'info',
  className,
  children,
}: {
  variant?: AlertVariant;
  className?: string;
  children: React.ReactNode;
}) {
  const { box, Icon } = styles[variant];
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-body-sm', box, className)}
    >
      <Icon aria-hidden="true" className="mt-px size-4 shrink-0" />
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
