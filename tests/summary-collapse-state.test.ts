import { describe, expect, it } from 'vitest';
import { readSummaryCollapsed, writeSummaryCollapsed } from '../packages/ui-shell/SummaryDock';

function storage(values: Record<string, string> = {}) {
  return { getItem: (key: string) => values[key] ?? null, setItem: (key: string, value: string) => { values[key] = value; }, values };
}
describe('summary collapse preference migration', () => {
  it('reads legacy collapse without importing stale floating geometry', () => {
    const value = storage({ 'harness:floating:plan:v1': JSON.stringify({ collapsed: false, x: 72, width: 9000, floating: true }) });
    expect(readSummaryCollapsed('plan', true, value)).toBe(false);
  });
  it('writes the new collapse record while leaving historical geometry recoverable', () => {
    const old = JSON.stringify({ collapsed: false, x: 72, width: 352 });
    const value = storage({ 'harness:floating:plan:v1': old });
    writeSummaryCollapsed('plan', true, value);
    expect(value.values['harness:floating:plan:v1']).toBe(old);
    expect(readSummaryCollapsed('plan', false, value)).toBe(true);
  });
  it('rejects malformed or oversized storage and keeps a real boolean default', () => {
    for (const raw of ['{broken', '[]', 'true', '{"collapsed":0}', ' '.repeat(1025)]) {
      expect(readSummaryCollapsed('plan', true, storage({ 'harness:summary:plan:v1': raw }))).toBe(true);
    }
  });
  it('uses legacy state when the new record is invalid and ignores retired usage visibility', () => {
    expect(readSummaryCollapsed('usage', true, storage({ 'harness:summary:usage:v1': '{}', 'harness:floating:usage:v1': '{"collapsed":false}', 'harness:usage-floating-open': 'false' }))).toBe(false);
  });
  it('remains usable when browser storage is unavailable', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readSummaryCollapsed('plan', true, blocked)).toBe(true);
    expect(() => writeSummaryCollapsed('plan', false, blocked)).not.toThrow();
  });
});
