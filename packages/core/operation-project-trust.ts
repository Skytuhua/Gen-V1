import { randomUUID } from 'node:crypto';
import { relative, sep } from 'node:path';
import { HarnessError, type Operation, type ResourceGrant, type Thread } from '../contracts/index.ts';
import type { ToolOwner } from '../contracts/tool-effects.ts';
import {
  operationProjectTrustTargetSchema, operationProjectTrustDecisionSchema, operationProjectTrustRevokeSchema,
  type OperationProjectTrustTarget, type OperationProjectTrustDecision, type OperationProjectTrustRevoke,
  type OperationProjectTrustReview, type OperationProjectTrustReceipt, type OperationProjectTrustState, type OperationProjectTrustStatus,
} from '../contracts/operation-project-trust.ts';
import { parseRepositoryTestOperation, requireRepositoryTestBinding, requireRepositoryTestBindingV2, withRepositoryTestBinding, withRepositoryTestBindingV2 , type AnyRepositoryTestBinding } from '../capabilities/repository-test-binding.ts';
import { Store, digest } from '../storage/store.ts';
import { ProjectTrustLedger } from './project-trust.ts';
import { withResourceGrant } from './file-access.ts';
import { resolveGrant } from './security.ts';

const SCOPE = Object.freeze({ read: true, write: true, network: 'none' as const });
const REVIEW_TTL_MS = 5 * 60_000, MAX_REVIEWS = 128;
const stale = () => new HarnessError('PROJECT_TRUST_REVIEW_STALE', 'The operation or its owner changed; review its current bytes again');
const ownerOf = (thread: Thread): ToolOwner => ({ threadId: thread.id, runId: thread.runId, epoch: thread.epoch,
  accountBinding: thread.accountId ?? null, projectId: thread.projectId ?? null, workspaceId: thread.workspaceId ?? null });
const operationCommitment = (op: Operation) => digest({ id: op.id, threadId: op.threadId, revision: op.revision,
  kind: op.kind, args: op.args, resourceIds: op.resourceIds, preconditions: op.preconditions });
const trustIdFor = (op: Operation) => 'operation-trust-' + digest([op.threadId, op.id]);
const approvedFile = (binding: AnyRepositoryTestBinding) => ({ path: relative(binding.cwd.path, binding.test.path).split(sep).join('/'),
  kind: 'configuration' as const, sha256: binding.test.sha256 });
interface Publication {
  version: 1; owner: ToolOwner; operationCommitment: string; trustId: string; trustRevision: number;
  executionMode: 'TRUSTED_HOST' | null;
}
interface Basis {
  operation: Operation; grant: ResourceGrant; owner: ToolOwner; key: string;
  binding: AnyRepositoryTestBinding; testFile: string;
  recipe: 'node-test' | 'vitest'; testName?: string;
}
interface Review { target: OperationProjectTrustTarget; basis: Basis; trustRevision: number; expiresAt: number }

/** Native user review of one already prepared operation, not an arbitrary-path
 * trust setter. This class does not approve or launch an operation. */
