import {afterEach, expect, it, vi} from 'vitest';
import {lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HarnessError, type RuntimeAdapter, type Thread} from '../packages/contracts/index.ts';
import {Store} from '../packages/storage/store.ts';
import {createHermesService} from '../apps/server/hermes-service.ts';

const close: (() => Promise<void>)[] = [];
afterEach(async () => {for (const action of close.splice(0).reverse()) await action(); vi.unstubAllEnvs();});
it.each([false, true])('production Hermes composition keeps verification authority host-owned (configured: %s)', async configured => {
  vi.stubEnv('HARNESS_FLAG_VERIFICATION_WORKFLOW_V1', '1');
  const directory = mkdtempSync(join(tmpdir(), 'verification-composition-')), root = join(directory, 'project'); mkdirSync(root); writeFileSync(join(root, 'app.ts'), 'fixture');
  const store = new Store(join(directory, 'state')), native: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {throw Error('No model inference in a composition test');}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const executor = {describe: vi.fn(async () => {throw new HarnessError('FIXTURE_HOST_CAPABILITY', 'Reached only the injected host capability');}), assertCurrent: vi.fn(), open: vi.fn()};
  const service = createHermesService(store, native, configured ? {verificationExecutor: executor} : {});
  close.push(async () => {await service.dispose(); store.close(); rmSync(directory, {recursive: true, force: true});});
  const at = new Date().toISOString(), physical = lstatSync(root, {bigint: true});
  const thread: Thread = {id: 'composition-task', title: 'Composition', projectName: 'Fixture', projectId: 'fixture', kind: 'main', mode: 'build', status: 'ready', runId: null, epoch: 0, modelId: null, sessionPath: null, createdAt: at, updatedAt: at};
  store.internal('fixture.owned-project', thread.id, () => {store.put('thread', thread.id, thread.id, thread); store.put('workspaceProject', 'fixture', null, {id: 'fixture', name: 'Fixture', rootPath: root, authority: {kind: 'local'}, createdAt: at}); store.put('workspaceProjectRoot', 'fixture', null, {path: root, identity: {dev: String(physical.dev), ino: String(physical.ino)}});});
  const proposal = {profileId: 'operator-profile', sourceFiles: ['app.ts'], dependencyFiles: [], phases: [{name: 'TEST', executableId: 'operator-tool', argv: [], relativeCwd: '.', environmentRefs: [], timeoutMs: 1000}], requirements: [{id: 'tests', checks: [{phase: 'TEST'}]}]};
  await expect(service.prepareVerification(thread.id, proposal)).rejects.toMatchObject({code: configured ? 'FIXTURE_HOST_CAPABILITY' : 'VERIFICATION_BACKEND_UNAVAILABLE'});
  expect(executor.describe).toHaveBeenCalledTimes(configured ? 1 : 0); expect(executor.open).not.toHaveBeenCalled(); expect(store.all('operation')).toHaveLength(0);
});
