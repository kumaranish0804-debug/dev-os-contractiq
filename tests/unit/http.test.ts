// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser } }),
}));

import { ApiError, parseErrorResponse } from '@/lib/api/api-error';
import { apiFetch } from '@/lib/api/http';
import { errorResponse, parseBody, readJson, requireUser } from '@/lib/api/route';
import { ERROR_MESSAGES } from '@/lib/utils/errors';
import { parseId } from '@/lib/validation/common';

describe('errorResponse', () => {
  it('returns the envelope and status for an ApiError', async () => {
    const res = errorResponse(new ApiError('SCANNED_PDF'), 'req-1');
    expect(res.status).toBe(422);
    expect(res.headers.get('x-request-id')).toBe('req-1');
    expect(await res.json()).toEqual({
      error: { code: 'SCANNED_PDF', message: ERROR_MESSAGES.SCANNED_PDF, requestId: 'req-1' },
    });
  });

  it('hides unexpected errors behind INTERNAL and logs them', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorResponse(new Error('db password is hunter2'), 'req-2');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('generates a request id when none is given', async () => {
    const body = await errorResponse(new ApiError('NOT_FOUND')).json();
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('parseBody', () => {
  const schema = z.object({ rating: z.enum(['up', 'down']), comment: z.string().max(5).optional() });

  it('returns parsed data', () => {
    expect(parseBody(schema, { rating: 'up' })).toEqual({ rating: 'up' });
  });

  it('throws INVALID_INPUT with field errors', () => {
    try {
      parseBody(schema, { rating: 'meh', comment: 'too long' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const error = e as ApiError;
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.status).toBe(400);
      const { fieldErrors } = error.details as { fieldErrors: Record<string, string[]> };
      expect(Object.keys(fieldErrors).sort()).toEqual(['comment', 'rating']);
    }
  });
});

describe('readJson', () => {
  it('parses a JSON body', async () => {
    const req = new Request('http://x', { method: 'POST', body: '{"a":1}' });
    expect(await readJson(req)).toEqual({ a: 1 });
  });

  it('treats malformed JSON as INVALID_INPUT', async () => {
    const req = new Request('http://x', { method: 'POST', body: '{nope' });
    await expect(readJson(req)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
  });
});

describe('parseId', () => {
  it('accepts a UUID', () => {
    const id = '7d444840-9dc0-11d1-b245-5ffdce74fad2';
    expect(parseId(id)).toBe(id);
  });

  it.each([['not-a-uuid'], [''], [undefined], ["1' or '1'='1"]])(
    'returns NOT_FOUND (not 400) for %j',
    (value) => {
      expect(() => parseId(value)).toThrow(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }));
    },
  );
});

describe('requireUser', () => {
  beforeEach(() => getUser.mockReset());

  it('returns the user and client when signed in', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const { user } = await requireUser();
    expect(user.id).toBe('u1');
  });

  it('throws UNAUTHENTICATED when signed out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });
});

describe('parseErrorResponse', () => {
  it('reads the envelope but takes copy from the catalogue', async () => {
    const res = Response.json(
      { error: { code: 'RATE_LIMITED', message: 'server text', requestId: 'r9' } },
      { status: 429 },
    );
    const error = await parseErrorResponse(res);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429, requestId: 'r9' });
    expect(error.message).toBe(ERROR_MESSAGES.RATE_LIMITED);
  });

  it('maps unknown codes and non-JSON bodies to INTERNAL', async () => {
    const unknown = await parseErrorResponse(
      Response.json({ error: { code: 'WHO_KNOWS' } }, { status: 418 }),
    );
    expect(unknown.code).toBe('INTERNAL');

    const html = await parseErrorResponse(new Response('<html>502</html>', { status: 502 }));
    expect(html).toMatchObject({ code: 'INTERNAL', status: 502 });
  });
});

describe('apiFetch', () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('sends JSON and returns the parsed body', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    await expect(apiFetch('/api/x', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch('/api/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws ApiError from the envelope', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('turns network failures into INTERNAL', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ code: 'INTERNAL', status: 0 });
  });
});
