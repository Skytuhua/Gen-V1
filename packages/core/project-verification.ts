import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, createReadStream, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HarnessError, type Thread } from '../contracts/index.ts';
import type { ProjectSummary } from '../contracts/workspace.ts';
import { approvalSchema, type ApprovalV1, type ToolOwner } from '../contracts/tool-effects.ts';
import {
  checkObservationV1Schema, verificationRecipeV1Schema, type CheckObservationV1, type RecipePhase,
  type VerificationRecipeV1, type BrowserChecklistV1,
} from '../contracts/verification.ts';
import { canonical, inside } from './security.ts';
import { hostFlagEnabled } from './host-flags.ts';
import { digest, type Store } from '../storage/store.ts';
import { VerificationArtifactStore } from './verification-artifacts.ts';
import { runBrowserChecklist, type BrowserDriver } from './browser-verification.ts';
import { observationMatchesThreadOwner } from './verification-gate.ts';

/** M06 project verification: approved recipes run through a fixed phase order
 * against an explicit, previously approved workspace identity. Every check
 * observation binds the code/dependency/recipe/environment digests and the
 * exact argv/cwd that ran; freshness is derived later, never rewritten here.
 * The service decides and records — an authorized launcher supplies the actual
 * execution inside the M03 permitted execution environment. */

const now = () => new Date().toISOString();
const MAX_DIGEST_FILE_BYTES = 64 * 1024 * 1024;
// Shared host limits, including synchronous completion reads inside Store.
const MAX_DIGEST_TOTAL_BYTES = 128 * 1024 * 1024;
const DIGEST_CHUNK_BYTES = 64 * 1024;
const MAX_DIGEST_FILES = 2048;
const MAX_LOG_BYTES = 64 * 1024;
/** A START server must stay alive past this bounded settle window; the
 * READINESS phase then proves it actually serves the approved endpoint. */
const START_SETTLE_MS = 2_000;
async function executionDeadline<T>(action: () => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined, aborted = () => {};
  try {
    if (signal?.aborted) throw new HarnessError('CANCELLED_RUN', 'Verification execution was cancelled');
    const cancelled = new Promise<never>((_, reject) => {aborted = () => reject(new HarnessError('CANCELLED_RUN', 'Verification execution was cancelled')); signal?.addEventListener('abort', aborted, {once: true});});
    const timeout = new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new HarnessError('VERIFICATION_TIMEOUT', 'Verification phase exceeded its approved deadline')), timeoutMs);});
    return await Promise.race([action(), timeout, cancelled]);
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', aborted);}
}
async function settleStart(wait: ReturnType<LaunchedProcess['wait']>, timeoutMs: number): Promise<Awaited<ReturnType<LaunchedProcess['wait']>> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([wait, new Promise<null>(resolve => {timer = setTimeout(() => resolve(null), timeoutMs);})]);}
  finally {clearTimeout(timer);}
}

export interface LaunchedProcess {
  /** Host-level identity of the launched root process, for ownership checks. */
  pid: number;
  /** PIDs this launch owns (root + observed children). */
  tree(): Promise<number[]>;
  wait(): Promise<{ exitCode: number | null; termination: 'NONE' | 'TIMEOUT' | 'CANCELLED' | 'SPAWN_ERROR' }>;
  /** Terminate only this process tree; never unrelated processes. */
  terminate(): Promise<void>;
  log(): Promise<{ text: string; truncated: boolean }>;
}

/** The authorized launcher: the only execution path. The host composes it from
 * the M03 approved backend — recipes never reach an arbitrary shell. */
export interface VerificationLauncher {
  launch(request: { executableId: string; argv: string[]; cwd: string; envRefs: string[]; timeoutMs: number }): Promise<LaunchedProcess>;
}

