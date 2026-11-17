import {afterEach, expect, it, vi} from 'vitest';
import {lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import {VerificationWorkflow} from '../packages/core/verification-workflow.ts';
import {Service, type ServiceOptions} from '../packages/core/service.ts';
import {__setEffectFaultHookForTests} from '../packages/core/tool-effects.ts';
import type {VerificationIntent, VerificationPrepareInput} from '../packages/contracts/verification-workflow.ts';
import {verificationPanelModel} from '../packages/core/verification-read-models.ts';
import {ProjectTrustLedger} from '../packages/core/project-trust.ts';
import {SecretReferenceLedger} from '../packages/core/secret-references.ts';
import {digestFileSha256} from '../packages/core/execution-policy.ts';
import {createVerificationExecutorFactory} from '../packages/core/verification-executor.ts';
import type {ObservedVerificationBackend, VerificationExecutorHostConfig} from '../packages/core/verification-executor-binding.ts';
import type {HostCommand, Operation, RuntimeAdapter, RuntimeCallbacks, Thread} from '../packages/contracts/index.ts';
import type {CheckObservationV1, DeliverableAssessmentV1} from '../packages/contracts/verification.ts';
import type {ApprovalV1, ToolEffectRecord} from '../packages/contracts/tool-effects.ts';
import type {VerificationRepairPlan} from '../packages/contracts/verification-repair.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {__setEffectFaultHookForTests(null); vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs();});
async function fixture(options: {browser?: boolean; serverLifetime?: number; browserDelay?: number; changeSourceDuringOpen?: boolean; exitCodes?: number[]; qaRuntimeFactory?: ServiceOptions['verificationQaRuntimeFactory']} = {}) {
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
      if (server) {serverPid = pid; started();} else resolveExit({exitCode: options.exitCodes?.[launched.length - 1] ?? 0, termination: 'NONE'});
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
  const service = new Service(store, runtime, {verificationExecutor: factory, verificationQaRuntimeFactory: options.qaRuntimeFactory});
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

function qaRuntime(script: (callbacks: RuntimeCallbacks, input: import('../packages/contracts/index.ts').StartRun) => Promise<void>, options: {usage?: {inputTokens: number; outputTokens: number}; cleanupFailure?: boolean} = {}) {
  const created: {policy: unknown; callbacks: RuntimeCallbacks; input?: import('../packages/contracts/index.ts').StartRun; cancelled: number; disposed: number}[] = [];
  const factory = vi.fn((policy: unknown): RuntimeAdapter => {
    const owned = {policy, callbacks: undefined as unknown as RuntimeCallbacks, input: undefined as import('../packages/contracts/index.ts').StartRun | undefined, cancelled: 0, disposed: 0}; created.push(owned);
    return {configure: value => {owned.callbacks = value;}, models: async () => [], start: async input => {
      owned.input = input;
      queueMicrotask(() => {owned.callbacks.onEvent({...input, type: 'usage', usage: options.usage ?? {inputTokens: 5, outputTokens: 5}}); void script(owned.callbacks, input).catch(error => {owned.callbacks.onEvent({...input, type: 'error', error: String(error)}); owned.callbacks.onEvent({...input, type: 'settled', error: true});});});
    }, followUp: async () => {throw Error('Fixture QA has no steering or output retry');}, cancel: async () => {owned.cancelled++;}, compact: async () => {}, history: async () => [], dispose: async () => {owned.disposed++; if (options.cleanupFailure) throw Error('fixture QA cleanup failure');}};
  });
  return {factory, created};
}
const qaRequest = {prompt: 'Run the approved checks and give an advisory review.', budget: {tokens: 1000, ms: 10_000}};
const qaOutput = {outcome: 'COMPLETED', summary: 'Advisory review only', evidenceRefs: [], requirementIds: ['tests-pass'], observations: []};

it('managed repair recovery accounts for a stopped repair whose dispatched cleanup was interrupted', async () => {
  const qa = qaRuntime(async (callbacks, ctx) => {
    await callbacks.onTool({name: 'qa_run', args: {}}, ctx);
    await callbacks.onTool({name: 'qa_result', args: {output: qaOutput}}, ctx);
  });
  const f = await fixture({exitCodes: [1], qaRuntimeFactory: qa.factory}); f.input.qa = qaRequest;
  const baseline = await f.execute();
  let entered!: () => void, terminating!: () => void, releaseWait!: () => void, releaseCleanup!: () => void;
  const reached = new Promise<void>(resolve => {entered = resolve;}), closing = new Promise<void>(resolve => {terminating = resolve;});
  const wait = new Promise<void>(resolve => {releaseWait = resolve;}), cleanup = new Promise<void>(resolve => {releaseCleanup = resolve;});
  const launch = f.backend.launchObserved.bind(f.backend);
  f.backend.launchObserved = async request => {
    const handle = await launch(request);
    return {...handle, wait: async () => {entered(); await wait; return {exitCode: 2, termination: 'NONE' as const};},
      terminate: async () => {terminating(); await cleanup; await handle.terminate();}};
  };
  const operation = (await f.service.command({id: randomUUID(), type: 'verification.repair.start', threadId: f.thread.id,
    payload: {executionId: (baseline.args.intent as VerificationIntent).executionId, budget: {tokens: 2000, ms: 60_000}}})).result as Operation;
  const planId = (operation.args.intent as VerificationIntent).repair!.planId;
  let recovered: Store | undefined, service: Service | undefined;
  const directory = mkdtempSync(join(tmpdir(), 'verification-repair-recovered-'));
  try {
    await f.approve(operation); await reached;
    const running = f.store.get<VerificationRepairPlan>('verificationRepair', planId)!;
    await f.service.command({id: randomUUID(), type: 'verification.repair.stop', threadId: f.thread.id, payload: {planId, revision: running.revision}});
    await closing;
    expect(f.store.get('verificationRepair', planId)).toMatchObject({stopped: 'CANCELLED', chargedTokens: 0, attempts: [{outcome: 'RUNNING', reservedTokens: 1000}]});
    // Capture only real durable state produced by approval, dispatch and Stop,
    // before the old native cleanup can finish. No approval/evidence is seeded.
    f.store.db.prepare('VACUUM INTO ?').run(join(directory, 'harness.sqlite'));
    recovered = new Store(directory);
    const runtime: RuntimeAdapter = {configure() {}, models: async () => [], history: async () => [], start: async () => {},
      followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}};
    service = new Service(recovered, runtime, {verificationExecutor: f.factory});
    await service.recover();
    expect(recovered.get('verificationRepair', planId)).toMatchObject({stopped: 'BLOCKED', pendingOperationId: null, chargedTokens: 1000,
      attempts: [{outcome: 'UNKNOWN', reservedTokens: 1000}]});
    const once = recovered.get('verificationRepair', planId); await service.recover(); expect(recovered.get('verificationRepair', planId)).toEqual(once);
  } finally {
    await service?.dispose(); recovered?.close(); rmSync(directory, {recursive: true, force: true});
    releaseWait(); releaseCleanup(); await f.service.dispatchOperation(operation.id).catch(() => {});
  }
});

it('managed repair recovery retains measured QA overrun captured before repair settlement', async () => {
  const qa = qaRuntime(async (callbacks, ctx) => {await callbacks.onTool({name: 'qa_run', args: {}}, ctx); await callbacks.onTool({name: 'qa_result', args: {output: qaOutput}}, ctx);});
  let workers = 0;
  const f = await fixture({exitCodes: [1], qaRuntimeFactory: policy => {
    const native = qa.factory(policy), ordinal = ++workers; let callbacks!: RuntimeCallbacks;
    return {...native, configure: value => {callbacks = value; native.configure(value);}, start: async input => {
      if (ordinal === 2) {callbacks.onEvent({...input, type: 'usage', usage: {inputTokens: 1000, outputTokens: 1}}); return;}
      await native.start(input);
    }};
  }}); f.input.qa = qaRequest;
  const baseline = await f.execute(), operation = (await f.service.command({id: randomUUID(), type: 'verification.repair.start', threadId: f.thread.id,
    payload: {executionId: (baseline.args.intent as VerificationIntent).executionId, budget: {tokens: 1000, ms: 60_000}}})).result as Operation;
  const intent = operation.args.intent as VerificationIntent, directory = mkdtempSync(join(tmpdir(), 'verification-repair-usage-recovered-'));
  const internal = f.store.internal.bind(f.store); let captured = false, recovered: Store | undefined, service: Service | undefined;
  const spy = vi.spyOn(f.store, 'internal').mockImplementation((...args) => {
    const value = internal(...args);
    if (!captured && args[0] === 'verification.qa.lifecycle' && f.store.get<{observedTokens: number; cleanupConfirmed: boolean}>('verificationQaLifecycle', intent.qa!.admission.workId)?.observedTokens === 1001) {
      f.store.db.prepare('VACUUM INTO ?').run(join(directory, 'harness.sqlite')); captured = true;
    }
    return value;
  });
  try {
    await f.approve(operation); await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
    expect(captured).toBe(true); spy.mockRestore();
    recovered = new Store(directory);
    expect(recovered.get('verificationRepair', intent.repair!.planId)).toMatchObject({attempts: [{outcome: 'RUNNING', reservedTokens: 1000}], chargedTokens: 0});
    expect(recovered.get('verificationQaLifecycle', intent.qa!.admission.workId)).toMatchObject({observedTokens: 1001});
    const runtime: RuntimeAdapter = {configure() {}, models: async () => [], history: async () => [], start: async () => {},
      followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}};
    service = new Service(recovered, runtime, {verificationExecutor: f.factory}); await service.recover();
    expect(recovered.get('verificationRepair', intent.repair!.planId)).toMatchObject({stopped: 'BLOCKED', chargedTokens: 1001,
      attempts: [{outcome: 'UNKNOWN', reservedTokens: 1000, observedTokens: 1001}]});
    const once = recovered.get('verificationRepair', intent.repair!.planId); await service.recover(); expect(recovered.get('verificationRepair', intent.repair!.planId)).toEqual(once);
  } finally {spy.mockRestore(); await service?.dispose(); recovered?.close(); rmSync(directory, {recursive: true, force: true});}
});

