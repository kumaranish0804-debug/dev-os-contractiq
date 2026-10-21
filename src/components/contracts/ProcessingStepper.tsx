import { AlertCircle, CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils/cn';
import { ERROR_MESSAGES } from '@/lib/utils/errors';
import type { ProcessingState } from '@/stores/review-session-store';

type StepStatus = 'done' | 'active' | 'pending' | 'error';

const STEPS = ['Extracting text', 'Analysing with AI', 'Compiling results'] as const;

function statusFor(index: number, state: Exclude<ProcessingState, { kind: 'idle' }>): StepStatus {
  if (index === 0) return 'done';
  if (state.kind === 'error') return index === 1 ? 'error' : 'pending';
  const active = state.step - 1;
  if (index < active) return 'done';
  return index === active ? 'active' : 'pending';
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <CheckCircle2 aria-hidden="true" className="size-4 text-success-text" />;
  if (status === 'active') return <Spinner className="text-brand" />;
  if (status === 'error') return <AlertCircle aria-hidden="true" className="size-4 text-error-text" />;
  return <Circle aria-hidden="true" className="size-4 text-text-secondary" />;
}

const statusLabel: Record<StepStatus, string> = {
  done: 'done',
  active: 'in progress',
  pending: 'not started',
  error: 'failed',
};

// Three-step progress for process-contract (Spec 06 §6.4).
export function ProcessingStepper({
  state,
  onRetry,
}: {
  state: Exclude<ProcessingState, { kind: 'idle' }>;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="processing-title"
      className="flex flex-col gap-4 rounded-lg border border-border bg-bg-primary p-6"
    >
      <h2 id="processing-title" className="text-body-lg text-text-primary">
        Analysing your contract
      </h2>
      <ol aria-live="polite" className="flex flex-col gap-3">
        {STEPS.map((label, i) => {
          const status = statusFor(i, state);
          return (
            <li
              key={label}
              aria-current={status === 'active' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 text-body-lg',
                status === 'pending' ? 'text-text-secondary' : 'text-text-primary',
                status === 'error' && 'text-error-text',
              )}
            >
              <StepIcon status={status} />
              <span>
                {i + 1}. {label}
                <span className="sr-only"> — {statusLabel[status]}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {state.kind === 'error' ? (
        <div className="flex flex-col items-start gap-4" role="alert">
          <p className="text-body-sm text-error-text">{ERROR_MESSAGES[state.code]}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onRetry}>Try again</Button>
            <LinkButton href="/dashboard" variant="ghost">
              Back to dashboard
            </LinkButton>
          </div>
        </div>
      ) : (
        <p className="text-body-sm text-text-secondary">This usually takes under 30 seconds.</p>
      )}
    </section>
  );
}
