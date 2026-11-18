import { randomUUID } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import type { ToolOwner } from '../contracts/tool-effects.ts';
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

export function observationFreshness(observation: Pick<CheckObservationV1, 'codeDigest' | 'dependencyDigest' | 'environmentId'>, current: { codeDigest: string; dependencyDigest: string; environmentId: string }): ObservationFreshness {
  if (observation.codeDigest === current.codeDigest && observation.dependencyDigest === current.dependencyDigest && observation.environmentId === current.environmentId) return 'CURRENT';
  if (!observation.codeDigest || !observation.dependencyDigest) return 'INDETERMINATE';
  return 'STALE';
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

export type RepairStopReason = 'VERIFIED' | 'UNCHANGED_FAILURE' | 'BUDGET' | 'REVOKED' | 'CONFLICT' | 'BLOCKED';

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

export class BoundedRepairLoop {
  private state: RepairState;
  constructor(private readonly store: Store, private readonly owner: ToolOwner, recipeId: string, requirementIds: readonly string[]) {
    const key = `repair-${owner.threadId}-${recipeId}`;
    this.state = store.get<RepairState>('repair', key) ?? { recipeId, requirementIds: [...requirementIds], attempts: [], stopped: null };
    this.key = key;
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
    if (this.state.stopped) return { allowed: false, reason: this.state.stopped };
    if (this.state.attempts.length >= MAX_REPAIR_ATTEMPTS) { this.state.stopped = 'BUDGET'; this.persist(); return { allowed: false, reason: 'BUDGET' }; }
    const failures = this.state.attempts.filter(a => a.outcome === 'FAIL').map(a => a.failureDigest);
    if (failures.length >= 2 && failures.at(-1) === failures.at(-2)) { this.state.stopped = 'UNCHANGED_FAILURE'; this.persist(); return { allowed: false, reason: 'UNCHANGED_FAILURE' }; }
    return { allowed: true, reason: null };
  }

  recordAttempt(input: { requirementIds: string[]; failures: { checkId: string; outcome: string; detail?: string }[]; outcome: RepairAttempt['outcome']; revoked?: boolean; conflict?: boolean }): RepairAttempt {
    const decision = this.nextDecision();
    if (!decision.allowed) throw new HarnessError('REPAIR_BUDGET', `Repair stopped: ${decision.reason}`);
    if (input.requirementIds.join(',') !== this.state.requirementIds.join(','))
      throw new HarnessError('REPAIR_SCOPE', 'A repair attempt must keep the same requirement IDs');
    const attempt: RepairAttempt = {
      attempt: this.state.attempts.length + 1,
      requirementIds: [...input.requirementIds],
      failureDigest: digest(input.failures.map(f => ({ checkId: f.checkId, outcome: f.outcome, detail: f.detail ?? '' }))),
      outcome: input.outcome,
      recordedAt: now(),
    };
    this.state.attempts.push(attempt);
    if (input.revoked) this.state.stopped = 'REVOKED';
    else if (input.conflict) this.state.stopped = 'CONFLICT';
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
    const id = `finding-${digest({ source: parsed.source, findingId: parsed.findingId }).slice(0, 24)}`;
    return this.store.internal('securityFinding.recorded', threadId, (): SecurityFindingV1 => {
      const prior = this.store.get<SecurityFindingV1>('securityFinding', id);
      const merged = prior ? { ...parsed, updatedAt: now() } : parsed;
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
  const current = { codeDigest: input.sourceCut.codeDigest, dependencyDigest: input.sourceCut.dependencyDigest, environmentId: input.sourceCut.environmentId };
  const requirements: AssessedRequirement[] = input.requirements.map(req => {
    const bound = input.observations.filter(obs => req.checkRefs.some(ref => match(obs, ref)));
    const missing: string[] = [];
    if (!req.checkRefs.length) missing.push(`no observation bound to ${req.id}`);
    // Every declared reference is required. An execution reference includes
    // all checks it produced, so one fresh PASS cannot hide a missing, stale
    // or unsettled sibling check. Advisory and audit-only evidence cannot
    // satisfy a reference even when its recorded outcome is PASS.
    for (const ref of new Set(req.checkRefs)) {
      const checks = bound.filter(obs => match(obs, ref));
      if (!checks.length) missing.push(`no observation bound to ${ref} for ${req.id}`);
      else if (checks.some(obs => observationFreshness(obs, current) === 'STALE'))
        missing.push(`evidence for ${req.id} (${ref}) is stale against the current source`);
      else if (checks.some(obs => observationFreshness(obs, current) !== 'CURRENT' || obs.outcome === 'UNKNOWN') ||
        !checks.some(obs => obs.outcome === 'PASS' && !isAuditMarker(obs) && obs.observationKind !== 'review-advisory'))
        missing.push(`evidence for ${req.id} (${ref}) is indeterminate or missing`);
    }
    let assessment: AssessedRequirement['assessment'] = 'UNVERIFIED';
    if (bound.some(obs => obs.outcome === 'FAIL' || obs.outcome === 'BLOCKED' || obs.outcome === 'CANCELLED')) {
      assessment = bound.some(obs => obs.outcome === 'BLOCKED') && !bound.some(obs => obs.outcome === 'FAIL') ? 'BLOCKED' : 'FAILED';
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

  return deliverableAssessmentV1Schema.parse({
    version: 1,
    assessmentId: `assess-${randomUUID()}`,
    threadId: input.threadId,
    sourceCut: { ...input.sourceCut, recordedAt: now() },
    label,
    requirements,
    unresolvedEffects: input.unresolvedEffects,
    verifierIdentity: input.verifierIdentity,
    provenance: input.provenance,
    createdAt: now(),
  });
}
