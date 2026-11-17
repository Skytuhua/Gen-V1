import {z} from 'zod';
import {HarnessError, type RunContext, type RuntimeAdapter, type RuntimeEvent, type StartRun, type Thread, type ToolCall} from '../contracts/index.ts';
import {AGENT_WORK_TERMINAL_STATES, QaResultV1Schema, type AgentWorkAdmissionV1, type AgentWorkV1, type QaResultV1} from '../contracts/agent-work.ts';
import type {VerificationIntent} from '../contracts/verification-workflow.ts';
import {digest, type Store} from '../storage/store.ts';
import type {AgentWorkChild, AgentWorkCoordinator, QaProof} from './agent-work.ts';
import {hostFlagEnabled} from './host-flags.ts';
import {ownerFor} from './tool-effects.ts';
import type {RecipeExecutionResult} from './project-verification.ts';
import {boundedQaResult, qaObservationArgsSchema, qaSourceRequestSchema, readQaSource, recordQaFinding} from './verification-qa-source.ts';

const empty = z.strictObject({}), contextArgs = z.union([z.strictObject({offset: z.number().int().min(0).max(127).optional()}), qaSourceRequestSchema]);
const resultArgs = z.strictObject({output: QaResultV1Schema});
const tools = [
  {name: 'qa_run', description: 'Invoke the single already approved parent-owned verification execution. Repeated calls return the same execution.', schema: empty},
  {name: 'qa_observe', description: 'Read bounded parent-runner observations. An optional structured finding is an advisory claim about an exact approved local source path and line; the host validates source bytes and stamps its scope. Never supply source digests, quality, provenance or mitigation status.', schema: qaObservationArgsSchema},
  {name: 'qa_context', description: 'Read bounded approved requirement metadata. An explicit approved source path reads at most 16 KiB with exact byte offsets and omissions; use nextByteOffset for another bounded range. Native source custody is required. No arbitrary filesystem, shell, browser, write or delegation access is granted.', schema: contextArgs},
  {name: 'qa_result', description: 'Submit an advisory review under the fixed QA output contract. This cannot set an executed PASS or a verified grade.', schema: resultArgs},
];
export interface VerificationQaRuntimePolicy {hostTools: {name: string; description: string; parameters: Record<string, unknown>}[]; systemPrompt: string}
export type VerificationQaRuntimeFactory = (policy: VerificationQaRuntimePolicy) => RuntimeAdapter | Promise<RuntimeAdapter>;
const policy = (): VerificationQaRuntimePolicy => ({hostTools: tools.map(tool => ({name: tool.name, description: tool.description, parameters: z.toJSONSchema(tool.schema) as Record<string, unknown>})),
  systemPrompt: 'You are the read-only QA role. Invoke qa_run for the exact approved parent-owned checks, inspect qa_observe and qa_context, then submit qa_result. Your review is ADVISORY. You have no shell, browser, filesystem write, delegation, approval or recipe-edit tools. Do not claim a model-generated PASS is executed evidence.'});
const failure = (code: string, message: string) => new HarnessError(code, message);
function deferred<T>() {let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); void promise.catch(() => {}); return {promise, resolve, reject};}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? failure('CANCELLED_RUN', 'QA was cancelled.'));
  return new Promise<T>((resolve, reject) => {const abort = () => reject(signal.reason ?? failure('CANCELLED_RUN', 'QA was cancelled.')); signal.addEventListener('abort', abort, {once: true}); work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));});
}
async function cleanupBound<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([work, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(failure('RECONCILIATION_REQUIRED', 'Owned QA cleanup did not finish within 15 seconds.')), 15_000);})]);}
  finally {if (timer) clearTimeout(timer);}
}
interface Session {
  intent: VerificationIntent; operationId: string; parent: RunContext; controller: AbortController;
  assertParent: () => void; execute: (signal: AbortSignal, assertCurrent: () => void) => Promise<RecipeExecutionResult>;
  done: ReturnType<typeof deferred<void>>; deadline: number; proofUsed: boolean; terminal: boolean; reported: boolean; started: boolean; toolCalls: number;
  tokens: number | null; runtime?: RuntimeAdapter; pendingRuntime?: Promise<RuntimeAdapter>; child?: RunContext; nativeSettled: boolean;
  execution?: Promise<RecipeExecutionResult>; result?: RecipeExecutionResult; cleanup?: Promise<void>; fault?: unknown;
}

/** Only the active M02 dispatch may issue a QA work proof. The child receives
 * metadata and bounded results, never an executor, approval or write handle. */
