import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE, type Thread } from '../packages/contracts';
import { contextSegments } from '../apps/web/src/ContextMeter';
import { acceptedCompaction, ownedCompaction, type ContextCompactionReport } from '../apps/web/src/ContextInspector';
import { runtimeUsageReport, usageCost, usageCount, usagePercent, usageReset } from '../apps/web/src/usage-presentation';

describe('reported context measurements', () => {
  it('keeps unknown category data unknown instead of fabricating Used or Other segments', () => {
    const value = contextSegments({ ...EMPTY_USAGE, contextTokens: 30, contextWindow: 100 });
    expect(value?.categories).toEqual([]);
    const partial = contextSegments({ ...EMPTY_USAGE, contextTokens: 30, contextWindow: 100, contextBreakdown: [{ label: 'System', tokens: 10 }] });
    expect(partial?.categories.map(item => item.label)).toEqual(['System']);
  });
  it('rejects impossible capacity and unknown or duplicate category breakdowns', () => {
    expect(contextSegments({ ...EMPTY_USAGE, contextTokens: 101, contextWindow: 100 })).toBeNull();
    for (const contextBreakdown of [[{ label: 'Made up', tokens: 10 }], [{ label: 'System', tokens: 10 }, { label: 'System', tokens: 10 }]]) {
      expect(contextSegments({ ...EMPTY_USAGE, contextTokens: 30, contextWindow: 100, contextBreakdown })?.categories).toEqual([]);
    }
  });
  it('shows Free and Reserved only when reported and rejects inconsistent partitions', () => {
    const base = { ...EMPTY_USAGE, contextTokens: 30, contextWindow: 100 };
    expect(contextSegments(base)?.free).toBeUndefined();
    const value = contextSegments({ ...base, contextBreakdown: [{ label: 'Messages', tokens: 30 }, { label: 'Reserved', tokens: 10 }, { label: 'Free', tokens: 60 }] });
    expect(value?.complete).toBe(true); expect(value?.free).toBe(60);
    expect(contextSegments({ ...base, contextBreakdown: [{ label: 'Free', tokens: 99 }] })?.categories).toEqual([]);
  });
  it('ignores malformed breakdowns instead of throwing or manufacturing values', () => {
    for (const value of [{}, [null], [{ label: 'System', tokens: -1 }]]) {
      expect(contextSegments({ ...EMPTY_USAGE, contextTokens: 30, contextWindow: 100, contextBreakdown: value as never })?.categories).toEqual([]);
    }
  });
});

describe('compaction evidence ownership', () => {
  const thread = { id: 'owner', sessionPath: '/session', epoch: 2, runId: null, status: 'ready' } as Thread;
  const usage = { ...EMPTY_USAGE, contextTokens: 30, contextWindow: 100 };
  const report: ContextCompactionReport = { threadId: 'owner', sessionPath: '/session', epoch: 2, runId: 'compact', status: 'accepted',
    receipt: { id: 'receipt', threadId: 'owner', sessionPath: '/session', epoch: 2, runId: 'compact', beforeTokens: 80, afterTokens: 30, contextWindow: 100 } };
  it('requires an accepted receipt rather than a command acknowledgement or usage decrease', () => {
    expect(acceptedCompaction(thread, undefined, usage)).toBeUndefined();
    for (const status of ['pending', 'failed', 'cancelled'] as const) expect(acceptedCompaction(thread, { ...report, status }, usage)).toBeUndefined();
    expect(acceptedCompaction(thread, report, usage)?.freed).toBe(50);
  });
  it.each(['threadId', 'sessionPath', 'runId', 'epoch'] as const)('rejects a receipt with a different %s', field => {
    expect(acceptedCompaction(thread, { ...report, receipt: { ...report.receipt!, [field]: field === 'epoch' ? 1 : 'foreign' } }, usage)).toBeUndefined();
  });
  it('discards prior thread, session, epoch, stopped and active-run reports', () => {
    for (const patch of [{ id: 'other' }, { sessionPath: '/other' }, { epoch: 3 }, { runId: 'new-run' }, { status: 'stopped' as const }, { status: 'interrupted' as const }]) {
      expect(ownedCompaction({ ...thread, ...patch }, report)).toBeUndefined();
    }
  });
  it('does not claim a freed count from unreported or mismatched measurements', () => {
    expect(acceptedCompaction(thread, { ...report, receipt: { ...report.receipt!, beforeTokens: undefined } }, usage)?.freed).toBeUndefined();
    expect(acceptedCompaction(thread, report, { ...usage, contextTokens: 20 })?.freed).toBeUndefined();
    expect(acceptedCompaction(thread, { ...report, receipt: { ...report.receipt!, beforeTokens: 101 } }, usage)?.freed).toBeUndefined();
  });
});

describe('reported usage presentation', () => {
  it('retains reported zero and precision while rejecting invalid metrics', () => {
    expect(usageCount(0)).toBe('0'); expect(usageCount(null)).toBe('Not reported');
    expect(usageCount(-1)).toBe('Not reported'); expect(usageCount(NaN)).toBe('Not reported');
    expect(usagePercent(23.456)).toBe('23.5%'); expect(usagePercent(0)).toBe('0.0%'); expect(usagePercent(80)).toBe('80.0%'); expect(usagePercent(101)).toBe('Not reported');
    expect(usageCost({ amount: 0.00123456, currency: 'USD' })).toContain('0.00123456');
    expect(usageCost({ amount: 1e-25, currency: 'USD' })).toBe('0.0000000000000000000000001 USD');
    expect(usageCost({ amount: 0 })).toBe('0 (currency not reported)');
  });
  it('formats reset instants with a four-digit year and preserves unparseable reports', () => {
    expect(usageReset('2030-01-01T12:34:56Z')).toContain('2030');
    expect(usageReset('2030-01-01T12:34:56Z')).not.toContain('T12:34:56Z');
    expect(usageReset(null)).toBe('Not reported'); expect(usageReset('  ')).toBe('Not reported');
    expect(usageReset('After next request')).toBe('After next request');
  });
  it('adapts only the selected thread snapshot with no invented currency, reset, quota or totals', () => {
    const report = runtimeUsageReport({ id: 'owner', title: 'Owner', modelId: 'runtime/model' }, { ...EMPTY_USAGE, inputTokens: 7, cost: 0.5 });
    expect(report).toMatchObject({ scopeId: 'owner', scopeLabel: 'Owner', providerId: 'runtime', inputTokens: 7, cost: { amount: 0.5 } });
    expect(report?.cost?.currency).toBeUndefined(); expect(report?.limits?.every(limit => limit.reset === undefined)).toBe(true);
    expect(runtimeUsageReport(undefined, EMPTY_USAGE)).toBeUndefined();
  });
});
