import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {QaResultV1Schema} from '../contracts/agent-work.ts';
import {HarnessError, type Operation, type Thread} from '../contracts/index.ts';
import type {ApprovalV1, ToolEffectRecord, ToolOwner} from '../contracts/tool-effects.ts';
import type {CheckObservationV1, VerificationDeclarationV1, VerificationRecipeV1, VisualObservationV1} from '../contracts/verification.ts';
import {verificationIntentSchema, verificationOperationArgumentsSchema, verificationPrepareSchema, verificationRerunSchema, type VerificationIntent, type VerificationPrepareInput} from '../contracts/verification-workflow.ts';
import {digest, type Store} from '../storage/store.ts';
import {assertVerificationSourceRoot, ProjectVerificationService, recipeDigest, sourceDigest, type RecipeExecutionResult} from './project-verification.ts';
import type {VerificationExecutorBinding, VerificationExecutorFactory} from './verification-executor.ts';
import {hostFlagEnabled} from './host-flags.ts';
import {actionCommitment, ownerFor} from './tool-effects.ts';
import {observationMatchesThreadOwner} from './verification-gate.ts';

const nativePhases = new Set(['BOOTSTRAP', 'BUILD', 'TEST', 'START']);
const drift = (message: string) => new HarnessError('BLOCKED_SOURCE_DRIFT', message);
export const isVerificationOperation = (operation: Pick<Operation, 'kind'>): boolean => operation.kind === 'verification.run';
interface PreparedExecution {operationId: string; intent: VerificationIntent; binding: VerificationExecutorBinding; assertBasis: () => void}
export interface VerificationReadBasis {readonly environmentId: string; readonly recipeDigest: string}
const readSeals = new WeakMap<VerificationReadBasis, {store: Store; threadId: string; assertCurrent: () => void}>();
/** A serialized descriptor or caller-created object never grants read-side authority. */
export function assertVerificationReadBasis(store: Store, threadId: string, basis: VerificationReadBasis | null | undefined): asserts basis is VerificationReadBasis {
  const seal = basis && readSeals.get(basis);
  if (!seal || seal.store !== store || seal.threadId !== threadId) throw new HarnessError('VERIFICATION_BASIS_UNAVAILABLE', 'Current approved execution authority is unavailable.');
  seal.assertCurrent();
}
export interface ManagedVerificationRecord {operationId: string; intent: VerificationIntent; status: Operation['status']; outcome?: RecipeExecutionResult['outcome']; cleanupFailures?: string[]}

/** Connects ordinary M02 operation approval to the admitted M03 executor.
 * All executable capabilities and seals remain private host objects. */
export class VerificationWorkflow {
  private readonly prepared = new WeakMap<PreparedExecution, 'prepared' | 'admitted'>();
  constructor(private readonly store: Store, private readonly factory?: VerificationExecutorFactory, private readonly env: Readonly<Record<string, string | undefined>> = process.env) {}

