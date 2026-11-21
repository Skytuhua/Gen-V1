import {useEffect, useState} from 'react';
import {formatDayFull, formatDayLabel, formatMessageDateTime, formatMessageTime, localDayKey, type TimeFormat} from './time-format';

export type DayBreak = {dayKey: string; beforeIndex: number};

/** Indices where a date header goes. Empty unless the rows span two or more local
 * days. Rows with invalid times join the previous day; leading invalid rows
 * belong to the first group and render before its header. */
export function dayBreaks<T>(rows: readonly T[], createdAt: (row: T) => string | undefined): DayBreak[] {
  const breaks: DayBreak[] = [];
  let current: string | null = null;
  rows.forEach((row, index) => {
    const value = createdAt(row), dayKey = value === undefined ? null : localDayKey(value);
    if (dayKey && dayKey !== current) {
      breaks.push({dayKey, beforeIndex: index});
      current = dayKey;
    }
  });
  return new Set(breaks.map(item => item.dayKey)).size >= 2 ? breaks : [];
}

/** Re-renders at the next local midnight so day labels roll over; returns the
 * current Date. One timer per mounted transcript, cleared on unmount. */
export function useLocalNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const at = new Date();
    const next = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
    const timer = setTimeout(() => setNow(new Date()), next.getTime() - at.getTime() + 1000);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}

export function MessageTime({createdAt, timeFormat}: {createdAt: string; timeFormat: TimeFormat}) {
  const short = formatMessageTime(createdAt, timeFormat);
  if (!short) return null;
  const full = formatMessageDateTime(createdAt, timeFormat);
  return <time className="message-time" dateTime={createdAt} title={full} aria-label={full} data-message-time="">{short}</time>;
}

export function ConversationDayDivider({dayKey, now}: {dayKey: string; now: Date}) {
  return <div className="conversation-day-divider" role="separator" aria-label={formatDayFull(dayKey)} data-day={dayKey}>{formatDayLabel(dayKey, now)}</div>;
}
