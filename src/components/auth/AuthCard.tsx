import Link from 'next/link';

// Centered auth container (Spec 04 §4.2).
export function AuthCard({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-surface px-4 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-6 rounded-lg border border-border bg-bg-primary p-8">
        <Link href="/" className="text-h5 text-text-primary">
          ContractIQ
        </Link>
        <h1 className="text-h5 text-text-primary">{title}</h1>
        {children}
        {footer ? <div className="text-body-sm text-text-secondary">{footer}</div> : null}
      </div>
    </main>
  );
}
