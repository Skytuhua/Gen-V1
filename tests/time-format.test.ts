import { describe, expect, it } from 'vitest';
import { formatLocalClock, formatLocalDateTime, formatTurnDuration, isoDuration, localTimeOptions } from '../apps/web/src/time-format';

// T07/R10: one absolute-time rule for the named consumers; 13:05 fixture, fixed locale.
// Schedules, explicitly labelled UTC logs, source timestamps and relative "ago" values
// keep their own semantics and do not use this helper.
describe('shared absolute local clock format', () => {
  const at = '2026-11-16T13:05:00';
  it('maps the preference to Intl hour cycles without touching other options', () => {
    expect(localTimeOptions('system')).toEqual({});
    expect(localTimeOptions('12h')).toEqual({ hour12: true });
    expect(localTimeOptions('24h')).toEqual({ hour12: false });
    expect(localTimeOptions('24h', { dateStyle: 'medium', timeStyle: 'short' })).toEqual({ dateStyle: 'medium', timeStyle: 'short', hour12: false });
    expect(localTimeOptions('system', { timeStyle: 'short' })).toEqual({ timeStyle: 'short' });
  });
  it('renders the 13:05 fixture consistently for clock-only consumers', () => {
    expect(formatLocalClock(at, '24h', 'en-US')).toBe('13:05');
    expect(formatLocalClock(at, '12h', 'en-US')).toBe('1:05 PM');
    expect(formatLocalClock(at, 'system', 'en-US')).toBe('1:05 PM');
  });
  it('renders date+time consumers with the same hour cycle', () => {
    expect(formatLocalDateTime(at, '24h', 'en-US', { dateStyle: 'medium', timeStyle: 'short' })).toContain('13:05');
    expect(formatLocalDateTime(at, '12h', 'en-US', { dateStyle: 'medium', timeStyle: 'short' })).toContain('1:05 PM');
    expect(formatLocalDateTime(at, 'system', 'en-US', { dateStyle: 'medium', timeStyle: 'short' })).toContain('1:05 PM');
  });
  it('accepts epoch milliseconds (device expiry) as well as ISO strings', () => {
    const epoch = new Date(at).getTime();
    expect(formatLocalClock(epoch, '24h', 'en-US')).toBe('13:05');
  });
});

// R04: turn-duration label + ISO dateTime for the transcript duration lines.
describe('formatTurnDuration', () => {
  it.each([
    [0, '<1s'], [999, '<1s'], [1000, '1s'], [59_999, '59s'],
    [60_000, '1m 0s'], [72_000, '1m 12s'], [3_599_000, '59m 59s'],
    [3_600_000, '1h 0m 0s'], [4_309_000, '1h 11m 49s'], [93_784_000, '26h 3m 4s'],
  ])('renders %d ms as %s', (ms, expected) => {
    expect(formatTurnDuration(ms)).toBe(expected);
  });
  it('reads negative and non-finite input as zero', () => {
    expect(formatTurnDuration(-5000)).toBe('<1s');
    expect(formatTurnDuration(Number.NaN)).toBe('<1s');
    expect(formatTurnDuration(Number.POSITIVE_INFINITY)).toBe('<1s');
  });
});

describe('isoDuration', () => {
  it.each([
    [0, 'PT0S'], [72_000, 'PT1M12S'], [4_309_000, 'PT1H11M49S'],
    [-5000, 'PT0S'], [Number.NaN, 'PT0S'],
  ])('renders %d ms as %s', (ms, expected) => {
    expect(isoDuration(ms)).toBe(expected);
  });
});
