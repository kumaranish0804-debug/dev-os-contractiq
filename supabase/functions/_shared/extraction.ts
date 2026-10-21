import { AppError } from './errors.ts';
import { postProcess, type ExtractedTerm } from './extraction-postprocess.ts';
import { withRetry, type ChatMessage, type CompleteFn, type RetryOptions } from './openai.ts';
import { buildExtractionMessages, REPAIR_PROMPT, type RequestedTerm } from './prompt-builder.ts';
import { splitPages } from './pure/page-markers.ts';
import { customTermDef, getStandardTerms, type ContractType } from './pure/term-library.ts';
import { extractionOutputSchema, type ExtractionOutput } from './schemas.ts';

// The extraction pipeline (Spec 06 §6.5 steps 3–8). No database access, so the eval harness
// runs exactly the production code path.

export const EXTRACTION_SETTINGS = { temperature: 0.1, maxTokens: 2000, json: true } as const;
const CUSTOM_SORT_START = 100;

/** Usage across every call, including failed ones — mutated so failures can still be logged. */
export type ExtractionMeter = {
  attempts: number;
  repairs: number;
  prompt: number;
  cached: number;
  completion: number;
  openaiMs: number;
};

export const newMeter = (): ExtractionMeter => ({
  attempts: 0,
  repairs: 0,
  prompt: 0,
  cached: 0,
  completion: 0,
  openaiMs: 0,
});

export type ExtractionResult = { terms: ExtractedTerm[]; detectedTypeMismatch: boolean };

export function buildRequestedTerms(type: ContractType, customTerms: string[]): RequestedTerm[] {
  return [
    ...getStandardTerms(type).map((t, i) => ({ ...t, isCustom: false, sortOrder: i })),
    ...customTerms.map((name, i) => ({
      ...customTermDef(name),
      isCustom: true,
      sortOrder: CUSTOM_SORT_START + i,
    })),
  ];
}

function parseOutput(content: string | null, finishReason: string | null): ExtractionOutput | null {
  // A truncated response is never valid JSON worth trusting.
  if (!content || finishReason === 'length') return null;
  try {
    const parsed = extractionOutputSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function runExtraction(input: {
  contractText: string;
  contractType: ContractType;
  customTerms: string[];
  complete: CompleteFn;
  meter?: ExtractionMeter;
  retry?: RetryOptions;
}): Promise<ExtractionResult> {
  const meter = input.meter ?? newMeter();
  const requested = buildRequestedTerms(input.contractType, input.customTerms);
  const pages = splitPages(input.contractText);
  const messages = buildExtractionMessages({
    contractType: input.contractType,
    requested,
    contractText: input.contractText,
  });

  const call = async (msgs: ChatMessage[]) => {
    const { result, attempts } = await withRetry(async () => {
      meter.attempts++;
      const started = performance.now();
      try {
        const completion = await input.complete(msgs, EXTRACTION_SETTINGS);
        meter.prompt += completion.usage.prompt;
        meter.cached += completion.usage.cached;
        meter.completion += completion.usage.completion;
        return completion;
      } finally {
        meter.openaiMs += Math.round(performance.now() - started);
      }
    }, input.retry);
    return { completion: result, attempts };
  };

  const first = await call(messages);
  let output = parseOutput(first.completion.content, first.completion.finishReason);

  if (!output) {
    meter.repairs++;
    const repair = await call([
      ...messages,
      { role: 'assistant', content: first.completion.content ?? '' },
      { role: 'user', content: REPAIR_PROMPT },
    ]);
    output = parseOutput(repair.completion.content, repair.completion.finishReason);
    if (!output) throw new AppError('AI_INVALID_OUTPUT');
  }

  return postProcess(output, requested, pages, input.contractType);
}
