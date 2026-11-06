import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { HarnessError } from "../contracts/index.ts";
import {
  CODE_REVIEW_LIMITS,
  type CodeReviewComparison,
  type ComparisonCheck,
  type ComparisonFile,
  type ComparisonIdentity,
  type ComparisonPatch,
  type ComparisonRead,
  type LocalComparisonIdentity,
} from "../contracts/code-review.ts";
import { withPathGuard } from "../core/file-access.ts";

type Git = (args: string[]) => Promise<string>;
export interface LocalReviewContext {
  git: Git;
  path: string;
  managed: boolean;
  signal: AbortSignal;
  owner: string;
}
export const reviewHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const comparisonError = (error: unknown): ComparisonRead => ({
  state: "error",
  error: {
    code: error instanceof HarnessError ? error.code : "COMPARISON_UNAVAILABLE",
    message: "The comparison could not be read. Refresh or sign in and retry.",
  },
});
export const comparisonResult = (value: CodeReviewComparison): ComparisonRead => ({
  state: value.files.length || value.filesTruncated ? "ready" : "empty",
  value,
});

/** Bounded, owner-scoped immutable snapshots. Eviction requires an explicit refresh. */
export class ComparisonSnapshots {
  private readonly entries = new Map<
    string,
    { owner: string; value: CodeReviewComparison; patches?: Map<string, ComparisonPatch> }
  >();
  save(owner: string, value: CodeReviewComparison, patches?: Map<string, ComparisonPatch>) {
    this.entries.delete(value.identity.id);
    this.entries.set(value.identity.id, structuredClone({ owner, value, patches }));
    while (this.entries.size > CODE_REVIEW_LIMITS.snapshots) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
  }
  get(owner: string, id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner)
      throw new HarnessError("COMPARISON_EXPIRED", "Refresh the comparison before reading this file.");
    return structuredClone(entry);
  }
}
const localPath = (value: string) =>
  value.length <= 1024 &&
  !/[\\:\0]/.test(value) &&
  !value.startsWith("/") &&
  !value.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git");
