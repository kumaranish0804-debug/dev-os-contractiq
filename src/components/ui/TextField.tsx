import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils/cn';

export type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  /** Validation message; also marks the input invalid (Spec 04 §4.10). */
  error?: React.ReactNode;
  hint?: React.ReactNode;
  /** Rendered inside the input on the right, e.g. a show-password toggle. */
  endAdornment?: React.ReactNode;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, endAdornment, className, ...props },
  ref,
) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-body-lg text-text-primary">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-10 w-full rounded-md border bg-bg-primary px-3 text-body-lg text-text-primary',
            'transition-colors duration-fast ease-out placeholder:text-text-secondary',
            // Design focus state: 2px Blue 500 = 1px border + 1px ring.
            'hover:border-border-strong focus-visible:border-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
            'disabled:cursor-not-allowed disabled:bg-bg-surface disabled:text-text-secondary',
            error ? 'border-error-text hover:border-error-text' : 'border-border',
            endAdornment ? 'pr-12' : undefined,
          )}
          {...props}
        />
        {endAdornment ? (
          <div className="absolute inset-y-0 right-1 flex items-center">{endAdornment}</div>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="text-body-sm text-text-secondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-body-sm text-error-text">
          {error}
        </p>
      ) : null}
    </div>
  );
});
