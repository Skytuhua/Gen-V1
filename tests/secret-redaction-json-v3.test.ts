import { describe, expect, it } from 'vitest';
import { createSecretRedactor } from '../packages/core/secret-references';

describe('declared secret field JSON boundaries', () => {
  it.each([
    ['escaped quote', 'prefix"secret-after-quote'],
    ['escaped backslash then quote', 'prefix\\"secret-after-quote'],
    ['multiple quotes', 'first"middle"last-secret'],
    ['escaped line break and quote', 'first\n"last-secret'],
    ['trailing backslash', 'secret-ending-in-backslash\\'],
    ['ordinary value', 'plain-secret-value'],
    ['empty value', ''],
  ])('redacts the complete %s value and preserves neighboring fields', (_name, secret) => {
    const input = JSON.stringify({ before: 'visible-before', api_key: secret, after: 'visible-after' });
    const result = createSecretRedactor([], { fields: ['api_key'] }).redact(input);
    expect(JSON.parse(result.text)).toEqual({ before: 'visible-before', api_key: '[REDACTED]', after: 'visible-after' });
    expect(result.redactions).toBe(1);
  });

  it('handles whitespace, nesting, repeated fields and regex punctuation in a declared name', () => {
    const input = '{"token.v1" : "first\\\"suffix", "nested":{"token.v1":"second\\\"suffix"},"tokenXv1":"visible"}';
    const result = createSecretRedactor([], { fields: ['token.v1'] }).redact(input);
    expect(JSON.parse(result.text)).toEqual({ 'token.v1': '[REDACTED]', nested: { 'token.v1': '[REDACTED]' }, tokenXv1: 'visible' });
    expect(result.redactions).toBe(2);
  });

  it('maps an escaped value across ANSI sequences without leaving its tail', () => {
    const input = '{"api_key":"prefix\\\"\u001b[31msuffix-secret\u001b[0m","after":"visible"}';
    const result = createSecretRedactor([], { fields: ['api_key'] }).redact(input);
    expect(result.text).not.toContain('suffix-secret');
    expect(result.text.replace(/\u001b\[[0-9;]*m/g, '')).toBe('{"api_key":"[REDACTED]","after":"visible"}');
  });

  it('keeps declared-field redaction separate from registered known-value redaction', () => {
    const input = JSON.stringify({ api_key: 'unknown"secret', public_note: 'known-secret-value', ordinary: 'visible' });
    const result = createSecretRedactor(['known-secret-value'], { fields: ['api_key'] }).redact(input);
    expect(JSON.parse(result.text)).toEqual({ api_key: '[REDACTED]', public_note: '[REDACTED]', ordinary: 'visible' });
    expect(result.redactions).toBe(2);
  });

  it('does not scrub undeclared unknown fields or change already valid unclassified text', () => {
    const input = JSON.stringify({ ordinary: 'unknown"value', nested: { text: 'visible' } });
    expect(createSecretRedactor([], { fields: ['api_key'] }).redact(input)).toEqual({ text: input, redactions: 0 });
  });
});
