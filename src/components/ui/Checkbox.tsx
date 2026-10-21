import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils/cn';

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & {
  label: React.ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, ...props },
  ref,
) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="mt-1 size-4 shrink-0 cursor-pointer rounded-sm border-border-strong accent-brand"
        {...props}
      />
      <label htmlFor={id} className="cursor-pointer text-body-sm text-text-secondary">
        {label}
      </label>
    </div>
  );
});
