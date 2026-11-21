import type { UiPreferences } from '../../../packages/contracts/preferences';

export type TimeFormat = UiPreferences['timeFormat'];

/** One hour-cycle rule for displayed absolute local clock times (T07/R10).
 * Schedules, explicitly labelled UTC logs, source timestamps and relative "ago"
 * values keep their own semantics and must not route through this helper. */
export function localTimeOptions(timeFormat: TimeFormat, base: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
  return timeFormat === 'system' ? base : { ...base, hour12: timeFormat === '12h' };
}

/** Clock-only display (last checked, device expiry): minute precision by default. */
export function formatLocalClock(value: string | number | Date, timeFormat: TimeFormat, locale?: string, options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }): string {
  return new Date(value).toLocaleTimeString(locale, localTimeOptions(timeFormat, options));
}

/** Date+time display (captured/checked stamps): caller keeps its date/time semantics. */
export function formatLocalDateTime(value: string | number | Date, timeFormat: TimeFormat, locale?: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleString(locale, localTimeOptions(timeFormat, options));
}

/** Whole-seconds run duration for the transcript ("Worked for 1m 12s"): fixed
 * English unit letters; once a higher unit appears every lower unit is shown;
 * hours never roll into days. Negative/non-finite input reads as 0. */
export function formatTurnDuration(ms: number): string {
  const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  if (total < 1) return '<1s';
  const seconds = total % 60, minutes = Math.floor(total / 60) % 60, hours = Math.floor(total / 3600);
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** ISO 8601 duration for `<time dateTime>` matching formatTurnDuration. */
export function isoDuration(ms: number): string {
  const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  const seconds = total % 60, minutes = Math.floor(total / 60) % 60, hours = Math.floor(total / 3600);
  return `PT${hours ? hours + 'H' : ''}${minutes ? minutes + 'M' : ''}${seconds}S`;
}
