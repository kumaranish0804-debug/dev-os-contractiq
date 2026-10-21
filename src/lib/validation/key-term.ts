import { z } from 'zod';
import { LIMITS } from '@shared/limits';

// PATCH /api/key-terms/[id] (Spec 07 §7.5). An empty value clears the term ("Not found").
export const keyTermPatchSchema = z.object({
  value: z
    .string()
    .trim()
    .max(LIMITS.termValueMax)
    .nullable()
    .transform((v) => (v === '' ? null : v)),
});

export type KeyTermPatch = z.input<typeof keyTermPatchSchema>;
