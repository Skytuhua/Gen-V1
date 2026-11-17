import {test as base, expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../apps/server/server.ts';
import {launchHost, type RunningHost} from '../apps/server/host.ts';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import {ProjectTrustLedger} from '../packages/core/project-trust.ts';
import {SecretReferenceLedger} from '../packages/core/secret-references.ts';
import {digestFileSha256} from '../packages/core/execution-policy.ts';
import {createVerificationExecutorFactory, type VerificationExecutorFactory} from '../packages/core/verification-executor.ts';
import type {ObservedVerificationBackend} from '../packages/core/verification-executor-binding.ts';
import type {VerificationQaRuntimePolicy} from '../packages/core/verification-qa.ts';
import type {VerificationPrepareInput} from '../packages/contracts/verification-workflow.ts';
import type {ApprovalV1, ToolEffectRecord} from '../packages/contracts/tool-effects.ts';
import type {Operation, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread} from '../packages/contracts/index.ts';

export const VERIFICATION_HOST_URL = 'http://127.0.0.1:5561';
export const VERIFICATION_FIXTURE_LABEL = 'Verification host contract fixture (no model inference)';
export const INJECTED_LOG = 'Injected executor observation only. No native process or provider inference ran.\n<script>window.verificationLogExecuted = true</script>\n';
export const VERIFICATION_SOURCE = 'export const contractVersion = 1;\n';
export const VERIFICATION_CHANGED_SOURCE = 'export const contractVersion = 2;\n';
export const VERIFICATION_REPAIR_PROMPT = 'Prepare the injected contract check for bounded repair review.';

class ForegroundRuntime implements RuntimeAdapter {
  private callbacks!: RuntimeCallbacks;
  readonly deliveries: StartRun[] = [];
  readonly prepared: {threadId: string; runId: string; epoch: number; operationId: string}[] = [];
  constructor(private readonly folder: string, private readonly proposal: () => VerificationPrepareInput) {}
  configure(callbacks: RuntimeCallbacks) {this.callbacks = callbacks;}
  async models() {return [{id: 'fixture/verification-contract', provider: 'fixture', name: VERIFICATION_FIXTURE_LABEL}];}
  async history(path: string): Promise<string[]> {try {return JSON.parse(await readFile(path, 'utf8'));} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error;}}
  async start(input: StartRun) {await this.deliver(input);}
  async followUp(input: StartRun) {await this.deliver(input);}
  async cancel() {}
  async compact() {throw Error('Native compaction is outside this injected fixture.');}
  async dispose() {}
  private async deliver(input: StartRun) {
    this.deliveries.push(input);
    const sessionPath = join(this.folder, `foreground-${input.threadId}.json`), inputIds = input.inputIds ?? [input.inputId];
    await writeFile(sessionPath, JSON.stringify([...new Set([...await this.history(sessionPath), ...inputIds])]));
    this.callbacks.onEvent({...input, type: 'session', sessionPath});
    this.callbacks.onEvent({...input, type: 'input.processing', inputIds});
    this.callbacks.onEvent({...input, type: 'assistant.message', messageId: randomUUID(), inputIds, content: VERIFICATION_FIXTURE_LABEL});
    if (input.prompt.includes(VERIFICATION_REPAIR_PROMPT) && !inputIds.some(id => id.startsWith('operation-result:'))) {
      const operation = await this.callbacks.onTool({name: 'verification_prepare', args: this.proposal()}, input) as Operation;
      this.prepared.push({threadId: input.threadId, runId: input.runId, epoch: input.epoch, operationId: operation.id});
    }
    if (inputIds.some(id => id.startsWith('operation-result:')))
      await this.callbacks.onTool({name: 'task_finish', args: {outcome: 'The injected contract check completed.'}}, input);
    // Keep the real parent run active while its approved verification operates.
  }
}