it.each([
  {exitCodes: [1, 2, 3, 4], stop: 'BUDGET', outcomes: ['FAIL', 'FAIL', 'FAIL', 'FAIL']},
  {exitCodes: [1, 2, 3, 0], stop: 'PASSED', outcomes: ['FAIL', 'FAIL', 'FAIL', 'PASS']},
  {exitCodes: [1, 1], stop: 'UNCHANGED_FAILURE', outcomes: ['FAIL', 'FAIL']},
])('managed repair requires fresh approval and retains history when stopping for $stop', async ({exitCodes, stop, outcomes}) => {
  const f = await fixture({exitCodes}), baseline = await f.execute(), baselineIntent = baseline.args.intent as VerificationIntent;
  let operation = (await f.service.command({id: randomUUID(), type: 'verification.repair.start', threadId: f.thread.id,
    payload: {executionId: baselineIntent.executionId, budget: {tokens: 0, ms: 60_000}}})).result as Operation;
  const planId = (operation.args.intent as VerificationIntent).repair!.planId;
  for (let index = 0; index < exitCodes.length - 1; index++) {
    if (index > 0) {
      const plan = f.store.get<VerificationRepairPlan>('verificationRepair', planId)!;
      operation = (await f.service.command({id: randomUUID(), type: 'verification.repair.next', threadId: f.thread.id,
        payload: {planId, revision: plan.revision}})).result as Operation;
    }
    const intent = operation.args.intent as VerificationIntent;
    expect(operation).toMatchObject({status: 'prepared', approved: false});
    expect(intent.recipe).toEqual(baselineIntent.recipe); expect(intent.requirements).toEqual(baselineIntent.requirements);
    expect(intent.repair).toMatchObject({planId, attempt: index + 1});
    expect(f.launched).toHaveLength(index + 1);
    await f.approve(operation); await f.service.dispatchOperation(operation.id);
  }
  const plan = f.store.get<VerificationRepairPlan>('verificationRepair', planId)!;
  expect(plan).toMatchObject({stopped: stop, pendingOperationId: null, chargedTokens: 0});
  expect(plan.attempts).toHaveLength(exitCodes.length - 1);
  expect(f.store.all<CheckObservationV1>('checkObservation', f.thread.id).filter(value => value.phase === 'TEST').map(value => value.outcome)).toEqual(outcomes);
  expect(f.launched).toHaveLength(exitCodes.length);
  await expect(f.service.command({id: randomUUID(), type: 'verification.repair.next', threadId: f.thread.id,
    payload: {planId, revision: plan.revision}})).rejects.toMatchObject({code: 'REPAIR_STOPPED'});
  expect(f.launched).toHaveLength(exitCodes.length);
});

