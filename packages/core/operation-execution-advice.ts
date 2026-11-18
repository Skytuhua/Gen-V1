import { z } from 'zod';
import { HarnessError, type Operation, type Thread } from '../contracts/index.ts';
import { toolOwnerSchema } from '../contracts/tool-effects.ts';
import { operationExecutionTargetSchema, operationExecutionReviewSchema, recordedOperationAdvisorySchema,
  type OperationExecutionTarget, type OperationExecutionReview } from '../contracts/operation-execution-review.ts';
import { parseRepositoryTestOperation } from '../capabilities/repository-test-binding.ts';
import { context7OperationArgsSchema } from '../integrations/context7-execution.ts';
import { Store, digest } from '../storage/store.ts';
import { advisoryRiskAssessment, selectBackend, type LaunchRequest } from './execution-policy.ts';

const kindSchema = z.enum(['repository.test', 'integration.context7']);
const threadStateSchema = z.strictObject({ status: z.string().min(1).max(64), mode: z.enum(['plan', 'build']),
  modelId: z.string().max(200).nullable(), kind: z.enum(['main', 'side', 'delegate']), sideParentId: z.string().max(200).nullable() });
const trustStateSchema = z.strictObject({ revision: z.number().int().nonnegative(), revoked: z.boolean() });
const basis = z.strictObject({ version: z.literal(1), target: operationExecutionTargetSchema, operationKind: kindSchema });
const storedSchema = z.discriminatedUnion('available', [basis.extend({ available: z.literal(true),
  owner: toolOwnerSchema, threadState: threadStateSchema, trustState: trustStateSchema,
  sourceCommitment: z.string().min(1).max(500), recorded: recordedOperationAdvisorySchema,
}), basis.extend({ available: z.literal(false), reason: z.literal('COMPUTATION_FAILED') })]);
const ownerOf = (thread: Thread) => ({ threadId: thread.id, runId: thread.runId, epoch: thread.epoch,
  accountBinding: thread.accountId ?? null, projectId: thread.projectId ?? null, workspaceId: thread.workspaceId ?? null });
const stateOf = (thread: Thread) => ({ status: thread.status, mode: thread.mode ?? 'build', modelId: thread.modelId,
  kind: thread.kind ?? 'main', sideParentId: thread.sideParentId ?? null });
const targetOf = (operation: Operation) => ({ threadId: operation.threadId, operationId: operation.id, operationRevision: operation.revision });
const keyOf = (target: OperationExecutionTarget) => JSON.stringify([target.operationId, target.operationRevision]);

/** Records explanations, never authority. Reads preserve historical provenance
 * and do not hash live files, resolve secrets, approve or launch an operation. */
