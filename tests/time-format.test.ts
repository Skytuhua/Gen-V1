import { describe, expect, it } from 'vitest';
import { formatDayFull, formatDayLabel, formatLocalClock, formatLocalDateTime, formatMessageDateTime, formatMessageTime, localDayKey, localTimeOptions } from '../apps/web/src/time-format';

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

// #1282 T02: message send-time helpers and day-header labels.
describe('message time and day labels', () => {
  it('renders minute-precision clock times per the Time format preference', () => {
    const at = '2026-11-20T15:42:00';
    expect(formatMessageTime(at, '12h', 'en-US')).toBe('3:42 PM');
    expect(formatMessageTime(at, '24h', 'en-US')).toBe('15:42');
    expect(formatMessageTime(at, 'system', 'en-US')).toBe('3:42 PM');
  });
  it('renders the full local date+time for titles and accessible names', () => {
    const full = formatMessageDateTime('2026-11-20T15:42:00', '24h', 'en-US');
    expect(full).toContain('Friday');
    expect(full).toContain('November 20, 2026');
    expect(full).toContain('15:42');
  });
  it('rejects empty and unparsable values instead of rendering Invalid Date', () => {
    for (const bad of ['', 'not-a-date']) {
      expect(formatMessageTime(bad, '24h', 'en-US')).toBe('');
      expect(formatMessageDateTime(bad, '12h', 'en-US')).toBe('');
      expect(localDayKey(bad)).toBeNull();
    }
  });
  it('keys local calendar days in the runtime zone', () => {
    expect(localDayKey('2026-11-20T15:42:00')).toBe('2026-11-20');
    expect(localDayKey('2026-11-20T23:59:59')).toBe('2026-11-20');
    expect(localDayKey(new Date(2026, 10, 20, 15, 42))).toBe('2026-11-20');
  });
  it('labels Today, Yesterday, weekday, same-year and other-year days', () => {
    const now = new Date(2026, 10, 21, 12, 0); // Saturday 2026-11-21 local
    expect(formatDayLabel('2026-11-21', now, 'en-US')).toBe('Today');
    expect(formatDayLabel('2026-11-20', now, 'en-US')).toBe('Yesterday');
    expect(formatDayLabel('2026-11-19', now, 'en-US')).toBe('Thursday');
    expect(formatDayLabel('2026-11-16', now, 'en-US')).toBe('Monday');
    expect(formatDayLabel('2026-11-03', now, 'en-US')).toBe('November 3');
    expect(formatDayLabel('2025-12-30', now, 'en-US')).toBe('December 30, 2025');
  });
  it('counts calendar days across a DST boundary instead of raw elapsed hours', () => {
    const now = new Date(2026, 10, 2, 12, 0); // day after US DST end
    expect(formatDayLabel('2026-11-01', now, 'en-US')).toBe('Yesterday');
    const spring = new Date(2026, 2, 9, 12, 0);
    expect(formatDayLabel('2026-03-08', spring, 'en-US')).toBe('Yesterday');
  });
  it('renders the full day for separator accessible names', () => {
    expect(formatDayFull('2026-11-20', 'en-US')).toBe('Friday, November 20, 2026');
    expect(formatDayFull('bad-key', 'en-US')).toBe('');
  });
});
