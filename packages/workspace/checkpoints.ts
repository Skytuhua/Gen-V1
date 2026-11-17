import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { HarnessError } from "../contracts/index.ts";
import { readBoundFile, replaceOwnedFile, withPathGuard } from "../core/file-access.ts";
import type { Store } from "../storage/store.ts";
import {
  CHECKPOINT_V1_LIMITS,
  checkpointPathSchema,
  checkpointScopeSchema,
  checkpointV1Schema,
  provisionManifestV1Schema,
  repositoryGroupV1Schema,
  restorePlanV1Schema,
  type CheckpointScope,
  type CheckpointV1,
  type ProvisionManifestV1,
  type RepositoryGroupV1,
  type RestorePlanV1,
} from "../contracts/workspace-checkpoints.ts";
import { sha256hex } from "./edit-journal.ts";

// M08 file checkpoints and restores. Checkpoints capture exact bytes of
// approved text/code files through the path guard into a private blob store;
// excluded files stay visible as outside coverage. Restore is a separate
// protocol — never a widening of the read-only adapter — that requires the
// exact checkpoint, selected paths, a pre-restore checkpoint and an approval
// id, then writes per-file only when the preimage still matches. A conflict
// rolls back only bytes that still equal the written image; anything else is
// PARTIAL_RECOVERY_REQUIRED. No restore path ever touches Git refs or remotes.

export const CHECKPOINT_KIND = "workspaceCheckpoint" as const;
export const RESTORE_PLAN_KIND = "workspaceRestorePlan" as const;
export const REPOSITORY_GROUP_KIND = "workspaceRepositoryGroup" as const;
export const REPOSITORY_RECIPE_KIND = "workspaceRepositoryRecipe" as const;

// Adapter-visible cap: the frozen web contract lists at most 100 files.
export const ADAPTER_FILE_CAP = 100;
const REVIEW_DIFF_LIMIT = 128 * 1024;
const REVIEW_TTL_MS = 10 * 60 * 1000;

const SECRET_NAME = /(^|\.)(env|secrets?|credentials?|tokens?|keys?|id_rsa|id_dsa|id_ecdsa|id_ed25519|known_hosts|authorized_keys|htpasswd|netrc|npmrc|pypirc|aws_|kube|dockerconfig|session|cookie|accounts?)($|[._-])/i;
const SECRET_EXT = /\.(env|pem|key|p12|pfx|jks|keystore|ppk|der|crt|kdbx|asc|gpg)$/i;

const now = () => new Date().toISOString();

export interface StoredCheckpoint extends CheckpointV1 {
  label: string;
  provenance: { kind: "guarded_write" | "restore_backup"; operationId: string };
  expiresAt: string | null;
}

export interface StoredRestorePlan extends RestorePlanV1 {
  id: string;
  conflicts: string[];
  createdAt: string;
}

const isBinary = (data: Buffer) => data.includes(0);
const exclusionReason = (path: string, data: Buffer | null, statBytes?: number): "secret" | "binary" | "too_large" | "unsupported" | null => {
  const name = path.split("/").at(-1) ?? path;
  if (SECRET_NAME.test(name) || SECRET_EXT.test(name)) return "secret";
  if (!checkpointPathSchema.safeParse(path).success) return "unsupported";
  const size = statBytes ?? data?.length ?? 0;
  if (size > CHECKPOINT_V1_LIMITS.fileBytes) return "too_large";
  if (data && isBinary(data)) return "binary";
  return null;
};