const binary = (bytes: Buffer) => bytes.includes(0) || Buffer.from(bytes.toString("utf8"), "utf8").compare(bytes) !== 0;
async function fileBytes(
  context: LocalReviewContext,
  name: string,
  capture: boolean,
  budget = { remaining: CODE_REVIEW_LIMITS.hashBytes as number },
) {
  if (!localPath(name)) throw new HarnessError("CAPABILITY_DENIED", "The changed path is unsupported.");
  return withPathGuard([{ path: join(context.path, name), leaf: true, readOnly: true }], context.signal, async () => {
    const file = await open(join(context.path, name), "r");
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n)
        throw new HarnessError("CAPABILITY_DENIED", "Changed paths must be ordinary files.");
      if (before.size > BigInt(budget.remaining))
        throw new HarnessError("RESOURCE_LIMIT", "Changed file hashing exceeds its byte budget.");
      budget.remaining -= Number(before.size);
      const digest = createHash("sha256"),
        buffer = Buffer.alloc(64 * 1024),
        parts: Buffer[] = [];
      let offset = 0,
        isBinary = false;
      while (offset < Number(before.size)) {
        if (context.signal.aborted) throw new HarnessError("CANCELLED", "Comparison cancelled.");
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
        if (!bytesRead) throw new HarnessError("REVISION_CHANGED", "The file changed while reading.");
        const bytes = buffer.subarray(0, bytesRead);
        digest.update(bytes);
        isBinary ||= bytes.includes(0);
        if (capture && before.size <= BigInt(CODE_REVIEW_LIMITS.patchBytes)) parts.push(Buffer.from(bytes));
        offset += bytesRead;
      }
      const after = await file.stat({ bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
        throw new HarnessError("REVISION_CHANGED", "The file changed while reading.");
      const bytes = Buffer.concat(parts);
      return {
        digest: digest.digest("hex"),
        size: Number(before.size),
        binary: isBinary || (capture && parts.length > 0 && binary(bytes)),
        bytes,
      };
    } finally {
      await file.close();
    }
  });
}
async function localSnapshot(context: LocalReviewContext) {
  const head = (await context.git(["rev-parse", "HEAD"])).trim(),
    branch = (await context.git(["branch", "--show-current"])).trim();
  const index = await context.git(["ls-files", "--stage", "-z"]);
  const raw = await context.git([
    "status",
    "--porcelain=v1",
    "-z",
    context.managed ? "--untracked-files=all" : "--untracked-files=no",
  ]);
  const entries = raw.split("\0"),
    files: ComparisonFile[] = [],
    digests: unknown[] = [],
    budget = { remaining: CODE_REVIEW_LIMITS.hashBytes as number };
  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    if (!row) continue;
    const index = row[0],
      worktree = row[1],
      path = row.slice(3),
      oldPath = /[RC]/.test(index + worktree) ? entries[++i] : undefined;
    if (path.split("/").at(-1) === ".harness-directory-guard") continue;
    if (files.length >= CODE_REVIEW_LIMITS.files) throw new HarnessError("RESOURCE_LIMIT", "Too many changed files.");
    const file: ComparisonFile = {
      path,
      ...(oldPath ? { oldPath } : {}),
      status: index + worktree,
      index,
      worktree,
      untracked: index === "?",
      additions: null,
      deletions: null,
    };
    files.push(file);
    if (worktree !== "D" && !(index === "D" && worktree === " ")) {
      if (!localPath(path)) {
        file.patchUnavailable = "unsupported-path";
        digests.push([path, "unsupported-path"]);
        continue;
      }
      const info = await lstat(join(context.path, path), { bigint: true });
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) {
        file.patchUnavailable = "unsupported-file";
        digests.push([
          path,
          String(info.dev),
          String(info.ino),
          String(info.size),
          String(info.mtimeNs),
          String(info.ctimeNs),
          String(info.mode),
        ]);
      } else digests.push([path, (await fileBytes(context, path, false, budget)).digest]);
    }
  }
  return {
    head,
    branch,
    index: reviewHash(index),
    revision: reviewHash([context.owner, head, branch, index, raw, digests]),
    files,
  };
}
export async function readLocalComparison(
  context: LocalReviewContext,
  scope: "staged" | "worktree",
): Promise<CodeReviewComparison> {
  const before = await localSnapshot(context),
    after = await localSnapshot(context);
  if (before.revision !== after.revision)
    throw new HarnessError("REVISION_CHANGED", "The working copy changed. Refresh the comparison.");
  const identity: LocalComparisonIdentity = {
    kind: "local",
    id: "",
    scope,
    headOid: before.head,
    branch: before.branch,
    revision: before.revision,
    base: scope === "staged" ? { kind: "commit", revision: before.head } : { kind: "index", revision: before.index },
    head:
      scope === "staged" ? { kind: "index", revision: before.index } : { kind: "worktree", revision: before.revision },
  };
  identity.id = reviewHash([context.owner, identity]);
  return {
    identity,
    files: before.files.filter((file) =>
      scope === "staged" ? file.index !== " " && !file.untracked : file.worktree !== " ",
    ),
    filesTruncated: false,
    checks: [],
    observedAt: new Date().toISOString(),
    access: { mode: context.managed ? "managed" : "legacy", untrackedIncluded: context.managed },
  };
}
const patch = (
  identity: ComparisonIdentity,
  file: ComparisonFile,
  state: ComparisonPatch["state"],
  text: string | null = null,
  reason?: ComparisonPatch["reason"],
): ComparisonPatch => ({ identity, file, state, text, ...(reason ? { reason } : {}) });
export async function readLocalComparisonFile(
  context: LocalReviewContext,
  comparison: CodeReviewComparison,
  name: string,
): Promise<ComparisonPatch> {
  const identity = comparison.identity;
  if (identity.kind !== "local") throw new HarnessError("INVALID_INPUT", "Choose a local comparison.");
  const current = await readLocalComparison(context, identity.scope);
  if (identity.id !== current.identity.id)
    throw new HarnessError("REVISION_CHANGED", "The working copy changed. Refresh the comparison.");
  const file = comparison.files.find((file) => file.path === name);
  if (!file) throw new HarnessError("NOT_FOUND", "The selected file is not in this comparison.");
  let result: ComparisonPatch;
  if (!localPath(name) || (file.oldPath && !localPath(file.oldPath)))
    result = patch(identity, file, "unavailable", null, "unsupported-path");
  else if (file.patchUnavailable) result = patch(identity, file, "unavailable", null, file.patchUnavailable);
  else if (file.status.includes("U") || file.status === "AA" || file.status === "DD")
    result = patch(identity, file, "unavailable", null, "conflict");
  else if (file.untracked) {
    const data = await fileBytes(context, name, true);
    const content = data.bytes.toString("utf8"),
      lines = content.split(/(?<=\n)/).filter(Boolean);
    const text = `--- /dev/null\n+++ ${JSON.stringify(`b/${name}`)}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("")}${data.bytes.length && data.bytes.at(-1) !== 10 ? "\n\\ No newline at end of file\n" : ""}`;
    result = data.binary
      ? patch(identity, file, "binary")
      : data.size > CODE_REVIEW_LIMITS.patchBytes || Buffer.byteLength(text) > CODE_REVIEW_LIMITS.patchBytes
        ? patch(identity, file, "truncated", null, "resource-limit")
        : patch(identity, file, "untracked", data.size ? text : "");
  } else {
    const args = [
      "diff",
      "--full-index",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      ...(identity.scope === "staged" ? ["--cached", identity.headOid] : []),
      "--",
      ...[name, ...(file.oldPath ? [file.oldPath] : [])].map((path) => ":(literal)" + path),
    ];
    try {
      const read = async () => ({
        text: await context.git(args),
        stats: await context.git(["diff", "--numstat", "-z", ...args.slice(1)]),
      });
      // Pin existing worktree input through both Git reads. Cached/deleted reads use index objects.
      const { text, stats } =
        identity.scope === "worktree" && file.worktree !== "D"
          ? await withPathGuard([{ path: join(context.path, name), leaf: true, readOnly: true }], context.signal, read)
          : await read();
      result = stats.startsWith("-\t-\t")
        ? patch(identity, file, "binary")
        : Buffer.byteLength(text) > CODE_REVIEW_LIMITS.patchBytes
          ? patch(identity, file, "truncated", null, "resource-limit")
          : patch(identity, file, text ? "text" : "empty", text);
    } catch (error) {
      if (error instanceof HarnessError && error.code === "RESOURCE_LIMIT")
        result = patch(identity, file, "truncated", null, "resource-limit");
      else throw error;
    }
  }
  if ((await localSnapshot(context)).revision !== identity.revision)
    throw new HarnessError("REVISION_CHANGED", "The working copy changed while reading.");
  return result;
}

