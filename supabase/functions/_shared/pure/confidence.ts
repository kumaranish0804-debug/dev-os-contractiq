// Confidence bands (PRD US-004): green ≥ 80, amber 50–79, red < 50. Pure module: zero imports.

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export const LOW_CONFIDENCE_BELOW = 50;
export const HIGH_CONFIDENCE_FROM = 80;

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= HIGH_CONFIDENCE_FROM) return 'high';
  if (score >= LOW_CONFIDENCE_BELOW) return 'medium';
  return 'low';
}

/** A found term that should be verified by hand. Not-found terms (value null) are excluded. */
export const needsReview = (term: { value: string | null; confidence_score: number }): boolean =>
  term.value !== null && term.confidence_score < LOW_CONFIDENCE_BELOW;
