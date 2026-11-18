import {afterEach, expect, it, vi} from 'vitest';
import {lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {ProjectTrustLedger} from '../packages/core/project-trust.ts';
import {SecretReferenceLedger} from '../packages/core/secret-references.ts';
import {digestFileSha256} from '../packages/core/execution-policy.ts';
import {createVerificationExecutorFactory} from '../packages/core/verification-executor.ts';
import type {ObservedVerificationBackend, VerificationExecutorHostConfig} from '../packages/core/verification-executor-binding.ts';
import type {Operation, RuntimeAdapter, Thread} from '../packages/contracts/index.ts';
import type {ApprovalV1, ToolEffectRecord} from '../packages/contracts/tool-effects.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs();});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'verification-workflow-')), root = join(directory, 'project'); mkdirSync(root);
  const executable = join(root, 'test-tool'); writeFileSync(executable, 'fixture-only executable identity');
  writeFileSync(join(root, 'app.ts'), 'export const ready = true;\n'); writeFileSync(join(root, 'lock.yaml'), 'version: 1\n');
  const store = new Store(join(directory, 'state')), stamp = new Date().toISOString(), identity = lstatSync(root, {bigint: true});
  const ctx = {threadId: 'verification-task', runId: 'run-1', epoch: 1};
  const thread: Thread = {id: ctx.threadId, title: 'Verification', projectName: 'Project', projectId: 'project', accountId: null, kind: 'main', mode: 'build', status: 'working', runId: ctx.runId, epoch: ctx.epoch, modelId: null, sessionPath: null, createdAt: stamp, updatedAt: stamp};
  store.internal('fixture.project', thread.id, () => {store.put('thread', thread.id, thread.id, thread); store.put('workspaceProject', 'project', null, {id: 'project', name: 'Project', rootPath: root, authority: {kind: 'local'}, createdAt: stamp}); store.put('workspaceProjectRoot', 'project', null, {path: root, identity: {dev: String(identity.dev), ino: String(identity.ino)}});});
  const sha256 = await digestFileSha256(executable), trust = new ProjectTrustLedger();
  await trust.decide({trustId: 'fixture-trust', rootPath: root, approvedFiles: [{path: 'test-tool', kind: 'executable'}], scope: {read: true, write: false, network: 'none'}, decision: 'trusted'});
  const launched: string[] = [], terminated: number[] = [];
  const backend: ObservedVerificationBackend = {backendId: 'fixture-observed-backend', platform: process.platform, installed: true, approved: true,
    proof: {platformProofRef: 'fixture-proof', platform: process.platform, status: 'PASS', recordedAt: stamp, evidenceRef: 'fixture-only-not-installed-platform-evidence'}, launch: async () => {throw Error('unobserved launch is forbidden');},
    launchObserved: async request => {
      request.assertCurrent();
      const operation = store.all<Operation>('operation', thread.id).find(value => value.kind === 'verification.run' && value.status === 'running')!;
      const effect = store.get<ToolEffectRecord>('toolEffect', 'operation:' + operation.id + '@' + operation.revision)!;
      expect(effect.state).toBe('DISPATCHED'); expect(effect.owner).toEqual({...ctx, projectId: 'project', workspaceId: null, accountBinding: null});
      expect(store.get<ApprovalV1>('approval', effect.approvalId!)?.remainingUses).toBe(0);
      launched.push(request.executable); const pid = 100 + launched.length;
      return {pid, tree: async () => [pid], wait: async () => ({exitCode: 0, termination: 'NONE'}), log: async () => ({text: 'Actual fixture-adapter observation', truncated: false}), terminate: async () => {terminated.push(pid);}};
    }};
  const flags = {HARNESS_FLAG_VERIFICATION_WORKFLOW_V1: '1', HARNESS_FLAG_SECURITY_EXECUTION_PROFILES_V1: '1', HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1: '1'};
  for (const [name, value] of Object.entries(flags)) vi.stubEnv(name, value);
  const config: VerificationExecutorHostConfig = {approvedBackendId: backend.backendId, backends: [backend], profiles: [{profile: {profileId: 'fixture-profile', version: 1, backendId: backend.backendId, capabilities: ['process.execute', 'fs.read'], readRoots: [root], writeRoots: [], networkPolicy: {mode: 'none'}, secretRefs: [], executableAllowlist: [{executableSha256: sha256, argv: ['check']}], platformProofRef: 'fixture-proof'}, trustId: 'fixture-trust', projectId: 'project', workspaceId: null, accountBinding: null}], executables: [{id: 'fixture-tool', path: executable}], trust, secrets: new SecretReferenceLedger(), environment: {LANG: 'C'}, flags};
  const factory = createVerificationExecutorFactory(config), runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime, {verificationExecutor: factory});
  cleanups.push(async () => {await service.dispose(); store.close(); rmSync(directory, {recursive: true, force: true});});
  const input = {profileId: 'fixture-profile', sourceFiles: ['app.ts'], dependencyFiles: ['lock.yaml'], phases: [{name: 'TEST', executableId: 'fixture-tool', argv: ['check'], relativeCwd: '.', environmentRefs: [], timeoutMs: 10_000}], requirements: [{id: 'tests-pass', checks: [{phase: 'TEST'}]}]};
  const prepare = (args: Record<string, unknown> = input) => service.tool({name: 'verification_prepare', args}, ctx) as Promise<Operation>;
  const approve = (operation: Operation) => service.command({id: randomUUID(), type: 'operation.approve', threadId: thread.id, payload: {operationId: operation.id, revision: operation.revision}});
  return {root, store, service, thread, ctx, input, backend, factory, trust, launched, terminated, prepare, approve};
}

