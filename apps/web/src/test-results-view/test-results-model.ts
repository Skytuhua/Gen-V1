import type { Operation, TestCaseV1, TestRunV1, TestSuite } from '../../../../packages/contracts/index.ts';

/** Structured test results attached to an approved repository.test operation. */
export function operationTestRun(operation: { result?: unknown }): TestRunV1 | undefined {
  const result = operation.result as { testRun?: unknown } | undefined;
  return result && typeof result === 'object' && result.testRun && typeof result.testRun === 'object'
    ? (result.testRun as TestRunV1) : undefined;
}

/** Latest rerun operation keyed by the source test id it targets. */
export function latestRerunByTest(operations: Operation[], sourceId: string): Map<string, Operation> {
  const map = new Map<string, Operation>();
  for (const op of operations) {
    const rerunOf = (op.args as { rerunOf?: { operationId?: string; testId?: string } } | undefined)?.rerunOf;
    if (rerunOf?.operationId !== sourceId || typeof rerunOf.testId !== 'string') continue;
    const existing = map.get(rerunOf.testId);
    if (!existing || existing.createdAt < op.createdAt) map.set(rerunOf.testId, op);
  }
  return map;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One-line run summary, e.g. "Ran 5 tests, 1 failed, 1 skipped". */
export function runSummary(run: TestRunV1): string {
  const t = run.totals;
  if (t.tests === 0) return 'No tests ran';
  const parts = [`Ran ${plural(t.tests, 'test')}`];
  if (t.failed === 0 && t.skipped === 0 && t.todo === 0) return `${parts[0]}, all passed`;
  if (t.failed) parts.push(`${t.failed} failed`);
  if (t.skipped) parts.push(`${t.skipped} skipped`);
  if (t.todo) parts.push(`${t.todo} to do`);
  return parts.join(', ');
}

/** Duration display: "0.4 s" under a second, one decimal, then "1 min 12 s". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '';
  const s = ms / 1000;
  if (s >= 60) { const m = Math.floor(s / 60), rest = Math.round(s - m * 60); return `${m} min ${rest} s`; }
  return `${(Math.round(s * 10) / 10).toFixed(1)} s`;
}

export function findTest(run: TestRunV1, testId: string): { test: TestCaseV1; suite: TestSuite } | undefined {
  const walk = (suite: TestSuite): { test: TestCaseV1; suite: TestSuite } | undefined => {
    const hit = suite.tests.find(t => t.id === testId);
    return hit ? { test: hit, suite } : suite.suites.map(walk).find(Boolean);
  };
  return run.suites.map(walk).find(Boolean);
}

/** Rerun chip state for a test row. */
export type RerunState = 'pending' | 'running' | 'passed' | 'failed';
export function rerunState(op: Operation | undefined): RerunState | undefined {
  if (!op) return undefined;
  if (op.status === 'prepared') return 'pending';
  if (op.status === 'running') return 'running';
  if (op.status === 'succeeded') return 'passed';
  if (op.status === 'failed' || op.status === 'unknown') return 'failed';
  return undefined;
}
export const rerunLabel: Record<RerunState, string> = {
  pending: 'Rerun pending approval', running: 'Rerunning…', passed: 'Rerun passed', failed: 'Rerun failed',
};
