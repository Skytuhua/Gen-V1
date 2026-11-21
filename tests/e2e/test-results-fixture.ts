import type { Page } from '@playwright/test';
import type { Operation, TestRunV1 } from '../../packages/contracts';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

export const FIXTURE_RUN: TestRunV1 = {
  version: 1, runner: 'node-test', reportState: 'complete', truncated: false, durationMs: 184,
  totals: { tests: 3, passed: 2, failed: 1, skipped: 0, todo: 0 },
  suites: [{
    id: 's00000000000000a1', name: 'tests/total.test.mjs', file: 'tests/total.test.mjs', status: 'failed', suites: [],
    tests: [
      { id: 't00000000000000a1', name: 'includes item quantity', fullName: 'includes item quantity', status: 'failed', durationMs: 8,
        location: { file: 'tests/total.test.mjs', line: 4, column: 1 },
        failure: { message: 'Expected 12, received 3', expected: '12', actual: '3', stack: [{ file: 'src/total.ts', line: 3, column: 15, text: 'at total (src/total.ts:3:15)' }], truncated: false } },
      { id: 't00000000000000a2', name: 'empty basket returns zero', fullName: 'empty basket returns zero', status: 'passed', durationMs: 2, location: { file: 'tests/total.test.mjs', line: 8, column: 1 } },
      { id: 't00000000000000a3', name: 'rounds the final total', fullName: 'rounds the final total', status: 'passed', durationMs: 3, location: { file: 'tests/total.test.mjs', line: 14, column: 1 } },
    ],
  }],
};

export async function serveTestResultsFixture(page: Page, options: { flag?: boolean; operations?: Operation[] } = {}) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Test results card fixture.' } } } });
  snapshot.artifacts = [];
  if (options.flag !== false) snapshot.capabilities = { 'ui.testResultsV1': true };
  const operation: Operation = {
    id: 'test-operation', threadId: 'task-thread', revision: 2, kind: 'repository.test',
    description: 'Run the prepared project test.', args: { resourceId: 'project-one', testFile: 'tests/total.test.mjs', recipe: 'node-test' },
    resourceIds: ['project-one'], preconditions: { testSha256: 'a'.repeat(64) }, status: 'succeeded', approved: true,
    result: { exitCode: 1, testRun: FIXTURE_RUN },
    createdAt: '2026-11-21T00:00:00.000Z',
  };
  snapshot.operations = [operation, ...(options.operations ?? [])];
  const host = await serveTaskFixture(page, snapshot);
  return {
    ...host, snapshot, operation,
    async addRerun(testId: string, status: Operation['status'] = 'running') {
      snapshot.operations.push({
        id: `rerun-${testId}-${snapshot.operations.length}`, threadId: 'task-thread', revision: 1, kind: 'repository.test',
        description: 'Rerun one test.', args: { resourceId: 'project-one', testFile: 'tests/total.test.mjs', recipe: 'node-test', rerunOf: { operationId: 'test-operation', testId } },
        resourceIds: ['project-one'], preconditions: { testSha256: 'a'.repeat(64) }, status, approved: true,
        result: status === 'succeeded' ? { exitCode: 0, testRun: { ...FIXTURE_RUN, totals: { tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0 }, rerunOf: { operationId: 'test-operation', testId } } } : undefined,
        createdAt: '2026-11-21T00:01:00.000Z',
      });
      await host.publish();
    },
  };
}
