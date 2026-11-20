import { z } from 'zod';

/** M03 trust, secret-reference, execution-profile and package-screening contracts.
 * These records carry identities, digests, scopes and decisions only. They never
 * carry secret values, raw environment dumps or low-entropy secret hashes. */

export const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const isoTimestamp = z.string().datetime();
const boundedText = (max: number) => z.string().min(1).max(max);

/** A path relative to the trusted root, using '/' separators. Never absolute,
 * never escaping the root, never a reparse alias by construction. */
export const rootRelativePathSchema = z.string().min(1).max(1024).refine(value =>
  !value.includes('\0') && !value.includes('\\') && !value.startsWith('/') &&
  !/^[a-zA-Z]:/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
'Expected a relative path inside the trusted root.');

/* ------------------------------------------------------------------ */
/* SecretRefV1 — opaque reference. Resolution happens inside the       */
/* authorized executor after approval; the value never enters this     */
/* record, model context or public journals.                           */
/* ------------------------------------------------------------------ */

const secretDestinationV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('process-env'),
    /** SHA-256 of the one approved executable allowed to receive this secret. */
    executableSha256: sha256HexSchema,
    envName: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
  }),
  z.strictObject({
    kind: z.literal('http-header'),
    origin: z.string().max(2048).refine(value => {
      try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
      catch { return false; }
    }, 'Use an HTTP or HTTPS origin without credentials.'),
    header: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/),
  }),
]);
export type SecretDestinationV1 = z.infer<typeof secretDestinationV1Schema>;

export const secretRefV1Schema = z.strictObject({
  version: z.literal(1),
  refId: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/),
  purpose: boundedText(200),
  owner: boundedText(200),
  destination: secretDestinationV1Schema,
});
export type SecretRefV1 = z.infer<typeof secretRefV1Schema>;

/* ------------------------------------------------------------------ */
/* ProjectTrustV1 — binds the canonical physical root identity, the    */
/* approved executable/configuration digests, the requested scope,     */
/* the explicit user decision and its revision. Root aliases or        */
/* changed bytes invalidate the applicable decision.                   */
/* ------------------------------------------------------------------ */

export const approvedDigestV1Schema = z.strictObject({
  path: rootRelativePathSchema,
  sha256: sha256HexSchema,
  kind: z.enum(['executable', 'configuration']),
});
export type ApprovedDigestV1 = z.infer<typeof approvedDigestV1Schema>;

export const projectTrustScopeV1Schema = z.strictObject({
  read: z.boolean(),
  write: z.boolean(),
  network: z.enum(['none', 'allowlist']),
});
export type ProjectTrustScopeV1 = z.infer<typeof projectTrustScopeV1Schema>;

export const projectTrustV1Schema = z.strictObject({
  version: z.literal(1),
  trustId: boundedText(100),
  root: z.strictObject({
    canonicalPath: boundedText(4096),
    identity: z.strictObject({ dev: boundedText(40), ino: boundedText(40) }),
  }),
  approvedDigests: z.array(approvedDigestV1Schema).max(256),
  scope: projectTrustScopeV1Schema,
  decision: z.enum(['trusted', 'declined']),
  decidedAt: isoTimestamp,
  revision: z.number().int().positive(),
});
export type ProjectTrustV1 = z.infer<typeof projectTrustV1Schema>;

/* ------------------------------------------------------------------ */
/* ExecutionProfileV1 — the declared confinement contract an approved  */
/* backend must enforce. WORKSPACE_EXECUTE_NO_NETWORK is the first     */
/* untrusted product profile. TRUSTED_HOST is explicitly labeled       */
/* unrestricted and is never an automatic fallback.                    */
/* ------------------------------------------------------------------ */

const EXECUTION_CAPABILITIES = ['process.execute', 'fs.read', 'fs.write', 'net.connect', 'secret.inject'] as const;


const networkPolicyV1Schema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({ mode: z.literal('allowlist'), origins: z.array(boundedText(2048)).min(1).max(256) }),
]);


const executableAllowlistEntryV1Schema = z.strictObject({
  executableSha256: sha256HexSchema,
  /** Exact approved argument vector (excluding the executable itself). */
  argv: z.array(z.string().max(4096)).max(64),
});


export const executionProfileV1Schema = z.strictObject({
  profileId: boundedText(100),
  version: z.number().int().positive(),
  /** Declared backend for untrusted profiles; TRUSTED_HOST carries ''. */
  backendId: z.string().max(100),
  capabilities: z.array(z.enum(EXECUTION_CAPABILITIES)).max(8),
  readRoots: z.array(boundedText(4096)).max(64),
  writeRoots: z.array(boundedText(4096)).max(64),
  networkPolicy: networkPolicyV1Schema,
  secretRefs: z.array(z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/)).max(64),
  executableAllowlist: z.array(executableAllowlistEntryV1Schema).max(64),
  platformProofRef: boundedText(200).nullable(),
});
export type ExecutionProfileV1 = z.infer<typeof executionProfileV1Schema>;

