'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { CheckEmail } from '@/components/auth/CheckEmail';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { createClient } from '@/lib/supabase/client';

// Switches between the sign-up form and the "check your inbox" state (Spec 04 §4.4).
export function SignUpCard() {
  const [supabase] = useState(() => createClient());
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo) {
    return (
      <AuthCard title="Check your inbox">
        <CheckEmail email={sentTo} supabase={supabase} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-brand underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm supabase={supabase} onSuccess={setSentTo} />
    </AuthCard>
  );
}
