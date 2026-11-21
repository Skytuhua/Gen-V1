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

// T04: capture + normalizer coverage over real files in owned temp dirs.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectTestReport, createReportDir, removeReportDir } from '../packages/capabilities/test-report.ts';

const dirs: string[] = [];
import { afterEach } from 'vitest';
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

async function reportDir() {
  const root = await mkdtemp(join(tmpdir(), 't04-reports-'));
  dirs.push(root);
  return root;
}

const nodeEvent = (over: Record<string, unknown>) => JSON.stringify({
  type: 'pass', name: 't', nesting: 0, file: 'a.test.cjs', line: 1, kind: 'test', skip: false, todo: false, durationMs: 1, ...over,
});

describe('collectTestReport (node-test)', () => {
  it('normalizes nested suites and statuses into the file-rooted tree', async () => {
    const dir = await reportDir();
    const lines = [
      nodeEvent({ type: 'pass', kind: 'suite', name: 'outer', nesting: 0 }),
      nodeEvent({ type: 'pass', name: 'inner passes', nesting: 1 }),
      nodeEvent({ type: 'fail', name: 'inner fails', nesting: 1, error: { message: 'boom', expected: 1, actual: 2, stack: `Error: boom\n    at t (a.test.cjs:2:5)\n    at other (/usr/lib/node_modules/x.js:1:1)` } }),
      nodeEvent({ type: 'pass', name: 'skipped leaf', nesting: 0, skip: true }),
      nodeEvent({ type: 'pass', name: 'todo leaf', nesting: 0, todo: true }),
    ].join('\n');
    await writeFile(join(dir, 'node-test.jsonl'), lines);
    const run = await collectTestReport(dir, 'node-test', process.cwd());
    expect(run.reportState).toBe('complete');
    expect(run.totals).toEqual({ tests: 4, passed: 1, failed: 1, skipped: 1, todo: 1 });
    const root = run.suites[0];
    expect(root.status).toBe('failed');
    const outer = root.suites.find(s => s.name === 'outer')!;
    expect(outer.status).toBe('failed');
    const failed = outer.tests.find(t => t.status === 'failed')!;
    expect(failed.fullName).toBe('outer inner fails');
    expect(failureFields(failed).message).toBe('boom');
    expect(failureFields(failed).expected).toBe('1');
    expect(failureFields(failed).stack).toHaveLength(1); // outside-project frame dropped
    expect(failed.id).toMatch(/^t[0-9a-f]{16}$/);
    expect(root.id).toMatch(/^s[0-9a-f]{16}$/);
  });

  it('maps missing, empty, unreadable-shape and unparseable reports to reportState', async () => {
    const dir = await reportDir();
    expect((await collectTestReport(dir, 'node-test', process.cwd())).reportState).toBe('missing');
    await writeFile(join(dir, 'node-test.jsonl'), '');
    expect((await collectTestReport(dir, 'node-test', process.cwd())).reportState).toBe('missing');
    await writeFile(join(dir, 'node-test.jsonl'), 'not json at all');
    const run = await collectTestReport(dir, 'node-test', process.cwd());
    expect(run.reportState).toBe('complete'); // unparseable lines are skipped; nothing observed
    expect(run.totals.tests).toBe(0);
    await mkdir(join(dir, 'vitest.json'));
    expect((await collectTestReport(dir, 'vitest', process.cwd())).reportState).toBe('invalid');
  });

  it('truncates beyond the limits but still counts every test', async () => {
    const dir = await reportDir();
    const many = Array.from({ length: 2100 }, (_, i) => nodeEvent({ name: `t${i}`, type: i === 2099 ? 'fail' : 'pass' })).join('\n');
    await writeFile(join(dir, 'node-test.jsonl'), many);
    const run = await collectTestReport(dir, 'node-test', process.cwd());
    expect(run.reportState).toBe('partial');
    expect(run.truncated).toBe(true);
    expect(run.totals.tests).toBe(2100);
    const kept = run.suites.flatMap(s => s.tests);
    expect(kept.length).toBeLessThanOrEqual(2000);
    expect(kept[0].status).toBe('failed'); // failures kept first
  });
});

const failureFields = (t: { failure?: { message: string; expected?: string; stack: unknown[] } }) => t.failure!;

describe('collectTestReport (vitest)', () => {
  it('normalizes ancestor titles, failure messages, durations and totals', async () => {
    const dir = await reportDir();
    const report = {
      numTotalTests: 3, numPassedTests: 1, numFailedTests: 1, numPendingTests: 1, numTodoTests: 0,
      startTime: 1000, endTime: 1500,
      testResults: [{
        name: join(process.cwd(), 'pkg', 'x.test.ts'),
        assertionResults: [
          { ancestorTitles: ['group'], title: 'works', fullName: 'group works', status: 'passed', duration: 3 },
          { ancestorTitles: ['group'], title: 'fails', fullName: 'group fails', status: 'failed', duration: 4,
            failureMessages: ['AssertionError: expected 2 to be 1\n    at x (pkg/x.test.ts:9:3)'], location: { line: 9, column: 3 } },
          { ancestorTitles: [], title: 'skipped', fullName: 'skipped', status: 'pending' },
        ],
      }],
    };
    await writeFile(join(dir, 'vitest.json'), JSON.stringify(report));
    const run = await collectTestReport(dir, 'vitest', process.cwd());
    expect(run.reportState).toBe('complete');
    expect(run.durationMs).toBe(500);
    expect(run.totals).toEqual({ tests: 3, passed: 1, failed: 1, skipped: 1, todo: 0 });
    const root = run.suites[0];
    expect(root.file).toBe('pkg/x.test.ts');
    const group = root.suites[0];
    expect(group.name).toBe('group');
    const failed = group.tests.find(t => t.status === 'failed')!;
    expect(failed.fullName).toBe('group fails');
    expect(failed.failure!.message).toContain('expected 2 to be 1');
    expect(failed.location).toEqual({ file: 'pkg/x.test.ts', line: 9, column: 3 });
  });

  it('carries filter and rerunOf through to the run', async () => {
    const dir = await reportDir();
    await writeFile(join(dir, 'vitest.json'), JSON.stringify({ testResults: [] }));
    const run = await collectTestReport(dir, 'vitest', process.cwd(), { testName: 'group works' }, { operationId: 'op1', testId: 'taaaaaaaaaaaaaaaa' });
    expect(run.filter).toEqual({ testName: 'group works' });
    expect(run.rerunOf).toEqual({ operationId: 'op1', testId: 'taaaaaaaaaaaaaaaa' });
  });
});

describe('report directory lifecycle', () => {
  it('creates a private directory under dataDir/test-reports and removes it', async () => {
    const dataDir = await reportDir();
    const dir = await createReportDir(dataDir);
    expect(dir.startsWith(join(dataDir, 'test-reports'))).toBe(true);
    await removeReportDir(dir);
    const fs = await import('node:fs/promises');
    await expect(fs.lstat(dir)).rejects.toThrow();
  });
});
