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

const valid = (value: string | number | Date) => !Number.isNaN(new Date(value).getTime());

/** Minute-precision local clock for a message send time; '' when invalid. */
export function formatMessageTime(createdAt: string, timeFormat: TimeFormat, locale?: string): string {
  return valid(createdAt) ? formatLocalClock(createdAt, timeFormat, locale) : '';
}

/** Full local date+time for title / accessible name; '' when invalid. */
export function formatMessageDateTime(createdAt: string, timeFormat: TimeFormat, locale?: string): string {
  return valid(createdAt) ? formatLocalDateTime(createdAt, timeFormat, locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

/** Local calendar day key 'YYYY-MM-DD' in the runtime zone; null when invalid. */
export function localDayKey(value: string | number | Date): string | null {
  if (!valid(value)) return null;
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Local-midnight Date for a 'YYYY-MM-DD' key; null when the key is malformed. */
function dayOfKey(dayKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(day.getTime()) ? null : day;
}

/** Date header label relative to `now`: 'Today' | 'Yesterday' | weekday | 'November 3' | 'November 3, 2025'. */
export function formatDayLabel(dayKey: string, now: Date, locale?: string): string {
  const day = dayOfKey(dayKey), todayKey = localDayKey(now);
  if (!day || !todayKey) return '';
  const today = dayOfKey(todayKey)!;
  const diffDays = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const options: Intl.DateTimeFormatOptions = diffDays >= 2 && diffDays <= 6 ? { weekday: 'long' } : day.getFullYear() === now.getFullYear() ? { month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' };
  return day.toLocaleDateString(locale, options);
}

/** Full date for the separator's accessible name, e.g. 'Friday, November 20, 2026'; '' when malformed. */
export function formatDayFull(dayKey: string, locale?: string): string {
  const day = dayOfKey(dayKey);
  return day ? day.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
}
