import { describe, expect, it } from 'vitest';
import {
  matchCorsOrigin,
  parseAllowedOrigins,
  RATE_LIMITS,
  retryAfterSeconds,
} from '@shared/request-rules';

describe('RATE_LIMITS', () => {
  it('matches Spec 03 §3.6', () => {
    expect(RATE_LIMITS.upload).toEqual({ bucket: 'upload', limit: 20, windowSeconds: 3600 });
    expect(RATE_LIMITS.process).toEqual({ bucket: 'process', limit: 20, windowSeconds: 3600 });
    expect(RATE_LIMITS.chat).toEqual({ bucket: 'chat', limit: 30, windowSeconds: 600 });
  });
});

describe('retryAfterSeconds', () => {
  it('returns the full window at the exact window start', () => {
    expect(retryAfterSeconds(600, 1_800_000_000 * 1000)).toBe(600);
  });

  it('counts down to the end of the current fixed window', () => {
    const windowStart = 1_800_000_000; // divisible by 600 and 3600
    expect(retryAfterSeconds(600, (windowStart + 1) * 1000)).toBe(599);
    expect(retryAfterSeconds(600, (windowStart + 599) * 1000 + 999)).toBe(1);
    expect(retryAfterSeconds(3600, (windowStart + 3599) * 1000)).toBe(1);
  });

  it('is always a positive integer no larger than the window', () => {
    for (let ms = 0; ms < 5000_000; ms += 7919) {
      const value = retryAfterSeconds(3600, ms);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(3600);
    }
  });
});

describe('parseAllowedOrigins', () => {
  it('splits, trims and drops trailing slashes and empties', () => {
    expect(
      parseAllowedOrigins(' http://localhost:3000/ , https://contractiq.netlify.app,, '),
    ).toEqual(['http://localhost:3000', 'https://contractiq.netlify.app']);
  });

  it('returns an empty list when unset', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
  });
});

describe('matchCorsOrigin', () => {
  const allowed = ['http://localhost:3000', 'https://contractiq.netlify.app'];

  it('echoes an allowed origin', () => {
    expect(matchCorsOrigin('https://contractiq.netlify.app', allowed)).toBe(
      'https://contractiq.netlify.app',
    );
  });

  it('rejects unknown, look-alike and missing origins', () => {
    expect(matchCorsOrigin('https://evil.example', allowed)).toBeNull();
    expect(matchCorsOrigin('https://contractiq.netlify.app.evil.example', allowed)).toBeNull();
    expect(matchCorsOrigin('http://localhost:3001', allowed)).toBeNull();
    expect(matchCorsOrigin(null, allowed)).toBeNull();
  });
});
