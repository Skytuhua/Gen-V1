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
