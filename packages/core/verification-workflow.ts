import {randomUUID} from 'node:crypto';
import {HarnessError, type Operation, type Thread} from '../contracts/index.ts';
import type {ToolOwner} from '../contracts/tool-effects.ts';
import type {VerificationRecipeV1} from '../contracts/verification.ts';
import {verificationIntentSchema, verificationOperationArgumentsSchema, verificationPrepareSchema, type VerificationIntent} from '../contracts/verification-workflow.ts';
import {digest, type Store} from '../storage/store.ts';
import {assertVerificationSourceRoot, recipeDigest, sourceDigest} from './project-verification.ts';
import type {VerificationExecutorFactory} from './verification-executor.ts';
import {hostFlagEnabled} from './host-flags.ts';
import {ownerFor} from './tool-effects.ts';

const nativePhases = new Set(['BOOTSTRAP', 'BUILD', 'TEST', 'START']);
export const isVerificationOperation = (operation: Pick<Operation, 'kind'>): boolean => operation.kind === 'verification.run';
/** Connects ordinary M02 operation approval to the admitted M03 executor.
 * All executable capabilities and seals remain private host objects. */
export class VerificationWorkflow {
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
  private async cut(root: string, sourceFiles: string[], dependencyFiles: string[]) {
    return {codeDigest: await sourceDigest(root, sourceFiles), dependencyDigest: await sourceDigest(root, dependencyFiles)};
  }
  private prior(owner: ToolOwner, recipeId: string): VerificationRecipeV1 | null {
    const any = this.store.get<VerificationRecipeV1>('verificationRecipe', recipeId);
    const owned = this.store.all<VerificationRecipeV1>('verificationRecipe', owner.threadId).find(value => value.recipeId === recipeId) ?? null;
    if (any && !owned) throw new HarnessError('CAPABILITY_DENIED', 'That recipe belongs to another thread.');
    return owned;
  }

  async prepare(owner: ToolOwner, raw: unknown, signal: AbortSignal, assertCurrent: () => void): Promise<{intent: VerificationIntent}> {
    const encoded = JSON.stringify(raw);
    if (encoded === undefined || Buffer.byteLength(encoded) > 128 * 1024) throw new HarnessError('RESOURCE_LIMIT', 'Verification proposal exceeds the review bound.');
    const input = verificationPrepareSchema.parse(raw), factory = this.enabled(), root = this.root(owner);
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
      readiness: input.readiness ?? null, checklist: input.checklist ?? null, requirements: input.requirements});
    if (Buffer.byteLength(JSON.stringify(intent)) > 256 * 1024) throw new HarnessError('RESOURCE_LIMIT', 'Verification intent exceeds the review bound.');
    return {intent};
  }

  assertApproval(operation: Operation): VerificationIntent {
    this.enabled();
    const {intent} = verificationOperationArgumentsSchema.parse(operation.args);
    this.current(intent.owner);
    if (operation.threadId !== intent.owner.threadId || !isVerificationOperation(operation) || intent.recipe.approvedDigest !== recipeDigest(intent.recipe)) throw new HarnessError('APPROVAL_REQUIRED', 'The prepared verification intent changed.');
    return intent;
  }
}
