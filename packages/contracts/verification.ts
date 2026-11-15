import { z } from 'zod';
import { rootRelativePathSchema, sha256HexSchema } from './execution-profile.ts';
import { observationFreshnessSchema, toolOwnerSchema } from './tool-effects.ts';

/** M06 verification contracts: trustworthy project verification, functional/
 * visual browser QA, bounded repair and evidence-grade completion. Records
 * carry identities, digests, owners and outcomes only. A model-generated PASS,
 * a screenshot alone or a confidence score is never a verified result. */

const isoTimestamp = z.string().datetime();
const boundedText = (max: number) => z.string().min(1).max(max);
const sha1 = z.string().regex(/^[a-f0-9]{40}$/);

/* ------------------------------------------------------------------ */
/* VerificationRecipeV1 — an approved, executable-identity bound check  */
/* plan. Executable strings are identities, never arbitrary shell       */
/* fragments. Registration and changes require M02 exact approval.      */
/* ------------------------------------------------------------------ */

export const VERIFICATION_PHASE_NAMES = ['BOOTSTRAP', 'BUILD', 'TEST', 'START', 'READINESS', 'BROWSER', 'TEARDOWN'] as const;
export type VerificationPhaseName = (typeof VERIFICATION_PHASE_NAMES)[number];
export const verificationPhaseNameSchema = z.enum(VERIFICATION_PHASE_NAMES);

export const recipePhaseSchema = z.strictObject({
  name: verificationPhaseNameSchema,
  /** Identity of the executable the approved profile resolves (e.g. 'pnpm',
   * 'node'). It is never a shell fragment and never a path inside the project. */
  executableId: boundedText(100),
  argv: z.array(z.string().max(4096)).max(64),
  /** Working directory relative to the trusted workspace root; '.' names the
   * root itself. */
  relativeCwd: z.union([z.literal('.'), rootRelativePathSchema]),
  /** Names of environment references resolved inside the permitted execution
   * environment; never literal values. */
  environmentRefs: z.array(boundedText(128)).max(32),
  timeoutMs: z.number().int().min(1).max(600_000),
});
export type RecipePhase = z.infer<typeof recipePhaseSchema>;

export const workspaceIdentityV1Schema = z.strictObject({
  canonicalPath: boundedText(4096),
  dev: boundedText(40),
  ino: boundedText(40),
});
export type WorkspaceIdentityV1 = z.infer<typeof workspaceIdentityV1Schema>;

export const recipeEnvironmentV1Schema = z.strictObject({
  platform: boundedText(40),
  nodeVersion: boundedText(40),
  packageManager: boundedText(100).nullable(),
});
export type RecipeEnvironmentV1 = z.infer<typeof recipeEnvironmentV1Schema>;

export const verificationRecipeV1Schema = z.strictObject({
  version: z.literal(1),
  recipeId: boundedText(100),
  workspaceIdentity: workspaceIdentityV1Schema,
  /** SHA-256 of the canonical recipe content (phases + environment) that the
   * M02 approval committed to. Registration or change requires a new approval. */
  approvedDigest: sha256HexSchema,
  environment: recipeEnvironmentV1Schema,
  /** Phases must appear in the canonical verification order (BOOTSTRAP →
   * TEARDOWN), each at most once — a TEST before BUILD would check the previous
   * build's output. */
  phases: z.array(recipePhaseSchema).min(1).max(16).refine(
    phases => phases.every((phase, index) => index === 0 || VERIFICATION_PHASE_NAMES.indexOf(phase.name) > VERIFICATION_PHASE_NAMES.indexOf(phases[index - 1].name)),
    'Recipe phases must appear once each, in the canonical verification order'),
  createdAt: isoTimestamp,
  revision: z.number().int().positive(),
});
export type VerificationRecipeV1 = z.infer<typeof verificationRecipeV1Schema>;

/* ------------------------------------------------------------------ */
/* CheckObservationV1 — one immutable executed observation bound to the */
/* exact code/dependency/recipe/environment digests and argv it ran.    */
/* Freshness is derived from the current source, never rewritten.       */
/* ------------------------------------------------------------------ */

export const checkOutcomeSchema = z.enum(['PASS', 'FAIL', 'BLOCKED', 'CANCELLED', 'UNKNOWN']);
export type CheckOutcome = z.infer<typeof checkOutcomeSchema>;