  private enabled(): VerificationExecutorFactory {
    if (!hostFlagEnabled('verification.workflowV1', this.env)) throw new HarnessError('CAPABILITY_DENIED', 'Verification workflow is disabled on this host.');
    if (!this.factory) throw new HarnessError('VERIFICATION_BACKEND_UNAVAILABLE', 'This host has no approved verification executor.');
    return this.factory;
  }
  private current(owner: ToolOwner): Thread {
    const thread = this.store.get<Thread>('thread', owner.threadId);
    if (!thread || thread.kind === 'delegate' || thread.kind === 'side' || thread.sideParentId || thread.mode === 'plan' || this.store.get('archivedThread', owner.threadId) || digest(ownerFor(thread)) !== digest(owner))
      throw new HarnessError('APPROVAL_REQUIRED', 'The complete verification owner changed; prepare and review a new operation.');
    return thread;
  }
  private root(owner: ToolOwner): string {
    const thread = this.current(owner), physical = thread.workspaceId ? this.store.get<{path: string}>('workspaceBinding', thread.workspaceId) : thread.projectId ? this.store.get<{path: string}>('workspaceProjectRoot', thread.projectId) : null;
    if (!physical) throw new HarnessError('CAPABILITY_DENIED', 'Verification requires the current attested project working copy.');
    assertVerificationSourceRoot(this.store, owner.threadId, physical.path); return physical.path;
  }
  private origins(intent: Pick<VerificationIntent, 'readiness' | 'checklist'>): string[] {
    return [...new Set([...(intent.checklist?.approvedOrigins ?? []), ...(intent.readiness ? [`http://${intent.readiness.host}:${intent.readiness.port}`] : [])])].sort();
  }
  private async describe(intent: Pick<VerificationIntent, 'owner' | 'recipe' | 'binding' | 'readiness' | 'checklist'>, signal: AbortSignal, assertCurrent: () => void) {
    return this.enabled().describe({owner: intent.owner, rootPath: intent.recipe.workspaceIdentity.canonicalPath, profileId: intent.binding.profile.profileId,
      executableIds: [...new Set(intent.recipe.phases.filter(phase => nativePhases.has(phase.name)).map(phase => phase.executableId))], approvedOrigins: this.origins(intent), browserRequired: Boolean(intent.checklist), signal, assertCurrent});
  }
  private async cut(root: string, sourceFiles: string[], dependencyFiles: string[]) {
    return {codeDigest: await sourceDigest(root, sourceFiles), dependencyDigest: await sourceDigest(root, dependencyFiles)};
  }
  private prior(owner: ToolOwner, recipeId: string): VerificationRecipeV1 | null {
    const any = this.store.get<VerificationRecipeV1>('verificationRecipe', recipeId);
    const owned = this.store.all<VerificationRecipeV1>('verificationRecipe', owner.threadId).find(value => value.recipeId === recipeId) ?? null;
    if (any && !owned) throw new HarnessError('CAPABILITY_DENIED', 'That recipe belongs to another thread.');
    return owned;
  }

  rerunInput(owner: ToolOwner, raw: unknown): VerificationPrepareInput {
    const {executionId} = verificationRerunSchema.parse(raw); this.enabled();
    const thread = this.current(owner), current = this.store.get<ManagedVerificationRecord>('verificationManaged', owner.threadId);
    if (!current || current.intent.executionId !== executionId) throw new HarnessError('STALE_REVISION', 'Select the current verification execution before preparing a rerun.');
    const intent = verificationIntentSchema.parse(current.intent);
    if (!observationMatchesThreadOwner({owner: intent.owner}, thread)) throw new HarnessError('APPROVAL_REQUIRED', 'The retained recipe belongs to a different project, working copy or account.');
    if (!['succeeded', 'failed', 'cancelled'].includes(current.status)) throw new HarnessError('VERIFICATION_BUSY', 'The previous verification must settle before a new run can be prepared.');
    const recipe = this.prior(owner, intent.recipe.recipeId);
    if (!recipe || digest(recipe) !== digest(intent.recipe)) throw drift('The retained recipe no longer matches the current approved recipe.');
    return verificationPrepareSchema.parse({recipeId: recipe.recipeId, baseRevision: recipe.revision, profileId: intent.binding.profile.profileId,
      phases: recipe.phases, sourceFiles: intent.sourceFiles, dependencyFiles: intent.dependencyFiles, requirements: intent.requirements,
      ...(intent.readiness ? {readiness: intent.readiness} : {}), ...(intent.checklist ? {checklist: intent.checklist} : {}),
      ...(intent.qa ? {qa: {prompt: intent.qa.admission.prompt, budget: intent.qa.admission.budget}} : {})});
  }