it('managed repair rejection cancels its pending review without consuming another approval or attempt', async () => {
  const f = await fixture({exitCodes: [1]}), baseline = await f.execute();
  const operation = (await f.service.command({id: randomUUID(), type: 'verification.repair.start', threadId: f.thread.id,
    payload: {executionId: (baseline.args.intent as VerificationIntent).executionId, budget: {tokens: 0, ms: 60_000}}})).result as Operation;
  await f.service.command({id: randomUUID(), type: 'operation.reject', threadId: f.thread.id, payload: {operationId: operation.id, revision: operation.revision}});
  expect(f.store.get('verificationRepair', (operation.args.intent as VerificationIntent).repair!.planId)).toMatchObject({stopped: 'CANCELLED', pendingOperationId: null, chargedTokens: 0, attempts: []});
  expect(f.store.get('operation', operation.id)).toMatchObject({status: 'cancelled', approved: false});
  expect(f.store.all('approval', f.thread.id)).toHaveLength(1); expect(f.launched).toHaveLength(1);
});

it('managed repair source conflict blocks dispatch before it consumes the retest approval', async () => {
  const f = await fixture({exitCodes: [1]}), baseline = await f.execute();
  const operation = (await f.service.command({id: randomUUID(), type: 'verification.repair.start', threadId: f.thread.id,
    payload: {executionId: (baseline.args.intent as VerificationIntent).executionId, budget: {tokens: 0, ms: 60_000}}})).result as Operation;
  writeFileSync(join(f.root, 'app.ts'), 'export const changedAfterReview = true;\n');
  // Approval schedules the first dispatch. A later dispatch reads its durable failure.
  await f.approve(operation);
  await expect(f.service.dispatchOperation(operation.id)).resolves.toMatchObject({id: operation.id, status: 'failed', approved: true, error: expect.stringContaining('BLOCKED_SOURCE_DRIFT')});
  const intent = operation.args.intent as VerificationIntent;
  expect(f.store.get('verificationRepair', intent.repair!.planId)).toMatchObject({stopped: 'CONFLICT', pendingOperationId: null, chargedTokens: 0, attempts: []});
  const approvals = f.store.all<ApprovalV1>('approval', f.thread.id).filter(value => value.operationId === operation.id);
  expect(approvals).toHaveLength(1); expect(approvals[0].remainingUses).toBe(1);
  expect(f.store.get('toolEffect', 'operation:' + operation.id + '@' + operation.revision)).toBeNull();
  expect(f.store.all<CheckObservationV1>('checkObservation', f.thread.id).filter(value => value.executionId === intent.executionId)).toEqual([]);
  expect(f.store.all('verificationQaLifecycle', f.thread.id)).toEqual([]);
  expect(f.launched).toHaveLength(1);
});

it('managed repair refuses an expired approval and model-supplied repair authority', async () => {
  const f = await fixture({exitCodes: [1]}), baseline = await f.execute();
  await expect(f.prepare({...f.input, repair: {planId: 'model-supplied'}})).rejects.toThrow();
  const operation = (await f.service.command({id: randomUUID(), type: 'verification.repair.start', threadId: f.thread.id,
    payload: {executionId: (baseline.args.intent as VerificationIntent).executionId, budget: {tokens: 0, ms: 60_000}}})).result as Operation;
  const intent = operation.args.intent as VerificationIntent, clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(intent.repair!.deadline) + 1);
  try {
    await expect(f.approve(operation)).rejects.toMatchObject({code: 'REPAIR_BUDGET'});
    expect(f.store.get('operation', operation.id)).toMatchObject({status: 'prepared', approved: false});
    expect(f.store.all('approval', f.thread.id)).toHaveLength(1); expect(f.launched).toHaveLength(1);
  } finally {clock.mockRestore();}
});