export class OperationExecutionAdviceHost {
  constructor(private readonly store: Store, private readonly options: {
    assertHostActive(): void; sourceCommitment(operation: Operation): string;
  }) {}
  private trustState(operation: Operation) {
    const publication = this.store.get<{ trustId: string; trustRevision: number }>('operationProjectTrust', operation.id);
    const envelope = publication && this.store.get<{ revokedAt?: string }>('projectTrust', publication.trustId);
    return { revision: publication?.trustRevision ?? 0, revoked: Boolean(envelope?.revokedAt) };
  }
  /** Called only within the existing operation.prepared Store transaction. */
  recordPrepared(operation: Operation, thread: Thread): void {
    if (!kindSchema.safeParse(operation.kind).success) return;
    const base = { version: 1 as const, target: targetOf(operation), operationKind: operation.kind };
    // Preparation provenance is write-once, including an unavailable result.
    if (this.store.get('operationExecutionAdvice', keyOf(base.target))) return;
    let stored: z.infer<typeof storedSchema>;
    try {
      if (operation.status !== 'prepared' || operation.approved) throw Error('Advice requires an unapproved preparation');
      const binding = operation.kind === 'repository.test' ? parseRepositoryTestOperation(operation.args).executionBinding
        : context7OperationArgsSchema.parse(operation.args).binding;
      if (!binding) throw Error('No exact launch binding');
      const request: LaunchRequest = { kind: 'executable', executable: binding.executable.path, argv: binding.argv, cwd: binding.cwd.path };
      // This operation has not been approved. No approved argument vector is
      // inferred from preparation or from an advisory classifier.
      const advisory = advisoryRiskAssessment(request, { executableAllowlist: [] });
      stored = storedSchema.parse({ ...base, available: true, owner: ownerOf(thread), threadState: stateOf(thread),
        trustState: this.trustState(operation), sourceCommitment: this.options.sourceCommitment(operation),
        recorded: { recordedAt: operation.createdAt, decisionAtPreparation: 'REQUIRE_APPROVAL', advisory } });
    } catch {
      stored = storedSchema.parse({ ...base, available: false, reason: 'COMPUTATION_FAILED' });
    }
    this.store.put('operationExecutionAdvice', keyOf(base.target), operation.threadId, stored);
  }
  read(input: OperationExecutionTarget): OperationExecutionReview {
    this.options.assertHostActive();
    const target = operationExecutionTargetSchema.parse(input), operation = this.store.get<Operation>('operation', target.operationId);
    const thread = this.store.get<Thread>('thread', target.threadId);
    if (!operation || !thread || operation.threadId !== thread.id) throw new HarnessError('NOT_FOUND', 'Operation execution metadata is unavailable');
    if (operation.revision !== target.operationRevision) throw new HarnessError('PRECONDITION_FAILED', 'The operation revision changed');
    if (!kindSchema.safeParse(operation.kind).success) throw new HarnessError('UNSUPPORTED_OPERATION', 'This operation has no host process execution metadata');
    const owner = ownerOf(thread), archived = Boolean(this.store.get('archivedThread', thread.id));
    const raw = this.store.get('operationExecutionAdvice', keyOf(target)), parsed = storedSchema.safeParse(raw);
    let advice: OperationExecutionReview['advice'];
    if (!raw) advice = { state: 'UNAVAILABLE', reason: 'NOT_RECORDED' };
    else if (!parsed.success || digest(parsed.data.target) !== digest(target) || parsed.data.operationKind !== operation.kind)
      advice = { state: 'UNAVAILABLE', reason: 'INVALID_RECORD' };
    else if (!parsed.data.available) advice = { state: 'UNAVAILABLE', reason: parsed.data.reason };
    else {
      const stored = parsed.data;
      let reason: Extract<OperationExecutionReview['advice'], { state: 'STALE' }>['reason'] | undefined;
      if (digest(stored.owner) !== digest(owner)) reason = 'OWNER_CHANGED';
      else if (archived || operation.status !== 'prepared' || operation.approved || digest(stored.threadState) !== digest(stateOf(thread))) reason = 'STATE_CHANGED';
      else if (digest(stored.trustState) !== digest(this.trustState(operation))) reason = 'TRUST_CHANGED';
      else {
        try { if (stored.sourceCommitment !== this.options.sourceCommitment(operation)) reason = 'ACTION_CHANGED'; }
        catch { reason = 'SOURCE_UNAVAILABLE'; }
      }
      advice = reason ? { state: 'STALE', reason, validation: 'NOT_REVALIDATED', recorded: stored.recorded }
        : { state: 'RECORDED', validation: 'NOT_REVALIDATED', recorded: stored.recorded };
    }
    // Neither concrete host runner accepts an isolation backend/proof. Report
    // the existing selector's missing-backend result without selecting one.
    const isolation = selectBackend(undefined, []);
    if (isolation.status !== 'UNSUPPORTED_BACKEND') throw new HarnessError('INVALID_EXECUTION_STATUS', 'Host execution metadata is unavailable');
    return operationExecutionReviewSchema.parse({ ...target, version: 1,
      current: { owner, operationStatus: operation.status, approved: operation.approved, threadStatus: thread.status,
        threadMode: thread.mode ?? 'build', archived, authority: 'NOT_EVALUATED' },
      execution: { mode: 'TRUSTED_HOST', backendId: 'TRUSTED_HOST', runner: operation.kind === 'repository.test' ? 'repository-test' : 'context7-stdio',
        policy: { filesystem: 'unrestricted', network: 'unrestricted', processes: 'unrestricted' },
        isolated: { status: 'BLOCKED', stage: 'ISOLATED_EXECUTION', code: isolation.status, reason: isolation.reason, approvedBackendId: null, platformProofRef: null } },
      advice,
    });
  }
}
