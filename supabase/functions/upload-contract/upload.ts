import { z } from 'zod';
import { AppError } from '../_shared/errors.ts';
import type { HandlerContext } from '../_shared/handler.ts';
import { log } from '../_shared/logging.ts';
import { countTokens, extractPdf } from '../_shared/pdf-text.ts';
import { safeFilename, titleFromFilename } from '../_shared/pure/filenames.ts';
import { LIMITS } from '../_shared/pure/limits.ts';

// Spec 05 §5.6. Validates and extracts a PDF, then creates the contract row.
// No contracts row is written on any rejection ("no partial output stored").

/** 10 MB plus multipart overhead — rejected before the body is read. */
const MAX_CONTENT_LENGTH = 10_600_000;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const STORAGE_RETRY_DELAY_MS = 500;

const fieldsSchema = z.object({
  file: z.instanceof(File),
  contract_type: z.enum(['NDA', 'MSA']),
  title: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.titleMax)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export type UploadResponse = {
  contract_id: string;
  page_count: number;
  word_count: number;
  token_count: number;
  file_stored: boolean;
};

export type UploadDeps = {
  extract: typeof extractPdf;
  countTokens: typeof countTokens;
  sleep: (ms: number) => Promise<void>;
  newId: () => string;
};

const defaultDeps: UploadDeps = {
  extract: extractPdf,
  countTokens,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  newId: () => crypto.randomUUID(),
};

/** Supabase errors are not always Error instances, but they carry a message. */
function errorText(e: unknown): string {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(e);
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, i) => bytes[i] === byte);
}

async function readFields(req: Request) {
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_LENGTH) {
    throw new AppError('FILE_TOO_LARGE');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    throw new AppError('INVALID_INPUT', { cause: e });
  }

  const parsed = fieldsSchema.safeParse({
    file: form.get('file'),
    contract_type: form.get('contract_type'),
    title: form.get('title') ?? undefined,
  });
  if (!parsed.success) {
    throw new AppError('INVALID_INPUT', {
      details: { fieldErrors: parsed.error.flatten().fieldErrors },
    });
  }
  return parsed.data;
}

async function storeFile(
  ctx: HandlerContext,
  deps: UploadDeps,
  contractId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const path = `${ctx.userId}/${contractId}/${safeFilename(fileName)}`;
  const upload = () =>
    ctx.admin.storage
      .from('contracts')
      .upload(path, bytes, { contentType: 'application/pdf', upsert: false });

  try {
    let { error } = await upload();
    if (error) {
      await deps.sleep(STORAGE_RETRY_DELAY_MS);
      ({ error } = await upload());
    }
    if (error) throw error;

    const { error: updateError } = await ctx.admin
      .from('contracts')
      .update({ file_path: path })
      .eq('id', contractId)
      .eq('user_id', ctx.userId);
    if (updateError) throw updateError;
    return true;
  } catch (e) {
    // Non-blocking (PRD assumption 13): the text viewer is the fallback.
    log('warn', {
      event: 'storage_upload_failed',
      requestId: ctx.requestId,
      userId: ctx.userId,
      contractId,
      error: errorText(e),
    });
    return false;
  }
}

async function logUpload(
  ctx: HandlerContext,
  fields: { contractId: string | null; totalMs: number; success: boolean; errorCode?: string },
): Promise<void> {
  const { error } = await ctx.admin.from('processing_logs').insert({
    user_id: ctx.userId,
    contract_id: fields.contractId,
    kind: 'upload',
    total_ms: fields.totalMs,
    attempts: 1,
    success: fields.success,
    error_code: fields.errorCode ?? null,
  });
  if (error) {
    log('warn', { event: 'processing_log_failed', requestId: ctx.requestId, error: error.message });
  }
}

export async function handleUpload(
  ctx: HandlerContext,
  deps: UploadDeps = defaultDeps,
): Promise<Response> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  try {
    const { file, contract_type, title } = await readFields(ctx.req);
    if (file.size > LIMITS.maxFileBytes) throw new AppError('FILE_TOO_LARGE');
    if (file.size === 0) throw new AppError('INVALID_PDF');

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasPdfMagic(bytes)) throw new AppError('UNSUPPORTED_FILE_TYPE');

    // unpdf may detach the buffer it is given, so keep `bytes` intact for Storage.
    const pdf = await deps.extract(bytes.slice());
    if (pdf.wordCount < LIMITS.minWords) throw new AppError('SCANNED_PDF');

    const tokenCount = deps.countTokens(pdf.contractText);
    if (tokenCount > LIMITS.maxTokens) throw new AppError('CONTRACT_TOO_LONG');

    const contractId = deps.newId();
    const { error: insertError } = await ctx.admin.from('contracts').insert({
      id: contractId,
      user_id: ctx.userId,
      title: title ?? titleFromFilename(file.name),
      original_filename: file.name.slice(0, 255) || 'contract.pdf',
      contract_type,
      contract_text: pdf.contractText,
      page_count: pdf.pageCount,
      word_count: pdf.wordCount,
      token_count: tokenCount,
      file_size_bytes: file.size,
    });
    if (insertError) throw new Error(`contracts insert failed: ${insertError.message}`);

    const fileStored = await storeFile(ctx, deps, contractId, file.name, bytes);
    await logUpload(ctx, { contractId, totalMs: elapsed(), success: true });

    const body: UploadResponse = {
      contract_id: contractId,
      page_count: pdf.pageCount,
      word_count: pdf.wordCount,
      token_count: tokenCount,
      file_stored: fileStored,
    };
    return Response.json(body, { status: 201 });
  } catch (e) {
    await logUpload(ctx, {
      contractId: null,
      totalMs: elapsed(),
      success: false,
      errorCode: e instanceof AppError ? e.code : 'INTERNAL',
    });
    throw e;
  }
}
