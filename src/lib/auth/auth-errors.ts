// Maps Supabase AuthError codes to UI copy (Spec 04 §4.4, §4.6).

export type AuthErrorField = 'email' | 'password' | 'form';

export type AuthErrorKind =
  | 'email_exists'
  | 'weak_password'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'unknown';

export type MappedAuthError = { kind: AuthErrorKind; field: AuthErrorField; message: string };

export const GENERIC_AUTH_ERROR = 'Something went wrong. Please try again.';
const RATE_LIMITED = 'Too many attempts. Please wait a minute and try again.';

function codeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function mapSignUpError(error: unknown): MappedAuthError {
  switch (codeOf(error)) {
    case 'user_already_exists':
    case 'email_exists':
      return {
        kind: 'email_exists',
        field: 'email',
        message: 'An account with this email already exists.',
      };
    case 'weak_password':
      return { kind: 'weak_password', field: 'password', message: 'Choose a stronger password.' };
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return { kind: 'rate_limited', field: 'form', message: RATE_LIMITED };
    default:
      return { kind: 'unknown', field: 'form', message: GENERIC_AUTH_ERROR };
  }
}

export function mapSignInError(error: unknown): MappedAuthError {
  switch (codeOf(error)) {
    case 'invalid_credentials':
      return {
        kind: 'invalid_credentials',
        field: 'form',
        message: 'Email or password is incorrect.',
      };
    case 'email_not_confirmed':
      return {
        kind: 'email_not_confirmed',
        field: 'form',
        message: 'Please verify your email first.',
      };
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return { kind: 'rate_limited', field: 'form', message: RATE_LIMITED };
    default:
      return { kind: 'unknown', field: 'form', message: GENERIC_AUTH_ERROR };
  }
}

/** Copy for a failed "Resend email" request. */
export function mapResendError(error: unknown): string {
  const code = codeOf(error);
  return code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit'
    ? RATE_LIMITED
    : GENERIC_AUTH_ERROR;
}

/** The verification link target. The callback defaults to /dashboard. */
export function emailRedirectTo(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/auth/callback`;
}
