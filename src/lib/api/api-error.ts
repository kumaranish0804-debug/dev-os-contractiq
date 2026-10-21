import { buildErrorEnvelope, type ErrorEnvelope } from '@shared/error-catalogue';
import { ERROR_MESSAGES, ERROR_STATUS, isErrorCode, type ErrorCode } from '@/lib/utils/errors';

// Shared by route handlers (server) and fetch helpers (browser), so it imports nothing server-only.
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    code: ErrorCode,
    options: { status?: number; message?: string; details?: unknown; requestId?: string } = {},
  ) {
    super(options.message ?? ERROR_MESSAGES[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code];
    this.details = options.details;
    this.requestId = options.requestId;
  }

  toEnvelope(requestId: string): ErrorEnvelope {
    return buildErrorEnvelope(this.code, requestId, this.message, this.details);
  }
}

/** Converts a non-2xx response into an ApiError. Malformed bodies become INTERNAL. */
export async function parseErrorResponse(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const error = (body as { error?: Record<string, unknown> } | null)?.error;
  const code = isErrorCode(error?.code) ? error.code : 'INTERNAL';

  return new ApiError(code, {
    status: response.status,
    // UI copy always comes from the catalogue (Spec 03 §3.8), never from the response.
    message: ERROR_MESSAGES[code],
    details: error?.details,
    requestId: typeof error?.requestId === 'string' ? error.requestId : undefined,
  });
}
