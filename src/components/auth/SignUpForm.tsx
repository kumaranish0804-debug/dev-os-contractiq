'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextField } from '@/components/ui/TextField';
import { useSlowNotice } from '@/hooks/use-slow-notice';
import { emailRedirectTo, mapSignUpError, type MappedAuthError } from '@/lib/auth/auth-errors';
import { publicEnv } from '@/lib/env';
import type { createClient } from '@/lib/supabase/client';
import { signUpSchema, type SignUpValues } from '@/lib/validation/auth';

export function SignUpForm({
  supabase,
  onSuccess,
}: {
  supabase: ReturnType<typeof createClient>;
  onSuccess: (email: string) => void;
}) {
  const [formError, setFormError] = useState<MappedAuthError | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', confirmPassword: '', feedbackOptIn: false },
  });
  const slow = useSlowNotice(isSubmitting);

  async function onSubmit(values: SignUpValues) {
    setFormError(null);
    let error: unknown;
    try {
      ({ error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          emailRedirectTo: emailRedirectTo(publicEnv.NEXT_PUBLIC_SITE_URL),
          data: { feedback_opt_in: values.feedbackOptIn ? 'true' : 'false' },
        },
      }));
    } catch (e) {
      error = e;
    }

    if (!error) {
      onSuccess(values.email);
      return;
    }

    const mapped = mapSignUpError(error);
    if (mapped.field === 'form') {
      setFormError(mapped);
    } else {
      setError(mapped.field, { type: mapped.kind, message: mapped.message });
      setFocus(mapped.field);
    }
  }

  const emailError =
    errors.email?.type === 'email_exists' ? (
      <>
        {errors.email.message}{' '}
        <Link href="/login" className="text-brand underline">
          Sign in instead
        </Link>
      </>
    ) : (
      errors.email?.message
    );

  // POST, so credentials never reach the URL (history, logs) if the form is submitted before JS loads.
  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      {formError ? (
        <Alert variant="error">
          <span>{formError.message}</span>
          {formError.kind === 'unknown' ? (
            <button
              type="button"
              onClick={handleSubmit(onSubmit)}
              className="self-start font-medium underline"
            >
              Retry
            </button>
          ) : null}
        </Alert>
      ) : null}

      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        error={emailError}
        {...register('email')}
      />
      <PasswordField
        label="Password"
        autoComplete="new-password"
        hint="At least 8 characters, with a letter and a number."
        error={errors.password?.message}
        {...register('password')}
      />
      <PasswordField
        label="Confirm password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />
      <Checkbox
        label="Help improve ContractIQ by sharing anonymised corrections"
        {...register('feedbackOptIn')}
      />

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" loading={isSubmitting}>
          Create account
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
