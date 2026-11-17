import { randomUUID } from 'node:crypto';
import { HarnessError, type Thread } from '../contracts/index.ts';
import type { ToolOwner } from '../contracts/tool-effects.ts';
import { verificationArtifactAttestationSchema, type VerificationArtifactAttestation } from '../contracts/verification-artifacts.ts';
import {
  type AssessedRequirement, type CheckObservationV1, type CompletionLabel,
  type DeliverableAssessmentV1, type ObservationFreshness, type SecurityFindingV1,
  deliverableAssessmentV1Schema, securityFindingV1Schema, type VisualObservationV1,
} from '../contracts/verification.ts';
import { digest, type Store } from '../storage/store.ts';

/** M06 verification gate: the additive completion read model, the bounded
 * test-fix-retest loop, the read-only QA delegation role and the security
 * finding evidence store. Model review is ADVISORY; executable runner results
 * are EXECUTED; they combine only through explicit requirement/check bindings.
 * A stale result is a result attached to a different code/environment, never a
 * green badge. */

const now = () => new Date().toISOString();
const MAX_REPAIR_ATTEMPTS = 3;

/* ------------------------------------------------------------------ */
/* Freshness — derived from current digests, never by rewriting the     */
/* stored outcome.                                                      */
/* ------------------------------------------------------------------ */

export function observationFreshness(observation: Pick<CheckObservationV1, 'codeDigest' | 'dependencyDigest' | 'environmentId'> & Partial<Pick<CheckObservationV1, 'recipeDigest'>>, current: { codeDigest: string; dependencyDigest: string; environmentId: string; recipeDigest?: string }): ObservationFreshness {
  if (observation.codeDigest === current.codeDigest && observation.dependencyDigest === current.dependencyDigest && observation.environmentId === current.environmentId && (current.recipeDigest === undefined || observation.recipeDigest === current.recipeDigest)) return 'CURRENT';
  if (!observation.codeDigest || !observation.dependencyDigest) return 'INDETERMINATE';
  return 'STALE';
}

/** Historical runs can prove unchanged code, but their evidence never moves
 * to another project, working copy or account when a thread changes owner. */
export function observationMatchesThreadOwner(observation: Pick<CheckObservationV1, 'owner'>, thread: Pick<Thread, 'id' | 'projectId' | 'workspaceId' | 'accountId'> | null): boolean {
  return !!thread && observation.owner.threadId === thread.id &&
    observation.owner.projectId === (thread.projectId ?? null) &&
    observation.owner.workspaceId === (thread.workspaceId ?? null) &&
    observation.owner.accountBinding === (thread.accountId ?? null);
}

/* ------------------------------------------------------------------ */
/* QA delegation — the QA role receives only the parent-owned           */
/* verification service and read-only context. It is a structural       */
/* whitelist object, not a tool grant: no shell, browser or write tool  */
/* exists on it.                                                        */
/* ------------------------------------------------------------------ */

const QA_ALLOWED_OPERATIONS = new Set(['verification.run', 'verification.observe', 'context.read']);

export interface QaWorkerRequest {
  operation: 'verification.run' | 'verification.observe';
  payload: unknown;
}

export function createQaWorkerRole(owner: ToolOwner) {
  return {
    kind: 'qa-v1' as const,
    owner,
    /** The only operations this role may request. Anything else is denied
     * before a worker is created. */
    allows(operation: string): boolean {
      return QA_ALLOWED_OPERATIONS.has(operation);
    },
    describe(): { tools: string[]; policy: string } {
      return { tools: [], policy: 'QA may invoke the parent-owned verification service and read context only. It holds no shell, browser or write tool.' };
    },
  };
}

export type QaWorkerRole = ReturnType<typeof createQaWorkerRole>;

export interface QaSpawnRequest {
  threadId: string;
  /** Spawn of a QA worker requires a recorded M02 approval. */
  approvalId: string;
  /** Recursive QA spawn is denied: a QA thread may not create QA workers. */
  parentIsQa?: boolean;
  cancelled?: boolean;
}

/** Gate the QA spawn before any worker is created. Returns the role to hand
 * the worker when every guard passes. */