interface QaObservation {policy: string[]; deliveries: StartRun[]; cancelled: number; disposed: number; error: string | null}
export class VerificationHostFixture {
  store!: Store;
  service!: Service;
  runtime!: ForegroundRuntime;
  private host?: RunningHost;
  private executor?: VerificationExecutorFactory;
  readonly projectPath: string;
  readonly sourcePath: string;
  readonly requests: {method: string; url: string; status: number; csrf: boolean; body: unknown}[] = [];
  readonly launches: {argv: string[]; effectId: string; approvalId: string; executionId: string; pid: number; exitCode: number; terminated: boolean}[] = [];
  readonly qa: QaObservation[] = [];
  constructor(readonly folder: string, readonly configured: boolean, private readonly exitCodes: readonly number[] = [], private readonly composerQa = false) {this.projectPath = join(folder, 'project'); this.sourcePath = join(this.projectPath, 'app.ts');}
  async start() {
    await mkdir(this.projectPath);
    await writeFile(this.sourcePath, VERIFICATION_SOURCE);
    await writeFile(join(this.projectPath, 'lock.yaml'), 'version: 1\n');
    await writeFile(join(this.projectPath, 'fixture-tool'), 'Identity-only fixture file. It is never executed.\n');
    const forward: VerificationExecutorFactory = {
      describe: input => {if (!this.executor) throw Error('Configure the explicit fixture profile after connecting its project.'); return this.executor.describe(input);},
      assertCurrent: (binding, fence) => {if (!this.executor) throw Error('Fixture executor unavailable.'); this.executor.assertCurrent(binding, fence);},
      open: input => {if (!this.executor) throw Error('Fixture executor unavailable.'); return this.executor.open(input);},
    };
    this.host = await launchHost({dataDir: join(this.folder, 'profile'), port: 5561, widgetPort: 5562, dev: false,
      pluginDir: join(this.folder, 'plugins'), capabilityFlags: {}, ...(this.configured ? {verificationExecutor: forward} : {})}, {
      createRuntime: () => this.runtime = new ForegroundRuntime(this.folder, () => this.proposal(this.composerQa)),
      createService: (store, runtime, capabilities) => {
        this.store = store;
        return this.service = new Service(store, runtime, {verificationExecutor: capabilities?.verificationExecutor,
          verificationQaRuntimeFactory: policy => this.qaRuntime(policy)});
      },
      buildServer: async (service, options) => {
        const app = await buildServer(service, options);
        app.addHook('onResponse', async (request, reply) => {
          if (!request.url.startsWith('/api/')) return;
          if (this.requests.length >= 256) throw Error('Fixture HTTP observation bound exceeded.');
          this.requests.push({method: request.method, url: request.url, status: reply.statusCode,
            csrf: typeof request.headers['x-harness-csrf'] === 'string', body: request.body ?? null});
        });
        return app;
      },
    });
  }
  async configureProject(thread: Thread) {
    if (!this.configured || !thread.projectId || thread.workspaceId) throw Error('Fixture requires its ordinary connected project root.');
    const root = this.store.get<{path: string}>('workspaceProjectRoot', thread.projectId);
    if (root?.path !== this.projectPath) throw Error('Fixture profile cannot bind a different project root.');
    const executable = join(this.projectPath, 'fixture-tool'), sha256 = await digestFileSha256(executable), trust = new ProjectTrustLedger();
    await trust.decide({trustId: 'injected-contract-trust', rootPath: this.projectPath, approvedFiles: [{path: 'fixture-tool', kind: 'executable'}], scope: {read: true, write: false, network: 'none'}, decision: 'trusted'});
    const backend: ObservedVerificationBackend = {
      backendId: 'injected-contract-backend', platform: process.platform, installed: true, approved: true,
      proof: {platformProofRef: 'INJECTED_CONTRACT_FIXTURE', platform: process.platform, status: 'PASS', recordedAt: new Date().toISOString(), evidenceRef: 'fixture-only-not-native-platform-proof'},
      launch: async () => {throw Error('No native or unobserved launch exists in this fixture.');},
      launchObserved: async request => {
        request.assertCurrent();
        const operation = this.store.all<Operation>('operation', thread.id).find(value => value.kind === 'verification.run' && value.status === 'running');
        if (!operation) throw Error('Fixture launch has no actual running operation.');
        const effectId = `operation:${operation.id}@${operation.revision}`, effect = this.store.get<ToolEffectRecord>('toolEffect', effectId);
        const approval = effect?.approvalId ? this.store.get<ApprovalV1>('approval', effect.approvalId) : null;
        if (effect?.state !== 'DISPATCHED' || !approval || approval.issuer !== 'authenticated_user' || approval.remainingUses !== 0)
          throw Error('Fixture launch requires consumed ordinary user approval and durable M02 dispatch.');
        if (request.executable !== executable || JSON.stringify(request.argv) !== JSON.stringify(['check'])) throw Error('Fixture executor received an unapproved command.');
        const intent = operation.args.intent as {executionId: string}, pid = 10_000 + this.launches.length;
        const exitCode = this.exitCodes[this.launches.length] ?? 0;
        const observation = {argv: [...request.argv], effectId, approvalId: approval.approvalId, executionId: intent.executionId, pid, exitCode, terminated: false};
        this.launches.push(observation);
        return {pid, tree: async () => [pid], wait: async () => ({exitCode, termination: 'NONE' as const}),
          log: async () => ({text: INJECTED_LOG, truncated: false}), terminate: async () => {observation.terminated = true;}};
      },
    };
    const flags = {HARNESS_FLAG_VERIFICATION_WORKFLOW_V1: '1', HARNESS_FLAG_SECURITY_EXECUTION_PROFILES_V1: '1', HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1: '1'};
    this.executor = createVerificationExecutorFactory({approvedBackendId: backend.backendId, backends: [backend],
      profiles: [{profile: {profileId: 'injected-contract-profile', version: 1, backendId: backend.backendId, capabilities: ['process.execute', 'fs.read'],
        readRoots: [this.projectPath], writeRoots: [], networkPolicy: {mode: 'none'}, secretRefs: [], executableAllowlist: [{executableSha256: sha256, argv: ['check']}], platformProofRef: 'INJECTED_CONTRACT_FIXTURE'},
      trustId: 'injected-contract-trust', projectId: thread.projectId, workspaceId: null, accountBinding: thread.accountId ?? null}],
      executables: [{id: 'fixture-tool', path: executable}], trust, secrets: new SecretReferenceLedger(), environment: {LANG: 'C'}, flags});
  }
  proposal(qa = false): VerificationPrepareInput {
    return {profileId: 'injected-contract-profile', sourceFiles: ['app.ts'], dependencyFiles: ['lock.yaml'],
      phases: [{name: 'TEST', executableId: 'fixture-tool', argv: ['check'], relativeCwd: '.', environmentRefs: [], timeoutMs: 10_000}],
      requirements: [{id: 'contract-check', checks: [{phase: 'TEST'}]}],
      ...(qa ? {qa: {prompt: 'Run the approved contract check and report an advisory result.', budget: {tokens: 1000, ms: 10_000}}} : {})};
  }
  private qaRuntime(policy: VerificationQaRuntimePolicy): RuntimeAdapter {
    const observation: QaObservation = {policy: policy.hostTools.map(tool => tool.name), deliveries: [], cancelled: 0, disposed: 0, error: null};
    this.qa.push(observation);
    let callbacks!: RuntimeCallbacks;
    return {configure: value => {callbacks = value;}, models: async () => [], history: async () => [],
      start: async input => {
        observation.deliveries.push(input);
        queueMicrotask(() => {void (async () => {
          callbacks.onEvent({...input, type: 'usage', usage: {inputTokens: 5, outputTokens: 5}});
          await callbacks.onTool({name: 'qa_run', args: {}}, input);
          await callbacks.onTool({name: 'qa_result', args: {output: {outcome: 'COMPLETED', summary: 'Injected advisory review only.', evidenceRefs: [], requirementIds: ['contract-check'], observations: []}}}, input);
        })().catch(error => {observation.error = error instanceof Error ? error.message : String(error); callbacks.onEvent({...input, type: 'error'});});});
      }, followUp: async () => {throw Error('The QA fixture does not permit steering.');}, cancel: async () => {observation.cancelled++;},
      compact: async () => {throw Error('The QA fixture cannot compact.');}, dispose: async () => {observation.disposed++;}};
  }
  async close() {await this.host?.close();}
}

