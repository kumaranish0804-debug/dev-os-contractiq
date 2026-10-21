import { describe, expect, it } from 'vitest';
import {
  buildErrorEnvelope,
  ERROR_CATALOGUE,
  isErrorCode,
} from '@shared/error-catalogue';
import { ERROR_MESSAGES, ERROR_STATUS, errorMessage } from '@/lib/utils/errors';

// Spec 03 §3.3 — the full catalogue, in order.
const SPEC_CODES = [
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'INVALID_INPUT',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'TOO_MANY_PAGES',
  'SCANNED_PDF',
  'CONTRACT_TOO_LONG',
  'INVALID_PDF',
  'PDF_PASSWORD_PROTECTED',
  'ALREADY_PROCESSING',
  'CONTRACT_NOT_READY',
  'CUSTOM_TERM_LIMIT',
  'CHAT_LIMIT_REACHED',
  'FILE_NOT_AVAILABLE',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_INVALID_OUTPUT',
  'INTERNAL',
];

describe('error catalogue', () => {
  it('contains exactly the Spec 03 codes', () => {
    expect(Object.keys(ERROR_CATALOGUE)).toEqual(SPEC_CODES);
  });

  it('never uses 403 (unowned resources are 404)', () => {
    for (const { status } of Object.values(ERROR_CATALOGUE)) {
      expect(status).not.toBe(403);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it.each([
    ['UNAUTHENTICATED', 401],
    ['NOT_FOUND', 404],
    ['FILE_TOO_LARGE', 413],
    ['UNSUPPORTED_FILE_TYPE', 415],
    ['SCANNED_PDF', 422],
    ['ALREADY_PROCESSING', 409],
    ['CUSTOM_TERM_LIMIT', 400],
    ['RATE_LIMITED', 429],
    ['AI_UNAVAILABLE', 502],
    ['AI_TIMEOUT', 504],
    ['INTERNAL', 500],
  ] as const)('%s maps to HTTP %i', (code, status) => {
    expect(ERROR_CATALOGUE[code].status).toBe(status);
  });

  it('mirrors the catalogue into the UI message and status maps', () => {
    expect(Object.keys(ERROR_MESSAGES)).toEqual(SPEC_CODES);
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE)) {
      expect(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]).toBe(entry.message);
      expect(ERROR_STATUS[code as keyof typeof ERROR_STATUS]).toBe(entry.status);
    }
  });

  it('falls back to INTERNAL copy for unknown codes', () => {
    expect(errorMessage('SCANNED_PDF')).toBe(ERROR_CATALOGUE.SCANNED_PDF.message);
    expect(errorMessage('SOMETHING_NEW')).toBe(ERROR_CATALOGUE.INTERNAL.message);
    expect(errorMessage(undefined)).toBe(ERROR_CATALOGUE.INTERNAL.message);
  });

  it('isErrorCode rejects inherited and non-string keys', () => {
    expect(isErrorCode('RATE_LIMITED')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode(404)).toBe(false);
  });
});

describe('buildErrorEnvelope', () => {
  it('uses the catalogue message by default and omits empty details', () => {
    expect(buildErrorEnvelope('NOT_FOUND', 'req-1')).toEqual({
      error: { code: 'NOT_FOUND', message: ERROR_CATALOGUE.NOT_FOUND.message, requestId: 'req-1' },
    });
  });

  it('includes details when given', () => {
    const details = { fieldErrors: { title: ['Required'] } };
    const envelope = buildErrorEnvelope('INVALID_INPUT', 'req-2', undefined, details);
    expect(envelope.error.details).toEqual(details);
    expect(envelope.error.message).toBe(ERROR_CATALOGUE.INVALID_INPUT.message);
  });
});
