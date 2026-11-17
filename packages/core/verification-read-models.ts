import {assertVerificationReadBasis, type VerificationReadBasis} from './verification-workflow.ts';
import {attestVerificationArtifacts} from './verification-artifacts.ts';
import type { Store } from '../storage/store.ts';
import type { Thread } from '../contracts/index.ts';
import type {VerificationWorkflowView} from '../contracts/verification-repair.ts';
import type { ToolEffectRecord } from '../contracts/tool-effects.ts';
import type {
  CheckObservationV1, CompletionLabel, DeliverableAssessmentV1,
  SecurityFindingV1, VerificationDeclarationV1, VisualObservationV1,
} from '../contracts/verification.ts';
import {securityFindingV1Schema} from '../contracts/verification.ts';
import { computeAssessment, observationFreshness, observationMatchesThreadOwner } from './verification-gate.ts';
import { assertVerificationSourceRoot, sourceDigestSync } from './project-verification.ts';

/** M06 additive read model for the verification panel. Columns: requirement,
 * observed check, source revision, outcome, freshness, verifier and evidence.
 * A stale result is a result attached to a different source cut — it never
 * renders as a green badge, and the panel shows a Stale banner. */

export interface VerificationCheckDetails {
  argv: string[];
  cwdIdentity: string;
  codeDigest: string;
  dependencyDigest: string;
  recipeDigest: string;
  environmentId: string;
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
  observationKind: CheckObservationV1['observationKind'];
  detail: string | null;
  visual: Pick<VisualObservationV1, 'checklistItemId' | 'actionTraceId' | 'origin' | 'viewport' | 'assertion' | 'observed' | 'screenshotDigest'> | null;
}

export interface VerificationPanelRow {
  requirement: string;
  checkId: string | null;
  check: string;
  phase: string | null;
  sourceRevision: string;
  outcome: string;
  freshness: 'CURRENT' | 'STALE' | 'INDETERMINATE' | null;
  verifier: string | null;
  evidence: string[];
  missing: string[];
  details?: VerificationCheckDetails;
}

export interface SecurityFindingView extends Omit<SecurityFindingV1, 'provenance' | 'evidenceQuality'> {
  evidenceQuality: NonNullable<SecurityFindingV1['evidenceQuality']>;
  freshness: 'CURRENT' | 'STALE' | 'INDETERMINATE';
  scopeAuthority: 'HOST_RECORDED' | 'UNVERIFIED';
  executionId: string | null;
}

export interface VerificationPanelModel {
  workflow?: VerificationWorkflowView | null;
  label: CompletionLabel | null;
  staleBanner: boolean;
  summary: { verified: number; failed: number; unverified: number; blocked: number; missing: string[] };
  rows: VerificationPanelRow[];
  securityFindings?: {items: SecurityFindingView[]; truncated: boolean; invalid: number};
}

const short = (value: string) => (value.length > 12 ? value.slice(0, 12) : value);

function checkDetails(obs: CheckObservationV1 | VisualObservationV1): VerificationCheckDetails {
  // Functional browser assertions also carry visual fields. Their recorded
  // kind must not hide the expected/observed behavior or tested viewport.
  const visual = 'checklistItemId' in obs ? {
    checklistItemId: obs.checklistItemId, actionTraceId: obs.actionTraceId, origin: obs.origin,
    viewport: {...obs.viewport}, assertion: obs.assertion, observed: obs.observed, screenshotDigest: obs.screenshotDigest,
  } : null;
  return {
    argv: [...obs.argv], cwdIdentity: obs.cwdIdentity, codeDigest: obs.codeDigest,
    dependencyDigest: obs.dependencyDigest, recipeDigest: obs.recipeDigest, environmentId: obs.environmentId,
    startedAt: obs.startedAt, endedAt: obs.endedAt, exitCode: obs.exitCode,
    observationKind: obs.observationKind, detail: obs.detail?.slice(0, 2000) ?? null, visual,
  };
}

