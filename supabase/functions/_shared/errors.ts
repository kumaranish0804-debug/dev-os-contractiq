import { buildErrorEnvelope, ERROR_CATALOGUE, type ErrorCode } from './pure/error-catalogue.ts';
import { log } from './logging.ts';

export { ERROR_CATALOGUE, type ErrorCode };

/** An expected, user-safe failure. Anything else thrown in a handler becomes INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly headers: Record<string, string>;

  constructor(
    code: ErrorCode,
    options: { details?: unknown; headers?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(ERROR_CATALOGUE[code].message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CATALOGUE[code].status;
    this.details = options.details;
    this.headers = options.headers ?? {};
  }
}

/** Builds the §3.2 envelope response. Non-AppErrors are logged (never returned) as INTERNAL. */
export function errorJson(
  e: unknown,
  requestId: string,
  headers: Record<string, string> = {},
  fn?: string,
): Response {
  const error = e instanceof AppError ? e : new AppError('INTERNAL', { cause: e });
  if (!(e instanceof AppError)) {
    log('error', {
      fn,
      requestId,
      errorCode: 'INTERNAL',
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    });
  }
  return Response.json(buildErrorEnvelope(error.code, requestId, error.message, error.details), {
    status: error.status,
    headers: { ...headers, ...error.headers, 'x-request-id': requestId },
  });
}
