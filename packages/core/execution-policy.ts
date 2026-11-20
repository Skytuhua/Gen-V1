import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { canonical, inside } from './security.ts';
import { HarnessError } from '../contracts/index.ts';
import { hostFlagEnabled } from './host-flags.ts';
import { verifyProjectTrust, trustScopeCovers, type TrustVerification } from './project-trust.ts';
import {
  executionProfileV1Schema, isTrustedHostProfile,
  type ExecutionProfileV1, type ProjectTrustV1, type ProjectTrustScopeV1,
} from '../contracts/execution-profile.ts';

/** Explicit execution boundary. A child process, a clean package scan or a
 * path check is never a sandbox: confinement exists only when an installed,
 * independently approved backend enforces the declared file, process and
 * network policy at launch, proven by a PASS platform proof. This module
 * decides; it never launches and never falls back to trusted host execution. */

export type LaunchRequest =
  | { kind: 'executable'; executable: string; argv: string[]; cwd: string }
  | { kind: 'shell'; command: string; cwd: string };

export interface PlatformProof {
  platformProofRef: string;
  platform: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNTESTED';
  recordedAt: string;
  evidenceRef?: string;
}

export interface ExecutionHandle { id: string; terminate(): Promise<void> }
export interface ApprovedLaunch {
  profileId: string; profileVersion: number;
  executable: string; executableSha256: string; argv: string[]; cwd: string;
  readRoots: string[]; writeRoots: string[];
  networkPolicy: ExecutionProfileV1['networkPolicy'];
  secretRefs: string[];
}
export interface ExecutionBackend {
  backendId: string;
  platform: string;
  installed: boolean;
  /** Independently approved by the operator/source lock — not by this code. */
  approved: boolean;
  proof: PlatformProof | null;
  launch(request: ApprovedLaunch): Promise<ExecutionHandle>;
}

/** A proof is valid only for the backend and host platform that it tested. */
export function hasCurrentPlatformProof(backend: ExecutionBackend): boolean {
  return backend.platform === process.platform && backend.proof?.status === 'PASS' &&
    backend.proof.platform === backend.platform;
}

/** Every host launch boundary — execution, debugger, language server — needs
 * the same admission: one installed, approved backend proven for this host. */
export function assertProvenBackend(backends: readonly ExecutionBackend[], approvedBackendId: string | null | undefined): void {
  const selection = selectBackend(approvedBackendId, backends);
  if (selection.status !== 'SELECTED' || !selection.backend || !hasCurrentPlatformProof(selection.backend))
    throw new HarnessError('UNSUPPORTED', 'A host launch requires an installed, approved backend with a PASS platform proof for this host platform.');
}

export type BackendSelection =
  | { status: 'SELECTED'; backend: ExecutionBackend }
  | { status: 'BLOCKED_BACKEND_SELECTION'; reason: string }
  | { status: 'UNSUPPORTED_BACKEND'; reason: string };

/** One explicit approvedBackendId supplied by the operator/source lock must
 * resolve to exactly one installed, independently approved backend. This
 * function never chooses a backend itself. */
export function selectBackend(approvedBackendId: string | null | undefined, backends: readonly ExecutionBackend[]): BackendSelection {
  if (!approvedBackendId || !approvedBackendId.trim()) {
    return { status: 'UNSUPPORTED_BACKEND', reason: 'No approved execution backend was supplied by the operator/source lock; executable stages stay disabled.' };
  }
  const matches = backends.filter(backend => backend.backendId === approvedBackendId && backend.installed && backend.approved);
  if (matches.length === 0) return { status: 'BLOCKED_BACKEND_SELECTION', reason: 'No installed, independently approved backend matches the supplied id.' };
  if (matches.length > 1) return { status: 'BLOCKED_BACKEND_SELECTION', reason: 'The supplied backend id is ambiguous.' };
  return { status: 'SELECTED', backend: matches[0]! };
}

/** Arbitrary shell text is always a single effectful command. Unknown syntax
 * can never become read-only through a pattern match. */
export function classifyShellCommand(_command: string): { effectful: true; effect: 'shell'; reason: string } {
  return { effectful: true, effect: 'shell', reason: 'Arbitrary shell expressions are effectful commands requiring explicit approval and confinement.' };
}

export const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;
export async function digestFileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_EXECUTABLE_BYTES) throw new HarnessError('RESOURCE_LIMIT', 'Executable exceeds the digest size limit');
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export interface AdvisoryRisk {
  label: 'Advisory';
  classifier: string;
  model: string;
  version: string;
  uncertainty: 'low' | 'medium' | 'high';
  rationale: string;
  cannotAuthorize: true;
}

