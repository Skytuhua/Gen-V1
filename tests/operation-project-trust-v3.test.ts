import { afterEach, expect, it, vi } from 'vitest';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HarnessError, type Operation, type RuntimeAdapter, type StartRun, type Thread } from '../packages/contracts/index.ts';
import { resolveGrant } from '../packages/core/security.ts';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';

// Only native path leases are replaced. Store, public Service commands, owning
// runs, grant resolution, exact byte binding and the owned Node child are real.
// This is host trust/admission evidence, not native confinement acceptance.
const seam = vi.hoisted(() => ({ beforeGuard: undefined as undefined | (() => Promise<void>), launches: 0 }));
vi.mock('../packages/core/file-access.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/core/file-access.ts')>();
  const lease: typeof actual.withPathGuard = async (_paths, signal, action) => {
    await seam.beforeGuard?.();
    if (signal.aborted) throw new HarnessError('CANCELLED', 'Owned fixture cancelled');
    return action([]);
  };
  return { ...actual, withPathGuard: lease,
    withResourceGrant: async (grant, dataDir, path, write, signal, action) => {
      const target = await resolveGrant(grant, path, write, dataDir);
      return lease([{ path: target, leaf: !write }], signal, async () => {
        if (await resolveGrant(grant, path, write, dataDir) !== target) throw new HarnessError('CAPABILITY_DENIED', 'Owned grant changed');
        return action(target);
      });
    },
  } satisfies typeof actual;
});
vi.mock('../packages/capabilities/process.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/capabilities/process.ts')>();
  return { ...actual, runProcess: (...args: Parameters<typeof actual.runProcess>) => {
    seam.launches++; return actual.runProcess(...args);
  } };
});
const realNode = process.execPath, cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  seam.beforeGuard = undefined;
  for (const run of cleanup.splice(0).reverse()) await run();
  process.execPath = realNode; seam.launches = 0; vi.unstubAllEnvs(); vi.restoreAllMocks();
});

async function fixture(enabled = true) {
  vi.stubEnv('HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1', enabled ? '1' : '0');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'm03 operation trust '))), project = join(root, 'project');
  await mkdir(project);
  await writeFile(join(project, 'owned.test.cjs'), "require('node:test')('owned effect', () => require('node:fs').appendFileSync('effect.log', 'x'));\n");
  const executable = join(root, process.platform === 'win32' ? 'owned-node.exe' : 'owned-node');
  await copyFile(realNode, executable, constants.COPYFILE_FICLONE); process.execPath = executable;
  const store = new Store(join(root, 'state')), starts: StartRun[] = [];
  const runtime: RuntimeAdapter = {
    configure: () => {}, models: async () => [{ id: 'test/model', provider: 'test', name: 'Owned trust fixture' }],
    start: async input => { starts.push(input); }, followUp: async () => {}, cancel: async () => {},
    compact: async () => {}, history: async () => [], dispose: async () => {},
  };
  const service = new Service(store, runtime);
  cleanup.push(async () => { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const command = (type: string, threadId?: string, payload: Record<string, unknown> = {}) =>
    service.command({ id: randomUUID(), type, threadId, payload });
  const thread = (await command('thread.create')).result as Thread;
  const grant = (await command('resource.grant', thread.id, { path: project, kind: 'project', writable: true })).result as { id: string };
  await command('message.send', thread.id, { content: 'Prepare the owned repository test', modelId: 'test/model' });
  await service.deliverOutbox(thread.id);
  const run = starts[0];
  const operation = await service.tool({ name: 'repository_test_prepare', args: { resourceId: grant.id, testFile: 'owned.test.cjs' } }, run) as Operation;
  const target = { threadId: thread.id, operationId: operation.id, operationRevision: operation.revision };
  const approve = () => command('operation.approve', thread.id, { operationId: operation.id, revision: operation.revision });
  return { root, project, store, service, thread, operation, target, approve };
}

it.each([true, false])('enforces explicit project trust at the real approval boundary (enabled=%s)', async enabled => {
  const f = await fixture(enabled);
  const outcome = await f.approve().then(() => ({ status: 'approved' }), error => ({ status: 'denied', code: error.code }));
  if (outcome.status === 'approved') {
    await f.service.dispatchOperation(f.operation.id);
    expect(f.store.get<Operation>('operation', f.operation.id)?.status).toBe('succeeded');
    expect(await readFile(join(f.project, 'effect.log'), 'utf8')).toBe('x');
  }
  expect(outcome).toEqual(enabled ? { status: 'denied', code: 'PROJECT_TRUST_REQUIRED' } : { status: 'approved' });
  expect(seam.launches).toBe(enabled ? 0 : 1);
  if (!enabled) expect(await readFile(join(f.project, 'effect.log'), 'utf8')).toBe('x');
});
