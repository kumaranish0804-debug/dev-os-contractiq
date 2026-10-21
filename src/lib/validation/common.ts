import { z } from 'zod';
import { ApiError } from '@/lib/api/api-error';

export const uuidSchema = z.string().uuid();

/**
 * Validates a route `[id]` segment. Invalid IDs return NOT_FOUND, not INVALID_INPUT,
 * so the API never reveals whether a resource exists (Spec 03 §3.1).
 */
export function parseId(value: unknown): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw new ApiError('NOT_FOUND');
  return result.data;
}
