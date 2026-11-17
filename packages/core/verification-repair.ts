import {randomUUID} from 'node:crypto';
import {HarnessError, type Operation, type Thread} from '../contracts/index.ts';
import type {ApprovalV1, ToolEffectRecord, ToolOwner} from '../contracts/tool-effects.ts';
import type {CheckObservationV1, VisualObservationV1} from '../contracts/verification.ts';
import {verificationIntentSchema, type VerificationIntent, type VerificationPrepareInput} from '../contracts/verification-workflow.ts';
import {verificationRepairNextSchema, verificationRepairPlanSchema, verificationRepairStartSchema, type VerificationRepairPlan, type VerificationRepairStop} from '../contracts/verification-repair.ts';
import {digest, type Store} from '../storage/store.ts';
import {assertVerificationSourceRoot, sourceDigestSync, type RecipeExecutionResult} from './project-verification.ts';
import {observationMatchesThreadOwner, verificationFailureIdentity} from './verification-gate.ts';
import {actionCommitment, ownerFor} from './tool-effects.ts';
import type {ManagedVerificationRecord, VerificationWorkflow} from './verification-workflow.ts';

const now = () => new Date().toISOString();
const denied = (code: string, message: string) => new HarnessError(code, message);
const scopeOf = (intent: VerificationIntent) => digest({recipe: intent.recipe, binding: intent.binding, requirements: intent.requirements,
  sourceFiles: intent.sourceFiles, dependencyFiles: intent.dependencyFiles, readiness: intent.readiness, checklist: intent.checklist,
  qa: intent.qa ? {prompt: intent.qa.admission.prompt, model: intent.qa.model} : null});
const failureDigest = (values: (CheckObservationV1 | VisualObservationV1)[]) => digest(values.filter(value => value.outcome === 'FAIL').map(value => verificationFailureIdentity(value)).sort());
function errorStop(error: unknown): VerificationRepairStop {
  const code = error instanceof HarnessError ? error.code : '';
  if (['REPAIR_BUDGET', 'QA_BUDGET_EXHAUSTED'].includes(code)) return 'BUDGET';
  if (['CANCELLED_RUN', 'CANCELLED'].includes(code)) return 'CANCELLED';
  if (['BLOCKED_SOURCE_DRIFT', 'STALE_REVISION', 'REPAIR_SCOPE'].includes(code)) return 'CONFLICT';
  if (['APPROVAL_REQUIRED', 'CAPABILITY_DENIED', 'EXECUTION_BINDING_CHANGED', 'PROJECT_TRUST_INVALIDATED', 'VERIFICATION_BACKEND_UNAVAILABLE'].includes(code)) return 'REVOKED';
  return 'BLOCKED';
}
export interface PreparedRepair {readonly plan: VerificationRepairPlan; readonly input: VerificationPrepareInput; readonly initial: boolean; readonly expectedExecutionId: string}

/** A plan can prepare another reviewable operation, never approve an edit or
 * reuse a consumed executor. All writes run in the caller's host transaction. */
