// Error code catalogue (Spec 03 §3.3) — the single source for Next.js and Edge Functions.
// Pure module: zero imports, so it compiles in both runtimes (Spec 01 §1.6).

export const ERROR_CATALOGUE = {
  UNAUTHENTICATED: { status: 401, message: 'Your session has expired. Please sign in again.' },
  NOT_FOUND: { status: 404, message: "We couldn't find that contract." },
  INVALID_INPUT: { status: 400, message: 'Some of the information provided is invalid.' },
  FILE_TOO_LARGE: {
    status: 413,
    message: 'This file is larger than 10 MB. Please upload a smaller PDF.',
  },
  UNSUPPORTED_FILE_TYPE: { status: 415, message: 'Only PDF files are supported.' },
  TOO_MANY_PAGES: {
    status: 422,
    message:
      'This contract has more than 20 pages. ContractIQ currently supports contracts up to 20 pages.',
  },
  SCANNED_PDF: {
    status: 422,
    message: 'Scanned PDFs are not supported yet. Please upload a PDF with selectable text.',
  },
  CONTRACT_TOO_LONG: {
    status: 422,
    message:
      'This contract is too long to analyse (over ~15,000 tokens). Support for longer contracts is coming.',
  },
  INVALID_PDF: {
    status: 422,
    message: "We couldn't read this PDF. It may be corrupted — try exporting it again.",
  },
  PDF_PASSWORD_PROTECTED: {
    status: 422,
    message: 'This PDF is password-protected. Remove the password and upload it again.',
  },
  ALREADY_PROCESSING: { status: 409, message: 'This contract is already being analysed.' },
  CONTRACT_NOT_READY: { status: 409, message: "This contract hasn't finished processing yet." },
  CUSTOM_TERM_LIMIT: { status: 400, message: 'You can add up to 5 custom terms.' },
  CHAT_LIMIT_REACHED: {
    status: 409,
    message: 'This conversation has reached its 200-message limit.',
  },
  FILE_NOT_AVAILABLE: {
    status: 404,
    message: "The original PDF isn't available. Showing the extracted text instead.",
  },
  RATE_LIMITED: {
    status: 429,
    message: "You're doing that too often. Please try again in a few minutes.",
  },
  AI_UNAVAILABLE: { status: 502, message: 'Our AI service is busy. Try again in a few minutes.' },
  AI_TIMEOUT: { status: 504, message: 'The analysis took too long. Try again in a few minutes.' },
  AI_INVALID_OUTPUT: {
    status: 502,
    message: "We couldn't read the AI's response. Try again in a few minutes.",
  },
  INTERNAL: { status: 500, message: 'Something went wrong on our side. Please try again.' },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export type ErrorBody = {
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: unknown;
};

export type ErrorEnvelope = { error: ErrorBody };

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CATALOGUE, value);
}

/** Builds the §3.2 envelope. `details` is included only when present. */
export function buildErrorEnvelope(
  code: ErrorCode,
  requestId: string,
  message: string = ERROR_CATALOGUE[code].message,
  details?: unknown,
): ErrorEnvelope {
  const error: ErrorBody = { code, message, requestId };
  if (details !== undefined) error.details = details;
  return { error };
}
