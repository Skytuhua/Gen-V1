import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationDayDivider, dayBreaks, MessageTime } from '../apps/web/src/message-time';

// #1282 T03: day grouping and the unstyled timestamp/day-divider markup.

describe('dayBreaks', () => {
  const row = (createdAt: string | undefined) => ({ createdAt });
  const at = (rows: { createdAt?: string }[]) => dayBreaks(rows, item => item.createdAt);
  it('returns no headers when visible rows span a single local day', () => {
    expect(at([row('2026-11-20T09:00:00'), row('2026-11-20T15:00:00'), row('2026-11-20T23:00:00')])).toEqual([]);
  });
  it('marks each new local day when rows span three days', () => {
    expect(at([row('2026-11-18T10:00:00'), row('2026-11-19T10:00:00'), row('2026-11-19T12:00:00'), row('2026-11-20T10:00:00')])).toEqual([
      { dayKey: '2026-11-18', beforeIndex: 0 },
      { dayKey: '2026-11-19', beforeIndex: 1 },
      { dayKey: '2026-11-20', beforeIndex: 3 },
    ]);
  });
  it('keeps rows with invalid times inside the previous day', () => {
    expect(at([row('2026-11-19T10:00:00'), row(''), row('not-a-date'), row('2026-11-20T10:00:00')])).toEqual([
      { dayKey: '2026-11-19', beforeIndex: 0 },
      { dayKey: '2026-11-20', beforeIndex: 3 },
    ]);
  });
  it('does not let leading invalid rows form their own group', () => {
    expect(at([row(''), row(undefined), row('2026-11-19T10:00:00'), row('2026-11-20T10:00:00')])).toEqual([
      { dayKey: '2026-11-19', beforeIndex: 2 },
      { dayKey: '2026-11-20', beforeIndex: 3 },
    ]);
  });
  it('returns no headers when every time is invalid', () => {
    expect(at([row(''), row('not-a-date'), row(undefined)])).toEqual([]);
  });
});

describe('MessageTime', () => {
  it('renders one time element with the stored ISO value and a full label', () => {
    const html = renderToStaticMarkup(createElement(MessageTime, { createdAt: '2026-11-20T15:42:00', timeFormat: '24h' }));
    expect(html).toContain('data-message-time');
    expect(html).toContain('dateTime="2026-11-20T15:42:00"');
    expect(html).toContain('aria-label="Friday, November 20, 2026 at 15:42"');
    expect(html).toContain('>15:42</time>');
  });
  it('honours the 12h preference', () => {
    const html = renderToStaticMarkup(createElement(MessageTime, { createdAt: '2026-11-20T15:42:00', timeFormat: '12h' }));
    expect(html).toContain('>3:42 PM</time>');
  });
  it('renders nothing for empty or unparsable send times', () => {
    expect(renderToStaticMarkup(createElement(MessageTime, { createdAt: '', timeFormat: '24h' }))).toBe('');
    expect(renderToStaticMarkup(createElement(MessageTime, { createdAt: 'not-a-date', timeFormat: '24h' }))).toBe('');
  });
});

describe('ConversationDayDivider', () => {
  it('renders a labelled separator with the day key and relative label', () => {
    const html = renderToStaticMarkup(createElement(ConversationDayDivider, { dayKey: '2026-11-20', now: new Date(2026, 10, 21, 12, 0) }));
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Friday, November 20, 2026"');
    expect(html).toContain('data-day="2026-11-20"');
    expect(html).toContain('>Yesterday<');
  });
  it('relays the computed label for older days', () => {
    const html = renderToStaticMarkup(createElement(ConversationDayDivider, { dayKey: '2026-11-03', now: new Date(2026, 10, 21, 12, 0) }));
    expect(html).toContain('>November 3<');
  });
  it('renders alongside message rows without changing row markup', () => {
    const html = renderToStaticMarkup(createElement(Fragment, {}, createElement(ConversationDayDivider, { dayKey: '2026-11-21', now: new Date(2026, 10, 21, 12, 0) }), createElement('div', { className: 'message message-user' }, createElement('span', { className: 'sr-only' }, 'You'), createElement(MessageTime, { createdAt: '2026-11-21T09:00:00', timeFormat: 'system' }), createElement('div', { className: 'message-content' }, 'Hi'))));
    expect(html.indexOf('data-day')).toBeLessThan(html.indexOf('message-content'));
    expect(html).toContain('>Today<');
  });
});
