import {afterEach, expect, it, vi} from 'vitest';
import {lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import {VerificationWorkflow} from '../packages/core/verification-workflow.ts';
import {Service} from '../packages/core/service.ts';
import {__setEffectFaultHookForTests} from '../packages/core/tool-effects.ts';
import type {VerificationPrepareInput} from '../packages/contracts/verification-workflow.ts';
import {verificationPanelModel} from '../packages/core/verification-read-models.ts';
import {ProjectTrustLedger} from '../packages/core/project-trust.ts';
import {SecretReferenceLedger} from '../packages/core/secret-references.ts';
import {digestFileSha256} from '../packages/core/execution-policy.ts';
import {createVerificationExecutorFactory} from '../packages/core/verification-executor.ts';
import type {ObservedVerificationBackend, VerificationExecutorHostConfig} from '../packages/core/verification-executor-binding.ts';
import type {Operation, RuntimeAdapter, RuntimeCallbacks, Thread} from '../packages/contracts/index.ts';
import type {CheckObservationV1, DeliverableAssessmentV1} from '../packages/contracts/verification.ts';
import type {ApprovalV1, ToolEffectRecord} from '../packages/contracts/tool-effects.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {__setEffectFaultHookForTests(null); vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs();});
async function fixture(options: {browser?: boolean; serverLifetime?: number; browserDelay?: number; changeSourceDuringOpen?: boolean} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'verification-workflow-')), root = join(directory, 'project'); mkdirSync(root);
  const executable = join(root, 'test-tool'); writeFileSync(executable, 'fixture-only executable identity');
  writeFileSync(join(root, 'app.ts'), 'export const ready = true;\n'); writeFileSync(join(root, 'lock.yaml'), 'version: 1\n');
  const store = new Store(join(directory, 'state')), stamp = new Date().toISOString(), identity = lstatSync(root, {bigint: true});
  const ctx = {threadId: 'verification-task', runId: 'run-1', epoch: 1};
  const thread: Thread = {id: ctx.threadId, title: 'Verification', projectName: 'Project', projectId: 'project', accountId: null, kind: 'main', mode: 'build', status: 'working', runId: ctx.runId, epoch: ctx.epoch, modelId: 'fixture/check', sessionPath: null, createdAt: stamp, updatedAt: stamp};
  store.internal('fixture.project', thread.id, () => {store.put('thread', thread.id, thread.id, thread); store.put('workspaceProject', 'project', null, {id: 'project', name: 'Project', rootPath: root, authority: {kind: 'local'}, createdAt: stamp}); store.put('workspaceProjectRoot', 'project', null, {path: root, identity: {dev: String(identity.dev), ino: String(identity.ino)}});});
  const sha256 = await digestFileSha256(executable), trust = new ProjectTrustLedger();
  await trust.decide({trustId: 'fixture-trust', rootPath: root, approvedFiles: [{path: 'test-tool', kind: 'executable'}], scope: {read: true, write: false, network: options.browser ? 'allowlist' : 'none'}, decision: 'trusted'});
  const launched: string[] = [], terminated: number[] = [], events: string[] = [];
  let serverPid = 0, started!: () => void, enteredBrowser!: () => void;
  const serverStarted = new Promise<void>(resolve => {started = resolve;}), browserEntered = new Promise<void>(resolve => {enteredBrowser = resolve;});
  const origin = 'http://127.0.0.1:4100';
  const backend: ObservedVerificationBackend = {backendId: 'fixture-observed-backend', platform: process.platform, installed: true, approved: true,
    proof: {platformProofRef: 'fixture-proof', platform: process.platform, status: 'PASS', recordedAt: stamp, evidenceRef: 'fixture-only-not-installed-platform-evidence'}, launch: async () => {throw Error('unobserved launch is forbidden');},
    launchObserved: async request => {
      request.assertCurrent();
      const operation = store.all<Operation>('operation', thread.id).find(value => value.kind === 'verification.run' && value.status === 'running')!;
      const effect = store.get<ToolEffectRecord>('toolEffect', 'operation:' + operation.id + '@' + operation.revision)!;
      expect(effect.state).toBe('DISPATCHED'); expect(effect.owner).toEqual({...ctx, projectId: 'project', workspaceId: null, accountBinding: null});
      expect(store.get<ApprovalV1>('approval', effect.approvalId!)?.remainingUses).toBe(0);
      launched.push(request.executable); const pid = 100 + launched.length; events.push('process:' + request.argv[0]);
      const server = request.argv[0] === 'serve'; let closed = false, resolveExit!: (value: {exitCode: number | null; termination: 'NONE' | 'CANCELLED'}) => void;
      const exit = new Promise<{exitCode: number | null; termination: 'NONE' | 'CANCELLED'}>(resolve => {resolveExit = resolve;});
      if (server) {serverPid = pid; started();} else resolveExit({exitCode: 0, termination: 'NONE'});
      return {pid, tree: async () => [pid], wait: () => exit, log: async () => ({text: 'Actual fixture-adapter observation', truncated: false}), terminate: async () => {if (!closed) {closed = true; terminated.push(pid); events.push('terminate:' + request.argv[0]); resolveExit({exitCode: null, termination: 'CANCELLED'});}}};
    },
    ...(options.browser ? {probeListener: async () => {events.push('probe'); return {reachable: true, ownerPid: serverPid};}, openBrowserDriver: async () => {
      events.push('driver-created'); const profileDir = join(directory, 'private-browser-profile'); mkdirSync(profileDir);
      if (options.changeSourceDuringOpen) writeFileSync(join(root, 'app.ts'), 'changed while allocating the admitted browser scope');
      return {profileDir, close: async () => {events.push('driver-close'); rmSync(profileDir, {recursive: true, force: true});}, launch: async () => {
        events.push('browser-launch'); enteredBrowser();
        return {page: {url: () => origin + '/', goto: async () => {}, click: async () => {}, type: async () => {}, text: async () => {if (options.browserDelay) await new Promise(resolve => setTimeout(resolve, options.browserDelay)); return 'Ready';}, visible: async () => true, screenshot: async () => {throw Error('No screenshot requested');}}, collectedFailures: () => ({console: [], network: []}), observedOrigins: () => [origin], close: async () => {events.push('browser-close');}};
      }};
    }} : {})};
  const flags = {HARNESS_FLAG_VERIFICATION_WORKFLOW_V1: '1', HARNESS_FLAG_SECURITY_EXECUTION_PROFILES_V1: '1', HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1: '1'};
  for (const [name, value] of Object.entries(flags)) vi.stubEnv(name, value);
  const config: VerificationExecutorHostConfig = {approvedBackendId: backend.backendId, backends: [backend], profiles: [{profile: {profileId: 'fixture-profile', version: 1, backendId: backend.backendId, capabilities: ['process.execute', 'fs.read'], readRoots: [root], writeRoots: [], networkPolicy: options.browser ? {mode: 'allowlist', origins: [origin]} : {mode: 'none'}, secretRefs: [], executableAllowlist: [{executableSha256: sha256, argv: ['check']}, {executableSha256: sha256, argv: ['serve']}], platformProofRef: 'fixture-proof'}, trustId: 'fixture-trust', projectId: 'project', workspaceId: null, accountBinding: null}], executables: [{id: 'fixture-tool', path: executable}], trust, secrets: new SecretReferenceLedger(), environment: {LANG: 'C'}, flags};
  let callbacks!: RuntimeCallbacks;
  const factory = createVerificationExecutorFactory(config), runtime: RuntimeAdapter = {configure: value => {callbacks = value;}, models: async () => [], start: async () => {}, followUp: async input => {callbacks.onEvent({...input, type: 'input.processing'});}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime, {verificationExecutor: factory});
  cleanups.push(async () => {await service.dispose(); store.close(); rmSync(directory, {recursive: true, force: true});});
  const input: VerificationPrepareInput = {profileId: 'fixture-profile', sourceFiles: ['app.ts'], dependencyFiles: ['lock.yaml'], phases: [{name: 'TEST', executableId: 'fixture-tool', argv: ['check'], relativeCwd: '.', environmentRefs: [], timeoutMs: 10_000}], requirements: [{id: 'tests-pass', checks: [{phase: 'TEST'}]}]};
  if (options.browser) {
    input.phases = [
      ...(['BUILD', 'TEST'] as const).map(name => ({...input.phases[0]!, name})),
      {name: 'START', executableId: 'fixture-tool', argv: ['serve'], relativeCwd: '.', environmentRefs: [], timeoutMs: options.serverLifetime ?? 10_000},
      ...(['READINESS', 'BROWSER'] as const).map(name => ({name, executableId: 'fixture-tool', argv: [], relativeCwd: '.', environmentRefs: [], timeoutMs: 10_000})),
    ];
    input.readiness = {host: '127.0.0.1', port: 4100, path: '/'};
    input.checklist = {version: 1, checklistId: 'ready', approvedOrigins: [origin], viewport: {width: 800, height: 600}, items: ['ready'], steps: [{kind: 'ASSERT_TEXT', selector: 'h1', text: 'Ready', checklistItemId: 'ready'}]};
    input.requirements = [{id: 'app-ready', checks: [{phase: 'BUILD'}, {phase: 'TEST'}, {phase: 'READINESS'}, {checklistItemId: 'ready'}]}];
  }
  const prepare = (args: Record<string, unknown> = input) => service.tool({name: 'verification_prepare', args}, ctx) as Promise<Operation>;
  const approve = (operation: Operation) => service.command({id: randomUUID(), type: 'operation.approve', threadId: thread.id, payload: {operationId: operation.id, revision: operation.revision}});
  const execute = async () => {const operation = await prepare(); await approve(operation); await service.dispatchOperation(operation.id); await service.deliverOutbox(thread.id); return operation;};
  const finish = async () => {await service.deliverOutbox(thread.id); await service.tool({name: 'task_finish', args: {outcome: 'done'}}, ctx); return store.all<DeliverableAssessmentV1>('assessment', thread.id).at(-1)!;};
  return {root, executable, config, events, serverStarted, browserEntered, store, service, thread, ctx, input, backend, factory, trust, launched, terminated, prepare, approve, execute, finish};
}