export class OperationProjectTrustHost {
  private readonly ledger: ProjectTrustLedger;
  private readonly reviews = new Map<string, Review>();
  private readonly deciding = new Set<string>();
  private readonly stop = new AbortController();
  constructor(private readonly store: Store, private readonly options: { enabled: boolean; assertHostActive(): void }) {
    this.ledger = new ProjectTrustLedger(store);
  }
  private active() {
    this.options.assertHostActive();
    if (this.stop.signal.aborted) throw new HarnessError('HOST_CLOSING', 'The project trust host has closed');
  }
  /** Called by the host in the same transaction that publishes preparation.
   * Disabling the capability later cannot downgrade this operation to legacy. */
  markPrepared(operation: Operation): void {
    if (this.options.enabled && operation.kind === 'repository.test') this.store.put('operationProjectTrustRequirement', operation.id, operation.threadId,
      { version: 1, operationId: operation.id, operationRevision: operation.revision, operationCommitment: operationCommitment(operation) });
  }
  private required(operation: Operation): boolean {
    return !!(this.store.get('operationProjectTrustRequirement', operation.id) || this.store.get('operationProjectTrust', operation.id)
      || this.ledger.get(trustIdFor(operation)));
  }
  private operation(target: OperationProjectTrustTarget, running = false, allowApproved = false) {
    this.active();
    const operation = this.store.get<Operation>('operation', target.operationId), thread = this.store.get<Thread>('thread', target.threadId);
    if (!operation || !thread || thread.id !== target.threadId || operation.threadId !== target.threadId || this.store.get('archivedThread', thread.id)) throw new HarnessError('NOT_FOUND', 'Prepared operation is unavailable');
    if (operation.kind !== 'repository.test') throw new HarnessError('PROJECT_TRUST_UNSUPPORTED', 'This trust review supports prepared repository tests only');
    if (operation.revision !== target.operationRevision || operation.status !== (running ? 'running' : 'prepared') || !running && !allowApproved && operation.approved) throw stale();
    if (thread.mode === 'plan' || thread.kind === 'delegate' || thread.sideParentId || ['stopped', 'interrupted', 'failed'].includes(thread.status)) throw stale();
    return { operation, thread };
  }
  private basis(target: OperationProjectTrustTarget, running = false, allowApproved = false): Basis {
    const { operation, thread } = this.operation(target, running, allowApproved), args = parseRepositoryTestOperation(operation.args);
    if (!args.executionBinding) throw new HarnessError('PRECONDITION_FAILED', 'Prepare a new repository test with an exact launch binding');
    const grant = this.store.get<ResourceGrant>('resource', args.resourceId);
    if (!grant || grant.threadId !== thread.id || !grant.writable || operation.resourceIds.length !== 1 || operation.resourceIds[0] !== grant.id) throw new HarnessError('CAPABILITY_DENIED', 'The operation requires its current writable project grant');
    const owner = ownerOf(thread), key = digest({ owner, status: thread.status, grant, operation: operationCommitment(operation) });
    return { operation, grant, owner, key, binding: args.executionBinding, testFile: args.testFile, recipe: args.recipe ?? 'node-test', testName: 'testName' in args ? args.testName : undefined };
  }
  private assertBasis(target: OperationProjectTrustTarget, basis: Basis) {
    if (this.basis(target).key !== basis.key) throw stale();
  }
  private async withBinding<T>(target: OperationProjectTrustTarget, basis: Basis,
    action: (binding: AnyRepositoryTestBinding) => Promise<T>): Promise<T> {
    return withResourceGrant(basis.grant, this.store.dataDir, undefined, false, this.stop.signal, async cwd => {
      const test = await resolveGrant(basis.grant, basis.testFile, false, this.store.dataDir);
      if (basis.binding.version === 2) return withRepositoryTestBindingV2(cwd, test, basis.testFile, basis.recipe, basis.testName, this.stop.signal, async binding => {
        this.assertBasis(target, basis);
        requireRepositoryTestBindingV2(basis.binding.version === 2 ? basis.binding : undefined, binding, basis.operation.preconditions.testSha256);
        return action(binding);
      });
      return withRepositoryTestBinding(cwd, test, basis.testFile, this.stop.signal, async binding => {
        this.assertBasis(target, basis);
        requireRepositoryTestBinding(basis.binding.version === 1 ? basis.binding : undefined, binding, basis.operation.preconditions.testSha256);
        return action(binding);
      });
    });
  }
  private state(basis: Basis): OperationProjectTrustState {
    const trustId = trustIdFor(basis.operation), envelope = this.ledger.get(trustId);
    if (!envelope) return { trustId, revision: 0, decision: 'required' };
    if (envelope.revokedAt) return { trustId, revision: envelope.record.revision, decision: 'revoked' };
    const publication = this.store.get<Publication>('operationProjectTrust', basis.operation.id);
    const record = envelope.record;
    const matches = publication?.version === 1 && publication.trustId === trustId && publication.trustRevision === record.revision
      && publication.operationCommitment === operationCommitment(basis.operation) && digest(publication.owner) === digest(basis.owner)
      && digest(record.root) === digest({ canonicalPath: basis.binding.cwd.path, identity: { dev: basis.binding.cwd.dev, ino: basis.binding.cwd.ino } })
      && digest(record.approvedDigests) === digest([approvedFile(basis.binding)]) && digest(record.scope) === digest(SCOPE)
      && (record.decision !== 'trusted' || publication.executionMode === 'TRUSTED_HOST');
    return { trustId, revision: record.revision, decision: matches ? record.decision : 'invalidated' };
  }
  /** Read recorded state for revocation without acquiring native custody,
   * issuing a review token or mutating trust. Launch still verifies bytes. */
  status(input: OperationProjectTrustTarget): OperationProjectTrustStatus {
    this.active();
    const target = operationProjectTrustTargetSchema.parse(input);
    const running = this.store.get<Operation>('operation', target.operationId)?.status === 'running';
    const { operation } = this.operation(target, running, true);
    if (!this.options.enabled) {
      if (this.required(operation)) throw new HarnessError('PROJECT_TRUST_DISABLED', 'This operation requires project trust; disabling it cannot authorize legacy execution');
      return { ...target, version: 1, enabled: false, reason: 'PROJECT_TRUST_DISABLED' };
    }
    const basis = this.basis(target, running, true);
    return structuredClone({ ...target, version: 1, enabled: true, owner: basis.owner, current: this.state(basis) });
  }
  async preview(input: OperationProjectTrustTarget): Promise<OperationProjectTrustReview> {
    const target = operationProjectTrustTargetSchema.parse(input);
    const { operation } = this.operation(target);
    if (!this.options.enabled) {
      if (this.required(operation)) throw new HarnessError('PROJECT_TRUST_DISABLED', 'This operation requires project trust; disabling it cannot authorize legacy execution');
      return { ...target, version: 1, enabled: false, reason: 'PROJECT_TRUST_DISABLED' };
    }
    // A legacy operation reviewed under an enabled policy also retains that
    // requirement across restart, without recording any trust decision.
    if (!this.required(operation)) this.store.internal('operation.projectTrust.required', target.threadId, () => this.markPrepared(operation));
    const basis = this.basis(target);
    return this.withBinding(target, basis, async binding => {
      const now = Date.now();
      for (const [id, review] of this.reviews) if (review.expiresAt <= now) this.reviews.delete(id);
      if (this.reviews.size >= MAX_REVIEWS) throw new HarnessError('PROJECT_TRUST_BUSY', 'Close or finish an existing trust review before opening another');
      const current = this.state(basis), reviewId = randomUUID(), expiresAt = now + REVIEW_TTL_MS;
      this.reviews.set(reviewId, { target, basis, trustRevision: current.revision, expiresAt });
      return structuredClone({ ...target, version: 1 as const, enabled: true as const, reviewId, expiresAt: new Date(expiresAt).toISOString(),
        owner: basis.owner, root: { canonicalPath: binding.cwd.path, identity: { dev: binding.cwd.dev, ino: binding.cwd.ino } },
        approvedDigests: [approvedFile(binding)], requestedScope: SCOPE,
        execution: { mode: 'TRUSTED_HOST' as const, label: 'Unrestricted host' as const,
          executable: { path: binding.executable.path, sha256: binding.executable.sha256 }, argv: binding.argv, cwd: binding.cwd.path,
          filesystem: 'unrestricted' as const, network: 'unrestricted' as const, processes: 'unrestricted' as const, platformProofRef: null }, current });
    });
  }
  private review(id: string, review: Review, target: OperationProjectTrustTarget, revision: number) {
    this.active();
    if (this.reviews.get(id) !== review || review.expiresAt <= Date.now() || digest(review.target) !== digest(target)
      || review.trustRevision !== revision || (this.ledger.get(trustIdFor(review.basis.operation))?.record.revision ?? 0) !== revision) throw stale();
    this.assertBasis(target, review.basis);
  }
  async decide(input: OperationProjectTrustDecision): Promise<OperationProjectTrustReceipt> {
    this.active();
    if (!this.options.enabled) throw new HarnessError('PROJECT_TRUST_DISABLED', 'Project trust decisions are disabled on this host');
    const parsed = operationProjectTrustDecisionSchema.parse(input);
    const target = { threadId: parsed.threadId, operationId: parsed.operationId, operationRevision: parsed.operationRevision };
    const review = this.reviews.get(parsed.reviewId);
    if (!review) throw stale();
    this.review(parsed.reviewId, review, target, parsed.expectedTrustRevision);
    if (this.deciding.has(target.operationId)) throw new HarnessError('PROJECT_TRUST_BUSY', 'A trust decision for this operation is already pending');
    this.deciding.add(target.operationId);
    try {
      return await this.withBinding(target, review.basis, async binding => {
        this.review(parsed.reviewId, review, target, parsed.expectedTrustRevision);
        const record = await this.ledger.decide({ trustId: trustIdFor(review.basis.operation), rootPath: binding.cwd.path,
          approvedFiles: [approvedFile(binding)], scope: SCOPE, decision: parsed.decision });
        // Ledger persistence alone is not admission. Publish its exact revision
        // only after every awaited read and the complete owner/status recheck.
        this.active(); this.assertBasis(target, review.basis);
        if (this.reviews.get(parsed.reviewId) !== review || review.expiresAt <= Date.now()) throw stale();
        if (digest(record.root) !== digest({ canonicalPath: binding.cwd.path, identity: { dev: binding.cwd.dev, ino: binding.cwd.ino } })
          || digest(record.approvedDigests) !== digest([approvedFile(binding)])) throw stale();
        const publication: Publication = { version: 1, owner: review.basis.owner, operationCommitment: operationCommitment(review.basis.operation),
          trustId: record.trustId, trustRevision: record.revision, executionMode: parsed.decision === 'trusted' ? 'TRUSTED_HOST' : null };
        this.store.internal('operation.projectTrust.decided', target.threadId, () => {
          this.assertBasis(target, review.basis);
          this.store.put('operationProjectTrust', target.operationId, target.threadId, publication);
        });
        return { ...target, version: 1, current: this.state(review.basis) };
      });
    } finally { this.reviews.delete(parsed.reviewId); this.deciding.delete(target.operationId); }
  }
  revoke(input: OperationProjectTrustRevoke): OperationProjectTrustReceipt {
    this.active();
    if (!this.options.enabled) throw new HarnessError('PROJECT_TRUST_DISABLED', 'Project trust decisions are disabled on this host');
    const parsed = operationProjectTrustRevokeSchema.parse(input), target = { threadId: parsed.threadId, operationId: parsed.operationId, operationRevision: parsed.operationRevision };
    const basis = this.basis(target, this.store.get<Operation>('operation', target.operationId)?.status === 'running', true), current = this.state(basis);
    for (const [id, review] of this.reviews) if (review.target.operationId === target.operationId) this.reviews.delete(id);
    if (parsed.trustId !== current.trustId || parsed.expectedTrustRevision !== current.revision) throw stale();
    this.ledger.revoke(current.trustId);
    return { ...target, version: 1, current: this.state(basis) };
  }
  assertApproval(operation: Operation, thread: Thread): void {
    if (operation.kind !== 'repository.test') return;
    if (!this.options.enabled && !this.required(operation)) return;
    if (!this.options.enabled) throw new HarnessError('PROJECT_TRUST_DISABLED', 'A reviewed operation cannot bypass disabled project trust');
    const basis = this.basis({ threadId: operation.threadId, operationId: operation.id, operationRevision: operation.revision });
    if (this.deciding.has(operation.id) || digest(ownerOf(thread)) !== digest(basis.owner)
      || operationCommitment(operation) !== operationCommitment(basis.operation) || this.state(basis).decision !== 'trusted')
      throw new HarnessError('PROJECT_TRUST_REQUIRED', 'Explicitly trust these exact project bytes before approving this operation');
  }
  assertLaunch(operation: Operation, binding: AnyRepositoryTestBinding): void {
    if (!this.options.enabled && !this.required(operation)) return;
    if (!this.options.enabled) throw new HarnessError('PROJECT_TRUST_DISABLED', 'A reviewed operation cannot bypass disabled project trust');
    const basis = this.basis({ threadId: operation.threadId, operationId: operation.id, operationRevision: operation.revision }, true);
    if (binding.version === 2) requireRepositoryTestBindingV2(basis.binding.version === 2 ? basis.binding : undefined, binding, operation.preconditions.testSha256);
    else requireRepositoryTestBinding(basis.binding.version === 1 ? basis.binding : undefined, binding, operation.preconditions.testSha256);
    if (this.deciding.has(operation.id) || !basis.operation.approved || operationCommitment(operation) !== operationCommitment(basis.operation) || this.state(basis).decision !== 'trusted')
      throw new HarnessError('PROJECT_TRUST_REQUIRED', 'Project trust or the operation owner changed before launch');
  }
  dispose(): void { this.reviews.clear(); this.stop.abort(); }
}