export interface ListenerProbe {
  /** Probe one approved loopback endpoint; report the owning PID when the
   * platform can establish it. */
  probe(endpoint: { host: string; port: number; path: string }): Promise<{ reachable: boolean; ownerPid: number | null }>;
}

/** Digest capture over source/config/lockfile inputs a recipe declares. A
 * changed file during a check makes the observation stale for current code
 * even when the process exited 0; a bare HEAD SHA is never sufficient for a
 * dirty worktree. */
export async function sourceDigest(root: string, files: readonly string[]): Promise<string> {
  const base = await canonical(root);
  const items: { path: string; sha256: string }[] = [];
  let totalBytes = 0;
  if (files.length > MAX_DIGEST_FILES) throw new HarnessError('RESOURCE_LIMIT', 'Digest input exceeds the file limit');
  for (const relative of files.slice().sort()) {
    const candidate = await canonical(join(base, ...relative.split('/')));
    if (!inside(base, candidate)) throw new HarnessError('CAPABILITY_DENIED', 'A digest input leaves the workspace root');
    const info = await stat(candidate, { bigint: true });
    if (!info.isFile()) throw new HarnessError('INVALID_RESOURCE', 'Digest inputs must be regular files');
    assertDigestSize(info.size, totalBytes);
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(candidate)) {
      bytes += (chunk as Buffer).length;
      totalBytes += (chunk as Buffer).length;
      assertDigestRead(bytes, totalBytes);
      hash.update(chunk as Buffer);
    }
    items.push({ path: relative, sha256: hash.digest('hex') });
  }
  return digest(items);
}

/** Synchronous variant for contexts that may not await (completion projection
 * inside Store callbacks). Same hashing semantics and the same bounds. */
export function sourceDigestSync(root: string, files: readonly string[]): string {
  if (files.length > MAX_DIGEST_FILES) throw new HarnessError('RESOURCE_LIMIT', 'Digest input exceeds the file limit');
  const base = canonicalSync(root);
  const items: { path: string; sha256: string }[] = [];
  let totalBytes = 0;
  const chunk = Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
  for (const relative of files.slice().sort()) {
    const candidate = canonicalSync(join(base, ...relative.split('/')));
    if (!inside(base, candidate)) throw new HarnessError('CAPABILITY_DENIED', 'A digest input leaves the workspace root');
    const fd = openSync(candidate, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = fstatSync(fd, { bigint: true });
      if (!info.isFile()) throw new HarnessError('INVALID_RESOURCE', 'Digest inputs must be regular files');
      assertDigestSize(info.size, totalBytes);
      const hash = createHash('sha256');
      let bytes = 0, count: number;
      while ((count = readSync(fd, chunk, 0, chunk.length, null)) !== 0) {
        bytes += count; totalBytes += count;
        assertDigestRead(bytes, totalBytes);
        hash.update(chunk.subarray(0, count));
      }
      items.push({ path: relative, sha256: hash.digest('hex') });
    } finally { closeSync(fd); }
  }
  return digest(items);
}

function assertDigestSize(bytes: bigint, priorBytes: number): void {
  if (bytes > BigInt(MAX_DIGEST_FILE_BYTES)) throw new HarnessError('RESOURCE_LIMIT', 'Digest input exceeds the per-file size limit');
  if (bytes > BigInt(MAX_DIGEST_TOTAL_BYTES - priorBytes)) throw new HarnessError('RESOURCE_LIMIT', 'Digest inputs exceed the combined size limit');
}

function assertDigestRead(fileBytes: number, totalBytes: number): void {
  if (fileBytes > MAX_DIGEST_FILE_BYTES) throw new HarnessError('RESOURCE_LIMIT', 'Digest input exceeds the per-file size limit');
  if (totalBytes > MAX_DIGEST_TOTAL_BYTES) throw new HarnessError('RESOURCE_LIMIT', 'Digest inputs exceed the combined size limit');
}

function canonicalSync(path: string): string {
  // Resolves symlinks/junctions to the real path; inside() still guards the root boundary.
  return realpathSync.native(path);
}