export const observationKindSchema = z.enum(['process', 'readiness', 'browser', 'visual', 'cleanup', 'review-advisory']);
export type ObservationKind = z.infer<typeof observationKindSchema>;

export const checkObservationV1Schema = z.strictObject({
  version: z.literal(1),
  checkId: boundedText(200),
  executionId: boundedText(200),
  owner: toolOwnerSchema,
  /** Digest of the exact source content observed (never a bare commit SHA when
   * the worktree can be dirty). */
  codeDigest: sha256HexSchema,
  /** Digest of the dependency manifest (lockfile) observed. */
  dependencyDigest: sha256HexSchema,
  /** Digest of the approved recipe that produced this observation. */
  recipeDigest: sha256HexSchema,
  environmentId: boundedText(200),
  argv: z.array(z.string().max(4096)).max(64),
  cwdIdentity: boundedText(4096),
  phase: verificationPhaseNameSchema,
  startedAt: isoTimestamp,
  endedAt: isoTimestamp,
  exitCode: z.number().int().nullable(),
  outcome: checkOutcomeSchema,
  artifactRefs: z.array(boundedText(1000)).max(64),
  observationKind: observationKindSchema,
  detail: boundedText(2000).optional(),
});
export type CheckObservationV1 = z.infer<typeof checkObservationV1Schema>;
export { observationFreshnessSchema };
export type ObservationFreshness = z.infer<typeof observationFreshnessSchema>;

/* ------------------------------------------------------------------ */
/* VisualObservationV1 — additionally binds the checklist item, action  */
/* trace, exact origin, viewport, assertion, observed behavior and the  */
/* screenshot digest. A schema-valid record or an image alone cannot    */
/* produce PASS.                                                        */
/* ------------------------------------------------------------------ */

export const visualObservationV1Schema = checkObservationV1Schema.extend({
  checklistItemId: boundedText(200),
  actionTraceId: boundedText(200),
  /** Exact top-level origin the assertion ran against. */
  origin: boundedText(2048),
  viewport: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }),
  assertion: boundedText(2000),
  observed: boundedText(2000),
  screenshotDigest: sha256HexSchema.nullable(),
});
export type VisualObservationV1 = z.infer<typeof visualObservationV1Schema>;

/* ------------------------------------------------------------------ */
/* DeliverableAssessmentV1 — additive completion read model. Thread     */
/* status is retained; this projection reports whether required checks  */
/* carry fresh trusted evidence for the current source/environment.     */
/* ------------------------------------------------------------------ */

export const requirementAssessmentSchema = z.enum(['VERIFIED', 'FAILED', 'UNVERIFIED', 'BLOCKED']);
export type RequirementAssessment = z.infer<typeof requirementAssessmentSchema>;

export const completionLabelSchema = z.enum(['VERIFIED', 'COMPLETED_UNVERIFIED', 'FAILED', 'BLOCKED']);
export type CompletionLabel = z.infer<typeof completionLabelSchema>;

export const sourceCutV1Schema = z.strictObject({
  headSha: sha1.nullable(),
  codeDigest: sha256HexSchema,
  dependencyDigest: sha256HexSchema,
  environmentId: boundedText(200),
  recordedAt: isoTimestamp,
});
export type SourceCutV1 = z.infer<typeof sourceCutV1Schema>;

export const assessedRequirementSchema = z.strictObject({
  id: boundedText(200),
  checkRefs: z.array(boundedText(200)).max(64),
  assessment: requirementAssessmentSchema,
  /** Exact missing or stale checks when the requirement is not verified. */
  missing: z.array(boundedText(500)).max(64),
});
export type AssessedRequirement = z.infer<typeof assessedRequirementSchema>;

export const deliverableAssessmentV1Schema = z.strictObject({
  version: z.literal(1),
  assessmentId: boundedText(200),
  threadId: boundedText(200),
  sourceCut: sourceCutV1Schema,
  label: completionLabelSchema,
  requirements: z.array(assessedRequirementSchema).max(128),
  /** External effects that settled uncertain or remain outstanding. */
  unresolvedEffects: z.array(boundedText(500)).max(64),
  verifierIdentity: boundedText(200),
  provenance: boundedText(500),
  createdAt: isoTimestamp,
});
export type DeliverableAssessmentV1 = z.infer<typeof deliverableAssessmentV1Schema>;