it('prepares a reviewable manifest and reaches the observed executor only through ordinary approval and durable M02 dispatch', async () => {
  const f = await fixture(), operation = await f.prepare();
  expect(operation).toMatchObject({kind: 'verification.run', status: 'prepared', approved: false}); expect(f.launched).toHaveLength(0); expect(f.store.all('approval')).toHaveLength(0); expect(f.store.all('verificationRecipe')).toHaveLength(0);
  expect(operation.args).toMatchObject({intent: {owner: {...f.ctx, projectId: 'project', workspaceId: null, accountBinding: null}, binding: {backendId: f.backend.backendId}, recipe: {phases: f.input.phases}, requirements: f.input.requirements}});
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'}); expect(f.launched).toHaveLength(0);
  await f.approve(operation); await f.service.dispatchOperation(operation.id);
  expect(f.store.get<Operation>('operation', operation.id)?.status).toBe('succeeded'); expect(f.launched).toHaveLength(1); expect(f.terminated).toEqual([101]);
  const effect = f.store.get<ToolEffectRecord>('toolEffect', 'operation:' + operation.id + '@1')!;
  expect(effect.state).toBe('SUCCEEDED'); expect(effect.approvalId).not.toBeNull(); expect(f.store.get<ApprovalV1>('approval', effect.approvalId!)?.issuer).toBe('authenticated_user');
  expect(f.store.all<CheckObservationV1>('checkObservation', f.thread.id).some(value => value.phase === 'TEST' && value.outcome === 'PASS')).toBe(true);
  await f.service.dispatchOperation(operation.id); expect(f.launched).toHaveLength(1);
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

it('source changes after preparation are rejected before approval consumption or external launch', async () => {
  const f = await fixture(), operation = await f.prepare(); writeFileSync(join(f.root, 'lock.yaml'), 'changed after preparation\n');
  await f.approve(operation); await f.service.dispatchOperation(operation.id);
  expect(f.launched).toHaveLength(0); expect(f.store.get<Operation>('operation', operation.id)?.status).toBe('failed');
  expect(f.store.all<ApprovalV1>('approval').every(value => value.remainingUses === 1)).toBe(true); expect(f.store.all('verificationRecipe')).toHaveLength(0);
});

it.each(['trust', 'environment', 'executable', 'recipe'] as const)('current completion and both read projections lose verification after %s authority changes', async kind => {
  const f = await fixture(); await f.execute();
  expect((await f.finish()).label).toBe('VERIFIED');
  expect((await f.service.verificationPanel(f.thread.id)).label).toBe('VERIFIED');
  expect(verificationPanelModel(f.store, f.thread.id).label).toBe('BLOCKED');
  expect((await f.service.sourceWorkbench.evidence(f.thread.id)).items.find(value => value.kind === 'REQUIREMENT')?.grade).toBe('VERIFIED');
  if (kind === 'trust') f.trust.revoke('fixture-trust');
  if (kind === 'environment') (f.config.environment as Record<string, string>).LANG = 'changed';
  if (kind === 'executable') writeFileSync(f.executable, 'different executable bytes');
  if (kind === 'recipe') f.store.internal('fixture.recipe.changed', f.thread.id, () => {const recipe = f.store.all<{recipeId: string; phases: unknown[]}>('verificationRecipe', f.thread.id)[0]; f.store.put('verificationRecipe', recipe.recipeId, f.thread.id, {...recipe, phases: []});});
  expect((await f.finish()).label).not.toBe('VERIFIED');
  expect((await f.service.verificationPanel(f.thread.id)).label).not.toBe('VERIFIED');
  expect((await f.service.sourceWorkbench.evidence(f.thread.id)).items.some(value => value.grade === 'VERIFIED')).toBe(false);
  expect(f.store.all<CheckObservationV1>('checkObservation', f.thread.id).some(value => value.phase === 'TEST' && value.outcome === 'PASS')).toBe(true);
  expect(f.launched).toHaveLength(1);
});

it.each([{lifetime: 10_000, outcome: 'PASS'}, {lifetime: 3_000, outcome: 'FAIL'}] as const)('composes START lifetime $lifetime through the actual executor, listener and browser runner', async ({lifetime, outcome}) => {
  const f = await fixture({browser: true, serverLifetime: lifetime, browserDelay: 1_500}); vi.useFakeTimers();
  const work = f.execute(); await f.serverStarted; await vi.advanceTimersByTimeAsync(2_000); await f.browserEntered; await vi.advanceTimersByTimeAsync(1_500); const operation = await work;
  const saved = f.store.get<Operation>('operation', operation.id)!;
  expect((saved.result as {outcome: string}).outcome).toBe(outcome);
  expect(operation.description).toContain('total approved server lifetime');
  expect(f.events.indexOf('browser-launch')).toBeGreaterThan(f.events.indexOf('probe'));
  expect(f.events.indexOf('browser-launch')).toBeGreaterThan(f.events.lastIndexOf('process:check'));
  expect(f.events).toContain('browser-close'); expect(f.events).toContain('driver-close'); expect(f.terminated).toHaveLength(3);
  if (outcome === 'FAIL') expect(f.store.all<CheckObservationV1>('checkObservation', f.thread.id).some(value => value.detail?.includes('START process exited'))).toBe(true);
  expect((await f.finish()).label).toBe(outcome === 'PASS' ? 'VERIFIED' : 'FAILED');
});

it('closes an opened executor when the recipe rejects its initial source cut before any process launch', async () => {
  const f = await fixture({browser: true, changeSourceDuringOpen: true}), operation = await f.prepare();
  await f.approve(operation); await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  expect(f.launched).toHaveLength(0); expect(f.events).toEqual(['driver-created', 'driver-close']);
  expect(f.store.get<Operation>('operation', operation.id)?.status).toBe('unknown');
  expect(f.store.get<{status: string}>('verificationManaged', f.thread.id)?.status).toBe('unknown');
  expect(f.store.get<ToolEffectRecord>('toolEffect', 'operation:' + operation.id + '@1')?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
});

it('does not reuse a read seal when authority is revoked after asynchronous description', async () => {
  const f = await fixture(); await f.execute(); expect((await f.finish()).label).toBe('VERIFIED');
  const describe = f.factory.describe.bind(f.factory); vi.spyOn(f.factory, 'describe').mockImplementation(async input => {const binding = await describe(input); f.trust.revoke('fixture-trust'); return binding;});
  expect((await f.service.verificationPanel(f.thread.id)).label).toBe('BLOCKED'); expect(f.launched).toHaveLength(1);
});

it('shows a later source edit as stale without rewriting the retained passing check', async () => {
  const f = await fixture(); await f.execute(); expect((await f.finish()).label).toBe('VERIFIED');
  writeFileSync(join(f.root, 'app.ts'), 'export const ready = false;');
  expect((await f.service.verificationPanel(f.thread.id))).toMatchObject({label: 'COMPLETED_UNVERIFIED', staleBanner: true});
  expect((await f.finish()).label).toBe('COMPLETED_UNVERIFIED');
  expect(f.store.all<CheckObservationV1>('checkObservation', f.thread.id).find(value => value.phase === 'TEST')?.outcome).toBe('PASS');
});

it('recovers a genuinely dispatched settlement fault without replay when legacy global effect flags are disabled', async () => {
  const f = await fixture(), operation = await f.prepare();
  __setEffectFaultHookForTests(at => {if (at === 'settlement') throw Error('Injected settlement crash');});
  await f.approve(operation); await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  __setEffectFaultHookForTests(null);
  const id = 'operation:' + operation.id + '@1'; expect(f.store.get<ToolEffectRecord>('toolEffect', id)?.state).toBe('DISPATCHED');
  await f.service.recover();
  expect(f.store.get<ToolEffectRecord>('toolEffect', id)?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  expect(f.launched).toHaveLength(1); expect(f.store.all<ApprovalV1>('approval').every(value => value.remainingUses === 0)).toBe(true);
});

it('a caller-created read descriptor cannot attest a managed completion', async () => {
  const f = await fixture(); await f.execute(); expect((await f.finish()).label).toBe('VERIFIED');
  const observed = f.store.all<CheckObservationV1>('checkObservation', f.thread.id)[0];
  expect(verificationPanelModel(f.store, f.thread.id, {environmentId: observed.environmentId, recipeDigest: observed.recipeDigest}).label).toBe('BLOCKED');
  expect(f.launched).toHaveLength(1);
});

it('an observed cleanup failure remains an unknown operation and cannot become current green evidence', async () => {
  const f = await fixture(), launch = f.backend.launchObserved.bind(f.backend);
  f.backend.launchObserved = async request => {const process = await launch(request); return {...process, terminate: async () => {await process.terminate(); throw Error('fixture cleanup could not be confirmed');}};};
  const operation = await f.prepare(); await f.approve(operation);
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  const saved = f.store.get<Operation>('operation', operation.id)!;
  expect(saved.status).toBe('unknown'); expect((saved.result as {cleanupFailures: string[]}).cleanupFailures.length).toBeGreaterThan(0);
  expect(f.store.get<ToolEffectRecord>('toolEffect', 'operation:' + operation.id + '@1')?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
  expect((await f.service.verificationPanel(f.thread.id)).summary.verified).toBe(0);
  expect(f.store.all<CheckObservationV1>('checkObservation', f.thread.id).some(value => value.phase === 'TEARDOWN' && value.outcome === 'FAIL')).toBe(true);
});

it('the workflow cannot register a recipe outside the durable M02 dispatch transaction', async () => {
  const f = await fixture(), proposed = await f.prepare();
  vi.spyOn(f.service, 'dispatchOperation').mockRejectedValue(new Error('Hold automatic dispatch for the admission boundary fixture'));
  await f.approve(proposed);
  const operation = f.store.get<Operation>('operation', proposed.id)!;
  const workflow = new VerificationWorkflow(f.store, f.factory), controller = new AbortController();
  const prepared = await workflow.preflight(operation, controller.signal, () => {});
  expect(() => f.store.internal('fixture.outside-dispatch', f.thread.id, () => workflow.admit(operation, prepared))).toThrow(/durable M02 dispatch/);
  expect(f.store.all('verificationRecipe')).toHaveLength(0);
  expect(f.store.all<ApprovalV1>('approval').every(value => value.remainingUses === 1)).toBe(true); expect(f.launched).toHaveLength(0);
});
