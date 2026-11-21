import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { testRunV1Schema, type Operation, type ResourceGrant, type TestRunV1, type Thread } from '../packages/contracts/index.ts';

import { vi } from 'vitest';

// The native path-guard broker is not available in unit tests; everything else
// (schema, binding capture, hashing, service command path) stays real.
vi.mock('../packages/core/file-access.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/core/file-access.ts')>();
  const { resolveGrant } = await import('../packages/core/security.ts');
  return { ...actual,
    withPathGuard: async (_paths: unknown, _signal: AbortSignal, action: (manifest: []) => Promise<unknown>) => action([]),
    withResourceGrant: async (grant: Parameters<typeof resolveGrant>[0], dataDir: string, relativePath: string | undefined, write: boolean, _signal: AbortSignal, action: (path: string) => Promise<unknown>) =>
      action(await resolveGrant(grant, relativePath, write, dataDir)),
  };
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  __setCapabilityFlagForTests('ui.testResultsV1', undefined);
  for (const fn of cleanups.splice(0)) await fn();
});

const runtime = { configure: () => {}, models: async () => [{ id: 'test/model', provider: 'test', name: 'M' }], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'test-rerun-'));
  const store = new Store(dir);
  const service = new Service(store, runtime as never);
  cleanups.push(async () => { await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const thread = (await service.command({ id: randomUUID(), type: 'thread.create', payload: {} })).result as Thread;
  const project = join(dir, 'project');
  await mkdir(project);
  await writeFile(join(project, 'owned.test.cjs'), "require('node:test')('owned', () => {});\n");
  const info = await stat(project, { bigint: true });
  const grant: ResourceGrant = { id: 'grant-1', threadId: thread.id, kind: 'project', path: project,
    writable: true, label: 'Fixture project', createdAt: new Date().toISOString(), identity: { dev: String(info.dev), ino: String(info.ino) } };
  store.internal('fixture', thread.id, () => store.put('resource', grant.id, thread.id, grant));
  const testRun = testRunV1Schema.parse({
    version: 1, runner: 'node-test', reportState: 'complete',
    totals: { tests: 2, passed: 1, failed: 1, skipped: 0, todo: 0 }, truncated: false,
    suites: [{ id: 's' + 'a'.repeat(16), name: 'owned.test.cjs', file: 'owned.test.cjs', status: 'failed', suites: [
      { id: 's' + 'b'.repeat(16), name: 'outer', file: 'owned.test.cjs', status: 'failed', suites: [], tests: [
        { id: 't' + 'c'.repeat(16), name: 'inner fails', fullName: 'outer inner fails', status: 'failed',
          failure: { message: 'boom', stack: [], truncated: false } },
      ] },
    ], tests: [
      { id: 't' + 'd'.repeat(16), name: 'top passes', fullName: 'top passes', status: 'passed' },
    ] }],
  } satisfies TestRunV1);
  const operation: Operation = {
    id: 'op-source', threadId: thread.id, revision: 3, kind: 'repository.test',
    args: { resourceId: grant.id, testFile: 'owned.test.cjs', recipe: 'node-test' },
    resourceIds: [grant.id], preconditions: {}, description: 'Run tests', status: 'failed',
    approved: true, createdAt: new Date().toISOString(), result: { exitCode: 1, testRun },
  };
  store.internal('fixture', thread.id, () => store.put('operation', operation.id, thread.id, operation));
  const rerun = (over: Record<string, unknown> = {}) => service.command({ id: randomUUID(), type: 'test.rerun', threadId: thread.id,
    payload: { operationId: operation.id, revision: operation.revision, testId: 't' + 'c'.repeat(16), ...over } });
  return { store, service, thread, grant, operation, rerun };
}

describe('test.rerun command', () => {
  it('prepares a single-test rerun operation with testName and rerunOf', async () => {
    const x = await setup();
    __setCapabilityFlagForTests('ui.testResultsV1', true);
    const prepared = (await x.rerun()).result as Operation;
    expect(prepared.id).not.toBe(x.operation.id);
    expect(prepared.kind).toBe('repository.test');
    expect(prepared.status).toBe('prepared');
    const args = prepared.args as Record<string, unknown>;
    expect(args.testName).toBe('outer inner fails');
    expect(args.testFile).toBe('owned.test.cjs');
    expect(args.recipe).toBe('node-test');
    expect(args.rerunOf).toEqual({ operationId: 'op-source', testId: 't' + 'c'.repeat(16) });
    const binding = args.executionBinding as { version: number; argv: string[] };
    expect(binding.version).toBe(2);
    expect(binding.argv.some(a => a.startsWith('--test-name-pattern='))).toBe(true);
  });

  it('returns the same prepared operation on a repeated rerun command', async () => {
    const x = await setup();
    __setCapabilityFlagForTests('ui.testResultsV1', true);
    const first = (await x.rerun()).result as Operation;
    const second = (await x.rerun()).result as Operation;
    expect(second.id).toBe(first.id);
  });

  it('denies flag-off, stale revision, wrong kind, unfinished run and unknown testId', async () => {
    const x = await setup();
    await expect(x.rerun()).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    __setCapabilityFlagForTests('ui.testResultsV1', true);
    await expect(x.rerun({ revision: 99 })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    await expect(x.rerun({ testId: 't' + 'f'.repeat(16) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(x.rerun({ operationId: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    x.store.internal('fixture', x.thread.id, () => x.store.put('operation', 'op-other', x.thread.id, { ...x.operation, id: 'op-other', kind: 'file.replace' }));
    await expect(x.rerun({ operationId: 'op-other' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    x.store.internal('fixture', x.thread.id, () => x.store.put('operation', 'op-running', x.thread.id, { ...x.operation, id: 'op-running', status: 'running' }));
    await expect(x.rerun({ operationId: 'op-running' })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    x.store.internal('fixture', x.thread.id, () => x.store.put('operation', 'op-noresult', x.thread.id, { ...x.operation, id: 'op-noresult', result: { exitCode: 0 } }));
    await expect(x.rerun({ operationId: 'op-noresult' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
