import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/AuthCard';
import { LoginForm } from '@/components/auth/LoginForm';
import { Alert } from '@/components/ui/Alert';
import { safeNext } from '@/lib/auth/safe-next';

export const metadata: Metadata = { title: 'Sign in — ContractIQ' };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string | string[]; error?: string | string[] };
}) {
  const next = safeNext(first(searchParams.next));
  const linkInvalid = first(searchParams.error) === 'link_invalid';

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          New to ContractIQ?{' '}
          <Link href="/signup" className="text-brand underline">
            Create an account
          </Link>
        </>
      }
    >
      {linkInvalid ? (
        <Alert variant="warning">
          That link is invalid or has expired. Sign in, or request a new verification email.
        </Alert>
      ) : null}
      <LoginForm next={next} />
    </AuthCard>
  );
}