/** Deterministic advisory classifier. It runs after the authority decision,
 * explains why approval is required, and can never convert DENY to ALLOW. */
export function advisoryRiskAssessment(request: LaunchRequest, profile: Pick<ExecutionProfileV1, 'executableAllowlist'>): AdvisoryRisk {
  let uncertainty: AdvisoryRisk['uncertainty'] = 'low';
  let rationale = 'The launch matches the approved executable allowlist.';
  if (request.kind === 'shell') { uncertainty = 'high'; rationale = 'Arbitrary shell syntax is effectful and cannot be classified as read-only.'; }
  else if (!profile.executableAllowlist.some(entry => entry.argv.length === request.argv.length && entry.argv.every((arg, i) => arg === request.argv[i]))) {
    uncertainty = 'medium'; rationale = 'The executable or argument vector is not an approved exact match.';
  }
  return { label: 'Advisory', classifier: 'execution-policy-advisory', model: 'deterministic-v1', version: '1.0.0', uncertainty, rationale, cannotAuthorize: true };
}

export type ExecutionDecision =
  | { status: 'ALLOW'; backendId: string; unrestricted?: boolean; launch: ApprovedLaunch; policy: Record<string, unknown> }
  | { status: 'REQUIRE_APPROVAL'; effect: 'process' | 'shell'; effectful: true; reasons: string[]; advisory: AdvisoryRisk }
  | { status: 'DENY'; reasons: string[]; advisory?: AdvisoryRisk }
  | { status: 'BLOCKED'; code: 'BLOCKED_BACKEND_SELECTION' | 'UNSUPPORTED_BACKEND' | 'PLATFORM_PROOF_REQUIRED' | 'PROJECT_TRUST_DISABLED' | 'SECRET_REFS_DISABLED'; reasons: string[] }
  | { status: 'DISABLED'; flag: string; reasons: string[] };

export interface EvaluateExecutionInput {
  profile: unknown;
  request: LaunchRequest;
  trust?: ProjectTrustV1 | null;
  trustRootPath?: string;
  approvedBackendId?: string | null;
  backends?: readonly ExecutionBackend[];
  env?: Readonly<Record<string, string | undefined>>;
  explicitTrustedHost?: boolean;
}

const flagEnv = (input: EvaluateExecutionInput) => input.env ?? process.env;
const blocked = (code: Extract<ExecutionDecision, { status: 'BLOCKED' }>['code'], reasons: string[]): ExecutionDecision => ({ status: 'BLOCKED', code, reasons });

