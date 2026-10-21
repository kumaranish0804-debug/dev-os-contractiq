import { z } from 'zod';
import { LIMITS } from '@shared/limits';

// POST /api/feedback (Spec 07 §7.6). An empty comment is stored as null.
export const feedbackSchema = z.object({
  contract_id: z.string().uuid(),
  rating: z.enum(['up', 'down']),
  comment: z
    .string()
    .trim()
    .max(LIMITS.feedbackCommentMax)
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type FeedbackBody = z.input<typeof feedbackSchema>;
export type Feedback = { id: string; rating: 'up' | 'down'; comment: string | null; updated_at: string };
