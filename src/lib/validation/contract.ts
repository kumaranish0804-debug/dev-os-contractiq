import { z } from 'zod';
import { LIMITS } from '@shared/limits';

// Mirrors supabase/functions/_shared/schemas.ts (Spec 06 §6.3); the server stays authoritative.

export const customTermSchema = z
  .string()
  .trim()
  .min(LIMITS.customTermMin, 'Use 2–60 characters')
  .max(LIMITS.customTermMax, 'Use 2–60 characters')
  .regex(/[A-Za-z0-9]/, 'Include at least one letter or number');

export const processContractSchema = z.object({
  contract_id: z.string().uuid(),
  contract_type: z.enum(['NDA', 'MSA']),
  custom_terms: z
    .array(customTermSchema)
    .max(LIMITS.maxCustomTerms)
    .default([])
    .refine((a) => new Set(a.map((s) => s.toLowerCase())).size === a.length, 'Duplicate custom terms'),
});

export type ProcessContractBody = z.input<typeof processContractSchema>;
