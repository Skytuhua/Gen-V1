import { describe, expect, it } from 'vitest';
import { ApiError } from '../apps/web/src/api';
import { ENHANCE_MAX_DRAFT_BYTES, enhanceText, validEnhancement, failureText } from '../apps/web/src/useComposerEnhance';

describe('validEnhancement', () => {
  it('accepts ordinary rewritten text', () => {
    expect(validEnhancement('  Enhanced draft text  ')).toBe(true);
    expect(validEnhancement('newlines\nare fine\ttabs too')).toBe(true);
  });
  it('rejects empty and whitespace-only replies', () => {
    expect(validEnhancement('')).toBe(false);
    expect(validEnhancement('   \n\t  ')).toBe(false);
  });
  it('rejects control bytes but keeps printable text', () => {
    expect(validEnhancement('bell\x07')).toBe(false);
    expect(validEnhancement('nul\x00byte')).toBe(false);
    expect(validEnhancement('del\x7Fchar')).toBe(false);
    expect(validEnhancement('accented café text')).toBe(true);
  });
  it('rejects replies over the 8KiB draft bound', () => {
    expect(validEnhancement('x'.repeat(ENHANCE_MAX_DRAFT_BYTES))).toBe(true);
    expect(validEnhancement('x'.repeat(ENHANCE_MAX_DRAFT_BYTES + 1))).toBe(false);
    expect(validEnhancement(''.repeat(3000))).toBe(false);
  });
});

describe('failureText', () => {
  it('maps documented enhance error codes to fixed copy', () => {
    expect(failureText(new ApiError('ENHANCE_TIMEOUT', 'reason'))).toBe(enhanceText.timeout);
    expect(failureText(new ApiError('ENHANCE_UNSUPPORTED', 'reason'))).toBe(enhanceText.unavailable);
    expect(failureText(new ApiError('ENHANCE_UNAVAILABLE', 'reason'))).toBe(enhanceText.unavailable);
    for (const code of ['ENHANCE_BUSY', 'ENHANCE_STALE', 'ENHANCE_CANCELLED', 'STALE_REQUEST_CONTEXT', 'ACCOUNT_REVOKED', 'ACCOUNT_MISSING']) {
      expect(failureText(new ApiError(code, 'reason', 409)), code).toBe(enhanceText.busy);
    }
  });
  it('falls back to the generic failure copy for other causes', () => {
    expect(failureText(new ApiError('ENHANCE_PROVIDER', 'reason'))).toBe(enhanceText.failed);
    expect(failureText(new ApiError('ENHANCE_INVALID_DRAFT', 'reason'))).toBe(enhanceText.failed);
    expect(failureText(new Error('network'))).toBe(enhanceText.failed);
    expect(failureText('string')).toBe(enhanceText.failed);
  });
  it('never leaks the server message into user copy', () => {
    const text = failureText(new ApiError('ENHANCE_PROVIDER', 'reason'));
    expect(text).not.toContain('internal secret detail');
  });
});
