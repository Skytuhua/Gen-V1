import { z } from 'zod';

/**
 * Dependency vulnerability check contracts (plan r1, feature flag `workspace.dependencyCheckV1`).
 * Everything here is typed evidence: no provider payload is ever trusted without schema
 * validation, and no field carries raw lockfile bytes, absolute paths, or credentials.
 */

export const dependencyScanStatuses = ['prepared', 'running', 'complete', 'partial', 'unavailable', 'cancelled', 'stale'] as const;
export type DependencyScanStatus = typeof dependencyScanStatuses[number];
export const dependencyUpgradeStatuses = ['prepared', 'resolving', 'preview', 'applying', 'applied', 'stale', 'rejected', 'failed', 'uncertain'] as const;
export type DependencyUpgradeStatus = typeof dependencyUpgradeStatuses[number];
export const dependencyDirectness = ['direct', 'transitive', 'unknown'] as const;
export type DependencyDirectness = typeof dependencyDirectness[number];
export const dependencySeverities = ['critical', 'high', 'medium', 'low', 'unknown'] as const;
export type DependencySeverity = typeof dependencySeverities[number];
export const dependencyEcosystems = ['npm', 'pypi', 'crates.io', 'go'] as const;
export type DependencyEcosystem = typeof dependencyEcosystems[number];
/** Lockfile/dependency manifest grammars the inventory recognizes; only npm-lock-v2/v3 and pnpm-lock-v9 are scannable in v1. */
export const dependencyFormats = ['npm-lock-v2', 'npm-lock-v3', 'pnpm-lock-v9', 'yarn-lock-v1', 'yarn-berry', 'poetry-lock', 'uv-lock', 'requirements-txt', 'cargo-lock', 'go-sum', 'unknown'] as const;
export type DependencyFormat = typeof dependencyFormats[number];
export const dependencyCoverageStatuses = ['scanned', 'unsupported', 'oversized', 'unreadable', 'ambiguous_root', 'private_registry', 'excluded'] as const;
export type DependencyCoverageStatus = typeof dependencyCoverageStatuses[number];

const relPath = z.string().min(1).max(1024);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const versionPin = z.string().min(1).max(256);
const advisoryId = z.string().min(1).max(128);
const reasonCode = z.string().min(1).max(64);

export const dependencyCoverageItemSchema = z.strictObject({
  relativePath: relPath,
  format: z.enum(dependencyFormats),
  status: z.enum(dependencyCoverageStatuses),
  reason: reasonCode.optional(),
});
export type DependencyCoverageItem = z.input<typeof dependencyCoverageItemSchema>;

/** What a prepared scan is allowed to query: bound identity, digests and coverage — never the data itself. */
export const dependencyScanBasisSchema = z.strictObject({
  /** Opaque scope identity binding thread/project/working copy; not a path. */
  scopeKey: z.string().min(1).max(256),
  /** Canonical sha256 over sorted input file digests and root identity. */
  inputDigest: digest,
  coverage: z.array(dependencyCoverageItemSchema).max(256),
  eligibleTupleCount: z.number().int().nonnegative().max(5000),
  truncated: z.boolean(),
  /** Display-only origin for the optional GitHub source; not a credential or URL. */
  githubOrigin: z.strictObject({ owner: z.string().min(1).max(128), repo: z.string().min(1).max(128) }).optional(),
});
export type DependencyScanBasis = z.input<typeof dependencyScanBasisSchema>;

/** One exact pinned registry occurrence; private/unverified registry pins never appear here. */
export const dependencyOccurrenceSchema = z.strictObject({
  occurrenceId: z.string().min(1).max(256),
  ecosystem: z.enum(dependencyEcosystems),
  name: z.string().min(1).max(256),
  installedVersion: versionPin,
  directness: z.enum(dependencyDirectness),
  lockPath: relPath,
  importerPath: relPath.optional(),
});
export type DependencyOccurrence = z.input<typeof dependencyOccurrenceSchema>;

export const dependencyFindingSchema = z.strictObject({
  occurrence: dependencyOccurrenceSchema,
  advisoryIds: z.array(advisoryId).max(64),
  severity: z.enum(dependencySeverities),
  severitySource: z.string().min(1).max(128).optional(),
  /** Advisory-reported applicable fixed releases only — never "latest". */
  fixedVersions: z.array(versionPin).max(16),
  upgradeCandidate: versionPin.nullable(),
  candidateEligible: z.boolean(),
});
export type DependencyFinding = z.input<typeof dependencyFindingSchema>;

/** Supplementary GitHub repository alerts; never counted as local findings. */
export const dependencyRemoteAlertSchema = z.strictObject({
  package: z.string().min(1).max(256),
  manifestPath: z.string().max(1024).optional(),
  advisoryIds: z.array(advisoryId).max(64),
  severity: z.enum(dependencySeverities),
  firstPatched: versionPin.nullable(),
  /** True only when identity, advisory alias, manifest association and installed version all satisfy the local evidence. */
  matchedOccurrence: z.boolean(),
});
export type DependencyRemoteAlert = z.input<typeof dependencyRemoteAlertSchema>;

export const dependencyScanResultSchema = z.strictObject({
  scanId: z.string().min(1).max(128),
  status: z.enum(dependencyScanStatuses),
  checkedAt: z.string().min(1).max(64),
  scopeKey: z.string().min(1).max(256),
  inputDigest: digest,
  fresh: z.boolean(),
  coverage: z.array(dependencyCoverageItemSchema).max(256),
  queriedCount: z.number().int().nonnegative().max(5000),
  findings: z.array(dependencyFindingSchema).max(500),
  remoteAlerts: z.array(dependencyRemoteAlertSchema).max(500),
  remoteAlertState: z.enum(['not_requested', 'available', 'unavailable', 'partial']),
  nextCursor: z.string().min(1).max(2048).optional(),
});
export type DependencyScanResult = z.input<typeof dependencyScanResultSchema>;

/** Host-owned inventory snapshot: the local evidence a prepared scan is sealed to. */
export const dependencyInventorySnapshotSchema = z.strictObject({
  scopeKey: z.string().min(1).max(256),
  inputDigest: digest,
  coverage: z.array(dependencyCoverageItemSchema).max(256),
  occurrences: z.array(dependencyOccurrenceSchema).max(5000),
  capturedAt: z.string().min(1).max(64),
});
export type DependencyInventorySnapshot = z.input<typeof dependencyInventorySnapshotSchema>;
