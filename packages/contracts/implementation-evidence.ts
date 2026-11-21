import { z } from 'zod';
import { Sha256Hex } from './hashing.ts';

// ImplementationEvidenceV3 / CommandEvidence / SourceLockV3 — the shared release
// evidence format used by implementation bundles. A bundle is PASS only when
// every required phase passes; FAIL on an observed required-case failure;
// PARTIAL when some phases pass while another is blocked; BLOCKED when no
// required phase can run. Release permission is separate and stays false here.
const EVIDENCE_SCHEMA_VERSION = 3;

const sha1 = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = Sha256Hex;
const nonEmpty = z.string().min(1);

const phaseStatusSchema = z.enum(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);


const commandTerminationSchema = z.enum(['NONE', 'TIMEOUT', 'CANCELLED', 'SPAWN_ERROR']);
export type CommandTermination = z.infer<typeof commandTerminationSchema>;

const commandStatusSchema = z.enum(['PASS', 'FAIL', 'EXPECTED_NEGATIVE', 'BLOCKED', 'NOT_RUN']);
export type CommandStatus = z.infer<typeof commandStatusSchema>;

const expectedNegativeSchema = z.strictObject({
  // The reproduction passed only because the asserted failure was observed at
  // the intended assertion with the intended bad value. Setup failures,
  // timeouts and other errors are separate failures, never this status.
  assertedFailure: nonEmpty,
  observed: z.literal(true),
});
export type ExpectedNegative = z.infer<typeof expectedNegativeSchema>;

export const commandEvidenceSchema = z.strictObject({
  argv: z.array(nonEmpty).min(1),
  cwdIdentity: nonEmpty,
  executableIdentity: nonEmpty,
  startedAt: nonEmpty,
  endedAt: nonEmpty,
  exitCode: z.number().int().nullable(),
  termination: commandTerminationSchema,
  status: commandStatusSchema,
  boundedLogRef: nonEmpty,
  logDigest: sha256,
  expectedNegative: expectedNegativeSchema.optional(),
});
export type CommandEvidence = z.infer<typeof commandEvidenceSchema>;

const requiredCaseStatusSchema = z.enum(['PASS', 'FAIL', 'EXPECTED_NEGATIVE', 'NOT_RUN']);
const requiredCaseSchema = z.strictObject({
  id: nonEmpty,
  status: requiredCaseStatusSchema,
  evidence: z.string().optional(),
});


const phaseEvidenceSchema = z.strictObject({
  id: nonEmpty,
  status: phaseStatusSchema,
  requiredCases: z.array(requiredCaseSchema),
  commands: z.array(commandEvidenceSchema),
  artifactRefs: z.array(z.string()),
});
export type PhaseEvidence = z.infer<typeof phaseEvidenceSchema>;

export const dependencyContractSchema = z.strictObject({
  name: nonEmpty,
  // The git blob SHA-1 of the source file that defines the contract.
  version: sha1,
  testIds: z.array(nonEmpty).min(1),
});


const flagStateSchema = z.strictObject({ key: nonEmpty, enabled: z.boolean() });


export const implementationEvidenceV3Schema = z.strictObject({
  schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
  bundleId: nonEmpty,
  baseSha: sha1,
  sourceLockDigest: sha256,
  platform: nonEmpty,
  nodeVersion: nonEmpty,
  packageManagerVersion: nonEmpty,
  phases: z.array(phaseEvidenceSchema),
  changedFiles: z.array(nonEmpty),
  dependencyContracts: z.array(dependencyContractSchema),
  flags: z.array(flagStateSchema),
  remainingGates: z.array(z.string()),
  // Self-reported approval is never accepted; release permission is separate.
  reviewerApproval: z.literal(false),
});
export type ImplementationEvidenceV3 = z.infer<typeof implementationEvidenceV3Schema>;

const inspectedPathSchema = z.strictObject({ path: nonEmpty, blobSha: sha1 });


const approvedDriftSchema = z.strictObject({
  path: nonEmpty,
  fromBlob: sha1,
  toBlob: sha1,
  note: nonEmpty,
});


export const sourceLockV3Schema = z.strictObject({
  schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
  auditAncestorSha: sha1,
  executionBaseSha: sha1,
  inspectedPaths: z.array(inspectedPathSchema),
  publicContracts: z.array(dependencyContractSchema),
  acceptedDependencyCommits: z.array(sha1),
  approvedDrift: z.array(approvedDriftSchema),
});
export type SourceLockV3 = z.infer<typeof sourceLockV3Schema>;

export type BundleStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'BLOCKED';

export function bundleStatus(phases: PhaseEvidence[]): BundleStatus {
  if (!phases.length) return 'BLOCKED';
  if (phases.some(phase => phase.status === 'FAIL' || phase.requiredCases.some(item => item.status === 'FAIL'))) return 'FAIL';
  // A claimed PASS is not proof when its required cases or command receipts
  // are missing or contradictory. Preserve observed failures above, and count
  // only phases that satisfy the same validation used by the manifest checker.
  const passed = phases.filter(phase => phase.status === 'PASS' && validatePhaseEvidence(phase).length === 0).length;
  if (passed === phases.length) return 'PASS';
  if (passed > 0) return 'PARTIAL';
  return 'BLOCKED';
}

