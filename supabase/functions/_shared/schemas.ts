import { z } from 'zod';
import { LIMITS } from './pure/limits.ts';

// Request and model-output schemas for process-contract (Spec 06 §6.3, §6.7).

export const customTermSchema = z
  .string()
  .trim()
  .min(LIMITS.customTermMin)
  .max(LIMITS.customTermMax)
  .regex(/[A-Za-z0-9]/);

export const processContractSchema = z.object({
  contract_id: z.string().uuid(),
  contract_type: z.enum(['NDA', 'MSA']),
  custom_terms: z
    .array(customTermSchema)
    .max(LIMITS.maxCustomTerms)
    .default([])
    .refine((a) => new Set(a.map((s) => s.toLowerCase())).size === a.length, 'Duplicate custom terms'),
});

export type ProcessContractInput = z.infer<typeof processContractSchema>;

export const extractionOutputSchema = z.object({
  terms: z
    .array(
      z.object({
        term_key: z.string(),
        term_name: z.string().optional().default(''),
        value: z.string().nullable(),
        page_number: z.number().int().nullable().optional().default(null),
        source_sentence: z.string().nullable().optional().default(null),
        confidence_score: z.number(),
      }),
    )
    .min(1),
  detected_contract_type: z.enum(['NDA', 'MSA', 'OTHER']).optional(),
});

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;
