// Product limits shared by Next.js and Edge Functions (Spec 01 §1.6). Pure module: zero imports.
// Keep in sync with the CHECK constraints in docs/specs/supabase-schema.sql.
export const LIMITS = {
  maxFileBytes: 10_485_760,
  maxPages: 20,
  minWords: 100,
  maxTokens: 15_000,
  maxCustomTerms: 5,
  customTermMin: 2,
  customTermMax: 60,
  chatMessageMax: 2000,
  chatSessionMax: 200,
  feedbackCommentMax: 1000,
  termValueMax: 2000,
  titleMax: 200,
} as const;