it('runs a restricted QA child through the exact approved M02 execution and retains its output as advisory', async () => {
  const runtime = qaRuntime(async (callbacks, ctx) => {
    const invoke = (name: string, args: Record<string, unknown> = {}) => callbacks.onTool({name, args}, ctx);
    expect(await invoke('qa_context')).toMatchObject({requirements: [{id: 'tests-pass'}]});
    expect(await invoke('qa_run')).toMatchObject({outcome: 'PASS'}); expect(await invoke('qa_run')).toMatchObject({outcome: 'PASS'});
    expect(await invoke('qa_observe')).toMatchObject({evidenceQuality: 'EXECUTED'});
    await invoke('qa_result', {output: qaOutput});
  });
  const f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest});
  expect(runtime.factory).not.toHaveBeenCalled(); expect(f.store.all('agentWork')).toEqual([]);
  await f.approve(operation); await f.service.dispatchOperation(operation.id).catch(error => {throw Error(f.store.get<Operation>('operation', operation.id)?.error ?? String(error));});
  expect(f.launched).toHaveLength(1); expect(runtime.factory).toHaveBeenCalledTimes(1); expect(runtime.created[0].disposed).toBe(1);
  expect(runtime.created[0].input?.resources).toEqual([]); expect(runtime.created[0].input?.sessionPath).toBeNull();
  expect(runtime.created[0].policy).toMatchObject({hostTools: [{name: 'qa_run'}, {name: 'qa_observe'}, {name: 'qa_context'}, {name: 'qa_result'}]});
  expect(f.store.all('verificationQaReview')).toEqual([expect.objectContaining({evidenceQuality: 'ADVISORY', output: qaOutput})]);
  expect(f.store.all('agentWork')).toEqual([expect.objectContaining({role: 'QA', state: 'COMPLETED_REPORTED', grantSubset: [], budget: qaRequest.budget})]);
  expect(f.store.get<Thread>('thread', runtime.created[0].input!.threadId)).toMatchObject({status: 'completed', runId: null});
  expect((await f.finish()).label).toBe('VERIFIED'); expect((await f.service.verificationPanel(f.thread.id)).label).toBe('VERIFIED');
});

it.each(['none', 'run', 'project', 'workspace', 'account', 'model'] as const)('retires only the completed QA child after confirmed cleanup (replacement: %s)', async replacement => {
  let entered = false, release!: () => void;
  const cleanup = new Promise<void>(resolve => {release = resolve;});
  const runtime = qaRuntime(async (callbacks, ctx) => {await callbacks.onTool({name: 'qa_run', args: {}}, ctx); await callbacks.onTool({name: 'qa_result', args: {output: qaOutput}}, ctx);});
  const f = await fixture({qaRuntimeFactory: policy => {
    const native = runtime.factory(policy);
    return {...native, dispose: async () => {entered = true; await cleanup; await native.dispose();}};
  }});
  const operation = await f.prepare({...f.input, qa: qaRequest}); await f.approve(operation);
  const pending = f.service.dispatchOperation(operation.id);
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    const input = runtime.created[0].input!, child = f.store.get<Thread>('thread', input.threadId)!;
    expect(child).toMatchObject({status: 'completed', runId: input.runId, epoch: input.epoch});
    expect(f.store.all('verificationQaLifecycle')).toEqual([expect.objectContaining({cleanupConfirmed: null})]);
    const change: Partial<Thread> = replacement === 'run' ? {runId: 'replacement-run', epoch: child.epoch + 1, status: 'working'} :
      replacement === 'project' ? {projectId: 'replacement-project'} : replacement === 'workspace' ? {workspaceId: 'replacement-workspace'} :
      replacement === 'account' ? {accountId: 'replacement-account'} : replacement === 'model' ? {modelId: 'replacement/model'} : {};
    if (replacement !== 'none') f.store.internal('fixture.replacement', child.id, () => f.store.put('thread', child.id, child.id, {...child, ...change}));
    release(); await pending;
    expect(f.store.get<Thread>('thread', child.id)).toMatchObject(replacement === 'none' ? {...child, runId: null} : {...child, ...change});
    expect(f.store.all('verificationQaLifecycle')).toEqual([expect.objectContaining({state: 'COMPLETED_REPORTED', cleanupConfirmed: true})]);
    expect(f.store.all('agentWork')).toEqual([expect.objectContaining({state: 'COMPLETED_REPORTED', childOwner: {threadId: input.threadId, runId: input.runId, epoch: input.epoch}})]);
  } finally {release(); await pending.catch(() => {});}
});

it('rejects QA source reads and structured findings outside the exact approved source inputs', async () => {
  const runtime = qaRuntime(async (callbacks, ctx) => {
    await expect(callbacks.onTool({name: 'qa_context', args: {path: 'not-approved.ts'}}, ctx)).rejects.toMatchObject({code: 'QA_SCOPE_CHANGED'});
    await expect(callbacks.onTool({name: 'qa_observe', args: {finding: {findingId: 'outside', path: 'not-approved.ts', line: null, observation: 'Claim', impact: 'Claim', reproduction: null}}}, ctx)).rejects.toMatchObject({code: 'QA_SCOPE_CHANGED'});
    await callbacks.onTool({name: 'qa_run', args: {}}, ctx); await callbacks.onTool({name: 'qa_result', args: {output: qaOutput}}, ctx);
  });
  const f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest}); await f.approve(operation); await f.service.dispatchOperation(operation.id);
  expect(f.store.get<Operation>('operation', operation.id)?.status).toBe('succeeded'); expect(f.store.all('securityFinding')).toEqual([]);
});