export const test = base.extend<{verificationHost: VerificationHostFixture; verificationBackend: boolean; verificationExitCodes: number[]; verificationComposerQa: boolean}>({
  verificationBackend: [true, {option: true}],
  verificationExitCodes: [[], {option: true}],
  verificationComposerQa: [false, {option: true}],
  verificationHost: async ({verificationBackend, verificationExitCodes, verificationComposerQa}, use, info) => {
    const folder = await mkdtemp(join(tmpdir(), 'gen-verify-host-')), host = new VerificationHostFixture(folder, verificationBackend, verificationExitCodes, verificationComposerQa);
    const prior = process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1;
    process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1 = '1';
    await mkdir(info.outputDir, {recursive: true});
    try {await host.start(); await use(host);}
    finally {
      try {
        await writeFile(info.outputPath('verification-host-observations.json'), JSON.stringify({fixture: VERIFICATION_FIXTURE_LABEL,
          scope: 'Production built App, HTTP session/CSRF, Service, SQLite, M02 approval, executor policy/seals and artifact viewer. Foreground, QA and executor outputs are injected contract observations. No native confinement, installed platform or provider proof.',
          configured: host.configured, ports: [5561, 5562], requests: host.requests, launches: host.launches, qa: host.qa,
          deliveries: host.runtime?.deliveries, preparedFromComposer: host.runtime?.prepared, snapshot: host.store?.db.isOpen ? host.store.snapshot() : null}, null, 2));
      } finally {
        try {await host.close(); await rm(folder, {recursive: true, force: true, maxRetries: 5});}
        finally {if (prior === undefined) delete process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1; else process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1 = prior;}
      }
    }
  },
});
export {expect};