// Bounded unified diff (context 3) between two utf-8 texts; truncates to the
// adapter's 128 KiB response limit and reports truncation.
export function unifiedDiff(path: string, before: Buffer | null, after: Buffer | null): { diff: string | null; truncated: boolean } {
  // Split without the phantom empty line a trailing newline produces. A last
  // line that lacks one is a different line from the same text that ends with
  // one, so it carries a sentinel: the sentinel is compared, never printed.
  const lines = (value: Buffer | null) => {
    const text = (value ?? Buffer.alloc(0)).toString("utf8");
    if (!text) return [] as string[];
    const parts = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
    if (!text.endsWith("\n")) parts[parts.length - 1] += "\n";
    return parts;
  };
  const a = lines(before), b = lines(after);
  const m = a.length, n = b.length;
  // LCS table for modest files; bounded by the 8 MiB file cap but keep it cheap.
  if (m * n > 4_000_000) return { diff: `Binary or oversized content differs for ${path}.`, truncated: true };
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const ops: { kind: " " | "-" | "+"; text: string }[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push({ kind: " ", text: a[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { ops.push({ kind: "-", text: a[i]! }); i++; }
    else { ops.push({ kind: "+", text: b[j]! }); j++; }
  }
  while (i < m) ops.push({ kind: "-", text: a[i++]! });
  while (j < n) ops.push({ kind: "+", text: b[j++]! });
  // Group changes with 3 lines of context into hunks.
  const hunks: string[] = [];
  let at = 0, covered = 0, oldCursor = 0, newCursor = 0;
  while (at < ops.length) {
    while (at < ops.length && ops[at]!.kind === " ") at++;
    if (at >= ops.length) break;
    const start = Math.max(covered, at - 3);
    let end = at;
    while (end < ops.length && (ops[end]!.kind !== " " || end - at < 7)) end = ops[end]!.kind !== " " ? end + 1 : end + 1;
    const slice = ops.slice(start, Math.min(ops.length, end));
    while (covered < start) { if (ops[covered]!.kind !== "+") oldCursor++; if (ops[covered]!.kind !== "-") newCursor++; covered++; }
    const oldLines = slice.filter((o) => o.kind !== "+").length;
    const newLines = slice.filter((o) => o.kind !== "-").length;
    const oldStart = oldLines ? oldCursor + 1 : oldCursor, newStart = newLines ? newCursor + 1 : newCursor;
    for (const op of slice) { if (op.kind !== "+") oldCursor++; if (op.kind !== "-") newCursor++; }
    const body: string[] = [];
    for (const op of slice) {
      // The sentinel never reaches the output; the marker line stands in for
      // the missing newline, exactly as git prints it.
      const marked = op.text.endsWith("\n");
      body.push(op.kind + (marked ? op.text.slice(0, -1) : op.text));
      if (marked) body.push("\\ No newline at end of file");
    }
    hunks.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@\n` + body.join("\n"));
    at = end;
    covered = end;
  }
  const header = `--- a/${path}\n+++ b/${path}\n`;
  let diff = header + (hunks.length ? hunks.join("\n") + "\n" : "");
  const truncated = Buffer.byteLength(diff, "utf8") > REVIEW_DIFF_LIMIT;
  if (truncated) diff = Buffer.from(diff, "utf8").subarray(0, REVIEW_DIFF_LIMIT).toString("utf8");
  return { diff: diff === header ? null : diff, truncated };
}

export class CheckpointService {
  constructor(private readonly store: Store) {}

  private get blobRoot() {
    return join(this.store.dataDir, "checkpoint-store", "blobs");
  }

  private async writeBlob(data: Buffer, signal: AbortSignal): Promise<string> {
    const ref = sha256hex(data);
    const target = join(this.blobRoot, ref);
    await mkdir(this.blobRoot, { recursive: true });
    await withPathGuard(
      [
        { path: this.blobRoot, leaf: false, allowChildWrites: true },
        // A new blob does not exist yet — the directory guard covers its creation.
        ...(await lstat(target).then(() => [{ path: target, leaf: true as const, allowChildWrites: true, childWriteRoot: this.blobRoot }], () => [])),
      ],
      signal,
      async () => {
        try {
          const file = await open(target, "wx", 0o600);
          try {
            await file.writeFile(data);
          } finally {
            await file.close();
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const check = await readBoundFile(target, CHECKPOINT_V1_LIMITS.fileBytes + 1);
        if (sha256hex(check) !== ref) throw new HarnessError("CAPABILITY_DENIED", "Checkpoint blob verification failed.");
      },
    );
    return ref;
  }

  private async readBlob(ref: string, signal: AbortSignal): Promise<Buffer | null> {
    const target = join(this.blobRoot, ref);
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return withPathGuard([{ path: this.blobRoot, leaf: false }, { path: target, leaf: true, readOnly: true }], signal, async () =>
      readBoundFile(target, CHECKPOINT_V1_LIMITS.fileBytes + 1),
    );
  }

  /** Read a file that may be absent, returning null instead of failing the guard. */
  private async readOptional(absolute: string, signal: AbortSignal): Promise<Buffer | null> {
    try {
      const info = await lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink()) return null;
      return await withPathGuard([{ path: absolute, leaf: true, readOnly: true }], signal, async () => readBoundFile(absolute, CHECKPOINT_V1_LIMITS.fileBytes + 1));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private checkpoints(owner: CheckpointScope): StoredCheckpoint[] {
    const scope = checkpointScopeSchema.parse(owner);
    return this.store
      .all<StoredCheckpoint>(CHECKPOINT_KIND)
      .filter(
        (entry) =>
          entry.scope.projectId === scope.projectId &&
          entry.scope.threadId === scope.threadId &&
          entry.scope.workingCopyId === scope.workingCopyId &&
          entry.scope.binding === scope.binding,
      );
  }

  private checkpoint(owner: CheckpointScope, checkpointId: string): StoredCheckpoint {
    const entry = this.store.get<StoredCheckpoint>(CHECKPOINT_KIND, checkpointId);
    if (!entry || entry.scope.projectId !== owner.projectId || entry.scope.threadId !== owner.threadId || entry.scope.workingCopyId !== owner.workingCopyId || entry.scope.binding !== owner.binding)
      throw new HarnessError("NOT_FOUND", "Checkpoint is unavailable for this owner.");
    return entry;
  }

  /** Capture the listed project-relative paths under root through a read-only guard. */
  async create(input: {
    owner: CheckpointScope;
    root: string;
    paths: string[];
    label?: string;
    provenance?: StoredCheckpoint["provenance"];
    signal?: AbortSignal;
  }): Promise<StoredCheckpoint> {
    const owner = checkpointScopeSchema.parse(input.owner);
    const signal = input.signal ?? new AbortController().signal;
    const files: CheckpointV1["files"] = [];
    const exclusions: CheckpointV1["exclusions"] = [];
    let total = 0;
    const paths = [...new Set(input.paths)];
    if (paths.length > CHECKPOINT_V1_LIMITS.files) throw new HarnessError("RESOURCE_LIMIT", `Checkpoints capture at most ${CHECKPOINT_V1_LIMITS.files} files.`);
    await withPathGuard([{ path: input.root, leaf: false }], signal, async () => {
      for (const path of paths) {
        if (exclusions.length >= CHECKPOINT_V1_LIMITS.exclusions) break;
        const target = join(input.root, ...path.split("/"));
        let data: Buffer | null = null;
        let size = 0;
        let dev: string | null = null;
        let ino: string | null = null;
        try {
          const info = await lstat(target, { bigint: true });
          if (info.isSymbolicLink() || !info.isFile()) {
            exclusions.push({ path, reason: "unsupported" });
            continue;
          }
          size = Number(info.size);
          dev = String(info.dev);
          ino = String(info.ino);
          const reason = exclusionReason(path, null, size);
          if (reason) {
            exclusions.push({ path, reason });
            continue;
          }
          data = await readBoundFile(target, CHECKPOINT_V1_LIMITS.fileBytes + 1, { dev: String(info.dev), ino: String(info.ino), size: Number(info.size) });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            exclusions.push({ path, reason: "unsupported" });
            continue;
          }
          throw error;
        }
        const reason = exclusionReason(path, data, size);
        if (reason) {
          exclusions.push({ path, reason });
          continue;
        }
        total += data.length;
        if (total > CHECKPOINT_V1_LIMITS.totalBytes) {
          exclusions.push({ path, reason: "too_large" });
          continue;
        }
        const digest = sha256hex(data);
        const blobRef = await this.writeBlob(data, signal);
        files.push({ path, identity: dev && ino ? { dev, ino } : null, digest, blobRef });
      }
    });
    if (files.length + exclusions.length > ADAPTER_FILE_CAP)
      throw new HarnessError("RESOURCE_LIMIT", `Checkpoints list at most ${ADAPTER_FILE_CAP} files for the review surface.`);
    const stored: StoredCheckpoint = {
      ...checkpointV1Schema.parse({
        version: 1,
        id: "chk-" + randomUUID(),
        scope: owner,
        sourceCut: sha256hex(JSON.stringify([owner.binding, files.map((file) => [file.path, file.digest]), exclusions])),
        createdAt: now(),
        files,
        exclusions,
        retention: "AVAILABLE",
      }),
      label: input.label ?? "Checkpoint",
      provenance: input.provenance ?? { kind: "guarded_write", operationId: "chk-" + randomUUID() },
      expiresAt: null,
    };
    this.store.internal("workspace.checkpoint.created", owner.threadId, () => {
      this.store.put(CHECKPOINT_KIND, stored.id, owner.threadId, stored);
    });
    return stored;
  }

  /** Record a checkpoint from bytes the caller already bound (e.g. a preimage
   *  captured inside an approved write, where the file is about to change).
   *  Same limits and exclusion rules as create(); no filesystem read. */
  async createFromBytes(input: {
    owner: CheckpointScope;
    files: { path: string; data: Buffer; identity?: { dev: string; ino: string } | null }[];
    label?: string;
    provenance?: StoredCheckpoint["provenance"];
    signal?: AbortSignal;
  }): Promise<StoredCheckpoint> {
    const owner = checkpointScopeSchema.parse(input.owner);
    const signal = input.signal ?? new AbortController().signal;
    if (input.files.length > CHECKPOINT_V1_LIMITS.files) throw new HarnessError("RESOURCE_LIMIT", `Checkpoints capture at most ${CHECKPOINT_V1_LIMITS.files} files.`);
    const files: CheckpointV1["files"] = [];
    const exclusions: CheckpointV1["exclusions"] = [];
    let total = 0;
    for (const item of input.files) {
      checkpointPathSchema.parse(item.path);
      const reason = exclusionReason(item.path, item.data, item.data.length);
      if (reason) { exclusions.push({ path: item.path, reason }); continue; }
      total += item.data.length;
      if (total > CHECKPOINT_V1_LIMITS.totalBytes) { exclusions.push({ path: item.path, reason: "too_large" }); continue; }
      const digest = sha256hex(item.data);
      const blobRef = await this.writeBlob(item.data, signal);
      files.push({ path: item.path, identity: item.identity ?? null, digest, blobRef });
    }
    if (files.length + exclusions.length > ADAPTER_FILE_CAP)
      throw new HarnessError("RESOURCE_LIMIT", `Checkpoints list at most ${ADAPTER_FILE_CAP} files for the review surface.`);
    const stored: StoredCheckpoint = {
      ...checkpointV1Schema.parse({
        version: 1,
        id: "chk-" + randomUUID(),
        scope: owner,
        sourceCut: sha256hex(JSON.stringify([owner.binding, files.map((file) => [file.path, file.digest]), exclusions])),
        createdAt: now(),
        files,
        exclusions,
        retention: "AVAILABLE",
      }),
      label: input.label ?? "Checkpoint",
      provenance: input.provenance ?? { kind: "guarded_write", operationId: "chk-" + randomUUID() },
      expiresAt: null,
    };
    this.store.internal("workspace.checkpoint.created", owner.threadId, () => {
      this.store.put(CHECKPOINT_KIND, stored.id, owner.threadId, stored);
    });
    return stored;
  }

  private adapterCheckpoint(entry: StoredCheckpoint, signal: AbortSignal) {
    void signal;
    return {
      id: entry.id,
      createdAt: entry.createdAt,
      label: entry.label,
      provenance: entry.provenance,
      fileCount: entry.files.length + entry.exclusions.length,
      revision: entry.sourceCut,
      expiresAt: entry.expiresAt,
    };
  }

  async list(owner: CheckpointScope, options: { cursor?: string; signal?: AbortSignal } = {}) {
    const signal = options.signal ?? new AbortController().signal;
    const entries = this.checkpoints(owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = entries.slice(start, start + 50);
    // Refresh retention for the page: a missing blob demotes the checkpoint.
    for (const entry of page) {
      if (entry.retention === "AVAILABLE" && (entry.expiresAt ? Date.parse(entry.expiresAt) <= Date.now() : false)) this.demote(entry, "EXPIRED");
    }
    return {
      owner,
      items: page.map((entry) => this.adapterCheckpoint(entry, signal)),
      nextCursor: start + 50 < entries.length ? String(start + 50) : null,
    };
  }

  private demote(entry: StoredCheckpoint, retention: StoredCheckpoint["retention"]) {
    if (entry.retention === retention) return;
    this.store.internal("workspace.checkpoint.retention", entry.scope.threadId, () => {
      const latest = this.store.get<StoredCheckpoint>(CHECKPOINT_KIND, entry.id);
      if (latest && latest.retention !== retention) this.store.put(CHECKPOINT_KIND, entry.id, entry.scope.threadId, { ...latest, retention });
    });
  }

  async detail(owner: CheckpointScope, checkpointId: string, options: { signal?: AbortSignal } = {}) {
    const signal = options.signal ?? new AbortController().signal;
    const entry = this.checkpoint(owner, checkpointId);
    const files = [
      ...entry.files.map((file) => ({
        path: file.path,
        targetHash: file.digest,
        bytes: 0,
        restorable: entry.retention === "AVAILABLE",
        reason: null as "binary" | "too_large" | "unsupported" | null,
      })),
      ...entry.exclusions.map((exclusion) => ({
        path: exclusion.path,
        targetHash: null,
        bytes: 0,
        restorable: false,
        reason: (exclusion.reason === "secret" ? "unsupported" : exclusion.reason) as "binary" | "too_large" | "unsupported",
      })),
    ];
    // Load blob sizes for real bytes where cheap.
    for (const row of files) {
      const file = entry.files.find((candidate) => candidate.path === row.path);
      if (!file) continue;
      const blob = await this.readBlob(file.blobRef, signal);
      row.bytes = blob?.length ?? 0;
      if (blob === null) this.demote(entry, "MISSING");
    }
    return { owner, checkpoint: this.adapterCheckpoint(entry, signal), files };
  }

  async review(owner: CheckpointScope, checkpointId: string, input: { paths: string[]; root: string; signal?: AbortSignal }) {
    const signal = input.signal ?? new AbortController().signal;
    const entry = this.checkpoint(owner, checkpointId);
    const files: { path: string; currentHash: string | null; targetHash: string | null; diff: string | null; diffTruncated: boolean; status: "ready" | "missing" | "binary" | "too_large" | "unreadable" | "unsupported" }[] = [];
    for (const path of input.paths) {
      const file = entry.files.find((candidate) => candidate.path === path);
      const exclusion = entry.exclusions.find((candidate) => candidate.path === path);
      if (exclusion) {
        files.push({ path, currentHash: null, targetHash: null, diff: null, diffTruncated: false, status: "unsupported" });
        continue;
      }
      if (!file) throw new HarnessError("NOT_FOUND", `The checkpoint has no file at ${path}.`);
      const target = await this.readBlob(file.blobRef, signal);
      const absolute = join(input.root, ...path.split("/"));
      let current: Buffer | null = null;
      try {
        current = await this.readOptional(absolute, signal);
      } catch (error) {
        const code = error instanceof HarnessError ? error.code : null;
        if (code === "RESOURCE_LIMIT" || code === "CAPABILITY_DENIED") {
          files.push({ path, currentHash: null, targetHash: file.digest, diff: null, diffTruncated: false, status: code === "RESOURCE_LIMIT" ? "too_large" : "unreadable" });
          continue;
        }
        throw error;
      }
      if (target === null) {
        files.push({ path, currentHash: current ? sha256hex(current) : null, targetHash: null, diff: null, diffTruncated: false, status: "missing" });
        continue;
      }
      if (current === null) {
        const { diff, truncated } = unifiedDiff(path, null, target);
        files.push({ path, currentHash: null, targetHash: file.digest, diff, diffTruncated: truncated, status: "missing" });
        continue;
      }
      const { diff, truncated } = unifiedDiff(path, current, target);
      files.push({ path, currentHash: sha256hex(current), targetHash: file.digest, diff, diffTruncated: truncated, status: "ready" });
    }
    return { owner, reviewId: "rev-" + randomUUID(), checkpointRevision: entry.sourceCut, files, expiresAt: new Date(Date.now() + REVIEW_TTL_MS).toISOString() };
  }

  /** PREVIEW: a plan binds checkpoint, selected paths, preimages and approval. */
  async planRestore(owner: CheckpointScope, input: { checkpointId: string; root: string; selectedPaths: string[]; approvalId: string; signal?: AbortSignal }): Promise<StoredRestorePlan> {
    const scope = checkpointScopeSchema.parse(owner);
    const signal = input.signal ?? new AbortController().signal;
    const entry = this.checkpoint(scope, input.checkpointId);
    if (entry.retention !== "AVAILABLE") throw new HarnessError("CAPABILITY_DENIED", "This checkpoint's blobs are no longer retained.");
    const selectedPaths = restorePlanV1Schema.shape.selectedPaths.parse(input.selectedPaths);
    const beforeDigests: { path: string; digest: string | null }[] = [];
    const targetDigests: { path: string; digest: string | null }[] = [];
    for (const path of selectedPaths) {
      const file = entry.files.find((candidate) => candidate.path === path);
      if (!file) throw new HarnessError("NOT_FOUND", `The checkpoint has no restorable file at ${path}.`);
      const absolute = join(input.root, ...path.split("/"));
      const current = await this.readOptional(absolute, signal);
      beforeDigests.push({ path, digest: current ? sha256hex(current) : null });
      targetDigests.push({ path, digest: file.digest });
    }
    const plan: StoredRestorePlan = {
      ...restorePlanV1Schema.parse({
        version: 1,
        checkpointId: entry.id,
        scope,
        currentRevision: sha256hex(JSON.stringify(beforeDigests)),
        selectedPaths,
        beforeDigests,
        targetDigests,
        preRestoreCheckpointId: null,
        approvalId: input.approvalId,
        state: "PREVIEW",
      }),
      id: "rst-" + randomUUID(),
      conflicts: [],
      createdAt: now(),
    };
    this.store.internal("workspace.restore.planned", scope.threadId, () => {
      this.store.put(RESTORE_PLAN_KIND, plan.id, scope.threadId, plan);
    });
    return plan;
  }

  async applyRestore(owner: CheckpointScope, input: { planId: string; approvalId: string; root: string; signal?: AbortSignal }): Promise<StoredRestorePlan> {
    const scope = checkpointScopeSchema.parse(owner);
    const signal = input.signal ?? new AbortController().signal;
    const plan = this.store.get<StoredRestorePlan>(RESTORE_PLAN_KIND, input.planId);
    if (!plan || plan.scope.projectId !== scope.projectId || plan.scope.threadId !== scope.threadId || plan.scope.workingCopyId !== scope.workingCopyId || plan.scope.binding !== scope.binding)
      throw new HarnessError("NOT_FOUND", "Restore plan is unavailable for this owner.");
    if (plan.approvalId !== input.approvalId) throw new HarnessError("CAPABILITY_DENIED", "Restore needs the exact approval for this plan.");
    if (plan.state !== "PREVIEW") throw new HarnessError("REVISION_CHANGED", "This restore plan was already applied or superseded.");
    const checkpoint = this.checkpoint(scope, plan.checkpointId);

    // The exact pre-restore checkpoint is the recovery anchor. It must exist
    // before the plan leaves PREVIEW — a failure here keeps the plan usable.
    const preRestore = await this.create({
      owner: scope,
      root: input.root,
      paths: plan.selectedPaths,
      label: `Before restore of ${checkpoint.id}`,
      provenance: { kind: "restore_backup", operationId: plan.id },
      signal,
    });
    this.transition(plan, "APPLYING");
    this.store.internal("workspace.restore.pre-checkpoint", scope.threadId, () => {
      const latest = this.store.get<StoredRestorePlan>(RESTORE_PLAN_KIND, plan.id);
      if (latest) this.store.put(RESTORE_PLAN_KIND, plan.id, scope.threadId, { ...latest, preRestoreCheckpointId: preRestore.id });
    });

    const written: { path: string; before: Buffer | null }[] = [];
    const conflicts: string[] = [];
    let partialRecovery = false;
    let applyError: unknown;
    try {
      for (const target of plan.targetDigests) {
        const before = plan.beforeDigests.find((entry) => entry.path === target.path)!;
        const blob = await this.readBlob(checkpoint.files.find((file) => file.path === target.path)!.blobRef, signal);
        if (blob === null || sha256hex(blob) !== target.digest) {
          conflicts.push(target.path);
          continue;
        }
        const absolute = join(input.root, ...target.path.split("/"));
        // Preimage must still match; otherwise the path conflicts.
        const current = await this.readOptional(absolute, signal);
        const currentDigest = current ? sha256hex(current) : null;
        if (currentDigest !== before.digest) {
          conflicts.push(target.path);
          continue;
        }
        // The recovery checkpoint cannot hold excluded content; never
        // overwrite bytes there is no recovery copy of.
        if (current !== null && exclusionReason(target.path, current) !== null) {
          conflicts.push(target.path);
          continue;
        }
        try {
          await this.writeRestored(absolute, blob, current, signal);
        } catch (error) {
          // The destination appeared between preview and apply.
          if (error instanceof HarnessError && error.code === "REVISION_CHANGED") {
            conflicts.push(target.path);
            continue;
          }
          throw error;
        }
        written.push({ path: target.path, before: current });
        // Postimage must equal the checkpoint digest.
        const after = await this.readOptional(absolute, signal);
        if (after === null) {
          partialRecovery = true;
          continue;
        }
        if (sha256hex(after) !== target.digest) partialRecovery = true;
      }
    } catch (error) {
      applyError = error;
    }

    if (conflicts.length || applyError) {
      // Roll back only writes whose bytes still equal the written image.
      for (const entry of written) {
        try {
          const absolute = join(input.root, ...entry.path.split("/"));
          const nowBytes = await this.readOptional(absolute, signal);
          const targetDigest = plan.targetDigests.find((item) => item.path === entry.path)!.digest;
          if (!nowBytes || sha256hex(nowBytes) !== targetDigest) {
            partialRecovery = true;
            continue;
          }
          if (entry.before === null) {
            await rm(absolute, { force: true });
          } else {
            await this.writeRestored(absolute, entry.before, nowBytes, signal);
          }
        } catch {
          partialRecovery = true;
        }
      }
    }
    const state = partialRecovery ? "PARTIAL_RECOVERY_REQUIRED" : conflicts.length || applyError ? "CONFLICT" : "APPLIED";
    this.store.internal("workspace.restore.finished", scope.threadId, () => {
      const latest = this.store.get<StoredRestorePlan>(RESTORE_PLAN_KIND, plan.id);
      if (latest) this.store.put(RESTORE_PLAN_KIND, plan.id, scope.threadId, { ...latest, state, conflicts });
    });
    // The plan is terminal before the failure surfaces — it never stays APPLYING.
    if (applyError) throw applyError;
    return { ...plan, state, conflicts, preRestoreCheckpointId: preRestore.id };
  }

  private async writeRestored(absolute: string, bytes: Buffer, before: Buffer | null, signal: AbortSignal): Promise<void> {
    const directory = dirname(absolute);
    const temp = join(directory, `.gen-restore-${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    // Guard the directory only — pinning the destination as a leaf would hold
    // a deny-delete handle that blocks the verified atomic rename.
    await withPathGuard(
      [{ path: directory, leaf: false, allowChildWrites: true }],
      signal,
      async () => {
        try {
          const file = await open(temp, "wx", 0o600);
          let tempIdentity: { dev: bigint; ino: bigint };
          try {
            await file.writeFile(bytes);
            const info = await file.stat({ bigint: true });
            tempIdentity = { dev: info.dev, ino: info.ino };
          } finally {
            await file.close();
          }
          if (before === null) {
            // New file: hard-link the temp into place. EEXIST means another
            // writer created the destination between preview and apply — those
            // bytes have no recovery backup, so the rename must never clobber.
            try {
              await link(temp, absolute);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new HarnessError("REVISION_CHANGED", `The destination ${absolute} appeared during restore.`);
              throw error;
            }
            return;
          }
          // identity names the verified temp source; the destination preimage is
          // re-verified against the preview digest on a single opened handle.
          await replaceOwnedFile(temp, absolute, tempIdentity, sha256hex(bytes), signal, sha256hex(before));
        } finally {
          // A successful link leaves the temp name as a second hardlink, and a
          // successful replace consumes it via rename — rm covers both plus
          // every failure path.
          await rm(temp, { force: true }).catch(() => {});
        }
      },
    );
  }

  private transition(plan: StoredRestorePlan, state: StoredRestorePlan["state"]) {
    this.store.internal("workspace.restore.transition", plan.scope.threadId, () => {
      const latest = this.store.get<StoredRestorePlan>(RESTORE_PLAN_KIND, plan.id);
      if (latest && latest.state === "PREVIEW") this.store.put(RESTORE_PLAN_KIND, plan.id, plan.scope.threadId, { ...latest, state });
    });
  }

  /** Remove blobs no checkpoint or receipt still references; demote broken ones. */
  async collectGarbage(): Promise<{ removed: number }> {
    const referenced = new Set<string>();
    for (const entry of this.store.all<StoredCheckpoint>(CHECKPOINT_KIND)) for (const file of entry.files) referenced.add(file.blobRef);
    let removed = 0;
    try {
      for (const name of await readdir(this.blobRoot)) {
        if (!/^[a-f0-9]{64}$/.test(name) || referenced.has(name)) continue;
        await rm(join(this.blobRoot, name), { force: true });
        removed++;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { removed };
  }

  /**
   * Copy an explicitly allowlisted non-secret manifest into a worktree. Every
   * entry is digest- and size-pinned; .env material, keys, credentials,
   * session files and symlinks are refused before a single byte is copied.
   */
  async provisionManifest(manifest: ProvisionManifestV1, sourceRoot: string, targetRoot: string, signal = new AbortController().signal): Promise<{ copied: string[] }> {
    const reviewed = provisionManifestV1Schema.parse(manifest);
    const copied: string[] = [];
    for (const entry of reviewed.entries) {
      const name = entry.path.split("/").at(-1) ?? entry.path;
      if (SECRET_NAME.test(name) || SECRET_EXT.test(name)) throw new HarnessError("CAPABILITY_DENIED", `Provisioning refuses secret material at ${entry.path}.`);
      const source = resolve(sourceRoot, ...entry.path.split("/"));
      const destination = resolve(targetRoot, ...entry.path.split("/"));
      if (!source.startsWith(resolve(sourceRoot) + sep) || !destination.startsWith(resolve(targetRoot) + sep))
        throw new HarnessError("CAPABILITY_DENIED", "Provisioned files stay inside the source and target roots.");
      const info = await lstat(source);
      if (info.isSymbolicLink() || !info.isFile()) throw new HarnessError("CAPABILITY_DENIED", `Provisioned file ${entry.path} must be a regular file.`);
      const data = await withPathGuard([{ path: source, leaf: true, readOnly: true }], signal, async () => readBoundFile(source, 1024 * 1024));
      if (data.length !== entry.bytes || sha256hex(data) !== entry.digest)
        throw new HarnessError("REVISION_CHANGED", `Provisioned file ${entry.path} no longer matches the reviewed manifest.`);
      await this.writeRestored(destination, data, null, signal);
      copied.push(entry.path);
    }
    return { copied };
  }

  /** One repository per operation, or an approved multi-root recipe. */
  selectRepository(group: RepositoryGroupV1, request: { repositoryId?: string; recipeId?: string }): RepositoryGroupV1["repositories"] {
    const parsed = repositoryGroupV1Schema.parse(group);
    if (request.recipeId) {
      const recipe = this.store.get<{ id: string; repositories: string[] }>(REPOSITORY_RECIPE_KIND, request.recipeId);
      if (!recipe) throw new HarnessError("NOT_FOUND", "The multi-repository recipe is unavailable.");
      const allowed = new Set(recipe.repositories);
      const selected = parsed.repositories.filter((entry) => allowed.has(entry.repositoryId));
      if (!selected.length || selected.length !== recipe.repositories.length) throw new HarnessError("CAPABILITY_DENIED", "The recipe does not cover this repository group.");
      return selected;
    }
    const selected = parsed.repositories.find((entry) => entry.repositoryId === request.repositoryId);
    if (!selected) throw new HarnessError("CAPABILITY_DENIED", "Choose exactly one repository from the group, or name an approved recipe.");
    return [selected];
  }
}
