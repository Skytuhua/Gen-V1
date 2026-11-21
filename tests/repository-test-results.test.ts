import { describe, expect, it } from 'vitest';
import { TEST_RUN_LIMITS, testRunV1Schema } from '../packages/contracts/test-results.ts';

function testCase(over: Record<string, unknown> = {}) {
  return { id: 't' + 'a'.repeat(16), name: 'works', fullName: 'suite works', status: 'passed', ...over };
}
function suite(over: Record<string, unknown> = {}) {
  return { id: 's' + 'b'.repeat(16), name: 'file.test.ts', file: 'src/file.test.ts', status: 'passed', suites: [], tests: [testCase()], ...over };
}
function run(over: Record<string, unknown> = {}) {
  return { version: 1, runner: 'node-test', reportState: 'complete', totals: { tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0 }, suites: [suite()], truncated: false, ...over };
}

describe('testRunV1Schema contract', () => {
  it('accepts a complete minimal run', () => {
    const parsed = testRunV1Schema.parse(run());
    expect(parsed.runner).toBe('node-test');
    expect(parsed.totals.passed).toBe(1);
  });

  it('accepts nested suites, failure detail, filter and rerunOf', () => {
    const failed = testCase({
      id: 't' + 'd'.repeat(16), status: 'failed',
      failure: { message: 'nope', expected: '1', actual: '2', stack: [{ file: 'src/a.ts', line: 3, column: 4, text: 'at x' }], truncated: false },
      location: { file: 'src/a.ts', line: 3 },
    });
    const parsed = testRunV1Schema.parse(run({
      runner: 'vitest',
      suites: [suite({ suites: [suite({ id: 's' + 'c'.repeat(16), name: 'group', tests: [failed] })] })],
      filter: { testName: 'suite works' },
      rerunOf: { operationId: 'op1', testId: 't' + 'd'.repeat(16) },
    }));
    expect(parsed.suites[0].suites[0].tests[0].failure?.stack).toHaveLength(1);
    expect(parsed.rerunOf?.testId).toBe('t' + 'd'.repeat(16));
  });

  it('rejects malformed ids and wrong version', () => {
    expect(() => testRunV1Schema.parse(run({ suites: [suite({ tests: [testCase({ id: 'x' + 'a'.repeat(16) })] })] }))).toThrow();
    expect(() => testRunV1Schema.parse(run({ version: 2 }))).toThrow();
    expect(() => testRunV1Schema.parse(run({ suites: [suite({ id: 's' + 'g'.repeat(16) })] }))).toThrow();
  });

  it('rejects unknown keys and over-limit fields', () => {
    expect(() => testRunV1Schema.parse(run({ extra: 1 }))).toThrow();
    expect(() => testRunV1Schema.parse(run({ suites: [suite({ tests: [testCase({ failure: { message: 'x'.repeat(TEST_RUN_LIMITS.messageChars + 1), stack: [], truncated: false } })] })] }))).toThrow();
    expect(() => testRunV1Schema.parse(run({ suites: [suite({ tests: [testCase({ failure: { message: 'm', stack: new Array(TEST_RUN_LIMITS.stackFrames + 1).fill({ file: 'a', line: 1, text: 'f' }), truncated: false } })] })] }))).toThrow();
  });

  it('rejects invalid enum values', () => {
    expect(() => testRunV1Schema.parse(run({ reportState: 'ok' }))).toThrow();
    expect(() => testRunV1Schema.parse(run({ runner: 'jest' }))).toThrow();
    expect(() => testRunV1Schema.parse(run({ suites: [suite({ tests: [testCase({ status: 'flaky' })] })] }))).toThrow();
  });
});