  async prepare(owner: ToolOwner, raw: unknown, signal: AbortSignal, assertCurrent: () => void): Promise<{intent: VerificationIntent}> {
    const encoded = JSON.stringify(raw);
    if (encoded === undefined || Buffer.byteLength(encoded) > 128 * 1024) throw new HarnessError('RESOURCE_LIMIT', 'Verification proposal exceeds the review bound.');
    const input = verificationPrepareSchema.parse(raw), factory = this.enabled(), root = this.root(owner), thread = this.current(owner);
    if (input.qa && (!owner.runId || !thread.modelId)) throw new HarnessError('QA_UNAVAILABLE', 'QA requires an active parent run and its selected model.');
    const fence = () => {if (signal.aborted) throw new HarnessError('CANCELLED_RUN', 'Verification preparation was cancelled'); this.current(owner); assertVerificationSourceRoot(this.store, owner.threadId, root); assertCurrent();};
    fence();
    const recipeId = input.recipeId ?? `recipe-${randomUUID()}`, prior = this.prior(owner, recipeId);
    if ((input.baseRevision ?? 0) !== (prior?.revision ?? 0)) throw new HarnessError('STALE_REVISION', 'Review the current recipe revision before preparing a change.');
    const binding = await factory.describe({owner, rootPath: root, profileId: input.profileId, executableIds: [...new Set(input.phases.filter(phase => nativePhases.has(phase.name)).map(phase => phase.executableId))], approvedOrigins: this.origins({readiness: input.readiness ?? null, checklist: input.checklist ?? null}), browserRequired: Boolean(input.checklist), signal, assertCurrent: fence});
    fence();
    for (const phase of input.phases) if (nativePhases.has(phase.name)) {
      const executable = binding.executables.find(value => value.id === phase.executableId);
      if (!executable || !binding.profile.executableAllowlist.some(value => value.executableSha256 === executable.sha256 && digest(value.argv) === digest(phase.argv)) || phase.environmentRefs.some(ref => !binding.profile.secretRefs.includes(ref)))
        throw new HarnessError('CAPABILITY_DENIED', 'The exact phase arguments or secret references are outside the host profile.');
    }
    const sourceCut = await this.cut(root, input.sourceFiles, input.dependencyFiles); fence();
    factory.assertCurrent(binding, {owner, signal, assertCurrent: fence});
    const candidate: VerificationRecipeV1 = {version: 1, recipeId, workspaceIdentity: binding.rootIdentity, approvedDigest: '0'.repeat(64), phases: input.phases, environment: {platform: process.platform, nodeVersion: process.version, packageManager: null}, createdAt: prior?.createdAt ?? new Date().toISOString(), revision: (prior?.revision ?? 0) + 1};
    candidate.approvedDigest = recipeDigest(candidate);
    if (prior && recipeDigest(prior) === candidate.approvedDigest && digest(prior.workspaceIdentity) === digest(candidate.workspaceIdentity)) candidate.revision = prior.revision;
    const intent = verificationIntentSchema.parse({version: 1, owner, executionId: `execution-${randomUUID()}`, baseRecipeRevision: prior?.revision ?? 0,
      priorDeclarationDigest: digest(this.store.get('verificationDeclaration', owner.threadId)), recipe: candidate, binding, sourceFiles: input.sourceFiles, dependencyFiles: input.dependencyFiles, sourceCut,
      readiness: input.readiness ?? null, checklist: input.checklist ?? null, requirements: input.requirements,
      ...(input.qa ? {qa: {admission: {commandId: `qa-admit-${randomUUID()}`, workId: `qa-${randomUUID()}`, role: 'QA', childThreadId: `qa-child-${randomUUID()}`,
        prompt: input.qa.prompt, expectedOutputSchema: z.toJSONSchema(QaResultV1Schema, {target: 'draft-7'}), grantSubset: [], budget: input.qa.budget},
        model: {modelId: thread.modelId, accountId: owner.accountBinding, thinkingLevel: thread.thinkingLevel ?? null}}} : {})});
    if (Buffer.byteLength(JSON.stringify(intent)) > 256 * 1024) throw new HarnessError('RESOURCE_LIMIT', 'Verification intent exceeds the review bound.');
    return {intent};
  }

