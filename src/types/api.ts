export type { ErrorBody, ErrorEnvelope } from '@shared/error-catalogue';

/** Zod `flatten().fieldErrors` shape carried in `details` for INVALID_INPUT. */
export type FieldErrorDetails = { fieldErrors: Record<string, string[] | undefined> };