export class VerificationRepair {
  private readonly candidates = new WeakSet<PreparedRepair>();
  private readonly running = new Map<string, AbortController>();
  constructor(private readonly store: Store, private readonly workflow: VerificationWorkflow) {}
  private load(planId: string, threadId: string): VerificationRepairPlan {
    const plan = verificationRepairPlanSchema.parse(this.store.get('verificationRepair', planId));
    if (plan.owner.threadId !== threadId) throw denied('APPROVAL_REQUIRED', 'The repair belongs to another task.');
    return plan;
  }
  private current(owner: ToolOwner): Thread {
    const thread = this.store.get<Thread>('thread', owner.threadId);
    if (!thread || digest(ownerFor(thread)) !== digest(owner)) throw denied('APPROVAL_REQUIRED', 'The repair parent owner changed.');
    return thread;
  }
  private observations(intent: VerificationIntent) {
    return [...this.store.all<CheckObservationV1>('checkObservation', intent.owner.threadId), ...this.store.all<VisualObservationV1>('visualObservation', intent.owner.threadId)]
      .filter(value => value.executionId === intent.executionId && digest(value.owner) === digest(intent.owner) && value.observationKind !== 'review-advisory');
  }
  private observedTokens(operation: Operation, intent: VerificationIntent): number | null {
    if (!intent.qa) return null;
    const receipt = this.store.get<{version: number; workId: string; operationId: string; executionId: string; owner: unknown; budget: unknown; observedTokens: unknown}>('verificationQaLifecycle', intent.qa.admission.workId);
    if (!receipt || receipt.version !== 1 || receipt.workId !== intent.qa.admission.workId || receipt.operationId !== operation.id || receipt.executionId !== intent.executionId || digest(receipt.owner ?? null) !== digest(intent.owner) || digest(receipt.budget ?? null) !== digest(intent.qa.admission.budget)) return null;
    return typeof receipt.observedTokens === 'number' && Number.isSafeInteger(receipt.observedTokens) && receipt.observedTokens >= 0 ? receipt.observedTokens : null;
  }
  private stopped(plan: VerificationRepairPlan): VerificationRepairStop | null {
    return plan.stopped ?? (Date.now() >= Date.parse(plan.deadline) || plan.attempts.length >= 3 && plan.attempts.at(-1)?.outcome !== 'RUNNING' || plan.budget.tokens > 0 && plan.chargedTokens >= plan.budget.tokens ? 'BUDGET' : null);
  }
  private save(plan: VerificationRepairPlan): void {
    const parsed = verificationRepairPlanSchema.parse(plan); this.store.put('verificationRepair', plan.planId, plan.owner.threadId, parsed);
    this.store.put('verificationRepairCurrent', plan.owner.threadId, plan.owner.threadId, {planId: plan.planId});
  }
  prepare(owner: ToolOwner, kind: 'start' | 'next', raw: unknown): PreparedRepair {
    const thread = this.current(owner); let plan: VerificationRepairPlan, executionId: string;
    if (kind === 'start') {
      const request = verificationRepairStartSchema.parse(raw); executionId = request.executionId;
      this.workflow.rerunInput(owner, {executionId});
      const managed = this.store.get<ManagedVerificationRecord>('verificationManaged', owner.threadId)!, intent = verificationIntentSchema.parse(managed.intent);
      const operation = this.store.get<Operation>('operation', managed.operationId), effect = operation && this.store.get<ToolEffectRecord>('toolEffect', `operation:${operation.id}@${operation.revision}`);
      const approval = effect?.approvalId ? this.store.get<ApprovalV1>('approval', effect.approvalId) : null, observed = this.observations(intent);
      if (managed.status !== 'failed' || managed.outcome !== 'FAIL' || !operation?.approved || operation.status !== 'failed' || digest(operation.args) !== digest({intent}) || effect?.state !== 'FAILED' || digest(effect.owner) !== digest(intent.owner) || !approval || approval.remainingUses !== 0 || digest(approval.owner) !== digest(intent.owner) || approval.actionCommitment !== actionCommitment(operation, {...thread, runId: intent.owner.runId, epoch: intent.owner.epoch}) || !observed.some(value => value.outcome === 'FAIL'))
        throw denied('REPAIR_REQUIRES_FAILURE', 'Start repair from the current settled executed failure.');
      if (this.store.all<VerificationRepairPlan>('verificationRepair', owner.threadId).some(value => value.recipeId === intent.recipe.recipeId && observationMatchesThreadOwner(value, thread))) throw denied('REPAIR_STOPPED', 'This recipe already has a bounded repair plan. Its history and budget cannot be reset.');
      const createdAt = now();
      plan = {version: 1, planId: `repair-${randomUUID()}`, owner, recipeId: intent.recipe.recipeId, scopeDigest: scopeOf(intent), baselineExecutionId: executionId,
        baselineFailureDigest: failureDigest(observed), budget: request.budget, deadline: new Date(Date.now() + request.budget.ms).toISOString(), revision: 1,
        chargedTokens: 0, pendingOperationId: null, attempts: [], stopped: null, stopDetail: null, createdAt, updatedAt: createdAt};
    } else {
      const request = verificationRepairNextSchema.parse(raw); plan = this.load(request.planId, owner.threadId);
      if (plan.revision !== request.revision) throw denied('STALE_REVISION', 'The repair progress changed; review the current state.');
      if (!observationMatchesThreadOwner(plan, thread)) throw denied('REPAIR_SCOPE', 'The repair project, working copy or account changed.');
      if (this.stopped(plan)) throw denied('REPAIR_STOPPED', `Repair stopped: ${this.stopped(plan)}.`);
      if (plan.pendingOperationId) throw denied('VERIFICATION_BUSY', 'Resolve the pending repair operation first.');
      executionId = plan.attempts.at(-1)?.executionId ?? plan.baselineExecutionId;
    }
    const input = this.workflow.rerunInput(owner, {executionId}), current = this.store.get<ManagedVerificationRecord>('verificationManaged', owner.threadId)!;
    if (scopeOf(current.intent) !== plan.scopeDigest) throw denied('REPAIR_SCOPE', 'The repair must keep its exact approved recipe and requirement selectors.');
    const remainingMs = Date.parse(plan.deadline) - Date.now(), remainingTokens = plan.budget.tokens - plan.chargedTokens;
    if (remainingMs < 1000 || input.qa && remainingTokens < 1) throw denied('REPAIR_BUDGET', 'The remaining repair budget cannot admit another attempt.');
    if (input.qa) input.qa.budget = {tokens: Math.min(input.qa.budget.tokens, remainingTokens), ms: Math.min(input.qa.budget.ms, remainingMs)};
    const candidate = Object.freeze({plan, input, initial: kind === 'start', expectedExecutionId: executionId}); this.candidates.add(candidate); return candidate;
  }
  private assertCandidate(candidate: PreparedRepair): void {
    if (!this.candidates.has(candidate)) throw denied('APPROVAL_REQUIRED', 'Repair preparation has no host custody.');
    const {plan} = candidate, thread = this.store.get<Thread>('thread', plan.owner.threadId);
    if (!thread || !observationMatchesThreadOwner(plan, thread)) throw denied('REPAIR_SCOPE', 'The repair owner changed before preparation committed.');
    if (candidate.initial) {
      if (this.store.all<VerificationRepairPlan>('verificationRepair', plan.owner.threadId).some(value => value.recipeId === plan.recipeId && observationMatchesThreadOwner(value, thread))) throw denied('REPAIR_STOPPED', 'This recipe already has a repair plan.');
    } else if (digest(this.load(plan.planId, plan.owner.threadId)) !== digest(plan)) throw denied('STALE_REVISION', 'The repair changed during preparation.');
    const managed = this.store.get<ManagedVerificationRecord>('verificationManaged', plan.owner.threadId);
    if (managed?.intent.executionId !== candidate.expectedExecutionId || scopeOf(managed.intent) !== plan.scopeDigest) throw denied('REPAIR_SCOPE', 'Another verification replaced the repair source execution.');
    if (this.stopped(plan)) throw denied('REPAIR_BUDGET', 'The repair budget is exhausted.');
  }
  bind(candidate: PreparedRepair, intent: VerificationIntent): VerificationIntent {
    this.assertCandidate(candidate);
    if (scopeOf(intent) !== candidate.plan.scopeDigest) throw denied('REPAIR_SCOPE', 'The prepared recipe or approved execution environment changed.');
    const plan = candidate.plan;
    return verificationIntentSchema.parse({...intent, repair: {planId: plan.planId, planRevision: plan.revision + 1, attempt: plan.attempts.length + 1, scopeDigest: plan.scopeDigest, deadline: plan.deadline, budget: plan.budget}});
  }
  prepared(candidate: PreparedRepair, operation: Operation): void {
    this.assertCandidate(candidate); const plan = candidate.plan;
    this.save({...plan, pendingOperationId: operation.id, revision: plan.revision + 1, updatedAt: now()}); this.candidates.delete(candidate);
  }
  assertApproval(operation: Operation, intent: VerificationIntent): void {
    if (!intent.repair) return;
    const plan = this.load(intent.repair.planId, operation.threadId), thread = this.current(intent.owner);
    if (!observationMatchesThreadOwner(plan, thread) || plan.pendingOperationId !== operation.id || plan.revision !== intent.repair.planRevision || plan.attempts.length + 1 !== intent.repair.attempt || scopeOf(intent) !== plan.scopeDigest || digest(intent.repair) !== digest({planId: plan.planId, planRevision: plan.revision, attempt: plan.attempts.length + 1, scopeDigest: plan.scopeDigest, deadline: plan.deadline, budget: plan.budget})) throw denied('REPAIR_SCOPE', 'The exact repair approval no longer matches its plan.');
    if (this.stopped(plan)) throw denied('REPAIR_BUDGET', 'The repair plan has stopped or exhausted its budget.');
    if (intent.qa && (intent.qa.admission.budget.tokens === null || intent.qa.admission.budget.tokens > plan.budget.tokens - plan.chargedTokens || intent.qa.admission.budget.ms === null || intent.qa.admission.budget.ms > plan.budget.ms)) throw denied('REPAIR_BUDGET', 'The approved QA request exceeds the remaining repair allocation.');
    const prior = this.store.get<ManagedVerificationRecord>('verificationManaged', operation.threadId);
    if (prior?.intent.executionId !== (plan.attempts.at(-1)?.executionId ?? plan.baselineExecutionId)) throw denied('REPAIR_SCOPE', 'Another verification replaced the repair execution.');
  }
  admit(operation: Operation, intent: VerificationIntent): void {
    if (!intent.repair) return; this.assertApproval(operation, intent);
    const plan = this.load(intent.repair.planId, operation.threadId), startedAt = now();
    this.save({...plan, revision: plan.revision + 1, updatedAt: startedAt, attempts: [...plan.attempts, {attempt: intent.repair.attempt, operationId: operation.id, executionId: intent.executionId, owner: intent.owner, outcome: 'RUNNING', failureDigest: null, reservedTokens: intent.qa?.admission.budget.tokens ?? 0, observedTokens: null, startedAt, endedAt: null}]});
  }
  private assertLive(operation: Operation, intent: VerificationIntent): void {
    const plan = this.load(intent.repair!.planId, operation.threadId), attempt = plan.attempts.at(-1);
    if (plan.stopped || plan.pendingOperationId !== operation.id || attempt?.operationId !== operation.id || attempt.executionId !== intent.executionId || attempt.outcome !== 'RUNNING' || digest(attempt.owner) !== digest(intent.owner)) throw denied('CANCELLED_RUN', 'The repair attempt is no longer active.');
    if (Date.now() >= Date.parse(plan.deadline)) throw denied('REPAIR_BUDGET', 'The repair deadline expired.');
  }
  async run(operation: Operation, intent: VerificationIntent, signal: AbortSignal, assertCurrent: () => void, execute: (signal: AbortSignal, fence: () => void) => Promise<RecipeExecutionResult>): Promise<RecipeExecutionResult> {
    if (!intent.repair) return execute(signal, assertCurrent);
    const key = intent.repair.planId; if (this.running.has(key)) throw denied('VERIFICATION_BUSY', 'This repair already owns an execution.');
    const control = new AbortController(), abort = () => control.abort(signal.reason), deadline = Date.parse(intent.repair.deadline);
    signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort();
    const timer = setTimeout(() => control.abort(denied('REPAIR_BUDGET', 'The repair deadline expired.')), Math.max(0, deadline - Date.now())); this.running.set(key, control);
    const fence = () => {assertCurrent(); this.assertLive(operation, intent); if (control.signal.aborted) throw control.signal.reason ?? denied('CANCELLED_RUN', 'Repair was stopped.');};
    try {fence(); return await execute(control.signal, fence);} finally {clearTimeout(timer); signal.removeEventListener('abort', abort); if (this.running.get(key) === control) this.running.delete(key);}
  }
  private finish(operation: Operation, intent: VerificationIntent, result?: RecipeExecutionResult, error?: unknown): void {
    if (!intent.repair) return;
    const plan = this.load(intent.repair.planId, operation.threadId); if (plan.pendingOperationId !== operation.id) return;
    const attempt = plan.attempts.at(-1), owned = attempt?.operationId === operation.id && attempt.outcome === 'RUNNING' ? attempt : null;
    const observedTokens = this.observedTokens(operation, intent);
    const chargedTokens = plan.chargedTokens + (owned ? Math.max(owned.reservedTokens, observedTokens ?? 0) : 0);
    const outcome: VerificationRepairPlan['attempts'][number]['outcome'] = operation.status === 'unknown' ? 'UNKNOWN' : result?.outcome ?? (operation.status === 'cancelled' ? 'CANCELLED' : 'BLOCKED');
    const fingerprint = result?.outcome === 'FAIL' ? failureDigest(this.observations(intent)) : null;
    let stopped = plan.stopped, detail = plan.stopDetail;
    if (outcome === 'UNKNOWN' || result?.cleanupFailures.length) {stopped = 'BLOCKED'; detail = 'Owned cleanup or the execution outcome could not be confirmed.';}
    else if (Date.now() >= Date.parse(plan.deadline) || plan.budget.tokens > 0 && chargedTokens >= plan.budget.tokens) {stopped = 'BUDGET'; detail = 'The repair deadline or token allocation is exhausted.';}
    else if (error) {stopped = errorStop(error); detail = error instanceof Error ? error.message.slice(0, 500) : 'Repair execution was unavailable.';}
    else if (outcome === 'CANCELLED') stopped = 'CANCELLED';
    else if (result) {
      try {assertVerificationSourceRoot(this.store, operation.threadId, intent.recipe.workspaceIdentity.canonicalPath);
        const root = intent.recipe.workspaceIdentity.canonicalPath;
        if (digest({codeDigest: sourceDigestSync(root, intent.sourceFiles), dependencyDigest: sourceDigestSync(root, intent.dependencyFiles)}) !== digest(intent.sourceCut)) throw denied('BLOCKED_SOURCE_DRIFT', 'Sources changed during the repair attempt.');
      } catch (changed) {stopped = errorStop(changed); detail = changed instanceof Error ? changed.message.slice(0, 500) : 'Repair source authority changed.';}
      if (!stopped) {
        if (outcome === 'PASS') stopped = 'PASSED';
        else if (outcome === 'BLOCKED') stopped = 'BLOCKED';
        else if (fingerprint === (plan.attempts.at(-2)?.failureDigest ?? plan.baselineFailureDigest)) stopped = 'UNCHANGED_FAILURE';
        else if (plan.attempts.length >= 3) stopped = 'BUDGET';
      }
    }
    const endedAt = now(), attempts = owned ? [...plan.attempts.slice(0, -1), {...owned, outcome, observedTokens, failureDigest: fingerprint, endedAt}] : plan.attempts;
    this.save({...plan, attempts, chargedTokens, pendingOperationId: null, stopped, stopDetail: detail, revision: plan.revision + 1, updatedAt: endedAt});
  }
  settled(operation: Operation, intent: VerificationIntent, result: RecipeExecutionResult): void {this.finish(operation, intent, result);}
  failed(operation: Operation, error: unknown): void {const parsed = verificationIntentSchema.safeParse(operation.args.intent); if (parsed.success) this.finish(operation, parsed.data, undefined, error);}
  rejected(operation: Operation): void {this.failed(operation, denied('CANCELLED_RUN', 'The user declined the repair operation.'));}
  stop(threadId: string, raw: unknown): VerificationRepairPlan {
    const request = verificationRepairNextSchema.parse(raw), plan = this.load(request.planId, threadId), thread = this.store.get<Thread>('thread', threadId);
    if (plan.revision !== request.revision) throw denied('STALE_REVISION', 'The repair changed before Stop.');
    if (!observationMatchesThreadOwner(plan, thread)) throw denied('APPROVAL_REQUIRED', 'The repair belongs to a different current owner.');
    if (plan.stopped) return plan;
    const next = {...plan, stopped: 'CANCELLED' as const, stopDetail: 'The user stopped this repair plan.', revision: plan.revision + 1, updatedAt: now()};
    if (plan.pendingOperationId) {const operation = this.store.get<Operation>('operation', plan.pendingOperationId); if (operation?.status === 'prepared') this.store.put('operation', operation.id, threadId, {...operation, status: 'cancelled', approved: false});}
    this.save(next); return next;
  }
  cancelOwned(planId: string): void {this.running.get(planId)?.abort(denied('CANCELLED_RUN', 'The user stopped this repair plan.'));}
  preparationFailed(candidate: PreparedRepair, error: unknown): void {
    if (candidate.initial || !this.candidates.has(candidate)) return;
    const current = this.load(candidate.plan.planId, candidate.plan.owner.threadId);
    if (digest(current) !== digest(candidate.plan)) return;
    this.store.internal('verification.repair.blocked', current.owner.threadId, () => this.save({...current, stopped: errorStop(error), stopDetail: error instanceof Error ? error.message.slice(0, 500) : 'Repair preparation failed.', revision: current.revision + 1, updatedAt: now()})); this.candidates.delete(candidate);
  }
  recover(): void {
    for (const controller of this.running.values()) controller.abort(denied('CANCELLED_RUN', 'Repair host custody was lost.'));
    const pending = this.store.all<VerificationRepairPlan>('verificationRepair').filter(plan => plan.pendingOperationId || plan.attempts.some(attempt => attempt.outcome === 'RUNNING'));
    if (!pending.length) return;
    this.store.internal('verification.repair.recovered', null, () => {for (const raw of pending) {const plan = verificationRepairPlanSchema.parse(raw), operation = plan.pendingOperationId ? this.store.get<Operation>('operation', plan.pendingOperationId) : null;
      if (operation?.status === 'prepared') this.store.put('operation', operation.id, operation.threadId, {...operation, status: 'cancelled', approved: false});
      let chargedTokens = plan.chargedTokens, lost = false;
      const attempts = plan.attempts.map(attempt => {
        if (attempt.outcome !== 'RUNNING') return attempt;
        lost = true;
        const ownedOperation = this.store.get<Operation>('operation', attempt.operationId), parsed = verificationIntentSchema.safeParse(ownedOperation?.args.intent);
        const intent = parsed.success ? parsed.data : null;
        const observedTokens = ownedOperation?.threadId === plan.owner.threadId && intent?.repair?.planId === plan.planId && intent.repair.attempt === attempt.attempt && intent.repair.scopeDigest === plan.scopeDigest && intent.executionId === attempt.executionId && digest(intent.owner) === digest(attempt.owner) ? this.observedTokens(ownedOperation, intent) : null;
        chargedTokens += Math.max(attempt.reservedTokens, observedTokens ?? 0);
        return {...attempt, outcome: 'UNKNOWN' as const, observedTokens, endedAt: now()};
      });
      this.save({...plan, stopped: lost ? 'BLOCKED' : plan.stopped ?? 'CANCELLED', stopDetail: 'Host recovery cannot inherit or replay the former repair execution.', pendingOperationId: null,
        chargedTokens, attempts, revision: plan.revision + 1, updatedAt: now()});
    }});
  }
}
