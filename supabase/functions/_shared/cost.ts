// OpenAI cost per call (Spec 06 §6.8). USD per 1,000 tokens.
// gpt-4o keeps the PRD's deliberately conservative assumptions; gpt-4o-mini uses list prices.
export const PRICING = {
  'gpt-4o': { inputPer1k: 0.005, cachedInputPer1k: 0.0025, outputPer1k: 0.015 },
  'gpt-4o-mini': { inputPer1k: 0.00015, cachedInputPer1k: 0.000075, outputPer1k: 0.0006 },
} as const;

type PricedModel = keyof typeof PRICING;

const FALLBACK_MODEL: PricedModel = 'gpt-4o';

/** Matches dated snapshots too, e.g. gpt-4o-mini-2024-07-18 → gpt-4o-mini. */
function pricedModel(model: string): PricedModel | null {
  const candidates = (Object.keys(PRICING) as PricedModel[]).sort((a, b) => b.length - a.length);
  return candidates.find((m) => model === m || model.startsWith(`${m}-`)) ?? null;
}

/**
 * Returns the call cost rounded to 5 dp. Unknown models are priced as gpt-4o (`known: false`)
 * so the caller can log `pricing_unknown_model`.
 */
export function costUsd(
  model: string,
  promptTokens: number,
  cachedTokens: number,
  completionTokens: number,
): { cost: number; known: boolean } {
  const matched = pricedModel(model);
  const price = PRICING[matched ?? FALLBACK_MODEL];
  const cached = Math.min(Math.max(cachedTokens, 0), promptTokens);
  const uncached = promptTokens - cached;
  const raw =
    (uncached * price.inputPer1k + cached * price.cachedInputPer1k + completionTokens * price.outputPer1k) /
    1000;
  return { cost: Math.round(raw * 1e5) / 1e5, known: matched !== null };
}