export const WORKSPACE_EXECUTE_NO_NETWORK = 'WORKSPACE_EXECUTE_NO_NETWORK' as const;
export const TRUSTED_HOST = 'TRUSTED_HOST' as const;
export function isTrustedHostProfile(profile: Pick<ExecutionProfileV1, 'profileId'>): boolean {
  return profile.profileId === TRUSTED_HOST;
}

/* ------------------------------------------------------------------ */
/* PackageScreeningV1 — advisory preflight for package activation.     */
/* Exact package/version/digest against a named advisory database and   */
/* its snapshot time. NO_KNOWN_MATCH is not safe or trusted; risk       */
/* advice is ADVISORY only and cannot authorize.                        */
/* ------------------------------------------------------------------ */

export const packageScreeningV1Schema = z.strictObject({
  version: z.literal(1),
  screeningId: boundedText(100),
  pkg: z.strictObject({
    name: boundedText(214),
    version: boundedText(100),
    digest: sha256HexSchema,
  }),
  source: z.strictObject({
    kind: z.enum(['registry', 'vcs', 'local']),
    locator: boundedText(2048),
  }),
  advisory: z.strictObject({
    database: boundedText(200),
    asOf: isoTimestamp,
  }),
  status: z.enum(['KNOWN_BAD', 'NO_KNOWN_MATCH', 'UNAVAILABLE']),
  decision: z.enum(['ALLOW', 'DENY', 'OPERATOR_EXCEPTION']),
  reason: boundedText(500),
  checkedAt: isoTimestamp,
  cacheAgeMs: z.number().int().nonnegative().nullable(),
});
export type PackageScreeningV1 = z.infer<typeof packageScreeningV1Schema>;

/* ------------------------------------------------------------------ */
/* ImplementationEvidenceV3 — machine-readable bundle evidence written */
/* to docs/implementation/v3/<bundle>-verification.json.                */
/* ------------------------------------------------------------------ */

const evidenceCommandV3Schema = z.strictObject({
  command: boundedText(500),
  cwd: boundedText(1000),
  exitCode: z.number().int().nullable(),
  result: z.enum(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']),
  logArtifact: boundedText(500).nullable(),
});
const evidenceStageResultV3Schema = z.strictObject({
  stage: boundedText(200),
  result: z.enum(['PASS', 'FAIL', 'BLOCKED', 'PARTIAL', 'NOT_RUN']),
  detail: boundedText(2000).optional(),
});
export const implementationEvidenceV3Schema = z.strictObject({
  version: z.literal(3),
  bundle: boundedText(40),
  generatedAt: isoTimestamp,
  base: z.strictObject({
    repository: boundedText(300),
    approvedBase: boundedText(100),
    baseSha: z.string().regex(/^[a-f0-9]{40}$/),
    auditAncestor: z.string().regex(/^[a-f0-9]{40}$/),
    branch: boundedText(200),
    worktree: boundedText(1000),
  }),
  dependencies: z.array(z.strictObject({
    contract: boundedText(40),
    status: z.enum(['VERIFIED', 'MISSING', 'DRIFTED', 'NOT_APPLICABLE']),
    evidence: boundedText(1000),
  })).max(20),
  results: z.strictObject({
    core: z.array(evidenceStageResultV3Schema).max(50),
    integration: z.array(evidenceStageResultV3Schema).max(50),
    platform: z.array(evidenceStageResultV3Schema).max(50),
  }),
  commands: z.array(evidenceCommandV3Schema).max(100),
  intendedNegatives: z.array(z.strictObject({
    case: boundedText(300),
    expected: boundedText(300),
    observed: boundedText(300),
    result: z.enum(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']),
  })).max(100),
  changedFiles: z.array(boundedText(500)).max(500),
  artifacts: z.array(boundedText(500)).max(200),
  migration: z.strictObject({
    status: z.enum(['NONE', 'APPLIED', 'PENDING']),
    detail: boundedText(1000),
  }),
  rollback: boundedText(2000),
  gates: z.array(z.strictObject({
    gate: boundedText(200),
    status: z.enum(['OPEN', 'SATISFIED', 'WAIVED', 'BLOCKED']),
    detail: boundedText(1000).optional(),
  })).max(50),
  outcome: z.enum(['IMPLEMENTED', 'PARTIAL', 'BLOCKED', 'FAIL']),
});
export type ImplementationEvidenceV3 = z.infer<typeof implementationEvidenceV3Schema>;
