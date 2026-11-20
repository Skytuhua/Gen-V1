import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  errorBodySchema,
  isApiErrorCode,
  statusForError,
  toApiErrorCode,
  HarnessError,
} from '../packages/contracts/index.ts';

describe('api error taxonomy (issue #1063)', () => {
  it('census union is sorted, deduplicated and non-empty', () => {
    expect(API_ERROR_CODES.length).toBeGreaterThan(300);
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
    const sorted = [...API_ERROR_CODES].sort();
    expect([...API_ERROR_CODES]).toEqual(sorted);
  });

  it('statusForError maps mapped codes, the *_UNAVAILABLE family, and defaults to 400', () => {
    expect(statusForError('NOT_FOUND')).toBe(404);
    expect(statusForError('AUTH_REQUIRED')).toBe(401);
    expect(statusForError('CAPABILITY_DENIED')).toBe(403);
    expect(statusForError('RATE_LIMITED')).toBe(429);
    expect(statusForError('RESOURCE_LIMIT')).toBe(413);
    expect(statusForError('HOST_ERROR')).toBe(500);
    expect(statusForError('INTEGRATION_UNAVAILABLE')).toBe(503);
    expect(statusForError('FOLLOW_UP_UNAVAILABLE')).toBe(503);
    expect(statusForError('INVALID_INPUT')).toBe(400);
  });

  it('toApiErrorCode passes well-formed codes through and rejects malformed input', () => {
    expect(toApiErrorCode('SOME_FUTURE_CODE')).toBe('SOME_FUTURE_CODE');
    expect(toApiErrorCode('INVALID_INPUT')).toBe('INVALID_INPUT');
    expect(toApiErrorCode('lowercase-code')).toBe('HOST_ERROR');
    expect(toApiErrorCode('')).toBe('HOST_ERROR');
    expect(toApiErrorCode(500)).toBe('HOST_ERROR');
    expect(toApiErrorCode(undefined)).toBe('HOST_ERROR');
  });

  it('isApiErrorCode only accepts census members', () => {
    expect(isApiErrorCode('NOT_FOUND')).toBe(true);
    expect(isApiErrorCode('SOME_FUTURE_CODE')).toBe(false);
    expect(isApiErrorCode(42)).toBe(false);
  });

  it('errorBodySchema accepts the wire shape and rejects a bogus code', () => {
    const ok = { error: { code: 'NOT_FOUND', message: 'missing', details: { id: 1 } } };
    expect(errorBodySchema.safeParse(ok).success).toBe(true);
    expect(errorBodySchema.safeParse({ error: { code: 'BOGUS', message: 'x' } }).success).toBe(false);
    expect(errorBodySchema.safeParse({ error: { code: 'NOT_FOUND' } }).success).toBe(false);
  });

  it('HarnessError narrows codes to ApiErrorCode and keeps details', () => {
    const err = new HarnessError('CAPABILITY_DENIED', 'denied', { op: 1 });
    expect(err.code).toBe('CAPABILITY_DENIED');
    expect(err.details).toEqual({ op: 1 });
    expect(err.name).toBe('HarnessError');
    expect(isApiErrorCode(err.code)).toBe(true);
  });
});
