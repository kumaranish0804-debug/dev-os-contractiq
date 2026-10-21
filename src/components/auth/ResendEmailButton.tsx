'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useCountdown } from '@/hooks/use-countdown';
import { emailRedirectTo, mapResendError } from '@/lib/auth/auth-errors';
import { publicEnv } from '@/lib/env';
import type { createClient } from '@/lib/supabase/client';

const COOLDOWN_SECONDS = 60;

type Status = { kind: 'idle' } | { kind: 'sent' } | { kind: 'error'; message: string };

// Re-sends the sign-up verification email, then locks for 60 s with a countdown (Spec 04 §4.4).
export function ResendEmailButton({
  email,
  supabase,
  label = 'Resend email',
}: {
  email: string;
  supabase: ReturnType<typeof createClient>;
  label?: string;
}) {
  const { remaining, start } = useCountdown();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function resend() {
    setPending(true);
    setStatus({ kind: 'idle' });
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: emailRedirectTo(publicEnv.NEXT_PUBLIC_SITE_URL) },
      });
      if (error) {
        setStatus({ kind: 'error', message: mapResendError(error) });
      } else {
        setStatus({ kind: 'sent' });
        start(COOLDOWN_SECONDS);
      }
    } catch (e) {
      setStatus({ kind: 'error', message: mapResendError(e) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="secondary" onClick={resend} loading={pending} disabled={remaining > 0}>
        {remaining > 0 ? `${label} (${remaining}s)` : label}
      </Button>
      <p aria-live="polite" className="text-body-sm text-text-secondary">
        {status.kind === 'sent' ? 'Verification email sent.' : null}
      </p>
      {status.kind === 'error' ? (
        <p role="alert" className="text-body-sm text-error-text">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
