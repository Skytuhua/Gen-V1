import { stat } from 'node:fs/promises';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import { executionProfileV1Schema, isTrustedHostProfile, type ExecutionProfileV1 } from '../contracts/execution-profile.ts';
import { toolOwnerSchema, type ToolOwner } from '../contracts/tool-effects.ts';
import { digest } from '../storage/store.ts';
import { canonical, inside } from './security.ts';
import { digestFileSha256, selectBackend, type ApprovedLaunch, type ExecutionBackend } from './execution-policy.ts';
import { hostFlagEnabled } from './host-flags.ts';
import { canonicalRootIdentity, trustScopeCovers, type ProjectTrustLedger, type RootIdentity } from './project-trust.ts';
import type { SecretReferenceLedger } from './secret-references.ts';
import type { BrowserDriver } from './browser-verification.ts';
import type { LaunchedProcess, ListenerProbe } from './project-verification.ts';

export interface VerificationExecutorBinding {
  readonly profile: ExecutionProfileV1;
  readonly profileDigest: string;
  readonly backendId: string;
  readonly platformProofRef: string;
  readonly environmentId: string;
  readonly browserRequired: boolean;
  readonly rootIdentity: RootIdentity;
  readonly executables: readonly { readonly id: string; readonly canonicalPath: string; readonly sha256: string }[];
}
export interface VerificationExecutionFence {
  readonly owner: ToolOwner;
  readonly signal: AbortSignal;
  /** Service checks the complete current owner and the admitted operation. */
  readonly assertCurrent: () => void;
}
export interface VerificationBackendScope extends VerificationExecutionFence {
  readonly executionId: string;
  readonly binding: VerificationExecutorBinding;
  readonly approvedOrigins: readonly string[];
}
export interface ManagedVerificationBrowserDriver extends BrowserDriver { readonly profileDir: string; close(): Promise<void> }
export interface ObservedVerificationBackend extends ExecutionBackend {
  /** The approved backend owns atomic confinement, the observed handle and
   * tree cleanup. It repeats assertCurrent immediately before native spawn. */
  launchObserved(request: ApprovedLaunch & {
    environment: Readonly<Record<string, string>>; timeoutMs: number;
    rootIdentities: readonly RootIdentity[]; executableIdentity: { dev: string; ino: string };
    signal: AbortSignal; assertCurrent: () => void;
  }): Promise<LaunchedProcess>;
  probeListener?: ListenerProbe['probe'];
  /** Prepare only the capability and exact private profile scope, without
   * starting a browser process or navigating. BrowserDriver.launch performs
   * native startup only when the consumer reaches its admitted BROWSER step
   * after build/test/readiness. The backend owns that process and profile;
   * its scope must never be added to ordinary build/test write roots. */
  openBrowserDriver?: (scope: VerificationBackendScope) => Promise<ManagedVerificationBrowserDriver>;
}
export interface VerificationExecutorHostConfig {
  readonly approvedBackendId: string | null;
  readonly backends: readonly ObservedVerificationBackend[];
  readonly profiles: readonly {
    profile: ExecutionProfileV1; trustId: string;
    projectId: string; workspaceId: string | null; accountBinding: string | null;
  }[];
  readonly executables: readonly { id: string; path: string }[];
  readonly trust: ProjectTrustLedger;
  readonly secrets: SecretReferenceLedger;
  /** Explicit nonsecret child environment only. Never pass process.env. */
  readonly environment: Readonly<Record<string, string>>;
  readonly flags: Readonly<Record<string, string | undefined>>;
}
export interface DescribeVerificationExecutor extends VerificationExecutionFence {
  readonly rootPath: string;
  readonly profileId: string;
  readonly executableIds: readonly string[];
  readonly approvedOrigins: readonly string[];
  readonly browserRequired?: boolean;
}
export const executorDenied = (code: string, message: string) => new HarnessError(code, message);
export function assertExecutionFence(input: VerificationExecutionFence): void {
  if (input.signal.aborted) throw executorDenied('CANCELLED', 'Verification was cancelled.');
  input.assertCurrent();
  if (input.signal.aborted) throw executorDenied('CANCELLED', 'Verification was cancelled.');
}
export async function checkedExecution<T>(input: VerificationExecutionFence, action: () => Promise<T>): Promise<T> {
  assertExecutionFence(input);
  const value = await action();
  assertExecutionFence(input);
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function exactOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== value)
    throw executorDenied('INVALID_INPUT', 'Verification requires exact HTTP origins without credentials or paths.');
  return value;
}
interface BasisWitness { canonicalPath: string; kind: 'file' | 'directory'; dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string; nlink: string; sha256?: string; maxBytes?: number }
const changedBasis = () => executorDenied('EXECUTION_BINDING_CHANGED', 'Verification execution basis changed.');
const WITNESS_CHUNK_BYTES = 1024 * 1024;
// Match ProjectTrust's approved-file and execution-policy's executable bounds.
export const MAX_APPROVED_FILE_BYTES = 64 * 1024 * 1024, MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;
/** Timestamp granularity is a coarse clock tick on Linux and two seconds on
 * FAT-family and some network filesystems, so a same-length in-place rewrite
 * can leave every stat field untouched. The witness therefore pins the bytes
 * of the inode it measured, read through a no-follow descriptor whose identity
 * is rechecked against that measurement. */