// Paired benchmark records: unknown measurements stay null, never fabricated.
const benchmarkMeasurementSchema = z.strictObject({
  elapsedMs: z.number().nullable(),
  coldStartMs: z.number().nullable(),
  firstPublicResponseMs: z.number().nullable(),
  requests: z.number().int().nullable(),
  inputBytes: z.number().int().nullable(),
  outputBytes: z.number().int().nullable(),
  cacheInputBytes: z.number().int().nullable(),
  cacheOutputBytes: z.number().int().nullable(),
  totalCostBytes: z.number().int().nullable(),
  backgroundCostBytes: z.number().int().nullable(),
  completionQuality: z.number().nullable(),
});
export type BenchmarkMeasurement = z.infer<typeof benchmarkMeasurementSchema>;

const benchmarkRunStatusSchema = z.enum(['PASS', 'FAIL', 'SETUP_FAILED', 'EXPECTED_NEGATIVE', 'UNAVAILABLE']);
const benchmarkRunSchema = z.strictObject({
  role: z.enum(['baseline', 'candidate']),
  status: benchmarkRunStatusSchema,
  measurement: benchmarkMeasurementSchema,
});
export type BenchmarkRun = z.infer<typeof benchmarkRunSchema>;

export const benchmarkRecordSchema = z.strictObject({
  fixture: nonEmpty,
  model: z.string().nullable(),
  account: z.string().nullable(),
  config: nonEmpty,
  seed: z.number().int(),
  baseline: benchmarkRunSchema.nullable(),
  candidate: benchmarkRunSchema.nullable(),
  notes: z.array(z.string()),
});
export type BenchmarkRecord = z.infer<typeof benchmarkRecordSchema>;

export interface EvidenceIssue { phase?: string; code: string; message: string }
const issue = (code: string, message: string, phase?: string): EvidenceIssue => ({ code, message, ...(phase ? { phase } : {}) });

export function validateCommandEvidence(command: CommandEvidence): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  const observed = command.termination === 'NONE';
  if (command.status === 'PASS' && (!observed || command.exitCode !== 0))
    issues.push(issue('PASS_WITHOUT_OBSERVED_SUCCESS', 'A PASS command needs termination NONE and exit code 0.'));
  if (command.status === 'EXPECTED_NEGATIVE') {
    if (!command.expectedNegative)
      issues.push(issue('EXPECTED_NEGATIVE_UNPROVEN', 'Expected-negative status needs the asserted failure that was observed.'));
    if (!observed || command.exitCode !== 0)
      issues.push(issue('EXPECTED_NEGATIVE_MISLABEL', 'A nonzero or unterminated command is FAIL, not an expected negative.'));
  }
  if (observed && command.exitCode !== null && command.exitCode !== 0 && command.status === 'EXPECTED_NEGATIVE')
    issues.push(issue('EXPECTED_NEGATIVE_MISLABEL', 'A nonzero exit is FAIL, not an expected negative.'));
  if (!observed && (command.status === 'PASS' || command.status === 'EXPECTED_NEGATIVE'))
    issues.push(issue('UNOBSERVED_RESULT', `${command.termination} cannot carry ${command.status} evidence.`));
  return issues;
}

export function validatePhaseEvidence(phase: PhaseEvidence): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  for (const command of phase.commands) for (const item of validateCommandEvidence(command)) issues.push({ ...item, phase: phase.id });
  if (phase.status === 'PASS') {
    if (!phase.requiredCases.length)
      issues.push(issue('SKIPPED_REQUIRED_SUITE', 'A PASS phase must name its required cases; an empty list skips required coverage.', phase.id));
    const unmet = phase.requiredCases.filter(item => item.status === 'NOT_RUN' || item.status === 'FAIL');
    for (const item of unmet)
      issues.push(issue(item.status === 'FAIL' ? 'REQUIRED_CASE_FAILED' : 'REQUIRED_CASE_NOT_RUN', `Required case ${item.id} is ${item.status} inside a PASS phase.`, phase.id));
    if (!phase.commands.some(command => command.status === 'PASS' || command.status === 'EXPECTED_NEGATIVE'))
      issues.push(issue('NO_COMMAND_EVIDENCE', 'A PASS phase needs at least one executed command record.', phase.id));
  }
  return issues;
}

export interface EvidenceValidationOptions {
  expectedBaseSha?: string;
  requiredContracts?: readonly { name: string; version: string }[];
}

export function validateImplementationEvidence(evidence: ImplementationEvidenceV3, options: EvidenceValidationOptions = {}): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  if (options.expectedBaseSha && evidence.baseSha !== options.expectedBaseSha)
    issues.push(issue('STALE_BASE_SHA', `Evidence base ${evidence.baseSha} does not match the accepted base ${options.expectedBaseSha}.`));
  for (const required of options.requiredContracts ?? []) {
    const actual = evidence.dependencyContracts.find(item => item.name === required.name);
    if (!actual) issues.push(issue('CONTRACT_MISSING', `Dependency contract ${required.name} is not covered.`));
    else if (actual.version !== required.version) issues.push(issue('CONTRACT_MISMATCH', `Dependency contract ${required.name} is ${actual.version}, expected ${required.version}.`));
    else if (!actual.testIds.length) issues.push(issue('CONTRACT_UNTESTED', `Dependency contract ${required.name} names no contract tests.`));
  }
  for (const phase of evidence.phases) issues.push(...validatePhaseEvidence(phase));
  return issues;
}
