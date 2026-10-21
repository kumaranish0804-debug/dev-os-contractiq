import Link from 'next/link';
import { buttonClasses, type ButtonSize, type ButtonVariant } from '@/components/ui/button-styles';

// Server-safe link styled as a button (no event handlers — hover via CSS only).
export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)}>
      {children}
    </Link>
  );
}