it('prepares and approves an exact manifest without granting an unavailable execution path', async () => {
  const f = await fixture(), operation = await f.prepare();
  expect(operation).toMatchObject({kind: 'verification.run', status: 'prepared', approved: false}); expect(f.launched).toHaveLength(0); expect(f.store.all('approval')).toHaveLength(0); expect(f.store.all('verificationRecipe')).toHaveLength(0);
  expect(operation.args).toMatchObject({intent: {owner: {...f.ctx, projectId: 'project', workspaceId: null, accountBinding: null}, binding: {backendId: f.backend.backendId}, recipe: {phases: f.input.phases}, requirements: f.input.requirements}});
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'});
  await f.approve(operation);
  const approval = f.store.all<ApprovalV1>('approval')[0];
  expect(approval).toMatchObject({issuer: 'authenticated_user', remainingUses: 1, owner: {...f.ctx, projectId: 'project', workspaceId: null, accountBinding: null}});
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'VERIFICATION_EXECUTION_UNAVAILABLE'});
  expect(f.launched).toHaveLength(0); expect(f.store.all('verificationRecipe')).toHaveLength(0); expect(f.store.get<ApprovalV1>('approval', approval.approvalId)?.remainingUses).toBe(1);
});

it.each(['runId', 'epoch', 'accountId', 'projectId', 'workspaceId'] as const)('an approval cannot move a prepared verification intent to another %s', async field => {
  const f = await fixture(), operation = await f.prepare();
  f.store.internal('fixture.owner.changed', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, [field]: field === 'epoch' ? 2 : 'other'}));
  await expect(f.approve(operation)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'});
  expect(f.launched).toHaveLength(0); expect(f.store.all('approval')).toHaveLength(0);
});


it('invalid required check selectors and model-supplied execution authority are rejected before host preparation', async () => {
  const f = await fixture(), describe = vi.spyOn(f.factory, 'describe');
  await expect(f.prepare({...f.input, requirements: [{id: 'missing-build', checks: [{phase: 'BUILD'}]}]})).rejects.toThrow();
  await expect(f.prepare({...f.input, rootPath: '/caller-path', approvedBackendId: f.backend.backendId})).rejects.toThrow();
  expect(describe).not.toHaveBeenCalled(); expect(f.store.all('operation')).toHaveLength(0); expect(f.launched).toHaveLength(0);
});

it('rejects a host profile revocation during asynchronous source preparation', async () => {
  const f = await fixture(), describe = f.factory.describe.bind(f.factory);
  vi.spyOn(f.factory, 'describe').mockImplementation(async input => {const binding = await describe(input); f.trust.revoke('fixture-trust'); return binding;});
  await expect(f.prepare()).rejects.toMatchObject({code: 'EXECUTION_BINDING_CHANGED'});
  expect(f.store.all('operation')).toHaveLength(0); expect(f.launched).toHaveLength(0);
});