const oid = z.string().regex(/^[0-9a-f]{40}$/);
const remotePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\0"));
export const PullComparisonSchema = z.object({
  id: z.string().min(1).max(256),
  number: z.number().int().positive(),
  title: z.string().max(4096),
  url: z.string().max(4096),
  baseRefOid: oid,
  headRefOid: oid,
  baseRefName: z.string().max(1024),
  headRefName: z.string().max(1024),
  statusCheckRollup: z.array(z.unknown()).max(1000).nullable(),
});
export const RemoteComparisonSchema = z.object({
  base_commit: z.object({ sha: oid }),
  merge_base_commit: z.object({ sha: oid }),
  files: z
    .array(
      z.object({
        sha: oid,
        filename: remotePath,
        previous_filename: remotePath.optional(),
        status: z.string().max(64),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
        patch: z.string().optional(),
      }),
    )
    .max(CODE_REVIEW_LIMITS.remoteFiles),
});
export function normalizeChecks(rows: unknown[] | null): ComparisonCheck[] {
  return (rows ?? []).map((row) => {
    const data = z
      .object({
        name: z.string().max(1024).optional(),
        context: z.string().max(1024).optional(),
        status: z.string().optional(),
        conclusion: z.string().nullable().optional(),
        state: z.string().optional(),
      })
      .safeParse(row);
    if (!data.success) return { name: "Unknown check", status: "unknown" };
    const value = data.data,
      state = value.conclusion ?? value.state ?? value.status ?? "";
    return {
      name: value.name ?? value.context ?? "Unknown check",
      status: ["SUCCESS", "EXPECTED"].includes(state)
        ? state === "SUCCESS"
          ? "passed"
          : "pending"
        : ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"].includes(state)
          ? "failed"
          : ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "PENDING_DEPLOYMENT"].includes(state)
            ? "pending"
            : ["NEUTRAL", "SKIPPED"].includes(state)
              ? "neutral"
              : "unknown",
    };
  });
}
export function remotePatch(identity: ComparisonIdentity, file: ComparisonFile, text?: string): ComparisonPatch {
  if (text === undefined) return patch(identity, file, "unavailable", null, "patch-omitted");
  if (Buffer.byteLength(text) > CODE_REVIEW_LIMITS.patchBytes)
    return patch(identity, file, "truncated", null, "resource-limit");
  let added = 0,
    deleted = 0,
    oldRemaining = 0,
    newRemaining = 0,
    malformed = false;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      malformed ||= oldRemaining !== 0 || newRemaining !== 0;
      oldRemaining = Number(hunk[1] ?? 1);
      newRemaining = Number(hunk[2] ?? 1);
    } else if (line.startsWith("+")) {
      added++;
      newRemaining--;
    } else if (line.startsWith("-")) {
      deleted++;
      oldRemaining--;
    } else if (line.startsWith(" ")) {
      oldRemaining--;
      newRemaining--;
    } else if (line !== "\\ No newline at end of file") malformed = true;
    malformed ||= oldRemaining < 0 || newRemaining < 0;
  }
  if (malformed || oldRemaining || newRemaining || added !== file.additions || deleted !== file.deletions)
    return patch(identity, file, "truncated", null, "patch-omitted");
  return patch(identity, file, text ? "text" : "empty", text);
}
