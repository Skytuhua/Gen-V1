import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/store.ts";
import type { Thread } from "../packages/contracts/index.ts";
import { ProjectTools } from "../packages/workspace/tools.ts";
import { SelectiveCommitService } from "../packages/workspace/selective-commit.ts";
import { checkpointScope, EditJournal, sha256hex } from "../packages/workspace/edit-journal.ts";

const roots: string[] = [];
const stores: Store[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_OPTIONAL_LOCKS: "0" },
  });

async function identity(path: string) {
  const info = await lstat(path, { bigint: true });
  return { dev: String(info.dev), ino: String(info.ino) };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "harness-selective-v3-"));
  roots.push(root);
  const dataDir = join(root, "state");
  const base = join(root, "base");
  await mkdir(base);
  git(base, "init", "-q", "-b", "main");
  await writeFile(join(base, "one.txt"), "one-0\n");
  await writeFile(join(base, "two.txt"), "two-0\n");
  await writeFile(
    join(base, "many.txt"),
    Array.from({ length: 40 }, (_, index) => `line-${index}`).join("\n") + "\n",
  );
  git(base, "add", ".");
  git(base, "commit", "-qm", "base");
  const store = new Store(dataDir);
  stores.push(store);
  const stamp = new Date().toISOString();
  const projectId = "project";
  const threadId = "thread";
  const rootIdentity = await identity(base);
  store.internal("fixture.project", null, () => {
    store.put("workspaceProject", projectId, null, { id: projectId, name: "project", rootPath: base, authority: { kind: "local" }, createdAt: stamp });
    store.put("workspaceProjectRoot", projectId, null, { path: base, identity: rootIdentity });
    store.put("thread", threadId, threadId, {
      id: threadId,
      title: "thread",
      projectName: "project",
      projectId,
      status: "working",
      epoch: 1,
      runId: "run",
      kind: "main",
      modelId: null,
      sessionPath: null,
      createdAt: stamp,
      updatedAt: stamp,
    });
  });
  const projects = new ProjectTools(store, { git: "git" });
  await projects.prepareWorkspace(store.get<Thread>("thread", threadId)!);
  const { workspace } = await projects.binding(projectId, threadId);
  if (!workspace) throw new Error("fixture did not create a managed working copy");
  const scope = checkpointScope({ projectId, threadId, workingCopyId: workspace.id, binding: { path: workspace.path, gitDirectory: workspace.gitDirectory, identity: workspace.identity } });
  const journal = new EditJournal(store);
  const service = new SelectiveCommitService(projects, journal);
  return { root, base, store, projects, projectId, threadId, workspace, scope, journal, service };
}

const select = (preview: { candidates: { path: string; index: number; digest: string }[] }, paths: string[]) =>
  preview.candidates.filter((candidate) => paths.includes(candidate.path)).map(({ path, index, digest }) => ({ path, index, digest }));

it("commits only the selected hunks and leaves the rest uncommitted", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace.path, "one.txt"), "one-1\n");
  await writeFile(join(f.workspace.path, "two.txt"), "two-1\n");
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  expect(preview.candidates.map((candidate) => candidate.path).sort()).toEqual(["one.txt", "two.txt"]);
  const result = await f.service.commit(f.projectId, f.threadId, {
    expectedHead: preview.expectedHead,
    selectedHunks: select(preview, ["one.txt"]),
    message: "commit one only",
    approvalId: "approval-1",
    scope: f.scope,
  });
  expect(result.applied).toBe(true);
  expect(git(f.workspace.path, "log", "-1", "--format=%s").trim()).toBe("commit one only");
  expect(git(f.workspace.path, "show", "--name-only", "--format=", "HEAD").trim()).toBe("one.txt");
  // The unselected change survives as an unstaged diff against the new head.
  expect(git(f.workspace.path, "status", "--porcelain")).toContain("two.txt");
  expect(git(f.workspace.path, "diff", "HEAD", "--", "two.txt")).toContain("+two-1");
  // The real index was reconciled: selected file is clean vs HEAD.
  expect(git(f.workspace.path, "diff", "--cached", "--name-only")).toBe("");
});

it("commits one hunk of a file and leaves the sibling hunk behind", async () => {
  const f = await fixture();
  const lines = Array.from({ length: 40 }, (_, index) => `line-${index}`);
  lines[0] = "top-changed";
  lines[39] = "bottom-changed";
  await writeFile(join(f.workspace.path, "many.txt"), lines.join("\n") + "\n");
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  const hunks = preview.candidates.filter((candidate) => candidate.path === "many.txt");
  expect(hunks.length).toBe(2);
  await f.service.commit(f.projectId, f.threadId, {
    expectedHead: preview.expectedHead,
    selectedHunks: [{ path: "many.txt", index: hunks[0]!.index, digest: hunks[0]!.digest }],
    message: "top only",
    approvalId: "approval-2",
    scope: f.scope,
  });
  const show = git(f.workspace.path, "show", "HEAD", "--", "many.txt");
  expect(show).toContain("+top-changed");
  expect(show).not.toContain("+bottom-changed");
  expect(git(f.workspace.path, "diff", "HEAD", "--", "many.txt")).toContain("+bottom-changed");
});