function witnessBytesDigest(path: string, identity: BasisWitness): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const value = fstatSync(fd, { bigint: true });
    const unchanged = (current: typeof value) => current.isFile() && (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'] as const).every(key => String(current[key]) === identity[key]);
    if (!unchanged(value)) throw changedBasis();
    let remaining = Number(value.size);
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(Math.min(WITNESS_CHUNK_BYTES, Math.max(1, remaining)));
    while (remaining > 0) {
      const read = readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
      if (read === 0) throw changedBasis();
      hash.update(buffer.subarray(0, read)); remaining -= read;
    }
    // Read at most the measured length plus one byte. A concurrent append must
    // not turn this synchronous admission fence into an unbounded read.
    if (readSync(fd, buffer, 0, 1, null) !== 0 || !unchanged(fstatSync(fd, { bigint: true }))) throw changedBasis();
    return hash.digest('hex');
  } finally { closeSync(fd); }
}
function basisWitness(path: string, kind: BasisWitness['kind'], maxBytes = MAX_APPROVED_FILE_BYTES): BasisWitness {
  try {
    const value = lstatSync(path, { bigint: true });
    if ((kind === 'file' ? !value.isFile() : !value.isDirectory()) || realpathSync(path) !== path) throw changedBasis();
    const witness: BasisWitness = { canonicalPath: path, kind, dev: String(value.dev), ino: String(value.ino), size: String(value.size), mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs), nlink: String(value.nlink) };
    if (kind === 'file') {
      if (value.size > BigInt(maxBytes)) throw changedBasis();
      witness.maxBytes = maxBytes; witness.sha256 = witnessBytesDigest(path, witness);
    }
    return witness;
  } catch { throw changedBasis(); }
}
function assertWitnesses(witnesses: readonly BasisWitness[]): void {
  for (const witness of witnesses) if (digest(basisWitness(witness.canonicalPath, witness.kind, witness.maxBytes)) !== digest(witness)) throw changedBasis();
}

/** The public descriptor is approval metadata, never launch authority. A
 * WeakMap retains its custody and opening spends that exact object once. */
