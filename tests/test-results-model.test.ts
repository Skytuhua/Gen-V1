import { describe, expect, it } from 'vitest';
import type { Operation, TestRunV1 } from '../packages/contracts/index.ts';
import { formatDuration, latestRerunByTest, operationTestRun, rerunState, runSummary } from '../apps/web/src/test-results-view/test-results-model.ts';

const run = (over: Partial<TestRunV1> = {}): TestRunV1 => ({
  version: 1, runner: 'node-test', reportState: 'complete', truncated: false,
  totals: { tests: 5, passed: 3, failed: 1, skipped: 1, todo: 0 },
  suites: [], ...over,
});
const op = (id: string, over: Record<string, unknown> = {}): Operation => ({
  id, threadId: 't', kind: 'repository.test', description: 'run', status: 'succeeded', args: {}, createdAt: 1000, updatedAt: 1000, revision: 1, ...over,
}) as unknown as Operation;

describe('operationTestRun', () => {
  it('reads testRun off the operation result and ignores other shapes', () => {
    expect(operationTestRun(op('a', { result: { testRun: run() } }))?.version).toBe(1);
    expect(operationTestRun(op('b', { result: { exitCode: 0 } }))).toBeUndefined();
    expect(operationTestRun(op('c'))).toBeUndefined();
    expect(operationTestRun(op('d', { result: 'x' }))).toBeUndefined();
  });
});

describe('latestRerunByTest', () => {
  it('keeps the newest rerun op per test for the source operation only', () => {
    const source = 'op-source';
    const older = op('r1', { args: { rerunOf: { operationId: source, testId: 't1' } }, createdAt: 10 });
    const newer = op('r2', { args: { rerunOf: { operationId: source, testId: 't1' } }, createdAt: 20 });
    const other = op('r3', { args: { rerunOf: { operationId: 'other', testId: 't1' } }, createdAt: 30 });
    const plain = op('r4', { createdAt: 40 });
    const map = latestRerunByTest([older, newer, other, plain], source);
    expect(map.get('t1')?.id).toBe('r2');
    expect(map.size).toBe(1);
  });
});

describe('runSummary', () => {
  it('summarizes counts per the spec', () => {
    expect(runSummary(run())).toBe('Ran 5 tests, 1 failed, 1 skipped');
    expect(runSummary(run({ totals: { tests: 40, passed: 40, failed: 0, skipped: 0, todo: 0 } }))).toBe('Ran 40 tests, all passed');
    expect(runSummary(run({ totals: { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 } }))).toBe('No tests ran');
    expect(runSummary(run({ totals: { tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0 } }))).toBe('Ran 1 test, all passed');
  });
});

describe('formatDuration', () => {
  it('formats sub-second, seconds and minutes', () => {
    expect(formatDuration(400)).toBe('0.4 s');
    expect(formatDuration(1840)).toBe('1.8 s');
    expect(formatDuration(72000)).toBe('1 min 12 s');
    expect(formatDuration(undefined)).toBe('');
  });
});

describe('rerunState', () => {
  it('maps operation status to chip states', () => {
    expect(rerunState(op('a', { status: 'prepared' }))).toBe('pending');
    expect(rerunState(op('a', { status: 'running' }))).toBe('running');
    expect(rerunState(op('a', { status: 'succeeded' }))).toBe('passed');
    expect(rerunState(op('a', { status: 'failed' }))).toBe('failed');
    expect(rerunState(op('a', { status: 'unknown' }))).toBe('failed');
    expect(rerunState(op('a', { status: 'cancelled' }))).toBeUndefined();
    expect(rerunState(undefined)).toBeUndefined();
  });
});