/* ------------------------------------------------------------------ */
/* VerificationDeclarationV1 — the requirement bindings and digest      */
/* inputs a thread declared for its completion projection.              */
/* ------------------------------------------------------------------ */

export const declaredRequirementSchema = z.strictObject({
  id: boundedText(200),
  checkRefs: z.array(boundedText(200)).max(64),
});
export type DeclaredRequirement = z.infer<typeof declaredRequirementSchema>;

export const verificationDeclarationV1Schema = z.strictObject({
  version: z.literal(1),
  rootPath: boundedText(4096),
  sourceFiles: z.array(rootRelativePathSchema).max(512),
  dependencyFiles: z.array(rootRelativePathSchema).max(64),
  environmentId: boundedText(200),
  requirements: z.array(declaredRequirementSchema).max(128),
});
export type VerificationDeclarationV1 = z.infer<typeof verificationDeclarationV1Schema>;

/* ------------------------------------------------------------------ */
/* SecurityFindingV1 — structured security evidence: source location    */
/* and digest, authorized test scope, observation, impact, status and   */
/* reproduction. Deduped by source + finding identity.                  */
/* ------------------------------------------------------------------ */

export const securityFindingStatusSchema = z.enum(['OPEN', 'MITIGATED', 'ACCEPTED', 'FALSE_POSITIVE']);
export type SecurityFindingStatus = z.infer<typeof securityFindingStatusSchema>;

export const securityFindingV1Schema = z.strictObject({
  version: z.literal(1),
  findingId: boundedText(200),
  source: z.strictObject({
    path: rootRelativePathSchema,
    blobSha: sha1,
    line: z.number().int().positive().nullable(),
  }),
  /** The scope this finding was authorized to test; never a third-party
   * target without authorization. */
  authorizedScope: boundedText(500),
  observation: boundedText(2000),
  impact: boundedText(1000),
  status: securityFindingStatusSchema,
  reproduction: boundedText(2000).nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type SecurityFindingV1 = z.infer<typeof securityFindingV1Schema>;

/* ------------------------------------------------------------------ */
/* Browser QA step union — strict, bounded, no arbitrary evaluate.      */
/* ------------------------------------------------------------------ */

export const BROWSER_STEP_LIMIT = 24;
export const BROWSER_STEP_TIMEOUT_MS = 15_000;
export const BROWSER_RUN_DEADLINE_MS = 5 * 60_000;

export const browserStepSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('NAVIGATE'), url: boundedText(2048) }),
  z.strictObject({ kind: z.literal('CLICK'), selector: boundedText(500) }),
  z.strictObject({ kind: z.literal('TYPE'), selector: boundedText(500), text: boundedText(2000) }),
  z.strictObject({ kind: z.literal('ASSERT_TEXT'), selector: boundedText(500), text: boundedText(2000), checklistItemId: boundedText(200) }),
  z.strictObject({ kind: z.literal('ASSERT_VISIBLE'), selector: boundedText(500), checklistItemId: boundedText(200) }),
  z.strictObject({ kind: z.literal('ASSERT_URL'), url: boundedText(2048), checklistItemId: boundedText(200) }),
  z.strictObject({ kind: z.literal('SCREENSHOT'), checklistItemId: boundedText(200), required: z.boolean() }),
  z.strictObject({ kind: z.literal('COLLECT_ERRORS') }),
]);
export type BrowserStep = z.infer<typeof browserStepSchema>;

export const browserChecklistSchema = z.strictObject({
  version: z.literal(1),
  checklistId: boundedText(200),
  /** Approved top-level origins for navigation, popups and traffic. */
  approvedOrigins: z.array(boundedText(2048)).min(1).max(32),
  viewport: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }),
  steps: z.array(browserStepSchema).min(1).max(BROWSER_STEP_LIMIT),
  items: z.array(boundedText(200)).min(1).max(64).refine(items => new Set(items).size === items.length, 'Checklist item IDs must be unique'),
});
export type BrowserChecklistV1 = z.infer<typeof browserChecklistSchema>;