it("refuses a stale expected head and records nothing", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace.path, "one.txt"), "one-1\n");
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  expect(preview.candidates.length).toBeGreaterThan(0);
  const selected = select(preview, ["one.txt"]);
  git(f.workspace.path, "checkout", "--", "one.txt");
  await writeFile(join(f.workspace.path, "other.txt"), "moved\n");
  git(f.workspace.path, "add", "other.txt");
  git(f.workspace.path, "commit", "-qm", "external");
  await expect(
    f.service.commit(f.projectId, f.threadId, {
      expectedHead: preview.expectedHead,
      selectedHunks: selected,
      message: "stale",
      approvalId: "approval-3",
      scope: f.scope,
    }),
  ).rejects.toMatchObject({ code: "REVISION_CHANGED" });
  expect(f.service.records(f.workspace.id)).toHaveLength(0);
});

it("commits a brand-new untracked file as a single proven hunk", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace.path, "added.txt"), "brand new\n");
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  const candidate = preview.candidates.find((entry) => entry.path === "added.txt");
  expect(candidate).toBeTruthy();
  await f.service.commit(f.projectId, f.threadId, {
    expectedHead: preview.expectedHead,
    selectedHunks: [candidate!].map(({ path, index, digest }) => ({ path, index, digest })),
    message: "add file",
    approvalId: "approval-4",
    scope: f.scope,
  });
  expect(git(f.workspace.path, "show", "HEAD:added.txt").trim()).toBe("brand new");
  // The path guard's sentinel file is never a commit candidate.
  expect(git(f.workspace.path, "status", "--porcelain")).not.toContain("added.txt");
});

it("labels hunk attribution from the provenance journal and requires explicit selection for unproven edits", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace.path, "one.txt"), "one-1\n");
  await writeFile(join(f.workspace.path, "two.txt"), "two-1\n");
  f.journal.recordProvenEdit({
    invocationId: "inv-1",
    owner: f.scope,
    workspaceIdentity: "0".repeat(64),
    repositoryId: "repo",
    path: "one.txt",
    beforeIdentity: null,
    beforeDigest: null,
    afterDigest: sha256hex("one-1\n"),
  });
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  const proven = preview.candidates.find((candidate) => candidate.path === "one.txt")!;
  const unproven = preview.candidates.find((candidate) => candidate.path === "two.txt")!;
  expect(proven.attribution).toBe("proven");
  expect(proven.requiresExplicitSelection).toBe(false);
  expect(unproven.attribution).toBe("unattributed");
  expect(unproven.requiresExplicitSelection).toBe(true);
});

it("keeps a path unattributed when its live bytes no longer match the proven receipt", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace.path, "one.txt"), "one-1\n");
  f.journal.recordProvenEdit({
    invocationId: "inv-1",
    owner: f.scope,
    workspaceIdentity: "0".repeat(64),
    repositoryId: "repo",
    path: "one.txt",
    beforeIdentity: null,
    beforeDigest: null,
    afterDigest: sha256hex("one-1\n"),
  });
  // A manual edit after the proven write is not covered by the receipt.
  await writeFile(join(f.workspace.path, "one.txt"), "one-2\n");
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  const candidate = preview.candidates.find((entry) => entry.path === "one.txt")!;
  expect(candidate.attribution).toBe("unattributed");
  expect(candidate.requiresExplicitSelection).toBe(true);
});

it("never offers an untracked non-UTF-8 file as a commit candidate", async () => {
  const f = await fixture();
  // Latin-1 bytes that are invalid UTF-8 but contain no NUL.
  await writeFile(join(f.workspace.path, "latin.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  expect(preview.candidates.some((candidate) => candidate.path === "latin.txt")).toBe(false);
});

it("commits an untracked UTF-8 file without dropping its BOM", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace.path, "bom.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("café\n", "utf8")]));
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  const candidate = preview.candidates.find((entry) => entry.path === "bom.txt");
  expect(candidate).toBeTruthy();
  await f.service.commit(f.projectId, f.threadId, {
    expectedHead: preview.expectedHead,
    selectedHunks: [candidate!].map(({ path, index, digest }) => ({ path, index, digest })),
    message: "add bom file",
    approvalId: "approval-6",
    scope: f.scope,
  });
  expect(git(f.workspace.path, "show", "HEAD:bom.txt")).toBe("\uFEFFcaf\u00e9\n");
});

it("rejects a hunk whose digest no longer matches the live postimage", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace.path, "one.txt"), "one-1\n");
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  const stale = select(preview, ["one.txt"]);
  await writeFile(join(f.workspace.path, "one.txt"), "one-2\n");
  await expect(
    f.service.commit(f.projectId, f.threadId, { expectedHead: preview.expectedHead, selectedHunks: stale, message: "changed under us", approvalId: "approval-5", scope: f.scope }),
  ).rejects.toMatchObject({ code: "REVISION_CHANGED" });
});

it("never uses blanket staging: an unselected file is absent from the commit", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace.path, "one.txt"), "one-1\n");
  await writeFile(join(f.workspace.path, "secret-dirty.txt"), "unrelated\n");
  const preview = await f.service.preview(f.projectId, f.threadId, f.scope);
  await f.service.commit(f.projectId, f.threadId, {
    expectedHead: preview.expectedHead,
    selectedHunks: select(preview, ["one.txt"]),
    message: "narrow",
    approvalId: "approval-6",
    scope: f.scope,
  });
  expect(git(f.workspace.path, "show", "--name-only", "--format=", "HEAD")).not.toContain("secret-dirty.txt");
  expect(git(f.workspace.path, "status", "--porcelain")).toContain("secret-dirty.txt");
});

it("requires a managed working copy", async () => {
  const f = await fixture();
  const service = f.service;
  await expect(service.preview(f.projectId, "missing-thread")).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});