it.skipIf(process.platform === 'win32')('keeps the native QA source leaf guard unavailable instead of using a portable read fallback', async () => {
  const runtime = qaRuntime(async (callbacks, ctx) => {
    await expect(callbacks.onTool({name: 'qa_context', args: {path: 'app.ts'}}, ctx)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
    await expect(callbacks.onTool({name: 'qa_observe', args: {finding: {findingId: 'review', path: 'app.ts', line: 1, observation: 'Claim', impact: 'Claim', reproduction: null}}}, ctx)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
    await callbacks.onTool({name: 'qa_run', args: {}}, ctx); await callbacks.onTool({name: 'qa_result', args: {output: qaOutput}}, ctx);
  });
  const f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest}); await f.approve(operation); await f.service.dispatchOperation(operation.id);
  expect(f.store.get<Operation>('operation', operation.id)?.status).toBe('succeeded'); expect(f.store.all('securityFinding')).toEqual([]);
});

it('rejects a QA finding when its approved source changes before capture', async () => {
  let f!: Awaited<ReturnType<typeof fixture>>;
  const runtime = qaRuntime(async (callbacks, ctx) => {
    writeFileSync(join(f.root, 'app.ts'), 'changed after approved source capture\n');
    await expect(callbacks.onTool({name: 'qa_observe', args: {finding: {findingId: 'stale', path: 'app.ts', line: 1, observation: 'Claim', impact: 'Claim', reproduction: null}}}, ctx)).rejects.toMatchObject({code: 'BLOCKED_SOURCE_DRIFT'});
    await callbacks.onTool({name: 'qa_result', args: {output: qaOutput}}, ctx);
  });
  f = await fixture({qaRuntimeFactory: runtime.factory}); const operation = await f.prepare({...f.input, qa: qaRequest}); await f.approve(operation);
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  expect(f.store.all('securityFinding')).toEqual([]); expect(f.launched).toEqual([]);
});

it.skipIf(process.platform !== 'win32')('records a source-bound advisory through the actual Windows file guard and approved fixture QA execution', async () => {
  const runtime = qaRuntime(async (callbacks, ctx) => {
    const source = await callbacks.onTool({name: 'qa_context', args: {path: 'app.ts', maxBytes: 16_384}}, ctx);
    expect(source).toMatchObject({path: 'app.ts', text: 'export const ready = true;\n', byteOffset: 0, omittedBytes: 0, lineCount: 1});
    for (const field of ['status', 'evidenceQuality', 'provenance', 'authorizedScope', 'source'])
      await expect(callbacks.onTool({name: 'qa_observe', args: {finding: {findingId: 'review', path: 'app.ts', line: 1, observation: 'Advisory review', impact: 'Review impact', reproduction: null, [field]: 'forged'}}}, ctx)).rejects.toThrow();
    await expect(callbacks.onTool({name: 'qa_observe', args: {finding: {findingId: 'review', path: 'app.ts', line: 2, observation: 'Advisory review', impact: 'Review impact', reproduction: null}}}, ctx)).rejects.toMatchObject({code: 'INVALID_INPUT'});
    expect(await callbacks.onTool({name: 'qa_observe', args: {finding: {findingId: 'review', path: 'app.ts', line: 1, observation: 'Advisory review', impact: 'Review impact', reproduction: null}}}, ctx)).toMatchObject({finding: {findingId: 'review', evidenceQuality: 'ADVISORY', status: 'OPEN', blobSha: (source as {blobSha: string}).blobSha}});
    await callbacks.onTool({name: 'qa_run', args: {}}, ctx); await callbacks.onTool({name: 'qa_result', args: {output: qaOutput}}, ctx);
  });
  const f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: {...qaRequest, budget: {...qaRequest.budget, ms: 180_000}}}); await f.approve(operation); await f.service.dispatchOperation(operation.id);
  const intent = operation.args.intent as VerificationIntent;
  expect(f.store.all('securityFinding')).toEqual([expect.objectContaining({status: 'OPEN', evidenceQuality: 'ADVISORY', source: {path: 'app.ts', line: 1, blobSha: expect.stringMatching(/^[0-9a-f]{40}$/)}, provenance: {owner: intent.owner, executionId: intent.executionId, ...intent.sourceCut}})]);
  expect(f.store.all('resource')).toEqual([]);
  expect((await f.service.verificationPanel(f.thread.id)).securityFindings?.items).toEqual([expect.objectContaining({evidenceQuality: 'ADVISORY', freshness: 'CURRENT', scopeAuthority: 'HOST_RECORDED'})]);
  writeFileSync(join(f.root, 'app.ts'), 'new source\n');
  expect((await f.service.verificationPanel(f.thread.id)).securityFindings?.items[0]?.freshness).toBe('STALE');
}, 180_000);

it('denies missing QA runtime and missing approval before a worker can be created', async () => {
  const missing = await fixture(); await expect(missing.prepare({...missing.input, qa: qaRequest})).rejects.toMatchObject({code: 'QA_UNAVAILABLE'});
  const runtime = qaRuntime(async () => {}), f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest});
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'});
  expect(runtime.factory).not.toHaveBeenCalled(); expect(f.store.all('agentWork')).toEqual([]);
});

