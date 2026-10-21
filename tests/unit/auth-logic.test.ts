import { describe, expect, it } from 'vitest';
import {
  emailRedirectTo,
  GENERIC_AUTH_ERROR,
  mapResendError,
  mapSignInError,
  mapSignUpError,
} from '@/lib/auth/auth-errors';
import { safeNext } from '@/lib/auth/safe-next';
import { loginSchema, signUpSchema } from '@/lib/validation/auth';

describe('safeNext', () => {
  it.each([
    ['/contracts/abc', '/contracts/abc'],
    ['/contracts/abc?tab=chat', '/contracts/abc?tab=chat'],
    ['/dashboard', '/dashboard'],
  ])('keeps same-origin path %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    ['//evil.com'],
    ['https://evil.com'],
    ['/\\evil.com'],
    ['javascript:alert(1)'],
    ['evil.com'],
    [''],
    [null],
    [undefined],
  ])('falls back to /dashboard for %j', (input) => {
    expect(safeNext(input)).toBe('/dashboard');
  });
});

describe('signUpSchema', () => {
  const valid = {
    email: '  Jane@Example.COM ',
    password: 'contract9',
    confirmPassword: 'contract9',
    feedbackOptIn: false,
  };

  it('normalises the email', () => {
    expect(signUpSchema.parse(valid).email).toBe('jane@example.com');
  });

  it.each([
    ['short1', 'Use at least 8 characters'],
    ['onlyletters', 'Include at least one number'],
    ['12345678', 'Include at least one letter'],
    [`a1${'x'.repeat(71)}`, 'Use at most 72 characters'],
  ])('rejects password %j', (password, message) => {
    const result = signUpSchema.safeParse({ ...valid, password, confirmPassword: password });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.password).toContain(message);
  });

  it('requires matching passwords', () => {
    const result = signUpSchema.safeParse({ ...valid, confirmPassword: 'different9' });
    expect(result.error?.flatten().fieldErrors.confirmPassword).toEqual(['Passwords do not match']);
  });

  it('rejects an invalid email', () => {
    const result = signUpSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.error?.flatten().fieldErrors.email).toEqual(['Enter a valid email address']);
  });
});

describe('loginSchema', () => {
  it('requires a password but not its strength', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).error?.flatten().fieldErrors)
      .toEqual({ password: ['Enter your password'] });
  });
});

describe('auth error mapping', () => {
  it.each([
    ['user_already_exists', 'email_exists', 'email'],
    ['email_exists', 'email_exists', 'email'],
    ['weak_password', 'weak_password', 'password'],
    ['over_email_send_rate_limit', 'rate_limited', 'form'],
    ['something_new', 'unknown', 'form'],
  ])('sign-up %s → %s on %s', (code, kind, field) => {
    expect(mapSignUpError({ code })).toMatchObject({ kind, field });
  });

  it.each([
    ['invalid_credentials', 'Email or password is incorrect.'],
    ['email_not_confirmed', 'Please verify your email first.'],
    ['over_request_rate_limit', 'Too many attempts. Please wait a minute and try again.'],
  ])('sign-in %s shows the spec copy', (code, message) => {
    expect(mapSignInError({ code }).message).toBe(message);
  });

  it('treats network failures and odd values as generic errors', () => {
    expect(mapSignInError(new TypeError('Failed to fetch')).message).toBe(GENERIC_AUTH_ERROR);
    expect(mapSignUpError(null).message).toBe(GENERIC_AUTH_ERROR);
    expect(mapSignInError({ code: 42 }).kind).toBe('unknown');
    expect(mapResendError({ code: 'over_email_send_rate_limit' })).toMatch(/Too many attempts/);
    expect(mapResendError(undefined)).toBe(GENERIC_AUTH_ERROR);
  });

  it('builds the callback URL without a trailing slash', () => {
    expect(emailRedirectTo('http://localhost:3000/')).toBe('http://localhost:3000/auth/callback');
    expect(emailRedirectTo('https://app.example.com')).toBe(
      'https://app.example.com/auth/callback',
    );
  });
});