/** A model-supplied declaration is not a filesystem grant. Validate the
 * current main-thread project and physical working copy before hashing it. */
export function assertVerificationSourceRoot(store: Store, threadId: string, rootPath: string): void {
  const denied = () => new HarnessError('CAPABILITY_DENIED', 'Verification sources require the current attested project working copy.');
  try {
    const thread = store.get<Thread>('thread', threadId);
    const project = thread?.projectId ? store.get<ProjectSummary>('workspaceProject', thread.projectId) : null;
    type PhysicalRoot = {path: string; identity: {dev: string; ino: string}};
    const root = project ? store.get<PhysicalRoot>('workspaceProjectRoot', project.id) : null;
    if (!thread || !project || project.authority.kind !== 'local' || thread.sideParentId || thread.kind === 'side' || thread.kind === 'delegate' || store.get('archivedThread', threadId) || !root) throw denied();
    const attest = (value: PhysicalRoot) => {
      const info = lstatSync(value.path, {bigint: true});
      if (!info.isDirectory() || info.isSymbolicLink() || resolve(canonicalSync(value.path)) !== resolve(value.path) || String(info.dev) !== value.identity.dev || String(info.ino) !== value.identity.ino) throw denied();
    };
    attest(root);
    const workspace = thread.workspaceId ? store.get<PhysicalRoot & {id: string; threadId: string; projectId: string}>('workspaceBinding', thread.workspaceId) : null;
    if (thread.workspaceId && (!workspace || workspace.id !== thread.workspaceId || workspace.threadId !== threadId || workspace.projectId !== project.id)) throw denied();
    if (workspace) attest(workspace);
    if (resolve(rootPath) !== resolve((workspace ?? root).path)) throw denied();
  } catch { throw denied(); }
}

export function recipeDigest(recipe: VerificationRecipeV1): string {
  return digest({ environment: recipe.environment, phases: recipe.phases });
}

export function environmentId(recipe: VerificationRecipeV1): string {
  return `${recipe.environment.platform}/${recipe.environment.nodeVersion}/${recipe.environment.packageManager ?? 'unknown'}`;
}

/** A recipe registration or change requires an M02 exact approval: a stored
 * ApprovalV1 whose actionCommitment binds this recipe's digest and workspace
 * identity, with remaining uses and a live expiry, owned by this thread. */
export function recipeApprovalCommitment(recipe: VerificationRecipeV1): string {
  return digest({ kind: 'verification.recipe.register', recipeId: recipe.recipeId, version: recipe.version, revision: recipe.revision, recipeDigest: recipeDigest(recipe), workspaceIdentity: recipe.workspaceIdentity });
}

function consumeRecipeApproval(store: Store, approvalId: string, recipe: VerificationRecipeV1, owner: ToolOwner): void {
  const raw = store.get<ApprovalV1>('approval', approvalId);
  let approval: ApprovalV1;
  try { approval = approvalSchema.parse(raw); } catch { throw new HarnessError('APPROVAL_REQUIRED', 'Recipe approval is unavailable or malformed'); }
  if (digest(approval.owner) !== digest(owner)) throw new HarnessError('APPROVAL_REQUIRED', 'Recipe approval belongs to another owner binding');
  if (approval.remainingUses < 1 || approval.expiresAt <= now()) throw new HarnessError('APPROVAL_REQUIRED', 'Recipe approval expired or was already consumed');
  if (approval.actionCommitment !== recipeApprovalCommitment(recipe)) throw new HarnessError('APPROVAL_REQUIRED', 'The approved recipe changed; approve the current recipe again');
  store.put('approval', approvalId, approval.owner.threadId, { ...approval, remainingUses: 0 });
}