it('does not turn a QA model completion into executed evidence or allow tools outside its captured catalog', async () => {
  const runtime = qaRuntime(async (callbacks, ctx) => {
    for (const name of ['verification_prepare', 'operation_execute', 'shell_exec', 'browser_launch', 'file_write', 'task_delegate', 'agent_result', 'verification.run'])
      await expect(callbacks.onTool({name, args: {}}, ctx)).rejects.toMatchObject({code: 'AGENT_TOOL_DENIED'});
    await callbacks.onTool({name: 'qa_result', args: {output: {...qaOutput, observations: [{checkId: 'invented-pass', outcome: 'PASS', evidenceRef: null}]}}}, ctx);
  });
  const f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest}); await f.approve(operation);
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  expect(f.store.get<Operation>('operation', operation.id)).toMatchObject({status: 'unknown', error: 'The advisory QA result contains no observed execution.'});
  expect(f.launched).toEqual([]); expect(f.store.all('checkObservation')).toEqual([]); expect((await f.service.verificationPanel(f.thread.id)).label).not.toBe('VERIFIED');
  expect(f.store.all('verificationQaReview')).toEqual([expect.objectContaining({evidenceQuality: 'ADVISORY'})]);
});

it('holds the QA budget and model selection inside the exact approval commitment', async () => {
  const runtime = qaRuntime(async () => {}), f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest});
  f.store.internal('fixture.model-selection-change', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, modelId: 'fixture/other'}));
  await expect(f.approve(operation)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'}); expect(runtime.factory).not.toHaveBeenCalled();
});

it('stops an over-budget QA child before it can launch the approved recipe', async () => {
  const runtime = qaRuntime(async (callbacks, ctx) => {await callbacks.onTool({name: 'qa_run', args: {}}, ctx);}, {usage: {inputTokens: 1000, outputTokens: 1}});
  const f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest}); await f.approve(operation);
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  expect(f.store.get<Operation>('operation', operation.id)).toMatchObject({status: 'unknown', error: 'The approved QA token budget is exhausted.'});
  expect(f.launched).toEqual([]); expect(runtime.created[0].disposed).toBe(1);
  expect(f.service.agentWork.budgetLedger().spentTokens).toBe(1001);
});

it('denies a forged or previously consumed QA work intent without creating another worker', async () => {
  const runtime = qaRuntime(async (callbacks, ctx) => {await callbacks.onTool({name: 'qa_run', args: {}}, ctx); await callbacks.onTool({name: 'qa_result', args: {output: qaOutput}}, ctx);});
  const f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest});
  const intent = operation.args.intent as import('../packages/contracts/verification-workflow.ts').VerificationIntent;
  await expect(f.service.agentWork.admit(f.ctx, intent.qa!.admission, new AbortController().signal)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'});
  expect(runtime.factory).not.toHaveBeenCalled();
  await f.approve(operation); await f.service.dispatchOperation(operation.id);
  await expect(f.service.agentWork.admit(f.ctx, intent.qa!.admission, new AbortController().signal)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'});
  await expect(f.service.agentWork.resume(f.ctx, intent.qa!.admission.workId)).rejects.toThrow();
  expect(runtime.factory).toHaveBeenCalledTimes(1); expect(f.launched).toHaveLength(1);
});

it('revokes QA tools and cleans the owned worker when the parent stops', async () => {
  const runtime = qaRuntime(async () => {}), f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest});
  await f.approve(operation); await vi.waitFor(() => expect(runtime.created[0]?.input).toBeDefined());
  await f.service.command({id: randomUUID(), type: 'run.stop', threadId: f.thread.id, payload: {}});
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'CANCELLED_RUN'});
  const child = runtime.created[0]; expect(child.cancelled).toBe(1); expect(child.disposed).toBe(1); expect(f.launched).toEqual([]);
  await expect(child.callbacks.onTool({name: 'qa_run', args: {}}, child.input!)).rejects.toThrow();
  expect(f.store.all('agentWork')).toEqual([expect.objectContaining({state: 'CANCELLED'})]);
  expect(f.store.all('verificationQaLifecycle')).toEqual([expect.objectContaining({state: 'FAILED', cleanupConfirmed: true})]);
});

it('owns a QA runtime created after cancellation and never starts that late worker', async () => {
  const runtime = qaRuntime(async () => {}); let entered = false, release!: () => void; const delay = new Promise<void>(resolve => {release = resolve;});
  const f = await fixture({qaRuntimeFactory: async policy => {entered = true; await delay; return runtime.factory(policy);}}), operation = await f.prepare({...f.input, qa: qaRequest});
  await f.approve(operation); await vi.waitFor(() => expect(entered).toBe(true));
  await f.service.command({id: randomUUID(), type: 'run.stop', threadId: f.thread.id, payload: {}}); release();
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'CANCELLED_RUN'});
  expect(runtime.created).toHaveLength(1); expect(runtime.created[0].input).toBeUndefined(); expect(runtime.created[0].disposed).toBe(1); expect(f.launched).toEqual([]);
});

