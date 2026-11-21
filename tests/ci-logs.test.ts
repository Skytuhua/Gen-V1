import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CI_FAILURE_LIMITS } from '../packages/contracts/ci-failures.ts';
import { extractFailureExcerpt, isBlobMissing } from '../packages/workspace/ci-logs.ts';

const fixture = (name: string) => readFileSync(`tests/fixtures/ci-logs/${name}`, 'utf8');
const stamp = (index: number, text: string) => `2026-11-21T08:00:${String(index % 60).padStart(2, '0')}.0000000Z ${text}`;

describe('extractFailureExcerpt (#1326 T03, R04)', () => {
  it('strips BOM, timestamps, ANSI and group markers; keeps group titles and error lines', () => {
    const { excerpt, lines, truncated } = extractFailureExcerpt(fixture('failed-job.txt'));
    // The earlier 'Set up job' group is outside the failing group's window.
    expect(truncated).toBe(true);
    expect(lines).toBe(6);
    expect(excerpt.endsWith('Post job cleanup.')).toBe(true);
    expect(excerpt).not.toContain('Set up job');
    expect(excerpt).toContain('▸ Run pnpm test');
    expect(excerpt).toContain('Process completed with exit code 1.');
    expect(excerpt).not.toContain('##[error]');
    expect(excerpt).not.toContain('##[group]');
    expect(excerpt).not.toContain('##[endgroup]');
    expect(excerpt).not.toContain('2026-11-21');
    expect(excerpt).not.toContain('\u001B');
    expect(excerpt).not.toContain('\uFEFF');
  });

  it('keeps at most the last maxErrorLines error lines outside the window', () => {
    // 24 early errors lie outside the last-error window; only the final 20
    // errors plus the window survive.
    const early = Array.from({ length: 24 }, (_, index) => `##[error]failure ${index}`);
    const filler = Array.from({ length: 200 }, (_, index) => `context ${index}`);
    const { excerpt } = extractFailureExcerpt([...early, ...filler, '##[error]last'].map((line, index) => stamp(index, line)).join('\n'));
    expect(excerpt).toContain('failure 23');
    expect(excerpt).toContain('failure 5');
    expect(excerpt).not.toContain('failure 4');
    expect(excerpt).toContain('context 199');
    expect(excerpt).toContain('last');
    expect(excerpt.split('\n').filter(line => line.startsWith('failure '))).toHaveLength(19);
  });

  it('bounds context to excerptLines before and afterLines after the last error inside its group', () => {
    const before = Array.from({ length: 300 }, (_, index) => `step ${index}`);
    const after = Array.from({ length: 30 }, (_, index) => `tail ${index}`);
    const log = ['##[group]Work', ...before, '##[error]boom', ...after].map((line, index) => stamp(index, line)).join('\n');
    const { excerpt, truncated } = extractFailureExcerpt(log);
    expect(truncated).toBe(true);
    const parts = excerpt.split('\n');
    expect(parts).toContain('boom');
    expect(parts).toContain('tail 19');
    expect(parts).not.toContain('tail 20');
    expect(parts).toContain('step 100');
    expect(parts).not.toContain('step 99');
    expect(parts).not.toContain('step 0');
  });

  it('does not reach across a group boundary for pre-error context', () => {
    const first = Array.from({ length: 250 }, (_, index) => stamp(index, `group-one ${index}`));
    const log = ['##[group]One', ...first, '##[endgroup]', '##[group]Two', 'in two', '##[error]failed here'].join('\n');
    const { excerpt } = extractFailureExcerpt(log);
    expect(excerpt).toContain('▸ Two');
    expect(excerpt).toContain('failed here');
    expect(excerpt).toContain('in two');
    expect(excerpt).not.toContain('group-one');
  });

  it('keeps the last excerptLines lines when no error exists', () => {
    const log = Array.from({ length: 250 }, (_, index) => stamp(index, `line ${index}`)).join('\n');
    expect(log).toContain('line 249');
    const { excerpt, lines, truncated } = extractFailureExcerpt(log);
    expect(truncated).toBe(true);
    expect(lines).toBe(200);
    expect(excerpt).not.toContain('line 49\n');
    expect(excerpt).toContain('line 50');
    expect(excerpt).toContain('line 249');
  });

  it('caps the excerpt at excerptBytes cutting from the top', () => {
    const long = Array.from({ length: 400 }, (_, index) => stamp(index, `payload ${index} ${'x'.repeat(80)}`));
    const { excerpt, truncated } = extractFailureExcerpt([...long, '##[error]at end'].join('\n'));
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(CI_FAILURE_LIMITS.excerptBytes);
    expect(excerpt).toContain('at end');
  });

  it('handles CRLF input', () => {
    const { excerpt, truncated } = extractFailureExcerpt(`${stamp(0, 'one')}\r\n${stamp(1, '##[error]two')}\r\n${stamp(2, 'three')}`);
    expect(truncated).toBe(false);
    expect(excerpt.split('\n')).toEqual(['one', 'two', 'three']);
  });

  it('returns an empty excerpt for an empty log', () => {
    expect(extractFailureExcerpt('')).toEqual({ excerpt: '', lines: 0, truncated: false });
  });
});

describe('isBlobMissing', () => {
  it('detects the Azure BlobNotFound error body', () => {
    expect(isBlobMissing(fixture('blob-missing.xml'))).toBe(true);
    expect(isBlobMissing(fixture('failed-job.txt'))).toBe(false);
    expect(isBlobMissing('')).toBe(false);
  });
});