export interface RecipeExecutionRequest {
  executionId?: string;
  recipeId: string;
  /** Source files the checks must bind (relative to the workspace root). */
  sourceFiles: string[];
  /** Dependency manifests the checks must bind (e.g. ['pnpm-lock.yaml']). */
  dependencyFiles: string[];
  /** The approved loopback endpoint the START phase must own. */
  readiness?: { host: '127.0.0.1' | 'localhost'; port: number; path: string };
  /** Historical compatibility only; retained bytes always use host custody. */
  artifactDir?: string;
}

export interface RecipeExecutionResult {
  executionId: string;
  observations: CheckObservationV1[];
  cleanupFailures: string[];
  outcome: 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED';
}

/** Host-composed controls. No model or RPC input can supply executor objects,
 * environment identity, current-authority callbacks or cleanup capabilities. */
export interface RecipeExecutionControl {
  signal?: AbortSignal;
  assertCurrent?: () => void;
  environmentId?: string;
  expectedSource?: {codeDigest: string; dependencyDigest: string};
  browser?: {checklist: BrowserChecklistV1; driver: BrowserDriver; profileDir: string};
  cleanup?: () => Promise<void>;
}

export class ProjectVerificationService {
  constructor(private readonly store: Store, private readonly env: Readonly<Record<string, string | undefined>> = process.env) {}

  private assertEnabled(): void {
    if (!hostFlagEnabled('verification.workflowV1', this.env))
      throw new HarnessError('CAPABILITY_DENIED', 'The verification workflow capability is disabled on this host.', { flag: 'verification.workflowV1' });
  }

  recipe(recipeId: string): VerificationRecipeV1 | null {
    return this.store.get<VerificationRecipeV1>('verificationRecipe', recipeId);
  }

  /** Register or replace a recipe inside one host transaction. M02 approval is
   * consumed exactly once, in the same transaction that persists the recipe. */
  registerRecipe(recipe: VerificationRecipeV1, approvalId: string, owner: ToolOwner): VerificationRecipeV1 {
    this.assertEnabled();
    const parsed = verificationRecipeV1Schema.parse(recipe);
    const committed = recipeDigest(parsed);
    if (parsed.approvedDigest !== committed)
      throw new HarnessError('RECIPE_DIGEST_MISMATCH', 'Recipe approvedDigest must equal the canonical digest of its phases and environment');
    let recorded!: VerificationRecipeV1;
    this.store.internal('verification.recipe.registered', owner.threadId, () => {
      const prior = this.store.get<VerificationRecipeV1>('verificationRecipe', parsed.recipeId);
      if (prior && !this.store.all<VerificationRecipeV1>('verificationRecipe', owner.threadId).some(value => value.recipeId === parsed.recipeId))
        throw new HarnessError('CAPABILITY_DENIED', 'A recipe belongs to another thread');
      consumeRecipeApproval(this.store, approvalId, parsed, owner);
      if (parsed.revision !== (prior?.revision ?? 0) + 1)
        throw new HarnessError('RECIPE_REVISION', 'A recipe registration must approve the exact next revision');
      recorded = parsed;
      this.store.put('verificationRecipe', parsed.recipeId, owner.threadId, recorded);
      return { recipeId: parsed.recipeId, revision: recorded.revision };
    });
    return recorded;
  }

  observations(threadId?: string): CheckObservationV1[] {
    return this.store.all<CheckObservationV1>('checkObservation', threadId);
  }

  /** External advisory evidence (M07 diagnostics and debug observations):
   * written through the same append-only path as executed checks so
   * task_finish evidence and the verification panel read them with identical
   * freshness semantics. The kind is pinned to 'review-advisory' — advisory
   * records inform review but never satisfy a declared requirement. */
  recordAdvisory(owner: ToolOwner, advisory: Omit<CheckObservationV1, 'checkId' | 'observationKind' | 'owner'>): CheckObservationV1 {
    this.assertEnabled();
    const parsed = checkObservationV1Schema.omit({ checkId: true, observationKind: true, owner: true }).parse(advisory);
    return this.record(owner, { ...parsed, owner, checkId: '', observationKind: 'review-advisory' });
  }

