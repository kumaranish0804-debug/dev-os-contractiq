import { costUsd } from '../_shared/cost.ts';
import { AppError, ERROR_CATALOGUE } from '../_shared/errors.ts';
import { newMeter, runExtraction, type ExtractionMeter } from '../_shared/extraction.ts';
import type { HandlerContext } from '../_shared/handler.ts';
import { log } from '../_shared/logging.ts';
import { createOpenAIComplete, hashUserId, type CompleteFn } from '../_shared/openai.ts';
import { PROMPT_VERSION } from '../_shared/prompt-builder.ts';
import { isStandardTermName } from '../_shared/pure/term-library.ts';
import { processContractSchema, type ProcessContractInput } from '../_shared/schemas.ts';
import { env } from '../_shared/supabase.ts';

// Spec 06 §6.5: validate → start_processing → runExtraction → save_extraction_results → log.

export type ProcessDeps = {
  /** Builds the model client for this user. Reads secrets lazily, inside the failure path. */
  createComplete: (userId: string) => Promise<{ complete: CompleteFn; model: string }>;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export const defaultDeps: ProcessDeps = {
  createComplete: async (userId) => {
    const model = env('OPENAI_MODEL');
    const complete = createOpenAIComplete({
      apiKey: env('OPENAI_API_KEY'),
      model,
      baseURL: Deno.env.get('OPENAI_BASE_URL') || undefined,
      userHash: await hashUserId(userId, env('OPENAI_USER_HASH_SALT')),
    });
    return { complete, model };
  },
  now: () => Date.now(),
};

const RPC_ERRORS: Record<string, ConstructorParameters<typeof AppError>[0]> = {
  P0002: 'NOT_FOUND',
  P0001: 'ALREADY_PROCESSING',
  '23514': 'CUSTOM_TERM_LIMIT',
  '23505': 'INVALID_INPUT',
};

async function readInput(req: Request): Promise<ProcessContractInput> {
  let body: unknown;
  try {
    body = await req.json();
  } catch (e) {
    throw new AppError('INVALID_INPUT', { cause: e });
  }
  const parsed = processContractSchema.safeParse(body);
  if (!parsed.success) {
    // An unknown or malformed contract id is reported as not found (Spec 03 §3.1).
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.contract_id && Object.keys(fieldErrors).length === 1) throw new AppError('NOT_FOUND');
    throw new AppError('INVALID_INPUT', { details: { fieldErrors } });
  }

  const clashes = parsed.data.custom_terms.filter((t) => isStandardTermName(parsed.data.contract_type, t));
  if (clashes.length > 0) {
    throw new AppError('INVALID_INPUT', {
      details: { fieldErrors: { custom_terms: [`Already a standard term: ${clashes.join(', ')}`] } },
    });
  }
  return parsed.data;
}

async function logExtraction(
  ctx: HandlerContext,
  fields: {
    contractId: string;
    model: string | null;
    meter: ExtractionMeter;
    totalMs: number;
    success: boolean;
    errorCode?: string;
  },
): Promise<void> {
  const { meter, model } = fields;
  let cost = 0;
  if (model) {
    const priced = costUsd(model, meter.prompt, meter.cached, meter.completion);
    cost = priced.cost;
    if (!priced.known) log('warn', { event: 'pricing_unknown_model', model });
  }

  const { error } = await ctx.admin.from('processing_logs').insert({
    user_id: ctx.userId,
    contract_id: fields.contractId,
    kind: 'extraction',
    model,
    prompt_version: PROMPT_VERSION,
    prompt_tokens: meter.prompt,
    completion_tokens: meter.completion,
    cached_tokens: meter.cached,
    cost_usd: cost,
    openai_ms: meter.openaiMs,
    total_ms: fields.totalMs,
    attempts: Math.min(meter.attempts, 10),
    success: fields.success,
    error_code: fields.errorCode ?? null,
  });
  if (error) log('warn', { event: 'processing_log_failed', requestId: ctx.requestId, error: error.message });
}

export async function handleProcess(ctx: HandlerContext, deps: ProcessDeps = defaultDeps): Promise<Response> {
  const startedAt = deps.now();
  const input = await readInput(ctx.req);

  const { data: contract, error: startError } = await ctx.admin.rpc('start_processing', {
    p_contract_id: input.contract_id,
    p_user_id: ctx.userId,
    p_contract_type: input.contract_type,
    p_custom_terms: input.custom_terms,
  });
  if (startError) {
    const code = RPC_ERRORS[startError.code ?? ''];
    if (code) throw new AppError(code, { cause: startError });
    throw new Error(`start_processing failed: ${startError.message}`);
  }
  if (!contract) throw new AppError('NOT_FOUND');

  // From here on the contract is 'processing': every failure must flip it to 'error'.
  const meter = newMeter();
  let model: string | null = null;
  try {
    const client = await deps.createComplete(ctx.userId);
    model = client.model;

    const result = await runExtraction({
      contractText: contract.contract_text,
      contractType: input.contract_type,
      customTerms: input.custom_terms,
      complete: client.complete,
      meter,
      retry: { startedAt, now: deps.now, sleep: deps.sleep },
    });

    const { data: keyTerms, error: saveError } = await ctx.admin.rpc('save_extraction_results', {
      p_contract_id: input.contract_id,
      p_user_id: ctx.userId,
      p_terms: result.terms,
      p_detected_type_mismatch: result.detectedTypeMismatch,
      p_prompt_version: PROMPT_VERSION,
    });
    if (saveError) throw new Error(`save_extraction_results failed: ${saveError.message}`);

    await logExtraction(ctx, {
      contractId: input.contract_id,
      model,
      meter,
      totalMs: deps.now() - startedAt,
      success: true,
    });

    return Response.json({
      status: 'completed',
      detected_type_mismatch: result.detectedTypeMismatch,
      key_terms: keyTerms ?? [],
    });
  } catch (e) {
    const code = e instanceof AppError ? e.code : 'INTERNAL';
    const { error: statusError } = await ctx.admin
      .from('contracts')
      .update({ status: 'error', error_code: code, error_message: ERROR_CATALOGUE[code].message })
      .eq('id', input.contract_id)
      .eq('user_id', ctx.userId);
    if (statusError) {
      log('error', { event: 'status_update_failed', requestId: ctx.requestId, error: statusError.message });
    }
    await logExtraction(ctx, {
      contractId: input.contract_id,
      model,
      meter,
      totalMs: deps.now() - startedAt,
      success: false,
      errorCode: code,
    });
    throw e;
  }
}
