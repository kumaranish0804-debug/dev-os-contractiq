import { cn } from '@/lib/utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-bg-primary hover:bg-brand-hover',
  secondary: 'border border-border-strong bg-bg-primary text-text-primary hover:bg-bg-subtle',
  ghost: 'text-text-primary hover:bg-bg-subtle',
};

const sizes: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-body-lg',
  lg: 'h-12 px-6 text-body-lg',
};

// Shared by Button and LinkButton so both render identically.
export function buttonClasses(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-fast ease-out',
    'disabled:cursor-not-allowed disabled:opacity-60',
    variants[variant],
    sizes[size],
    className,
  );
}