export function verificationPanelModel(store: Store, threadId: string, basis: VerificationReadBasis | null = null): VerificationPanelModel {
  const thread = store.get<Thread>('thread', threadId), managed = Boolean(store.get('verificationManaged', threadId));
  const declaration = store.get<VerificationDeclarationV1>('verificationDeclaration', threadId);
  const assessments = store.all<DeliverableAssessmentV1>('assessment', threadId);
  const latest = assessments.at(-1) ?? null;
  const observations: (CheckObservationV1 | VisualObservationV1)[] = [
    ...store.all<CheckObservationV1>('checkObservation', threadId),
    ...store.all<VisualObservationV1>('visualObservation', threadId),
  ];
  const ownedObservations = observations.filter(observation => observationMatchesThreadOwner(observation, thread));
  // The current source cut describes the workspace at READ time, not when an
  // assessment was saved: with a declaration, re-digest the declared inputs
  // live. Unavailable inputs make freshness indeterminate — never verified.
  let current: { codeDigest: string; dependencyDigest: string; environmentId: string } | null = null;
  if (declaration) {
    try {
      if (managed) assertVerificationReadBasis(store, threadId, basis);
      assertVerificationSourceRoot(store, threadId, declaration.rootPath);
      current = {
        codeDigest: sourceDigestSync(declaration.rootPath, declaration.sourceFiles),
        dependencyDigest: sourceDigestSync(declaration.rootPath, declaration.dependencyFiles),
        environmentId: basis?.environmentId ?? declaration.environmentId,
      };
      if (managed) assertVerificationReadBasis(store, threadId, basis);
    } catch {
      current = null;
    }
  }
  // Completion snapshots cannot attest today's source or external effects.
  // Recompute the projection without rewriting any saved observation/assessment.
  const unresolvedEffects = store.all<ToolEffectRecord>('toolEffect', threadId)
    .filter(effect => !['SUCCEEDED', 'FAILED', 'CANCELLED', 'DENIED'].includes(effect.state))
    .map(effect => effect.invocationId);
  const recomputed = declaration || latest ? computeAssessment({
      threadId,
      sourceCut: {
        headSha: latest?.sourceCut.headSha ?? null,
        codeDigest: current?.codeDigest ?? '0'.repeat(64),
        dependencyDigest: current?.dependencyDigest ?? '0'.repeat(64),
        environmentId: declaration?.environmentId ?? latest!.sourceCut.environmentId,
      },
      requirements: declaration?.requirements ?? latest!.requirements,
      observations: ownedObservations,
      artifactAttestations: attestVerificationArtifacts(store, ownedObservations, declaration?.requirements ?? latest!.requirements),
      unresolvedEffects,
      verifierIdentity: latest?.verifierIdentity ?? 'verification-panel',
      provenance: 'read model recomputed against live source digests',
      recipeDigest: basis?.recipeDigest,
    }) : null;
  if (!current && recomputed) {
    // A fallback digest is serialization plumbing, never evidence that a live
    // source matches. Even a matching historical value cannot establish this.
    for (const requirement of recomputed.requirements) {
      if (requirement.assessment === 'VERIFIED') requirement.assessment = 'UNVERIFIED';
      if (managed && requirement.assessment === 'UNVERIFIED') requirement.assessment = 'BLOCKED';
      requirement.missing = [...requirement.missing, managed ? 'current approved execution authority or source inputs are unavailable' : declaration ? 'current source inputs are unavailable' : 'current verification declaration is unavailable'].slice(0, 64);
    }
    if (recomputed.label === 'VERIFIED' || managed && recomputed.label === 'COMPLETED_UNVERIFIED') recomputed.label = managed ? 'BLOCKED' : 'COMPLETED_UNVERIFIED';
  }

  const matches = (obs: CheckObservationV1, ref: string) => obs.checkId === ref || obs.executionId === ref;
  const freshnessOf = (obs: CheckObservationV1) => (current && observationMatchesThreadOwner(obs, thread) ? observationFreshness(obs, {...current, recipeDigest: basis?.recipeDigest}) : 'INDETERMINATE' as const);

  const rows: VerificationPanelRow[] = [];
  const assessed = new Map((recomputed?.requirements ?? latest?.requirements ?? []).map(req => [req.id, req]));
  if (declaration) {
    for (const req of declaration.requirements) {
      const bound = observations.filter(obs => req.checkRefs.some(ref => matches(obs, ref)));
      const state = assessed.get(req.id);
      const missingRefs = req.checkRefs.filter(ref => !ownedObservations.some(obs => matches(obs, ref)));
      for (const ref of missingRefs) rows.push({requirement: req.id, checkId: null, check: ref, phase: null, sourceRevision: '—', outcome: 'UNVERIFIED', freshness: null, verifier: null, evidence: [], missing: [`no current-owner observation bound to ${ref} for ${req.id}`]});
      if (!bound.length && !missingRefs.length) {
        rows.push({ requirement: req.id, checkId: null, check: '—', phase: null, sourceRevision: '—', outcome: 'UNVERIFIED', freshness: null, verifier: null, evidence: [], missing: state?.missing ?? [`no observation bound to ${req.id}`] });
        continue;
      }
      for (const obs of bound) {
        const freshness = freshnessOf(obs);
        rows.push({
          requirement: req.id, checkId: obs.checkId, check: obs.argv.join(' ').slice(0, 200), phase: obs.phase,
          sourceRevision: short(obs.codeDigest), outcome: obs.outcome,
          freshness, verifier: obs.executionId, evidence: [...obs.artifactRefs], missing: [], details: checkDetails(obs),
        });
      }
    }
  }
  // Observations not bound to any declared requirement still render — the
  // panel reports what was observed, never just what was claimed.
  const boundIds = new Set(rows.map(row => row.checkId));
  for (const obs of observations) {
    if (boundIds.has(obs.checkId)) continue;
    const freshness = freshnessOf(obs);
    rows.push({
      requirement: '—', checkId: obs.checkId, check: obs.argv.join(' ').slice(0, 200), phase: obs.phase,
      sourceRevision: short(obs.codeDigest), outcome: obs.outcome,
      freshness, verifier: obs.executionId, evidence: [...obs.artifactRefs], missing: [], details: checkDetails(obs),
    });
  }

  const counts = { verified: 0, failed: 0, unverified: 0, blocked: 0, missing: [] as string[] };
  for (const req of recomputed?.requirements ?? latest?.requirements ?? []) {
    if (req.assessment === 'VERIFIED') counts.verified += 1;
    else if (req.assessment === 'FAILED') counts.failed += 1;
    else if (req.assessment === 'BLOCKED') counts.blocked += 1;
    else counts.unverified += 1;
    counts.missing.push(...req.missing);
  }
  const staleBanner = rows.some(row => row.freshness === 'STALE');
  // A completion label exists only after a saved completion assessment — the
  // task_finish boundary. Before that the panel still recomputes requirement
  // rows and freshness against the live cut, but shows no label.
  // Findings stay outside check/requirement grading. In particular, advisory
  // review and a recorded severity can never supply a successful check.
  const findingRows=store.db.prepare('SELECT body FROM entities WHERE kind = ? AND thread_id = ? ORDER BY rowid DESC LIMIT 51').all('securityFinding',threadId) as {body:string}[];
  const findings:SecurityFindingView[]=[];let invalid=0;
  for(const row of findingRows.slice(0,50)){
    try{
      const finding=securityFindingV1Schema.parse(JSON.parse(row.body)),{provenance,evidenceQuality,...recorded}=finding;
      const owned=Boolean(provenance&&observationMatchesThreadOwner({owner:provenance.owner},thread));
      const listed=Boolean(declaration&&[...declaration.sourceFiles,...declaration.dependencyFiles].includes(finding.source.path));
      const freshness=owned&&listed&&current&&provenance
        ? provenance.codeDigest===current.codeDigest&&provenance.dependencyDigest===current.dependencyDigest?'CURRENT' as const:'STALE' as const
        : 'INDETERMINATE' as const;
      findings.push({...recorded,evidenceQuality:owned?evidenceQuality??'UNVERIFIED':'UNVERIFIED',freshness,
        scopeAuthority:owned?'HOST_RECORDED':'UNVERIFIED',executionId:provenance?.executionId??null});
    }catch{invalid++;}
  }
  return { label: latest ? (recomputed?.label ?? latest.label) : null, staleBanner, summary: counts, rows,
    securityFindings:{items:findings,truncated:findingRows.length>50,invalid} };
}