export function admitQaSpawn(request: QaSpawnRequest, approval: { actionCommitment: string; remainingUses: number; expiresAt: string } | null, expectedCommitment: string, owner: ToolOwner, nowIso = now()): QaWorkerRole {
  if (request.parentIsQa) throw new HarnessError('CAPABILITY_DENIED', 'A QA worker cannot spawn another QA worker');
  if (request.cancelled) throw new HarnessError('CANCELLED_RUN', 'The QA request was cancelled before the worker was created');
  if (!approval || approval.actionCommitment !== expectedCommitment || approval.remainingUses < 1 || approval.expiresAt <= nowIso)
    throw new HarnessError('APPROVAL_REQUIRED', 'QA delegation needs an exact approval for this delegation');
  return createQaWorkerRole(owner);
}

/* ------------------------------------------------------------------ */
/* Bounded repair — one approved recipe, the same requirement IDs, at   */
/* most three attempts. Stops on an unchanged failure digest twice, on   */
/* budget, on a revoked approval or on conflicting evidence. QA never    */
/* commits.                                                             */
/* ------------------------------------------------------------------ */

export type RepairStopReason = 'VERIFIED' | 'UNCHANGED_FAILURE' | 'BUDGET' | 'REVOKED' | 'CONFLICT' | 'BLOCKED' | 'CANCELLED';

export interface RepairAttempt {
  attempt: number;
  requirementIds: string[];
  failureDigest: string;
  outcome: 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED';
  recordedAt: string;
}

export interface RepairState {
  recipeId: string;
  requirementIds: string[];
  attempts: RepairAttempt[];
  stopped: RepairStopReason | null;
}

/** Stable check identity excludes per-execution IDs and source edits. */
export function verificationFailureIdentity(observed: CheckObservationV1 | VisualObservationV1, detail?: string): string {
  return digest({
    phase: observed.phase, kind: observed.observationKind, argv: observed.argv,
    cwd: observed.cwdIdentity, recipe: observed.recipeDigest, environment: observed.environmentId,
    outcome: observed.outcome, exitCode: observed.exitCode,
    item: 'checklistItemId' in observed ? observed.checklistItemId : null,
    assertion: 'assertion' in observed ? observed.assertion : null,
    detail: detail ?? observed.detail ?? ('observed' in observed ? observed.observed : ''),
  });
}

export class BoundedRepairLoop {
  private state: RepairState;
  constructor(private readonly store: Store, private readonly owner: ToolOwner, recipeId: string, requirementIds: readonly string[]) {
    const key = `repair-${owner.threadId}-${recipeId}`;
    this.state = store.get<RepairState>('repair', key) ?? { recipeId, requirementIds: [...requirementIds], attempts: [], stopped: null };
    this.key = key;
    if (digest([...requirementIds].sort()) !== digest([...this.state.requirementIds].sort()))
      throw new HarnessError('REPAIR_SCOPE', 'A repair must keep the same requirement IDs');
    if (!this.state.attempts.length) this.persist();
  }
  private readonly key: string;
  private persist(): void {
    this.store.internal('repair.updated', this.owner.threadId, () => {
      this.store.put('repair', this.key, this.owner.threadId, this.state);
      return this.state;
    });
  }

  get attempts(): RepairAttempt[] { return [...this.state.attempts]; }
  get stopped(): RepairStopReason | null { return this.state.stopped; }

  /** Returns whether another attempt may start, and why not. */
  nextDecision(): { allowed: boolean; reason: RepairStopReason | null } {
    // Controllers may overlap or be reconstructed. Read the latest durable
    // attempt history before enforcing a budget or appending another attempt.
    this.state = this.store.get<RepairState>('repair', this.key) ?? this.state;
    if (this.state.stopped) return { allowed: false, reason: this.state.stopped };
    if (this.state.attempts.length >= MAX_REPAIR_ATTEMPTS) { this.state.stopped = 'BUDGET'; this.persist(); return { allowed: false, reason: 'BUDGET' }; }
    const failures = this.state.attempts.filter(a => a.outcome === 'FAIL').map(a => a.failureDigest);
    if (failures.length >= 2 && failures.at(-1) === failures.at(-2)) { this.state.stopped = 'UNCHANGED_FAILURE'; this.persist(); return { allowed: false, reason: 'UNCHANGED_FAILURE' }; }
    return { allowed: true, reason: null };
  }