export function createVerificationBindingAuthority(config: VerificationExecutorHostConfig) {
  const records = new WeakMap<VerificationExecutorBinding, {
    input: DescribeVerificationExecutor; used: boolean; backend: ObservedVerificationBackend;
    launch: ObservedVerificationBackend['launchObserved']; probe: ObservedVerificationBackend['probeListener']; browser: ObservedVerificationBackend['openBrowserDriver'];
    basis: { authorityAtStart: string; trustId: string; trustDigest: string; witnesses: readonly BasisWitness[] };
  }>();
  const hostState = () => digest({ profiles: config.profiles, executables: config.executables, approvedBackendId: config.approvedBackendId,
    backends: config.backends.map(({ backendId, platform, installed, approved, proof }) => ({ backendId, platform, installed, approved, proof })),
    environment: config.environment, flags: config.flags, secrets: config.secrets.list() });
  async function inspect(input: DescribeVerificationExecutor) {
    assertExecutionFence(input);
    const authorityAtStart = hostState();
    const owner = toolOwnerSchema.parse(input.owner);
    if (!owner.threadId || !owner.projectId) throw executorDenied('CAPABILITY_DENIED', 'Verification requires a project owner.');
    for (const flag of ['verification.workflowV1', 'security.executionProfilesV1', 'security.projectTrustV1'] as const)
      if (!hostFlagEnabled(flag, config.flags)) throw executorDenied('CAPABILITY_DISABLED', 'Verification execution is disabled on this host.');
    const matches = config.profiles.filter(entry => entry.profile.profileId === input.profileId && entry.projectId === owner.projectId && entry.workspaceId === owner.workspaceId && entry.accountBinding === owner.accountBinding);
    if (matches.length !== 1) throw executorDenied('EXECUTION_PROFILE_UNAVAILABLE', 'No unique host profile covers this verification owner.');
    const registration = matches[0]!;
    const profile = executionProfileV1Schema.parse(registration.profile);
    if (isTrustedHostProfile(profile) || !profile.capabilities.includes('process.execute'))
      throw executorDenied('CAPABILITY_DENIED', 'Verification requires a confined process execution profile.');
    const selected = selectBackend(config.approvedBackendId, config.backends);
    if (selected.status !== 'SELECTED') throw executorDenied(selected.status, selected.reason);
    const backend = selected.backend as ObservedVerificationBackend;
    const methods = { launch: backend.launchObserved, probe: backend.probeListener, browser: backend.openBrowserDriver };
    if (backend.backendId !== profile.backendId || typeof backend.launchObserved !== 'function')
      throw executorDenied('UNSUPPORTED_BACKEND', 'The approved backend cannot provide observed verification execution.');
    if (backend.platform !== process.platform || backend.proof?.platform !== process.platform || backend.proof?.status !== 'PASS' || !backend.proof.evidenceRef || !Number.isFinite(Date.parse(backend.proof.recordedAt)) || backend.proof.platformProofRef !== profile.platformProofRef)
      throw executorDenied('PLATFORM_PROOF_REQUIRED', 'Verification requires the current platform proof and its evidence reference.');
    const origins = [...new Set(input.approvedOrigins.map(exactOrigin))].sort();
    if (origins.length > 64 || input.approvedOrigins.length !== origins.length)
      throw executorDenied('INVALID_INPUT', 'Verification origins must be unique and bounded.');
    const permitted = profile.networkPolicy.mode === 'allowlist' ? profile.networkPolicy.origins.map(exactOrigin) : [];
    if (origins.some(origin => !permitted.includes(origin))) throw executorDenied('CAPABILITY_DENIED', 'Browser origins exceed the approved execution profile.');
    if (input.browserRequired !== undefined && typeof input.browserRequired !== 'boolean') throw executorDenied('INVALID_INPUT', 'Browser admission must be an explicit boolean.');
    const browserRequired = input.browserRequired === true;
    if (browserRequired && (!origins.length || !backend.openBrowserDriver)) throw executorDenied('UNSUPPORTED_BACKEND', 'The approved backend has no admitted managed browser scope.');
    const root = await checkedExecution(input, () => canonicalRootIdentity(input.rootPath));
    const witnesses: BasisWitness[] = [];
    const capture = (path: string, kind: BasisWitness['kind'], expected?: { dev: string; ino: string }, maxBytes?: number) => {
      const witness = basisWitness(path, kind, maxBytes);
      if (expected && (witness.dev !== expected.dev || witness.ino !== expected.ino)) throw changedBasis();
      witnesses.push(witness);
    };
    capture(root.canonicalPath, 'directory', root);
    const roots: RootIdentity[] = [];
    for (const path of [...profile.readRoots, ...profile.writeRoots]) {
      const identity = await checkedExecution(input, () => canonicalRootIdentity(path));
      if (!inside(root.canonicalPath, identity.canonicalPath)) throw executorDenied('CAPABILITY_DENIED', 'Verification file roots must stay inside the current project.');
      capture(identity.canonicalPath, 'directory', identity);
      roots.push(identity);
    }
    const envelope = config.trust.get(registration.trustId);
    if (!envelope || envelope.revokedAt) throw executorDenied('PROJECT_TRUST_INVALIDATED', 'The project trust decision is unavailable.');
    const trust = structuredClone(envelope.record);
    for (const approved of trust.approvedDigests) capture(join(root.canonicalPath, ...approved.path.split('/')), 'file');
    const valid = await checkedExecution(input, () => config.trust.verify(registration.trustId, root.canonicalPath));
    if (valid.status !== 'CURRENT' || digest(config.trust.get(registration.trustId)) !== digest(envelope))
      throw executorDenied('PROJECT_TRUST_INVALIDATED', 'The project trust decision changed.');
    if (!roots.length || !trustScopeCovers(trust.scope, { read: profile.readRoots.length > 0 || profile.capabilities.includes('fs.read'), write: profile.writeRoots.length > 0 || profile.capabilities.includes('fs.write'), network: profile.networkPolicy.mode }))
      throw executorDenied('CAPABILITY_DENIED', 'The verification profile exceeds the project trust scope.');
    if (!input.executableIds.length || input.executableIds.length > 64 || new Set(input.executableIds).size !== input.executableIds.length)
      throw executorDenied('INVALID_INPUT', 'Verification executables must be a nonempty bounded unique list.');
    const executables = [];
    for (const id of [...input.executableIds].sort()) {
      const registrations = config.executables.filter(entry => entry.id === id);
      if (registrations.length !== 1) throw executorDenied('EXECUTABLE_UNAVAILABLE', 'An executable id has no unique host registration.');
      const canonicalPath = await checkedExecution(input, () => canonical(registrations[0]!.path));
      const identity = await checkedExecution(input, () => stat(canonicalPath, { bigint: true }));
      if (!identity.isFile()) throw executorDenied('EXECUTABLE_UNAVAILABLE', 'Verification requires a regular executable file.');
      capture(canonicalPath, 'file', { dev: String(identity.dev), ino: String(identity.ino) }, MAX_EXECUTABLE_BYTES);
      const sha256 = await checkedExecution(input, () => digestFileSha256(canonicalPath));
      if (!profile.executableAllowlist.some(entry => entry.executableSha256 === sha256))
        throw executorDenied('EXECUTABLE_UNAVAILABLE', 'Executable bytes are not approved by this profile.');
      executables.push({ id, canonicalPath, sha256, dev: String(identity.dev), ino: String(identity.ino) });
    }
    const secretRefs = config.secrets.list().filter(entry => profile.secretRefs.includes(entry.refId));
    if (profile.secretRefs.length && (!hostFlagEnabled('security.secretRefsV1', config.flags) || secretRefs.length !== profile.secretRefs.length || secretRefs.some(entry => entry.revoked || !owner.accountBinding || entry.owner !== owner.accountBinding)))
      throw executorDenied('SECRET_REF_APPROVAL', 'Secret references require current account-bound host registration.');
    if (Object.keys(config.environment).length > 64 || Object.entries(config.environment).some(([name, value]) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || /secret|token|password|credential|key/i.test(name) || typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value) > 8192))
      throw executorDenied('INVALID_INPUT', 'Child environment requires a bounded nonsecret host allowlist.');
    if (hostState() !== authorityAtStart || digest(config.trust.get(registration.trustId)) !== digest(envelope) ||
        backend.launchObserved !== methods.launch || backend.probeListener !== methods.probe || backend.openBrowserDriver !== methods.browser)
      throw executorDenied('EXECUTION_BINDING_CHANGED', 'Execution authority changed during verification preparation.');
    const profileDigest = digest(profile);
    const binding: VerificationExecutorBinding = freeze({
      profile, profileDigest, backendId: backend.backendId, platformProofRef: profile.platformProofRef!, rootIdentity: root, browserRequired,
      executables: executables.map(({ id, canonicalPath, sha256 }) => ({ id, canonicalPath, sha256 })),
      environmentId: digest({ platform: process.platform, arch: process.arch, hostRuntime: process.version, root, roots, trust, proof: backend.proof, profileDigest, executables, origins, environment: config.environment, secretRefs }),
    });
    assertExecutionFence(input);
    assertWitnesses(witnesses);
    return { binding, backend, trust, origins, roots, executables, authorityAtStart, trustId: registration.trustId, trustDigest: digest(envelope), witnesses, methods };
  }
  return {
    async describe(input: DescribeVerificationExecutor): Promise<VerificationExecutorBinding> {
      const retained = { ...input, owner: toolOwnerSchema.parse(input.owner), executableIds: [...input.executableIds], approvedOrigins: [...input.approvedOrigins] };
      const basis = await inspect(retained), { binding, backend, methods } = basis;
      records.set(binding, { input: retained, used: false, backend, ...methods, basis });
      return binding;
    },
    /** Non-consuming synchronous fence for a read-side Store commit. Native
     * launch still requires take plus the backend's atomic dispatch boundary. */
    assertCurrent(binding: VerificationExecutorBinding, fence: VerificationExecutionFence): void {
      const record = records.get(binding);
      if (!record || digest(record.input.owner) !== digest(fence.owner)) throw executorDenied('CAPABILITY_DENIED', 'The verification binding is foreign or belongs to another owner.');
      const checkAuthority = () => {
        if (!config.backends.includes(record.backend) || record.backend.launchObserved !== record.launch || record.backend.probeListener !== record.probe || record.backend.openBrowserDriver !== record.browser ||
            hostState() !== record.basis.authorityAtStart || digest(config.trust.get(record.basis.trustId)) !== record.basis.trustDigest) throw changedBasis();
      };
      assertExecutionFence(fence); checkAuthority();
      assertWitnesses(record.basis.witnesses);
      assertExecutionFence(fence); checkAuthority();
    },
    async take(binding: VerificationExecutorBinding, fence: VerificationExecutionFence) {
      const record = records.get(binding);
      if (!record || record.used || digest(record.input.owner) !== digest(fence.owner))
        throw executorDenied('CAPABILITY_DENIED', 'The verification binding is foreign, spent or belongs to another owner.');
      record.used = true;
      let admitted: Awaited<ReturnType<typeof inspect>>;
      const assertCurrent = () => {
        assertExecutionFence(fence);
        if (!admitted || !config.backends.includes(record.backend) || record.backend.launchObserved !== record.launch || record.backend.probeListener !== record.probe || record.backend.openBrowserDriver !== record.browser || hostState() !== admitted.authorityAtStart || digest(config.trust.get(admitted.trustId)) !== admitted.trustDigest)
          throw executorDenied('EXECUTION_BINDING_CHANGED', 'Execution authority changed before native dispatch.');
      };
      const revalidate = async () => {
        const current = await inspect({ ...record.input, ...fence });
        if (digest(current.binding) !== digest(binding) || current.backend !== record.backend || current.backend.launchObserved !== record.launch || current.backend.probeListener !== record.probe || current.backend.openBrowserDriver !== record.browser)
          throw executorDenied('EXECUTION_BINDING_CHANGED', 'The approved verification environment changed.');
        admitted = current;
        return current;
      };
      const current = await revalidate();
      return { ...current, revalidate, assertCurrent };
    },
  };
}
