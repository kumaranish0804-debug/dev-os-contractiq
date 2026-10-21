import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';

// Full-panel failure with a retry action (engineering doc §11 `shared/ErrorState`).
export function ErrorState({
  title,
  message,
  retryLabel = 'Try again',
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <section
      role="alert"
      className="flex flex-col items-center gap-4 rounded-lg border border-error-border bg-bg-primary px-4 py-16 text-center"
    >
      <AlertCircle aria-hidden="true" className="size-8 text-error-text" />
      <div className="flex flex-col gap-2">
        <h2 className="text-h5 text-text-primary">{title}</h2>
        <p className="text-body-lg text-text-secondary">{message}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {onRetry ? <Button onClick={onRetry}>{retryLabel}</Button> : null}
        <LinkButton href="/dashboard" variant="ghost">
          Back to dashboard
        </LinkButton>
      </div>
    </section>
  );
}
