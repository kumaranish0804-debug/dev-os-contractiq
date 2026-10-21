import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserMenu } from '@/components/auth/UserMenu';
import { HealthBanner } from '@/components/shared/HealthBanner';
import { createClient } from '@/lib/supabase/server';

// Authenticated app shell. Middleware already guards these routes; this is defence in depth (Spec 04 §4.9).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col bg-bg-surface">
      <header className="flex items-center justify-between border-b border-border bg-bg-primary px-4 py-4 lg:px-28">
        <Link href="/dashboard" className="text-h5 text-text-primary">
          ContractIQ
        </Link>
        <UserMenu email={user.email ?? ''} />
      </header>
      <HealthBanner />
      {children}
    </div>
  );
}