it('keeps executed PASS historical but blocks clean completion when the QA runtime cannot close', async () => {
  const runtime = qaRuntime(async (callbacks, ctx) => {await callbacks.onTool({name: 'qa_run', args: {}}, ctx); await callbacks.onTool({name: 'qa_result', args: {output: qaOutput}}, ctx);}, {cleanupFailure: true});
  const f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest}); await f.approve(operation);
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  expect(f.store.get<Operation>('operation', operation.id)).toMatchObject({status: 'unknown', error: 'Owned QA runtime cleanup could not be confirmed.'});
  expect(f.store.all<CheckObservationV1>('checkObservation').some(value => value.phase === 'TEST' && value.outcome === 'PASS')).toBe(true);
  expect(f.store.all('verificationQaLifecycle')).toEqual([expect.objectContaining({state: 'FAILED', cleanupConfirmed: false})]);
  expect(f.store.get<Thread>('thread', runtime.created[0].input!.threadId)).toMatchObject({status: 'completed', runId: runtime.created[0].input!.runId});
  await expect(f.finish()).rejects.toMatchObject({code: 'REQUEST_GATED'});
  expect((await f.service.verificationPanel(f.thread.id)).summary.blocked).toBe(1);
});

it.each([false, true])('cleans the owned QA runtime after durable work-stop bookkeeping fails (cleanup failure: %s)', async cleanupFailure => {
  const runtime = qaRuntime(async () => {}, {cleanupFailure});
  const f = await fixture({qaRuntimeFactory: policy => ({...runtime.factory(policy), start: async () => {throw Error('fixture native startup failure');}})});
  const internal = f.store.internal.bind(f.store);
  vi.spyOn(f.store, 'internal').mockImplementation((type, threadId, apply) => {
    if (type === 'agentWork.failed' || type === 'agentWork.cancelled') throw Error('fixture durable work-stop failure');
    return internal(type, threadId, apply);
  });
  const operation = await f.prepare({...f.input, qa: qaRequest}); await f.approve(operation);
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  expect(runtime.created).toHaveLength(1); expect(runtime.created[0].cancelled).toBe(1); expect(runtime.created[0].disposed).toBe(1);
  expect(f.store.get<Operation>('operation', operation.id)).toMatchObject({status: 'unknown'});
  expect(f.store.all('verificationQaLifecycle')).toEqual([expect.objectContaining({state: 'FAILED', cleanupConfirmed: !cleanupFailure, stopReason: 'RECONCILIATION_REQUIRED'})]);
  expect(f.store.get<ToolEffectRecord>('toolEffect', 'operation:' + operation.id + '@1')?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
  expect(f.launched).toEqual([]);
});

it('ends an idle QA worker at its approved deadline without launching or restarting work', async () => {
  const runtime = qaRuntime(async () => {}), f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: {...qaRequest, budget: {tokens: 1000, ms: 1000}}});
  vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout']});
  await f.approve(operation); await vi.waitFor(() => expect(runtime.created[0]?.input).toBeDefined());
  await vi.advanceTimersByTimeAsync(1001);
  await expect(f.service.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  expect(f.store.get<Operation>('operation', operation.id)).toMatchObject({status: 'unknown', error: 'The approved QA deadline expired.'});
  expect(runtime.created[0].disposed).toBe(1); expect(f.launched).toEqual([]);
});

it('does not resume a QA child or its consumed execution after host recovery', async () => {
  const runtime = qaRuntime(async () => {}), f = await fixture({qaRuntimeFactory: runtime.factory}), operation = await f.prepare({...f.input, qa: qaRequest});
  await f.approve(operation); await vi.waitFor(() => expect(runtime.created[0]?.input).toBeDefined());
  const parentRuntime: RuntimeAdapter = {configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const restarted = new Service(f.store, parentRuntime, {verificationExecutor: f.factory, verificationQaRuntimeFactory: runtime.factory}); cleanups.push(() => restarted.dispose());
  await restarted.recover(); expect(f.store.all('agentWork')).toEqual([expect.objectContaining({state: 'INTERRUPTED'})]);
  await expect(restarted.dispatchOperation(operation.id)).rejects.toMatchObject({code: 'RECONCILIATION_REQUIRED'});
  const current = f.store.get<Thread>('thread', f.thread.id)!, ctx = {threadId: current.id, runId: 'new-parent-owner', epoch: current.epoch + 1};
  f.store.internal('fixture.new-parent-run', current.id, () => f.store.put('thread', current.id, current.id, {...current, runId: ctx.runId, epoch: ctx.epoch, status: 'working'}));
  const intent = operation.args.intent as import('../packages/contracts/verification-workflow.ts').VerificationIntent;
  await expect(restarted.agentWork.resume(ctx, intent.qa!.admission.workId)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'});
  await expect(runtime.created[0].callbacks.onTool({name: 'qa_run', args: {}}, runtime.created[0].input!)).rejects.toThrow();
  expect(runtime.factory).toHaveBeenCalledTimes(1); expect(f.launched).toEqual([]);
});

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

it('public verification preparation commits one reviewable operation and receipt for concurrent retries', async () => {
  const f = await fixture(), command: HostCommand = {id: randomUUID(), type: 'verification.prepare', threadId: f.thread.id, payload: f.input};
  const [first, retry] = await Promise.all([f.service.command(command), f.service.command(structuredClone(command))]);
  expect(retry).toEqual(first); expect(f.store.receipt(command)).toEqual(first);
  expect(first.result).toMatchObject({kind: 'verification.run', status: 'prepared', approved: false});
  expect(f.store.all('operation')).toHaveLength(1); expect(f.store.all('approval')).toEqual([]); expect(f.store.all('checkObservation')).toEqual([]); expect(f.launched).toEqual([]);
  await expect(f.service.command({...command, payload: {...f.input, profileId: 'different'}})).rejects.toMatchObject({code: 'DUPLICATE_COMMAND'});
});

it('public verification preparation admits only one of two distinct concurrent operations', async () => {
  const f = await fixture(), results = await Promise.allSettled(Array.from({length: 2}, () => f.service.command({id: randomUUID(), type: 'verification.prepare', threadId: f.thread.id, payload: f.input})));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected')).toMatchObject({reason: {code: 'VERIFICATION_BUSY'}});
  expect(f.store.all('operation')).toHaveLength(1); expect(f.launched).toEqual([]);
});

it('public verification preparation captures command content before asynchronous host description', async () => {
  const f = await fixture(), original: HostCommand = {id: randomUUID(), type: 'verification.prepare', threadId: f.thread.id, payload: structuredClone(f.input)}, command = structuredClone(original);
  const describe = f.factory.describe.bind(f.factory); let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => {entered = resolve;}), barrier = new Promise<void>(resolve => {release = resolve;});
  vi.spyOn(f.factory, 'describe').mockImplementation(async input => {entered(); await barrier; return describe(input);});
  const work = f.service.command(command); await Promise.race([reached, work.then(() => {throw Error('Preparation returned before host description');})]); command.payload.profileId = 'changed-after-admission'; release();
  const receipt = await work; expect(f.store.receipt(original)).toEqual(receipt);
  expect((receipt.result as Operation).args).toMatchObject({intent: {binding: {profile: {profileId: 'fixture-profile'}}}});
  await expect(f.service.command(command)).rejects.toMatchObject({code: 'DUPLICATE_COMMAND'});
});

it('public verification retry returns its committed receipt even when its redundant preparation later loses authority', async () => {
  const f = await fixture(), command: HostCommand = {id: randomUUID(), type: 'verification.prepare', threadId: f.thread.id, payload: f.input};
  const describe = f.factory.describe.bind(f.factory); let calls = 0, entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => {entered = resolve;}), barrier = new Promise<void>(resolve => {release = resolve;});
  vi.spyOn(f.factory, 'describe').mockImplementation(async input => {if (++calls === 2) {entered(); await barrier;} return describe(input);});
  const first = f.service.command(command), redundant = f.service.command(command); await reached; const committed = await first;
  f.trust.revoke('fixture-trust'); release();
  expect(await redundant).toEqual(committed); expect(f.store.all('operation')).toHaveLength(1); expect(f.launched).toEqual([]);
});

