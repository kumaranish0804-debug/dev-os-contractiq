import { ERROR_CATALOGUE, isErrorCode, type ErrorCode } from '@shared/error-catalogue';

export { isErrorCode, type ErrorCode };

// UI copy for every error code (Spec 03 §3.8). Derived from the shared catalogue so the
// browser and the Edge Functions can never disagree.
export const ERROR_MESSAGES = Object.fromEntries(
  Object.entries(ERROR_CATALOGUE).map(([code, { message }]) => [code, message]),
) as { readonly [C in ErrorCode]: (typeof ERROR_CATALOGUE)[C]['message'] };

export const ERROR_STATUS = Object.fromEntries(
  Object.entries(ERROR_CATALOGUE).map(([code, { status }]) => [code, status]),
) as { readonly [C in ErrorCode]: (typeof ERROR_CATALOGUE)[C]['status'] };

/** User-safe message for any code; unknown codes fall back to INTERNAL. */
export function errorMessage(code: unknown): string {
  return isErrorCode(code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.INTERNAL;
}
