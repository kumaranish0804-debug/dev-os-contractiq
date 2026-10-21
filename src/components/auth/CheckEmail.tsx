'use client';

import { MailCheck } from 'lucide-react';
import { ResendEmailButton } from '@/components/auth/ResendEmailButton';
import type { createClient } from '@/lib/supabase/client';

// Shown after a successful sign-up (Spec 04 §4.4). Supabase also returns this "success" for an
// existing unconfirmed email (enumeration protection), so the copy stays neutral.
export function CheckEmail({
  email,
  supabase,
}: {
  email: string;
  supabase: ReturnType<typeof createClient>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <MailCheck aria-hidden="true" className="size-8 text-brand" />
      <p className="text-body-lg text-text-primary">
        We sent a verification link to <strong className="font-semibold">{email}</strong>. Click it
        to finish creating your account.
      </p>
      <p className="text-body-sm text-text-secondary">
        Didn&apos;t get it? Check your spam folder, or send it again.
      </p>
      <ResendEmailButton email={email} supabase={supabase} />
    </div>
  );
}
