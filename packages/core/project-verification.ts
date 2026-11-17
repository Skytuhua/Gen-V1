import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, createReadStream, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HarnessError, type Thread } from '../contracts/index.ts';
import type { ProjectSummary } from '../contracts/workspace.ts';
import { approvalSchema, type ApprovalV1, type ToolOwner } from '../contracts/tool-effects.ts';
import {
  checkObservationV1Schema, verificationRecipeV1Schema, type CheckObservationV1, type RecipePhase,
  type VerificationRecipeV1,
} from '../contracts/verification.ts';
import { canonical, inside } from './security.ts';
import { hostFlagEnabled } from './host-flags.ts';
import { digest, type Store } from '../storage/store.ts';
import { VerificationArtifactStore } from './verification-artifacts.ts';

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
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

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
  async runRecipe(owner: ToolOwner, request: RecipeExecutionRequest, launcher: VerificationLauncher, probe?: ListenerProbe): Promise<RecipeExecutionResult> {
    this.assertEnabled();
    const recipe = this.store.all<VerificationRecipeV1>('verificationRecipe', owner.threadId).find(value => value.recipeId === request.recipeId);
    if (!recipe) throw new HarnessError('NOT_FOUND', 'Verification recipe is unavailable');
    const executionId = request.executionId ?? `exec-${randomUUID()}`;
    const root = await canonical(recipe.workspaceIdentity.canonicalPath);
    const info = await stat(root, { bigint: true });
    if (String(info.dev) !== recipe.workspaceIdentity.dev || String(info.ino) !== recipe.workspaceIdentity.ino)
      throw new HarnessError('BLOCKED_SOURCE_DRIFT', 'BLOCKED_SOURCE_DRIFT: the workspace identity no longer matches the approved recipe');

    const dependencyDigest = await sourceDigest(root, request.dependencyFiles);
    let outcome: RecipeExecutionResult['outcome'] = 'PASS';
    const observations: CheckObservationV1[] = [];
    const cleanupFailures: string[] = [];
    const owned: LaunchedProcess[] = [];
    let halted = false;

    const recordPhase = async (phase: RecipePhase, run: () => Promise<{ exitCode: number | null; outcome: CheckObservationV1['outcome']; artifactRefs: string[]; detail?: string }>) => {
      // Fresh digests immediately before execution.
      const codeDigest = await sourceDigest(root, request.sourceFiles);
      const startedAt = now();
      const cwd = await canonical(join(root, ...phase.relativeCwd.split('/')));
      if (!inside(root, cwd)) throw new HarnessError('CAPABILITY_DENIED', 'A recipe cwd leaves the workspace root');
      const result = await run();
      // Recompute before accepting: a mid-check source edit marks freshness
      // STALE at read time; the observation keeps the digest it actually ran.
      observations.push(this.record(owner, {
        version: 1, checkId: '', executionId, owner,
        codeDigest, dependencyDigest, recipeDigest: recipeDigest(recipe), environmentId: environmentId(recipe),
        argv: [phase.executableId, ...phase.argv], cwdIdentity: cwd, phase: phase.name,
        startedAt, endedAt: now(), exitCode: result.exitCode, outcome: result.outcome,
        artifactRefs: result.artifactRefs, observationKind: phase.name === 'READINESS' ? 'readiness' : phase.name === 'TEARDOWN' ? 'cleanup' : 'process',
        ...(result.detail ? { detail: result.detail.slice(0, 2000) } : {}),
      }));
      return result;
    };

    const artifacts = new VerificationArtifactStore(this.store);
    const captureLog = async (process: LaunchedProcess): Promise<string[]> => {
      const log = await process.log();
      if (typeof log.text !== 'string' || typeof log.truncated !== 'boolean') throw new HarnessError('INVALID_PROCESS_EVIDENCE', 'Observed process log is malformed');
      // Clip by UTF-8 bytes and drop an incomplete final code point. The host
      // adapter has already redacted destination-bound secrets before this read.
      const prefix = Buffer.from(log.text.slice(0, MAX_LOG_BYTES), 'utf8');
      const text = new TextDecoder('utf-8').decode(prefix.subarray(0, MAX_LOG_BYTES), {stream: true});
      const bytes = Buffer.from(text, 'utf8');
      const retained = artifacts.write({owner, executionId, kind: 'LOG', bytes, truncated: log.truncated || bytes.length < Buffer.byteLength(log.text, 'utf8')});
      return [retained.ref];
    };

    try {
    for (const phase of recipe.phases) {
      if (phase.name === 'TEARDOWN') continue;
      if (phase.name === 'READINESS') {
        if (halted) break;
        const readiness = request.readiness;
        if (!readiness || !probe) {
          await recordPhase(phase, async () => ({ exitCode: null, outcome: 'BLOCKED', artifactRefs: [], detail: 'No approved readiness endpoint or probe was supplied' }));
          halted = true; outcome = 'BLOCKED';
          continue;
        }
        const launched = owned.at(-1);
        const tree = launched ? new Set(await launched.tree().catch(() => [] as number[])) : new Set<number>();
        const result = await recordPhase(phase, async () => {
          const check = await probe.probe(readiness);
          if (!check.reachable) return { exitCode: null, outcome: 'FAIL' as const, artifactRefs: [], detail: 'The approved endpoint did not respond' };
          if (check.ownerPid === null || !tree.has(check.ownerPid))
            return { exitCode: null, outcome: 'BLOCKED' as const, artifactRefs: [], detail: 'READINESS_OWNER_UNPROVEN' };
          return { exitCode: 0, outcome: 'PASS' as const, artifactRefs: [] };
        });
        if (result.outcome !== 'PASS') { halted = true; outcome = result.outcome === 'FAIL' ? 'FAIL' : 'BLOCKED'; }
        continue;
      }
      if (halted) break;
      if (phase.name === 'BROWSER') {
        // Browser phases execute through the approved checklist runner with a
        // fresh profile and the strict step union — never an arbitrary launch.
        const result = await recordPhase(phase, async () => ({ exitCode: null, outcome: 'BLOCKED' as const, artifactRefs: [], detail: 'BROWSER phases run through runBrowserChecklist' }));
        if (result.outcome === 'BLOCKED') { halted = true; outcome = 'BLOCKED'; }
        continue;
      }
      if (phase.name === 'START') {
        // START launches a long-running server: it stays owned and alive past a
        // bounded settle window instead of waiting for exit. Early exit fails
        // the phase; serving is proven separately by READINESS, and teardown
        // terminates it in the guaranteed cleanup below.
        const result = await recordPhase(phase, async () => {
          try {
            const process = await launcher.launch({ executableId: phase.executableId, argv: phase.argv, cwd: join(root, ...phase.relativeCwd.split('/')), envRefs: phase.environmentRefs, timeoutMs: phase.timeoutMs });
            owned.push(process);
            const settled = await Promise.race([process.wait(), delay(Math.min(phase.timeoutMs, START_SETTLE_MS)).then(() => null)]);
            const artifactRefs = await captureLog(process);
            if (settled === null) return { exitCode: null, outcome: 'PASS' as const, artifactRefs, detail: 'START process stayed alive through the settle window; readiness is proven by the READINESS phase' };
            if (settled.termination === 'CANCELLED') return { exitCode: settled.exitCode, outcome: 'CANCELLED' as const, artifactRefs };
            if (settled.termination === 'SPAWN_ERROR') return { exitCode: settled.exitCode, outcome: 'BLOCKED' as const, artifactRefs, detail: 'Launch failed inside the permitted execution environment' };
            return { exitCode: settled.exitCode, outcome: 'FAIL' as const, artifactRefs, detail: 'START process exited before readiness was proven' };
          } catch (error) {
            if (error instanceof HarnessError && error.code === 'CANCELLED_RUN') return { exitCode: null, outcome: 'CANCELLED' as const, artifactRefs: [] };
            return { exitCode: null, outcome: 'BLOCKED' as const, artifactRefs: [], detail: error instanceof Error ? error.message.slice(0, 500) : 'Launch failed' };
          }
        });
        if (result.outcome === 'FAIL') { halted = true; outcome = 'FAIL'; }
        else if (result.outcome === 'BLOCKED') { halted = true; outcome = 'BLOCKED'; }
        else if (result.outcome === 'CANCELLED') { halted = true; outcome = 'CANCELLED'; }
        continue;
      }
      const result = await recordPhase(phase, async () => {
        try {
          const process = await launcher.launch({ executableId: phase.executableId, argv: phase.argv, cwd: join(root, ...phase.relativeCwd.split('/')), envRefs: phase.environmentRefs, timeoutMs: phase.timeoutMs });
          owned.push(process);
          const settled = await process.wait();
          const artifactRefs = await captureLog(process);
          if (settled.termination === 'TIMEOUT') return { exitCode: settled.exitCode, outcome: 'FAIL' as const, artifactRefs, detail: 'Phase timed out' };
          if (settled.termination === 'CANCELLED') return { exitCode: settled.exitCode, outcome: 'CANCELLED' as const, artifactRefs };
          if (settled.termination === 'SPAWN_ERROR') return { exitCode: settled.exitCode, outcome: 'BLOCKED' as const, artifactRefs, detail: 'Launch failed inside the permitted execution environment' };
          return { exitCode: settled.exitCode, outcome: settled.exitCode === 0 ? 'PASS' as const : 'FAIL' as const, artifactRefs };
        } catch (error) {
          if (error instanceof HarnessError && error.code === 'CANCELLED_RUN') return { exitCode: null, outcome: 'CANCELLED' as const, artifactRefs: [] };
          return { exitCode: null, outcome: 'BLOCKED' as const, artifactRefs: [], detail: error instanceof Error ? error.message.slice(0, 500) : 'Launch failed' };
        }
      });
      if (result.outcome === 'FAIL') { halted = true; outcome = 'FAIL'; }
      else if (result.outcome === 'BLOCKED') { halted = true; outcome = 'BLOCKED'; }
      else if (result.outcome === 'CANCELLED') { halted = true; outcome = 'CANCELLED'; }
    }
    } finally {
    // Cleanup runs unconditionally for resources this recipe actually launched —
    // including when a phase threw outside its own error handling.
    const teardownPhase = recipe.phases.find(phase => phase.name === 'TEARDOWN');
    const startedAt = now();
    for (const process of owned) {
      try { await process.terminate(); }
      catch (error) { cleanupFailures.push(error instanceof Error ? error.message.slice(0, 300) : 'Owned process cleanup failed'); }
    }
    if (teardownPhase || cleanupFailures.length) {
      try {
      observations.push(this.record(owner, {
        version: 1, checkId: '', executionId, owner,
        codeDigest: await sourceDigest(root, request.sourceFiles).catch(() => '0'.repeat(64)),
        dependencyDigest, recipeDigest: recipeDigest(recipe), environmentId: environmentId(recipe),
        argv: [], cwdIdentity: root, phase: 'TEARDOWN',
        startedAt, endedAt: now(), exitCode: cleanupFailures.length ? null : 0,
        outcome: cleanupFailures.length ? 'FAIL' : 'PASS',
        artifactRefs: [], observationKind: 'cleanup',
        ...(cleanupFailures.length ? { detail: cleanupFailures.join('; ').slice(0, 2000) } : {}),
      }));
      } catch (error) {
        // Cleanup evidence must never mask the original phase failure.
        cleanupFailures.push(error instanceof Error ? error.message.slice(0, 300) : 'Cleanup evidence could not be recorded');
      }
    }
    }
    // A successful command cannot establish a clean verification run while
    // its owned resources remain live or cleanup evidence could not be saved.
    if (cleanupFailures.length && outcome === 'PASS') outcome = 'FAIL';
    return { executionId, observations, cleanupFailures, outcome };
  }
}