it('public verification rerun derives the current recipe but requires fresh approval and source evidence', async () => {
  const f = await fixture(), first = await f.execute(), previous = first.args.intent as VerificationIntent;
  writeFileSync(join(f.root, 'app.ts'), 'export const ready = "new source";\n');
  const receipt = await f.service.command({id: randomUUID(), type: 'verification.rerun', threadId: f.thread.id, payload: {executionId: previous.executionId}}), next = receipt.result as Operation;
  const intent = next.args.intent as VerificationIntent;
  expect(next).toMatchObject({status: 'prepared', approved: false}); expect(next.id).not.toBe(first.id); expect(intent.executionId).not.toBe(previous.executionId);
  expect(intent.recipe).toEqual(previous.recipe); expect(intent.requirements).toEqual(previous.requirements); expect(intent.sourceCut.codeDigest).not.toBe(previous.sourceCut.codeDigest);
  expect(f.launched).toHaveLength(1); expect(f.store.all<ApprovalV1>('approval').every(value => value.remainingUses === 0)).toBe(true);
  await expect(f.service.dispatchOperation(next.id)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'});
  await f.approve(next); await f.service.dispatchOperation(next.id);
  expect(f.launched).toHaveLength(2); expect(f.store.all<CheckObservationV1>('checkObservation').filter(value => value.phase === 'TEST')).toHaveLength(2);
  expect(f.store.get<{intent: VerificationIntent}>('verificationManaged', f.thread.id)?.intent.executionId).toBe(intent.executionId);
  await expect(f.service.command({id: randomUUID(), type: 'verification.rerun', threadId: f.thread.id, payload: {executionId: previous.executionId}})).rejects.toMatchObject({code: 'STALE_REVISION'});
});

it.each(['projectId', 'workspaceId', 'accountId'] as const)('public verification rerun cannot carry an old recipe into a different %s', async field => {
  const f = await fixture(), operation = await f.execute(), intent = operation.args.intent as VerificationIntent;
  f.store.internal('fixture.owner.changed', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, [field]: 'different-owner'}));
  await expect(f.service.command({id: randomUUID(), type: 'verification.rerun', threadId: f.thread.id, payload: {executionId: intent.executionId}})).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'});
  expect(f.store.all('operation')).toHaveLength(1); expect(f.launched).toHaveLength(1);
});

it('public verification commands reject undeclared authority, invalid rerun fields and missing backend without preparation', async () => {
  const f = await fixture();
  await expect(f.service.command({id: randomUUID(), type: 'verification.prepare', threadId: f.thread.id, payload: {...f.input, rootPath: f.root}})).rejects.toThrow();
  await expect(f.service.command({id: randomUUID(), type: 'verification.rerun', threadId: f.thread.id, payload: {executionId: 'old', approved: true}})).rejects.toThrow();
  const runtime: RuntimeAdapter = {configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const unavailable = new Service(f.store, runtime); cleanups.push(() => unavailable.dispose());
  await expect(unavailable.command({id: randomUUID(), type: 'verification.prepare', threadId: f.thread.id, payload: f.input})).rejects.toMatchObject({code: 'VERIFICATION_BACKEND_UNAVAILABLE'});
  expect(f.store.all('operation')).toEqual([]); expect(f.launched).toEqual([]);
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
