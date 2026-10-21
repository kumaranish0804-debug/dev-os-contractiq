'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ResendEmailButton } from '@/components/auth/ResendEmailButton';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextField } from '@/components/ui/TextField';
import { useSlowNotice } from '@/hooks/use-slow-notice';
import { mapSignInError, type MappedAuthError } from '@/lib/auth/auth-errors';
import { createClient } from '@/lib/supabase/client';
import { loginSchema, type LoginValues } from '@/lib/validation/auth';

/** `next` must already be passed through safeNext() by the page. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [formError, setFormError] = useState<(MappedAuthError & { email: string }) | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const pending = isSubmitting || redirecting;
  const slow = useSlowNotice(isSubmitting);

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    let error: unknown;
    try {
      ({ error } = await supabase.auth.signInWithPassword(values));
    } catch (e) {
      error = e;
    }

    if (!error) {
      setRedirecting(true);
      router.replace(next);
      router.refresh();
      return;
    }

    const mapped = mapSignInError(error);
    setFormError({ ...mapped, email: values.email });
    if (mapped.kind === 'invalid_credentials') {
      // Keep the email, clear the password (Spec 04 §4.12).
      setValue('password', '');
      setFocus('password');
    }
  }

  // POST, so credentials never reach the URL (history, logs) if the form is submitted before JS loads.
  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      {formError ? (
        <Alert variant="error">
          <span>{formError.message}</span>
          {formError.kind === 'email_not_confirmed' ? (
            <ResendEmailButton
              email={formError.email}
              supabase={supabase}
              label="Resend verification email"
            />
          ) : null}
        </Alert>
      ) : null}

      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <PasswordField
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" loading={pending}>
          Sign in
        </Button>
        {slow ? (
          <p aria-live="polite" className="text-body-sm text-text-secondary">
            This is taking longer than usual…
          </p>
        ) : null}
      </div>
    </form>
  );
}