export async function evaluateExecution(input: EvaluateExecutionInput): Promise<ExecutionDecision> {
  const env = flagEnv(input);
  if (!hostFlagEnabled('security.executionProfilesV1', env)) {
    return { status: 'DISABLED', flag: 'security.executionProfilesV1', reasons: ['The execution profiles capability is disabled on this host.'] };
  }
  let profile: ExecutionProfileV1;
  try { profile = executionProfileV1Schema.parse(input.profile); }
  catch { return { status: 'DENY', reasons: ['The execution profile is malformed.'] }; }

  // TRUSTED_HOST is explicitly labeled unrestricted and is never an automatic
  // fallback: it applies only when the caller selects it on purpose.
  if (isTrustedHostProfile(profile)) {
    if (!input.explicitTrustedHost) return { status: 'DENY', reasons: ['TRUSTED_HOST requires an explicit trusted-host selection; it is never an automatic fallback.'] };
    return {
      status: 'ALLOW', backendId: 'TRUSTED_HOST', unrestricted: true,
      launch: { profileId: profile.profileId, profileVersion: profile.version, executable: '', executableSha256: '', argv: [], cwd: input.request.cwd, readRoots: profile.readRoots, writeRoots: profile.writeRoots, networkPolicy: profile.networkPolicy, secretRefs: [] },
      policy: { unrestricted: true, label: 'TRUSTED_HOST' },
    };
  }

  if (profile.secretRefs.length && !hostFlagEnabled('security.secretRefsV1', env)) {
    return { status: 'DENY', reasons: ['The profile references secret refs while security.secretRefsV1 is disabled.'] };
  }

  const request = input.request;
  const advisory = () => advisoryRiskAssessment(request, profile);
  const deny = (reasons: string[]): ExecutionDecision => ({ status: 'DENY', reasons, advisory: advisory() });
  const requireApproval = (effect: 'process' | 'shell', reasons: string[]): ExecutionDecision => ({ status: 'REQUIRE_APPROVAL', effect, effectful: true, reasons, advisory: advisory() });

  // Project trust is its own sub-capability and its own proof.
  if (!hostFlagEnabled('security.projectTrustV1', env)) {
    return blocked('PROJECT_TRUST_DISABLED', ['The project trust capability is disabled on this host.']);
  }
  if (!input.trust) return requireApproval(request.kind === 'shell' ? 'shell' : 'process', ['No current project trust decision covers this launch.']);
  const rootPath = input.trustRootPath ?? input.trust.root.canonicalPath;
  let verification: TrustVerification;
  try { verification = await verifyProjectTrust(input.trust, rootPath); }
  catch { return deny(['Project trust could not be verified.']); }
  if (verification.status !== 'CURRENT') return deny([`Project trust is invalidated: ${verification.reasons.join(', ')}`]);

  const requestedScope: ProjectTrustScopeV1 = {
    read: profile.readRoots.length > 0 || profile.capabilities.includes('fs.read'),
    write: profile.writeRoots.length > 0 || profile.capabilities.includes('fs.write'),
    network: profile.networkPolicy.mode === 'allowlist' ? 'allowlist' : 'none',
  };
  if (!trustScopeCovers(input.trust.scope, requestedScope)) return deny(['The requested scope exceeds the trusted scope.']);

  // Working directory must stay inside the trusted root and a declared profile root.
  let cwdCanonical: string;
  try { cwdCanonical = await canonical(request.cwd); }
  catch { return deny(['The launch working directory is unavailable.']); }
  const trustedRoot = input.trust.root.canonicalPath;
  if (!inside(trustedRoot, cwdCanonical)) return deny(['The launch working directory leaves the trusted root.']);
  const profileRoots: string[] = [];
  for (const root of [...profile.readRoots, ...profile.writeRoots]) {
    try { profileRoots.push(await canonical(root)); } catch { /* an unavailable declared root cannot admit cwd */ }
  }
  if (!profileRoots.some(root => inside(root, cwdCanonical))) return deny(['The launch working directory is outside every declared profile root.']);

  if (request.kind === 'shell') return requireApproval('shell', [classifyShellCommand(request.command).reason]);

  let executableSha256: string;
  try { executableSha256 = await digestFileSha256(request.executable); }
  catch { return deny(['The executable could not be read for digest verification.']); }
  const approvedEntry = profile.executableAllowlist.find(entry =>
    entry.executableSha256 === executableSha256 &&
    entry.argv.length === request.argv.length && entry.argv.every((arg, index) => arg === request.argv[index]));
  if (!approvedEntry) return requireApproval('process', ['The executable digest or argument vector is not an approved exact match.']);

  const selection = selectBackend(input.approvedBackendId, input.backends ?? []);
  if (selection.status === 'UNSUPPORTED_BACKEND') return blocked('UNSUPPORTED_BACKEND', [selection.reason]);
  if (selection.status === 'BLOCKED_BACKEND_SELECTION') return blocked('BLOCKED_BACKEND_SELECTION', [selection.reason]);
  const backend = selection.backend;
  if (backend.backendId !== profile.backendId) {
    return deny(['The operator-approved backend does not match the backend declared by the execution profile.']);
  }
  if (!profile.platformProofRef || !hasCurrentPlatformProof(backend) || backend.proof?.platformProofRef !== profile.platformProofRef) {
    return blocked('PLATFORM_PROOF_REQUIRED', ['Launch requires a PASS proof for this host and backend platform matching the profile platformProofRef.']);
  }

  const launch: ApprovedLaunch = {
    profileId: profile.profileId, profileVersion: profile.version,
    executable: request.executable, executableSha256, argv: [...request.argv], cwd: cwdCanonical,
    readRoots: profile.readRoots, writeRoots: profile.writeRoots,
    networkPolicy: profile.networkPolicy, secretRefs: [...profile.secretRefs],
  };
  return {
    status: 'ALLOW', backendId: backend.backendId, launch,
    policy: {
      profileId: profile.profileId, version: profile.version, backendId: backend.backendId,
      executableSha256, executable: request.executable, argv: [...request.argv], cwd: cwdCanonical,
      readRoots: [...profile.readRoots], writeRoots: [...profile.writeRoots],
      networkPolicy: profile.networkPolicy, secretRefs: [...profile.secretRefs],
      capabilities: [...profile.capabilities], platformProofRef: profile.platformProofRef,
    },
  };
}