  assertApproval(operation: Operation): VerificationIntent {
    this.enabled();
    const {intent} = verificationOperationArgumentsSchema.parse(operation.args);
    const thread = this.current(intent.owner);
    if (intent.qa && digest(intent.qa.model) !== digest({modelId: thread.modelId, accountId: thread.accountId ?? null, thinkingLevel: thread.thinkingLevel ?? null})) throw new HarnessError('APPROVAL_REQUIRED', 'The QA model selection changed after preparation.');
    if (operation.threadId !== intent.owner.threadId || !isVerificationOperation(operation) || intent.recipe.approvedDigest !== recipeDigest(intent.recipe)) throw new HarnessError('APPROVAL_REQUIRED', 'The prepared verification intent changed.');
    return intent;
  }
  private assertUnchanged(operation: Operation, intent: VerificationIntent): void {
    const current = this.store.get<Operation>('operation', operation.id);
    if (!current || current.revision !== operation.revision || current.status !== 'prepared' || !current.approved || digest(current.args) !== digest(operation.args)) throw new HarnessError('APPROVAL_REQUIRED', 'The prepared verification operation changed.');
    this.assertApproval(current);
    const prior = this.prior(intent.owner, intent.recipe.recipeId);
    if ((prior?.revision ?? 0) !== intent.baseRecipeRevision || digest(this.store.get('verificationDeclaration', intent.owner.threadId)) !== intent.priorDeclarationDigest) throw drift('The recipe or declared requirements changed after preparation.');
    assertVerificationSourceRoot(this.store, intent.owner.threadId, intent.recipe.workspaceIdentity.canonicalPath);
  }
  async preflight(operation: Operation, signal: AbortSignal, assertCurrent: () => void): Promise<PreparedExecution> {
    const intent = this.assertApproval(operation), fence = () => {this.assertUnchanged(operation, intent); assertCurrent();};
    fence();
    const binding = await this.describe(intent, signal, fence), cut = await this.cut(intent.recipe.workspaceIdentity.canonicalPath, intent.sourceFiles, intent.dependencyFiles); fence();
    if (digest(binding) !== digest(intent.binding) || digest(cut) !== digest(intent.sourceCut)) throw drift('BLOCKED_SOURCE_DRIFT: source, configuration or execution environment changed after preparation.');
    const assertBasis = () => this.enabled().assertCurrent(binding, {owner: intent.owner, signal, assertCurrent: fence});
    assertBasis();
    const prepared = {operationId: operation.id, intent, binding, assertBasis}; this.prepared.set(prepared, 'prepared'); return prepared;
  }
  /** Called only inside the M02 DISPATCHED transaction, after approval consumption. */
  admit(operation: Operation, prepared: PreparedExecution): void {
    if (prepared.operationId !== operation.id || this.prepared.get(prepared) !== 'prepared') throw new HarnessError('CAPABILITY_DENIED', 'Verification admission has no host custody.');
    this.assertUnchanged(operation, prepared.intent); prepared.assertBasis();
    const intent = prepared.intent, effect = this.store.get<ToolEffectRecord>('toolEffect', `operation:${operation.id}@${operation.revision}`);
    const approval = effect?.approvalId ? this.store.get<ApprovalV1>('approval', effect.approvalId) : null;
    if (!effect || effect.state !== 'DISPATCHED' || effect.toolId !== 'operation:verification.run' || effect.definitionDigest !== digest({kind: operation.kind, args: operation.args}) || digest(effect.owner) !== digest(intent.owner) || !approval || approval.remainingUses !== 0 || digest(approval.owner) !== digest(intent.owner) || approval.actionCommitment !== actionCommitment(operation, this.current(intent.owner)))
      throw new HarnessError('APPROVAL_REQUIRED', 'Recipe registration requires the exact durable M02 dispatch and consumed approval.');
    this.prepared.set(prepared, 'admitted');
    this.store.put('verificationRecipe', intent.recipe.recipeId, intent.owner.threadId, intent.recipe);
    this.store.put('verificationDeclaration', intent.owner.threadId, intent.owner.threadId, this.declaration(intent, []));
    const record: ManagedVerificationRecord = {operationId: operation.id, intent, status: 'running'};
    this.store.put('verificationManaged', intent.owner.threadId, intent.owner.threadId, record);
    this.store.put('verificationExecution', intent.executionId, intent.owner.threadId, record);
  }
  private declaration(intent: VerificationIntent, observations: (CheckObservationV1 | VisualObservationV1)[]): VerificationDeclarationV1 {
    return {version: 1, rootPath: intent.recipe.workspaceIdentity.canonicalPath, sourceFiles: intent.sourceFiles, dependencyFiles: intent.dependencyFiles, environmentId: intent.binding.environmentId,
      requirements: intent.requirements.map(requirement => ({id: requirement.id, checkRefs: [intent.executionId, ...requirement.checks.map(check => observations.find(observation => {
        if ('phase' in check) return observation.phase === check.phase && ['process', 'readiness'].includes(observation.observationKind);
        return 'checklistItemId' in observation && observation.checklistItemId === check.checklistItemId && observation.observationKind === 'browser';
      })?.checkId ?? `expected:${intent.executionId}:${digest(check).slice(0, 16)}`)]}))};
  }
  async run(prepared: PreparedExecution, signal: AbortSignal, assertCurrent: () => void): Promise<RecipeExecutionResult> {
    if (this.prepared.get(prepared) !== 'admitted') throw new HarnessError('CAPABILITY_DENIED', 'Verification execution was not durably admitted.');
    const intent = prepared.intent, factory = this.enabled();
    const fence = () => {this.current(intent.owner); assertVerificationSourceRoot(this.store, intent.owner.threadId, intent.recipe.workspaceIdentity.canonicalPath); assertCurrent();};
    const session = await factory.open({owner: intent.owner, executionId: intent.executionId, binding: prepared.binding, signal, assertCurrent: fence});
    let cleanupInvoked = false;
    try {
      if (intent.checklist && (!session.browser || !session.browserProfileDir)) throw new HarnessError('CAPABILITY_DENIED', 'The approved backend did not provide an owned browser capability.');
      return await new ProjectVerificationService(this.store, this.env).runRecipe(intent.owner, {executionId: intent.executionId, recipeId: intent.recipe.recipeId, sourceFiles: intent.sourceFiles, dependencyFiles: intent.dependencyFiles, ...(intent.readiness ? {readiness: intent.readiness} : {})}, session.launcher, session.probe,
        {signal, assertCurrent: fence, environmentId: intent.binding.environmentId, expectedSource: intent.sourceCut,
          ...(intent.checklist ? {browser: {checklist: intent.checklist, driver: session.browser!, profileDir: session.browserProfileDir!}} : {}),
          cleanup: async () => {cleanupInvoked = true; await session.close();}});
    } finally {if (!cleanupInvoked) await session.close();}
  }
  /** Fresh host-only seal for a synchronous completion/read-model cut. This
   * never opens an executor, consumes approval or resolves a secret. */
  async readBasis(threadId: string, signal: AbortSignal, assertHost: () => void): Promise<VerificationReadBasis | null> {
    const saved = this.store.get<ManagedVerificationRecord>('verificationManaged', threadId);
    if (!saved) return null;
    try {
      const factory = this.enabled(), intent = verificationIntentSchema.parse(saved.intent), thread = this.store.get<Thread>('thread', threadId);
      if (!observationMatchesThreadOwner({owner: intent.owner}, thread)) return null;
      const owner = ownerFor(thread!), managedDigest = digest(saved), declarationDigest = digest(this.store.get('verificationDeclaration', threadId));
      const assertCurrent = () => {
        if (signal.aborted) throw new HarnessError('CANCELLED_RUN', 'Verification read was cancelled.');
        assertHost(); this.current(owner); assertVerificationSourceRoot(this.store, threadId, intent.recipe.workspaceIdentity.canonicalPath);
        if (digest(this.store.get('verificationManaged', threadId)) !== managedDigest || digest(this.store.get('verificationDeclaration', threadId)) !== declarationDigest || digest(this.prior(owner, intent.recipe.recipeId)) !== digest(intent.recipe)) throw drift('The current approved recipe changed.');
        const operation = this.store.get<Operation>('operation', saved.operationId), effect = this.store.get<ToolEffectRecord>('toolEffect', `operation:${saved.operationId}@${operation?.revision}`);
        const approval = effect?.approvalId ? this.store.get<ApprovalV1>('approval', effect.approvalId) : null;
        if (!operation || !['succeeded', 'failed', 'cancelled'].includes(operation.status) || operation.status !== saved.status || digest(operation.args) !== digest({intent}) || !operation.approved || !effect || !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(effect.state) || digest(effect.owner) !== digest(intent.owner) || !approval || approval.remainingUses !== 0 || digest(approval.owner) !== digest(intent.owner) || approval.actionCommitment !== actionCommitment(operation, {...thread!, epoch: intent.owner.epoch, runId: intent.owner.runId})) throw drift('The approved execution has no settled authority receipt.');
        const observed = [...this.store.all<CheckObservationV1>('checkObservation', threadId), ...this.store.all<VisualObservationV1>('visualObservation', threadId)].filter(value => value.executionId === intent.executionId && digest(value.owner) === digest(intent.owner));
        if (digest(this.declaration(intent, observed)) !== declarationDigest) throw drift('The approved requirement bindings changed.');
      };
      assertCurrent();
      const binding = await this.describe({...intent, owner}, signal, assertCurrent);
      if (digest(binding) !== digest(intent.binding)) throw drift('The approved execution environment changed.');
      const basis = Object.freeze({environmentId: binding.environmentId, recipeDigest: intent.recipe.approvedDigest});
      readSeals.set(basis, {store: this.store, threadId, assertCurrent: () => factory.assertCurrent(binding, {owner, signal, assertCurrent})});
      assertVerificationReadBasis(this.store, threadId, basis); return basis;
    } catch {return null;}
  }
  recordFailure(operation: Operation): void {
    const current = this.store.get<ManagedVerificationRecord>('verificationManaged', operation.threadId);
    if (!current || current.operationId !== operation.id) return;
    const record: ManagedVerificationRecord = {...current, status: operation.status, outcome: 'BLOCKED'};
    this.store.put('verificationManaged', operation.threadId, operation.threadId, record);
    this.store.put('verificationExecution', record.intent.executionId, operation.threadId, record);
  }
  /** Synchronous companion of the ordinary operation terminal receipt. */
  recordResult(operation: Operation, prepared: PreparedExecution, result: RecipeExecutionResult): void {
    const intent = prepared.intent, record: ManagedVerificationRecord = {operationId: operation.id, intent, status: operation.status, outcome: result.outcome, cleanupFailures: result.cleanupFailures};
    this.store.put('verificationExecution', intent.executionId, intent.owner.threadId, record);
    if (this.store.get<ManagedVerificationRecord>('verificationManaged', intent.owner.threadId)?.intent.executionId === intent.executionId) {
      this.store.put('verificationManaged', intent.owner.threadId, intent.owner.threadId, record);
      this.store.put('verificationDeclaration', intent.owner.threadId, intent.owner.threadId, this.declaration(intent, result.observations));
    }
  }
}