  /** Append-only: an observation is written once and never updated. Freshness
   * is derived per read; history keeps the recorded outcome. */
  private record(owner: ToolOwner, observation: CheckObservationV1): CheckObservationV1 {
    const id = `obs-${randomUUID()}`;
    const stored = { ...observation, checkId: id };
    this.store.internal('checkObservation.recorded', owner.threadId, () => {
      this.store.put('checkObservation', id, owner.threadId, stored);
      return stored;
    });
    return stored;
  }

  /** Run an approved recipe through its fixed phase order. A failed phase
   * prevents START/BROWSER phases; cleanup always runs for processes this
   * recipe launched and is recorded separately. */
  async runRecipe(owner: ToolOwner, request: RecipeExecutionRequest, launcher: VerificationLauncher, probe?: ListenerProbe, control: RecipeExecutionControl = {}): Promise<RecipeExecutionResult> {
    this.assertEnabled();
    const saved = this.store.all<VerificationRecipeV1>('verificationRecipe', owner.threadId).find(value => value.recipeId === request.recipeId);
    if (!saved) throw new HarnessError('NOT_FOUND', 'Verification recipe is unavailable');
    const recipe = verificationRecipeV1Schema.parse(saved), committedRecipe = recipeDigest(recipe);
    if (recipe.approvedDigest !== committedRecipe) throw new HarnessError('BLOCKED_SOURCE_DRIFT', 'The stored recipe no longer matches its approved digest');
    const executionId = request.executionId ?? `exec-${randomUUID()}`, root = await canonical(recipe.workspaceIdentity.canonicalPath);
    const info = await stat(root, {bigint: true});
    if (!info.isDirectory() || String(info.dev) !== recipe.workspaceIdentity.dev || String(info.ino) !== recipe.workspaceIdentity.ino)
      throw new HarnessError('BLOCKED_SOURCE_DRIFT', 'BLOCKED_SOURCE_DRIFT: the workspace identity no longer matches the approved recipe');
    const assertCurrent = () => {
      const thread = this.store.get<Thread>('thread', owner.threadId);
      if (control.signal?.aborted || !observationMatchesThreadOwner({owner}, thread) || thread?.runId !== owner.runId || thread?.epoch !== owner.epoch || this.store.get('archivedThread', owner.threadId))
        throw new HarnessError('CANCELLED_RUN', 'Verification execution owner was cancelled or changed');
      control.assertCurrent?.();
      const current = lstatSync(root, {bigint: true});
      if (!current.isDirectory() || current.isSymbolicLink() || String(current.dev) !== recipe.workspaceIdentity.dev || String(current.ino) !== recipe.workspaceIdentity.ino || digest(this.recipe(recipe.recipeId)) !== digest(recipe))
        throw new HarnessError('BLOCKED_SOURCE_DRIFT', 'BLOCKED_SOURCE_DRIFT: approved workspace or recipe changed');
    };
    assertCurrent();
    const readCut = async () => ({codeDigest: await sourceDigest(root, request.sourceFiles), dependencyDigest: await sourceDigest(root, request.dependencyFiles)});
    const initial = await readCut(); assertCurrent();
    if (control.expectedSource && digest(initial) !== digest(control.expectedSource))
      throw new HarnessError('BLOCKED_SOURCE_DRIFT', 'BLOCKED_SOURCE_DRIFT: source or dependencies changed after exact approval');
    const environment = control.environmentId ?? environmentId(recipe);
    const observations: CheckObservationV1[] = [], cleanupFailures: string[] = [], owned: LaunchedProcess[] = [];
    const artifacts = new VerificationArtifactStore(this.store);
    let outcome: RecipeExecutionResult['outcome'] = 'PASS', closing = false, ready = false, started: LaunchedProcess | undefined;
    let startExit: Awaited<ReturnType<LaunchedProcess['wait']>> | undefined, startError: unknown;
    type PhaseResult = {exitCode: number | null; outcome: RecipeExecutionResult['outcome']; artifactRefs: string[]; detail?: string};
    const errorResult = (error: unknown): PhaseResult => {
      try {assertCurrent();} catch (changed) {error = changed;}
      const code = error instanceof HarnessError ? error.code : '';
      return {exitCode: null, outcome: code === 'CANCELLED_RUN' || code === 'CANCELLED' ? 'CANCELLED' : code === 'VERIFICATION_TIMEOUT' || code === 'VERIFICATION_START_EXITED' ? 'FAIL' : 'BLOCKED', artifactRefs: [], detail: error instanceof Error ? error.message.slice(0, 500) : 'Observed execution is unavailable'};
    };
    const record = (phase: RecipePhase, cut: typeof initial, cwd: string, startedAt: string, result: PhaseResult) => {
      const argv = phase.name === 'BROWSER' && control.browser ? ['browser-checklist', control.browser.checklist.checklistId] : phase.name === 'READINESS' && request.readiness ? ['listener-probe', `http://${request.readiness.host}:${request.readiness.port}${request.readiness.path}`] : phase.name === 'TEARDOWN' ? [] : [phase.executableId, ...phase.argv];
      const observed = this.record(owner, {version: 1, checkId: '', executionId, owner, ...cut, recipeDigest: committedRecipe, environmentId: environment,
        argv, cwdIdentity: cwd, phase: phase.name, startedAt, endedAt: now(), exitCode: result.exitCode, outcome: result.outcome, artifactRefs: result.artifactRefs,
        observationKind: phase.name === 'READINESS' ? 'readiness' : phase.name === 'TEARDOWN' ? 'cleanup' : 'process', ...(result.detail ? {detail: result.detail.slice(0, 2000)} : {})});
      observations.push(observed);
    };
    const captureLog = async (process: LaunchedProcess, guard: () => void): Promise<string[]> => {
      guard(); const log = await process.log(); guard();
      if (typeof log.text !== 'string' || typeof log.truncated !== 'boolean') throw new HarnessError('INVALID_PROCESS_EVIDENCE', 'Observed process log is malformed');
      const prefix = Buffer.from(log.text.slice(0, MAX_LOG_BYTES), 'utf8');
      const text = new TextDecoder('utf-8').decode(prefix.subarray(0, MAX_LOG_BYTES), {stream: true}), bytes = Buffer.from(text, 'utf8');
      return [artifacts.write({owner, executionId, kind: 'LOG', bytes, truncated: log.truncated || bytes.length < Buffer.byteLength(log.text, 'utf8')}).ref];
    };
    const launch = async (phase: RecipePhase, cwd: string, guard: () => void): Promise<LaunchedProcess> => {
      guard();
      const process = await launcher.launch({executableId: phase.executableId, argv: phase.argv, cwd, envRefs: phase.environmentRefs, timeoutMs: phase.timeoutMs});
      if (closing) {await executionDeadline(() => process.terminate(), 15_000); throw new HarnessError('CANCELLED_RUN', 'A late launch was closed after execution stopped');}
      owned.push(process); guard(); return process;
    };
    const recordPhase = async (phase: RecipePhase, run: (cut: typeof initial, cwd: string, guard: () => void, signal: AbortSignal) => Promise<PhaseResult>): Promise<PhaseResult> => {
      let cut = initial, cwd = root, result: PhaseResult;
      const startedAt = now(), phaseStop = new AbortController(), signal = control.signal ? AbortSignal.any([control.signal, phaseStop.signal]) : phaseStop.signal;
      const guard = () => {
        if (closing || signal.aborted) throw new HarnessError('CANCELLED_RUN', 'Verification phase stopped');
        assertCurrent();
        if (phase.name !== 'START' && startExit) throw new HarnessError('VERIFICATION_START_EXITED', 'START process exited while verification was still running');
        if (phase.name !== 'START' && startError) throw new HarnessError('INVALID_PROCESS_EVIDENCE', 'The owned START process state became unavailable');
      };
      try {
        guard(); cut = await readCut(); guard();
        if (digest(cut) !== digest(initial)) throw new HarnessError('BLOCKED_SOURCE_DRIFT', 'BLOCKED_SOURCE_DRIFT: source or dependencies changed before the next phase');
        cwd = await canonical(join(root, ...phase.relativeCwd.split('/'))); guard();
        if (!inside(root, cwd)) throw new HarnessError('CAPABILITY_DENIED', 'A recipe cwd leaves the workspace root');
        result = await executionDeadline(() => run(cut, cwd, guard, signal), phase.timeoutMs, signal); guard();
      } catch (error) {result = errorResult(error);}
      finally {phaseStop.abort();}
      record(phase, cut, cwd, startedAt, result);
      if (result.outcome === 'PASS') {
        try {
          assertCurrent(); const after = await readCut(); assertCurrent();
          if (digest(after) !== digest(cut)) throw new HarnessError('BLOCKED_SOURCE_DRIFT', 'BLOCKED_SOURCE_DRIFT: source or dependencies changed during the observed phase');
        } catch (error) {
          result = errorResult(error);
          if (result.outcome === 'BLOCKED' && !result.detail?.includes('BLOCKED_SOURCE_DRIFT')) result.detail = 'BLOCKED_SOURCE_DRIFT: source evidence became unavailable after execution';
          record(phase, cut, cwd, startedAt, result);
        }
      }
      return result;
    };
    const validTermination = (value: Awaited<ReturnType<LaunchedProcess['wait']>>) => {
      if (!['NONE', 'TIMEOUT', 'CANCELLED', 'SPAWN_ERROR'].includes(value.termination) || value.exitCode !== null && !Number.isSafeInteger(value.exitCode))
        throw new HarnessError('INVALID_PROCESS_EVIDENCE', 'Observed process exit is malformed');
      return value;
    };

    try {
      for (const phase of recipe.phases) {
        if (phase.name === 'TEARDOWN') continue;
        const result = await recordPhase(phase, async (cut, cwd, guard, signal) => {
          if (phase.name === 'READINESS') {
            if (!request.readiness || !probe || !started) return {exitCode: null, outcome: 'BLOCKED', artifactRefs: [], detail: 'No approved readiness endpoint, owned START process or listener probe was supplied'};
            guard(); const check = await probe.probe(request.readiness); guard();
            const tree = await started.tree(); guard();
            if (typeof check.reachable !== 'boolean' || !Array.isArray(tree) || tree.length > 4096 || tree.some(pid => !Number.isSafeInteger(pid) || pid < 1)) throw new HarnessError('INVALID_PROCESS_EVIDENCE', 'Observed listener ownership is malformed');
            if (!check.reachable) return {exitCode: null, outcome: 'FAIL', artifactRefs: [], detail: 'The approved endpoint did not respond'};
            if (check.ownerPid === null || !tree.includes(check.ownerPid)) return {exitCode: null, outcome: 'BLOCKED', artifactRefs: [], detail: 'READINESS_OWNER_UNPROVEN'};
            ready = true; return {exitCode: 0, outcome: 'PASS', artifactRefs: []};
          }
          if (phase.name === 'BROWSER') {
            const browser = control.browser;
            if (!browser || !ready) return {exitCode: null, outcome: 'BLOCKED', artifactRefs: [], detail: 'BROWSER requires the approved checklist, managed browser and successful owned readiness'};
            const result = await runBrowserChecklist(this.store, {owner, executionId, ...browser, digests: {...cut, recipeDigest: committedRecipe, environmentId: environment}, signal, assertCurrent: guard}, this.env);
            observations.push(...result.observations);
            return {exitCode: result.outcome === 'PASS' ? 0 : null, outcome: result.outcome, artifactRefs: [], detail: 'Executed the approved checklist through the owned browser service'};
          }
          const process = await launch(phase, cwd, guard);
          if (phase.name === 'START') {
            started = process;
            const waiting = process.wait().then(value => {startExit = value; return value;}, error => {startError = error; throw error;});
            void waiting.catch(() => {});
            const settled = await settleStart(waiting, Math.min(phase.timeoutMs, START_SETTLE_MS)); guard();
            const artifactRefs = await captureLog(process, guard);
            if (settled === null) return {exitCode: null, outcome: 'PASS', artifactRefs, detail: 'START process stayed alive through the settle window; readiness is proven by the READINESS phase'};
            validTermination(settled);
            return {exitCode: settled.exitCode, outcome: settled.termination === 'CANCELLED' ? 'CANCELLED' : settled.termination === 'SPAWN_ERROR' ? 'BLOCKED' : 'FAIL', artifactRefs, detail: 'START process exited before readiness was proven'};
          }
          const settled = validTermination(await process.wait()); guard();
          const artifactRefs = await captureLog(process, guard);
          return {exitCode: settled.exitCode, outcome: settled.termination === 'CANCELLED' ? 'CANCELLED' : settled.termination === 'SPAWN_ERROR' ? 'BLOCKED' : settled.termination === 'TIMEOUT' || settled.exitCode !== 0 ? 'FAIL' : 'PASS', artifactRefs,
            ...(settled.termination === 'TIMEOUT' ? {detail: 'Phase timed out'} : settled.termination === 'SPAWN_ERROR' ? {detail: 'Launch failed inside the permitted execution environment'} : {})};
        });
        if (result.outcome !== 'PASS') {outcome = result.outcome; break;}
      }
    } finally {
      closing = true;
      const startedAt = now(), results = await Promise.allSettled(owned.map(process => executionDeadline(() => process.terminate(), 15_000)));
      for (const result of results) if (result.status === 'rejected') cleanupFailures.push(result.reason instanceof Error ? result.reason.message.slice(0, 300) : 'Owned process cleanup failed');
      if (control.cleanup) try {await executionDeadline(control.cleanup, 15_000);} catch (error) {cleanupFailures.push(error instanceof Error ? error.message.slice(0, 300) : 'Owned executor cleanup failed');}
      const teardown = recipe.phases.find(phase => phase.name === 'TEARDOWN') ?? {...recipe.phases[0]!, name: 'TEARDOWN' as const};
      if (owned.length || control.cleanup || recipe.phases.some(phase => phase.name === 'TEARDOWN')) {
        try {record(teardown, initial, root, startedAt, {exitCode: cleanupFailures.length ? null : 0, outcome: cleanupFailures.length ? 'FAIL' : 'PASS', artifactRefs: [], ...(cleanupFailures.length ? {detail: cleanupFailures.join('; ')} : {})});}
        catch (error) {cleanupFailures.push(error instanceof Error ? error.message.slice(0, 300) : 'Cleanup evidence could not be recorded');}
      }
    }
    if (cleanupFailures.length && outcome === 'PASS') outcome = 'FAIL';
    if (outcome === 'PASS') {
      try {assertCurrent(); const final = await readCut(); assertCurrent(); if (digest(final) !== digest(initial)) throw new HarnessError('BLOCKED_SOURCE_DRIFT', 'BLOCKED_SOURCE_DRIFT: source or dependencies changed before cleanup settled');}
      catch (error) {const result = errorResult(error); outcome = result.outcome; record({...recipe.phases[0]!, name: 'TEARDOWN'}, initial, root, now(), result);}
    }
    return {executionId, observations, cleanupFailures, outcome};
  }
}