export class VerificationQa {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly hooks: {store: Store; work: () => AgentWorkCoordinator; runtimeFactory?: VerificationQaRuntimeFactory}) {}
  available(): boolean {return hostFlagEnabled('verification.workflowV1') && Boolean(this.hooks.runtimeFactory);}
  assertAvailable(): void {if (!this.available()) throw failure('QA_UNAVAILABLE', 'This host has no enabled restricted QA runtime.');}
  observedUsage(work: AgentWorkV1): {tokens: number | null; ms: number | null} | null {
    const session = this.sessions.get(work.workId);
    if (!session || work.role !== 'QA' || work.inputContractDigest !== digest(session.intent.qa!.admission) || digest(work.parentOwner) !== digest(session.parent)) return null;
    return {tokens: session.tokens, ms: Math.max(0, Date.now() - (session.deadline - session.intent.qa!.admission.budget.ms!))};
  }

  private active(workId: string): Session {
    const session = this.sessions.get(workId);
    if (!session || session.terminal || session.reported) throw failure('APPROVAL_REQUIRED', 'QA has no active approved parent execution.');
    session.assertParent();
    if (session.controller.signal.aborted) throw session.fault ?? session.controller.signal.reason ?? failure('CANCELLED_RUN', 'QA was cancelled.');
    if (Date.now() >= session.deadline) throw failure('QA_BUDGET_EXHAUSTED', 'The approved QA deadline expired.');
    return session;
  }
  proof(ctx: RunContext, admission: AgentWorkAdmissionV1): QaProof {
    const session = this.active(admission.workId);
    if (session.proofUsed || digest(ctx) !== digest(session.parent) || digest(admission) !== digest(session.intent.qa!.admission)) throw failure('APPROVAL_REQUIRED', 'QA work, budget or parent owner differs from the exact approved intent.');
    session.proofUsed = true;
    return {verifierId: 'verification.qa:' + digest([session.operationId, session.intent, admission])};
  }
  private workSession(work: AgentWorkV1): Session {
    const session = this.active(work.workId), admission = session.intent.qa!.admission;
    if (!session.proofUsed || work.role !== 'QA' || work.childOwner.threadId !== admission.childThreadId || digest(work.parentOwner) !== digest(session.parent) || work.inputContractDigest !== digest(admission) || digest(work.budget) !== digest(admission.budget) || work.grantSubset.length)
      throw failure('APPROVAL_REQUIRED', 'QA work authority changed after admission.');
    return session;
  }
  private fail(session: Session, reason: unknown): void {
    if (session.reported || session.terminal) return;
    session.fault ??= reason; session.controller.abort(session.fault); session.done.reject(session.fault);
    void this.closeRuntime(session).catch(() => {});
  }
  private closeRuntime(session: Session): Promise<void> {
    if (session.cleanup) return session.cleanup;
    session.terminal = true;
    session.cleanup = (async () => {
      const runtime = session.runtime ?? await session.pendingRuntime?.catch(() => undefined); if (!runtime) return;
      const cleanup = await Promise.allSettled([...(session.nativeSettled || !session.child ? [] : [Promise.resolve().then(() => runtime.cancel(session.child!))]), Promise.resolve().then(() => runtime.dispose())]);
      if (cleanup.some(result => result.status === 'rejected')) throw failure('RECONCILIATION_REQUIRED', 'Owned QA runtime cleanup could not be confirmed.');
    })();
    void session.cleanup.catch(() => {}); return session.cleanup;
  }
  private event(session: Session, event: RuntimeEvent): void {
    if (session.terminal || session.reported || !session.child || event.threadId !== session.child.threadId || event.runId !== session.child.runId || event.epoch !== session.child.epoch) return;
    try {
      session.assertParent();
      if (event.type === 'usage' && event.usage && typeof event.usage === 'object') {
        const usage = event.usage as Record<string, unknown>;
        if (!Object.hasOwn(usage, 'inputTokens') && !Object.hasOwn(usage, 'outputTokens')) return;
        if (![usage.inputTokens, usage.outputTokens].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw failure('QA_BUDGET_UNAVAILABLE', 'Native QA usage could not be measured against the approved token budget.');
        const tokens = (usage.inputTokens as number) + (usage.outputTokens as number);
        if (!Number.isSafeInteger(tokens) || tokens < (session.tokens ?? 0)) throw failure('QA_BUDGET_UNAVAILABLE', 'Native QA usage no longer identifies a cumulative budget.');
        session.tokens = tokens;
        if (tokens >= session.intent.qa!.admission.budget.tokens!) throw failure('QA_BUDGET_EXHAUSTED', 'The approved QA token budget is exhausted.');
      }
      if (event.type === 'error') throw failure('QA_RUNTIME_FAILED', 'The restricted QA runtime failed.');
      if (event.type === 'settled') {session.nativeSettled = true; throw failure('QA_RESULT_MISSING', 'QA settled without its declared advisory result.');}
    } catch (error) {this.fail(session, error);}
  }
  async child(work: AgentWorkV1, supplied: {prompt: string; grants: unknown[]; allowSpawn: false}): Promise<AgentWorkChild> {
    const session = this.workSession(work);
    if (session.pendingRuntime || supplied.allowSpawn !== false || supplied.grants.length || supplied.prompt !== session.intent.qa!.admission.prompt) throw failure('APPROVAL_REQUIRED', 'QA runtime creation does not match its admitted read-only work.');
    session.pendingRuntime = Promise.resolve().then(() => {this.workSession(work); return this.hooks.runtimeFactory!(policy());}).then(runtime => {session.runtime = runtime; return runtime;});
    const runtime = await abortable(session.pendingRuntime, session.controller.signal); this.workSession(work);
    runtime.configure({onEvent: event => this.event(session, event), onTool: async (call, ctx) => {
      const current = this.active(work.workId), child = current.child;
      if (!child || ctx.threadId !== child.threadId || ctx.runId !== child.runId || ctx.epoch !== child.epoch) throw failure('CANCELLED_RUN', 'QA tool belongs to a different native child owner.');
      const metadata = tools.find(tool => tool.name === call.name);
      if (!metadata) throw failure('AGENT_TOOL_DENIED', 'This tool is absent from the captured QA catalog.');
      if (Buffer.byteLength(JSON.stringify(call.args)) > 16 * 1024) throw failure('RESOURCE_LIMIT', 'QA tool arguments exceed the bounded role contract.');
      metadata.schema.parse(call.args);
      if (current.tokens === null) throw failure('QA_BUDGET_UNAVAILABLE', 'QA requires observed native usage before invoking its parent service.');
      if (++current.toolCalls > 32) {const error = failure('QA_BUDGET_EXHAUSTED', 'QA exceeded its 32-call workflow bound.'); this.fail(current, error); throw error;}
      if (call.name === 'qa_result') return this.report(current, ctx, resultArgs.parse(call.args).output);
      return this.hooks.work().invokeTool(work.workId, ctx, {name: call.name === 'qa_run' ? 'verification.run' : call.name === 'qa_observe' ? 'verification.observe' : 'context.read', args: call.args});
    }});
    return {supportsLiveSteer: false, send: async input => {
      this.workSession(work);
      if (session.started || input.kind !== 'START' || input.text !== session.intent.qa!.admission.prompt) throw failure('AGENT_TOOL_DENIED', 'QA admits one fixed prompt and no steering or recursive task.');
      const current = this.hooks.store.get<AgentWorkV1>('agentWork', work.workId);
      if (!current?.childOwner.runId || current.state !== 'RUNNING') throw failure('CANCELLED_RUN', 'QA has no live child dispatch.');
      session.child = {threadId: current.childOwner.threadId, runId: current.childOwner.runId, epoch: current.childOwner.epoch}; session.started = true;
      const model = session.intent.qa!.model, request: StartRun = {...session.child, ...model, sessionPath: null, inputId: input.inputId, prompt: input.text, resources: []};
      await abortable(runtime.start(request), session.controller.signal);
    }, cancel: async () => {this.fail(session, failure('CANCELLED_RUN', 'QA was stopped.')); await this.closeRuntime(session).catch(() => {});}, dispose: async () => {if (!session.reported && !session.fault) this.fail(session, failure('CANCELLED_RUN', 'QA was disposed before reporting.')); await this.closeRuntime(session).catch(() => {});}};
  }
  async handle(call: ToolCall, work: AgentWorkV1): Promise<unknown> {
    const session = this.workSession(work);
    if (call.name === 'verification.run') {
      empty.parse(call.args);
      session.execution ??= session.execute(session.controller.signal, () => {this.active(work.workId);}).then(result => {session.result = result; return result;});
      const result = await session.execution;
      const view = {evidenceQuality: 'EXECUTED', executionId: result.executionId, outcome: result.outcome, checkIds: result.observations.slice(0, 64).map(value => value.checkId), omittedCheckIds: Math.max(0, result.observations.length - 64), cleanupFailures: result.cleanupFailures.slice(0, 8), omittedCleanupFailures: Math.max(0, result.cleanupFailures.length - 8)};
      return boundedQaResult(view, () => {if (view.cleanupFailures.length) {view.cleanupFailures.pop(); view.omittedCleanupFailures++; return true;} if (view.checkIds.length) {view.checkIds.pop(); view.omittedCheckIds++; return true;} return false;});
    }
    if (call.name === 'verification.observe') {
      const args = qaObservationArgsSchema.parse(call.args), observations = session.result?.observations ?? [];
      const finding = args.finding ? await recordQaFinding({store: this.hooks.store, operationId: session.operationId, intent: session.intent, signal: session.controller.signal, assertCurrent: () => {this.active(work.workId);}}, args.finding) : undefined;
      const view = {evidenceQuality: 'EXECUTED', executionId: session.intent.executionId, observations: observations.slice(0, 64).map(value => ({checkId: value.checkId, outcome: value.outcome, phase: value.phase, detail: value.detail?.slice(0, 500) ?? null})), omitted: Math.max(0, observations.length - 64), ...(finding ? {finding: {findingId: finding.findingId, blobSha: finding.source.blobSha, line: finding.source.line, status: finding.status, evidenceQuality: finding.evidenceQuality}} : {})};
      return boundedQaResult(view, () => {if (!view.observations.length) return false; view.observations.pop(); view.omitted++; return true;});
    }
    if (call.name === 'context.read') {
      const args = contextArgs.parse(call.args);
      if ('path' in args) return readQaSource({store: this.hooks.store, operationId: session.operationId, intent: session.intent, signal: session.controller.signal, assertCurrent: () => {this.active(work.workId);}}, args);
      const offset = args.offset ?? 0, intent = session.intent;
      const view = {operationId: session.operationId, executionId: intent.executionId, recipeId: intent.recipe.recipeId, recipeDigest: intent.recipe.approvedDigest, sourceCut: intent.sourceCut,
        phases: intent.recipe.phases.map(value => ({phase: value.name, executableId: value.executableId, timeoutMs: value.timeoutMs})),
        requirements: intent.requirements.slice(offset, offset + 16).map(value => ({id: value.id, checks: value.checks.slice(0, 8), omittedChecks: Math.max(0, value.checks.length - 8)})), remainingRequirements: Math.max(0, intent.requirements.length - offset - 16),
        sourceFiles: intent.sourceFiles.slice(0, 32), omittedSourceFiles: Math.max(0, intent.sourceFiles.length - 32), budget: intent.qa!.admission.budget};
      return boundedQaResult(view, () => {if (view.sourceFiles.length) {view.sourceFiles.pop(); view.omittedSourceFiles++; return true;} if (view.requirements.length) {view.requirements.pop(); view.remainingRequirements++; return true;} return false;});
    }
    throw failure('AGENT_TOOL_DENIED', 'QA can only invoke the parent verification service and bounded context.');
  }
  private async report(session: Session, ctx: RunContext, output: QaResultV1): Promise<unknown> {
    const qa = session.intent.qa!;
    if (output.requirementIds.some(id => !session.intent.requirements.some(value => value.id === id))) throw failure('QA_SCOPE_CHANGED', 'QA reported a requirement outside the exact approved scope.');
    // Keep model statements separate from immutable executed observations.
    session.reported = true;
    try {
      const work = await this.hooks.work().submitResult(qa.admission.workId, ctx, output); session.assertParent();
      if (work.state !== 'COMPLETED_REPORTED') throw failure('QA_RESULT_INVALID', 'QA did not satisfy its fixed result contract.');
      this.hooks.store.internal('verification.qa.advisory', session.parent.threadId, () => this.hooks.store.put('verificationQaReview', qa.admission.workId, session.parent.threadId,
        {version: 1, workId: qa.admission.workId, operationId: session.operationId, executionId: session.intent.executionId, owner: session.intent.owner, sourceCut: session.intent.sourceCut, evidenceQuality: 'ADVISORY', output,
          budget: qa.admission.budget, observedTokens: session.tokens, createdAt: new Date().toISOString()}));
      session.done.resolve(); return {accepted: true, evidenceQuality: 'ADVISORY'};
    } catch (error) {session.fault = error; session.done.reject(error); session.controller.abort(error); void this.closeRuntime(session).catch(() => {}); throw error;}
  }
  private receipt(session: Session, state: 'RUNNING' | 'COMPLETED_REPORTED' | 'FAILED', cleanupConfirmed: boolean | null): void {
    const workId = session.intent.qa!.admission.workId;
    this.hooks.store.internal('verification.qa.lifecycle', session.parent.threadId, () => {
      this.hooks.store.put('verificationQaLifecycle', workId, session.parent.threadId,
      {version: 1, workId, operationId: session.operationId, executionId: session.intent.executionId, owner: session.intent.owner, state, evidenceQuality: 'ADVISORY',
        budget: session.intent.qa!.admission.budget, observedTokens: session.tokens, toolCalls: session.toolCalls, deadline: new Date(session.deadline).toISOString(), cleanupConfirmed,
        stopReason: session.fault instanceof HarnessError ? session.fault.code : session.fault ? 'QA_RUNTIME_FAILED' : null, updatedAt: new Date().toISOString()});
      const child = session.child ? this.hooks.store.get<Thread>('thread', session.child.threadId) : undefined;
      // Reporting a result is not native teardown. Retire only this completed
      // child after cleanup, retaining the historical AgentWork child owner.
      if (cleanupConfirmed === true && session.child && child?.status === 'completed' && child.kind === 'delegate' &&
        child.parentThreadId === session.parent.threadId && child.jobId === workId && child.modelId === session.intent.qa!.model.modelId &&
        digest(ownerFor(child)) === digest({...session.intent.owner, ...session.child}))
        this.hooks.store.put('thread', child.id, child.id, {...child, runId: null});
    });
  }
  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()];
    for (const session of sessions) this.fail(session, failure('CANCELLED_RUN', 'The host closed the owned QA role.'));
    await cleanupBound(Promise.all(sessions.map(session => this.closeRuntime(session))));
  }
  async run(operationId: string, intent: VerificationIntent, signal: AbortSignal, assertCurrent: () => void, execute: Session['execute']): Promise<RecipeExecutionResult> {
    this.assertAvailable(); const qa = intent.qa;
    if (!qa || !intent.owner.runId || this.sessions.has(qa.admission.workId)) throw failure('APPROVAL_REQUIRED', 'QA requires an unused exact approved work intent.');
    const parent = {threadId: intent.owner.threadId, runId: intent.owner.runId, epoch: intent.owner.epoch}, controller = new AbortController();
    const assertParent = () => {this.assertAvailable(); assertCurrent(); const thread = this.hooks.store.get<Thread>('thread', parent.threadId);
      if (!thread || digest(ownerFor(thread)) !== digest(intent.owner) || digest(qa.model) !== digest({modelId: thread.modelId, accountId: thread.accountId ?? null, thinkingLevel: thread.thinkingLevel ?? null})) throw failure('APPROVAL_REQUIRED', 'QA parent owner or approved model changed.');};
    const session: Session = {operationId, intent, parent, controller, assertParent, execute, done: deferred<void>(), deadline: Date.now() + qa.admission.budget.ms!, proofUsed: false, terminal: false, reported: false, started: false, toolCalls: 0, tokens: null, nativeSettled: false};
    const abort = () => this.fail(session, failure('CANCELLED_RUN', 'The parent verification request was cancelled.'));
    signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort();
    const timer = setTimeout(() => this.fail(session, failure('QA_BUDGET_EXHAUSTED', 'The approved QA deadline expired.')), qa.admission.budget.ms!);
    this.sessions.set(qa.admission.workId, session);
    try {
      this.active(qa.admission.workId);
      this.receipt(session, 'RUNNING', null);
      await abortable(this.hooks.work().admit(parent, qa.admission, controller.signal), controller.signal);
      await session.done.promise; assertParent();
      if (!session.result) throw failure('QA_EXECUTION_MISSING', 'The advisory QA result contains no observed execution.');
      return session.result;
    } catch (error) {session.fault ??= error; throw error;
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort); session.terminal = true; controller.abort();
      let shutdownError: unknown, cleanupConfirmed = false;
      try {
        // Durable coordinator failure cannot release ownership of a native
        // runtime or skip waiting for the parent execution to close.
        try {
          const work = this.hooks.store.get<AgentWorkV1>('agentWork', qa.admission.workId);
          if (work && !AGENT_WORK_TERMINAL_STATES.has(work.state)) await this.hooks.work().stop(parent, work.workId);
        } catch {session.fault = shutdownError = failure('RECONCILIATION_REQUIRED', 'QA work settlement could not be recorded.');}
        try {await cleanupBound(Promise.all([this.closeRuntime(session), session.execution?.then(() => undefined, () => undefined)])); cleanupConfirmed = true;}
        catch (error) {session.fault = shutdownError = error;}
        try {this.receipt(session, session.fault ? 'FAILED' : 'COMPLETED_REPORTED', cleanupConfirmed);}
        catch {session.fault = shutdownError = failure('RECONCILIATION_REQUIRED', 'QA cleanup settlement could not be recorded.');}
        if (shutdownError) throw shutdownError;
      } finally {this.sessions.delete(qa.admission.workId);}
    }
  }
}