  recordAttempt(input: { requirementIds: string[]; failures: { checkId: string; outcome: string; detail?: string }[]; outcome: RepairAttempt['outcome']; revoked?: boolean; conflict?: boolean }): RepairAttempt {
    const decision = this.nextDecision();
    if (!decision.allowed) throw new HarnessError('REPAIR_BUDGET', `Repair stopped: ${decision.reason}`);
    if (digest([...input.requirementIds].sort()) !== digest([...this.state.requirementIds].sort()))
      throw new HarnessError('REPAIR_SCOPE', 'A repair attempt must keep the same requirement IDs');
    const attempt: RepairAttempt = {
      attempt: this.state.attempts.length + 1,
      requirementIds: [...input.requirementIds],
      failureDigest: digest(input.failures.map(failure => {
        const observed = this.store.get<CheckObservationV1>('checkObservation', failure.checkId) ??
          this.store.get<VisualObservationV1>('visualObservation', failure.checkId);
        if (!observed) return digest({ checkId: failure.checkId, outcome: failure.outcome, detail: failure.detail ?? '' });
        if (digest(observed.owner) !== digest(this.owner))
          throw new HarnessError('REPAIR_SCOPE', 'Repair evidence belongs to another owner binding');
        // Execution and observation IDs are new for every retest. Compare the
        // stable check identity and actual failure instead of those run IDs.
        return verificationFailureIdentity(observed, failure.detail);
      }).sort()),
      outcome: input.outcome,
      recordedAt: now(),
    };
    this.state.attempts.push(attempt);
    if (input.revoked) this.state.stopped = 'REVOKED';
    else if (input.conflict) this.state.stopped = 'CONFLICT';
    else if (input.outcome === 'CANCELLED') this.state.stopped = 'CANCELLED';
    else if (input.outcome === 'BLOCKED') this.state.stopped = 'BLOCKED';
    else if (input.outcome === 'PASS') this.state.stopped = 'VERIFIED';
    this.persist();
    return attempt;
  }
}

/* ------------------------------------------------------------------ */
/* Security findings — deduped by source + finding identity; the store  */
/* is evidence, not an exploitation tool.                                */
/* ------------------------------------------------------------------ */

export class SecurityFindingLedger {
  constructor(private readonly store: Store) {}
  record(finding: Omit<SecurityFindingV1, 'updatedAt'>, threadId: string): SecurityFindingV1 {
    const parsed = securityFindingV1Schema.parse({ ...finding, updatedAt: finding.createdAt });
    const owner = parsed.provenance?.owner;
    if (owner && owner.threadId !== threadId) throw new HarnessError('STALE_FINDING_OWNER', 'The finding owner does not match this thread.');
    return this.store.internal('securityFinding.recorded', threadId, (): SecurityFindingV1 => {
      const legacyId = `finding-${digest({ source: parsed.source, findingId: parsed.findingId }).slice(0, 24)}`;
      const legacy = this.store.db.prepare('SELECT thread_id FROM entities WHERE kind = ? AND id = ?').get('securityFinding', legacyId) as {thread_id: string | null} | undefined;
      // Preserve same-owner legacy rows. Another thread must never move or
      // replace a finding merely because it reviewed identical source bytes.
      const logicalOwner = owner ? {projectId: owner.projectId, workspaceId: owner.workspaceId, accountBinding: owner.accountBinding} : undefined;
      const id = !owner && legacy?.thread_id === threadId ? legacyId : `finding-${digest({ threadId, ...(logicalOwner ? {logicalOwner} : {}), source: parsed.source, findingId: parsed.findingId }).slice(0, 24)}`;
      const prior = this.store.get<SecurityFindingV1>('securityFinding', id);
      const merged = prior ? { ...parsed, createdAt: prior.createdAt, updatedAt: now() } : parsed;
      this.store.put('securityFinding', id, threadId, merged);
      return merged;
    }) as SecurityFindingV1;
  }
  all(threadId?: string): SecurityFindingV1[] {
    return this.store.all<SecurityFindingV1>('securityFinding', threadId);
  }
}

/* ------------------------------------------------------------------ */
/* Completion projection — additive; it never replaces thread status.   */
/* ------------------------------------------------------------------ */

export interface RequirementSpec {
  id: string;
  /** Check IDs or observation kinds this requirement accepts as evidence. */
  checkRefs: string[];
}

export interface AssessmentInput {
  threadId: string;
  sourceCut: { headSha: string | null; codeDigest: string; dependencyDigest: string; environmentId: string };
  requirements: RequirementSpec[];
  observations: (CheckObservationV1 | VisualObservationV1)[];
  /** Host-only current byte attestations. Never a model or browser argument. */
  artifactAttestations?: readonly VerificationArtifactAttestation[];
  /** Current host-approved recipe identity, when a managed recipe is active. */
  recipeDigest?: string;
  unresolvedEffects: string[];
  verifierIdentity: string;
  provenance: string;
}

export function computeAssessment(input: AssessmentInput): DeliverableAssessmentV1 {
  // A check reference names an observation by checkId or the execution that
  // produced it; bindings are explicit, never inferred from result kind.
  const match = (obs: CheckObservationV1, ref: string) => obs.checkId === ref || obs.executionId === ref;
  // Run-level audit markers (__boundary__, __traffic__, __errors__, ...) prove
  // run policy held, not that a checklist item was verified — a marker PASS can
  // never satisfy a requirement, but marker failures/blocks/cancellations stay
  // effective so a failed execution cannot verify. The __ namespace is reserved
  // at checklist admission (browserChecklistSchema).
  const isAuditMarker = (obs: CheckObservationV1) =>
    'checklistItemId' in obs && typeof obs.checklistItemId === 'string' && obs.checklistItemId.startsWith('__');
  const executionKey = (obs: Pick<CheckObservationV1, 'executionId' | 'owner'>) => JSON.stringify([
    obs.executionId, obs.owner.threadId, obs.owner.runId, obs.owner.epoch,
    obs.owner.projectId, obs.owner.workspaceId, obs.owner.accountBinding,
  ]);
  const canVerify = (obs: CheckObservationV1) => !isAuditMarker(obs) &&
    obs.observationKind !== 'review-advisory' && obs.observationKind !== 'visual';
  // The gate stays pure. Only explicit host inputs from a current bounded read
  // can attest bytes; metadata in an observation never supplies custody.
  const attestations = new Map<string, VerificationArtifactAttestation | null>();
  for (const raw of (input.artifactAttestations ?? []).slice(0, 256)) {
    const parsed = verificationArtifactAttestationSchema.safeParse(raw);
    if (!parsed.success) continue;
    const value = parsed.data, key = executionKey(value) + ':' + value.ref;
    const existing = attestations.get(key);
    attestations.set(key, existing !== undefined && digest(existing) !== digest(value) ? null : value);
  }
  const missingArtifactCustody = (obs: CheckObservationV1): 'screenshot' | 'artifact' | null => {
    if (obs.observationKind === 'review-advisory') return null;
    const proofs = obs.artifactRefs.map(ref => attestations.get(executionKey(obs) + ':' + ref));
    const screenshotRequired = obs.observationKind === 'visual' ||
      'screenshotDigest' in obs && obs.screenshotDigest !== null ||
      proofs.some(proof => proof?.kind === 'SCREENSHOT');
    if (screenshotRequired && (!('screenshotDigest' in obs) || typeof obs.screenshotDigest !== 'string' || !('viewport' in obs) ||
        !proofs.some(proof => proof?.kind === 'SCREENSHOT' && proof.sha256 === obs.screenshotDigest && digest(proof.viewport) === digest(obs.viewport)))) return 'screenshot';
    return proofs.some(proof => !proof) ? 'artifact' : null;
  };
  const current = { codeDigest: input.sourceCut.codeDigest, dependencyDigest: input.sourceCut.dependencyDigest, environmentId: input.sourceCut.environmentId, recipeDigest: input.recipeDigest };
  const requirements: AssessedRequirement[] = input.requirements.map(req => {
    const bound = input.observations.filter(obs => req.checkRefs.some(ref => match(obs, ref)));
    // Direct check bindings still inherit the terminal state of the execution
    // that produced them. A caller cannot omit cleanup, cancellation or failed
    // assertions by choosing only a passing check. Include the complete owner
    // identity so an execution ID collision cannot import another run's state.
    const executions = new Set(bound.map(executionKey));
    const executionChecks = input.observations.filter(obs => executions.has(executionKey(obs)));
    const missing: string[] = [];
    if (!req.checkRefs.length) missing.push(`no observation bound to ${req.id}`);
    // Every declared reference is required. An execution reference includes
    // all checks it produced, so one fresh PASS cannot hide a missing, stale
    // or unsettled sibling check. Advisory and audit-only evidence cannot
    // satisfy a reference even when its recorded outcome is PASS.
    for (const ref of new Set(req.checkRefs)) {
      const checks = bound.filter(obs => match(obs, ref));
      const refExecutions = new Set(checks.map(executionKey));
      const related = executionChecks.filter(obs => refExecutions.has(executionKey(obs)));
      if (!checks.length) missing.push(`no observation bound to ${ref} for ${req.id}`);
      else if (related.some(obs => missingArtifactCustody(obs)))
        missing.push(`${related.some(obs => missingArtifactCustody(obs) === 'screenshot') ? 'screenshot' : 'artifact'} custody is unavailable for ${req.id} (${ref})`);
      else if (related.some(obs => observationFreshness(obs, current) === 'STALE'))
        missing.push(`evidence for ${req.id} (${ref}) is stale against the current source`);
      else if (related.some(obs => observationFreshness(obs, current) !== 'CURRENT' || obs.outcome === 'UNKNOWN') ||
        !checks.some(obs => obs.outcome === 'PASS' && canVerify(obs)))
        missing.push(`evidence for ${req.id} (${ref}) is indeterminate or missing`);
    }
    let assessment: AssessedRequirement['assessment'] = 'UNVERIFIED';
    if (executionChecks.some(obs => obs.outcome === 'FAIL' || obs.outcome === 'BLOCKED' || obs.outcome === 'CANCELLED')) {
      assessment = executionChecks.some(obs => obs.outcome === 'BLOCKED') && !executionChecks.some(obs => obs.outcome === 'FAIL' || obs.outcome === 'CANCELLED') ? 'BLOCKED' : 'FAILED';
    } else if (executionChecks.some(obs => missingArtifactCustody(obs))) {
      assessment = 'BLOCKED';
    } else if (req.checkRefs.length && !missing.length) {
      assessment = 'VERIFIED';
    }
    return { id: req.id, checkRefs: req.checkRefs, assessment, missing };
  });

  let label: CompletionLabel;
  if (input.unresolvedEffects.length) label = 'BLOCKED';
  else if (requirements.every(req => req.assessment === 'VERIFIED') && requirements.length) label = 'VERIFIED';
  else if (requirements.some(req => req.assessment === 'FAILED')) label = 'FAILED';
  else if (requirements.some(req => req.assessment === 'BLOCKED')) label = 'BLOCKED';
  else label = 'COMPLETED_UNVERIFIED';
  // A thread with no declared verification requirements completes unverified —
  // purely conversational tasks still finish, with the label saying so.
  if (!requirements.length) label = input.unresolvedEffects.length ? 'BLOCKED' : 'COMPLETED_UNVERIFIED';

  // Keep the wire projection bounded without dropping durable ledger records
  // or turning a large unresolved set into a schema error. The label above is
  // derived from the full set; provenance makes the displayed subset explicit.
  const unresolvedEffects = input.unresolvedEffects.slice(0, 64);
  let provenance = input.provenance;
  if (input.unresolvedEffects.length > unresolvedEffects.length) {
    deliverableAssessmentV1Schema.shape.provenance.parse(provenance);
    const summary = `Unresolved effects: ${input.unresolvedEffects.length}; references shown: ${unresolvedEffects.length}. `;
    const available = 500 - summary.length;
    const shortened = ' [provenance shortened]';
    if (provenance.length > available) provenance = provenance.slice(0, available - shortened.length) + shortened;
    provenance = summary + provenance;
  }
  return deliverableAssessmentV1Schema.parse({
    version: 1,
    assessmentId: `assess-${randomUUID()}`,
    threadId: input.threadId,
    sourceCut: { ...input.sourceCut, recordedAt: now() },
    label,
    requirements,
    unresolvedEffects,
    verifierIdentity: input.verifierIdentity,
    provenance,
    createdAt: now(),
  });
}
