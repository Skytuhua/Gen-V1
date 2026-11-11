import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { link, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../packages/storage/store.ts";
import { ProjectTools } from "../packages/workspace/tools.ts";
import { GitHubTools } from "../packages/workspace/github.ts";
import type { TerminalHost } from "../packages/workspace/terminal.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gen-reviewdata-")),
    source = join(root, "source");
  await mkdir(source);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", source, ...args], { encoding: "utf8", windowsHide: true }).trim();
  git("init");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "core.autocrlf", "false");
  await writeFile(join(source, "one.txt"), "base\n");
  await writeFile(join(source, "one.txt.extra"), "neighbor\n");
  git("add", ".");
  git("commit", "-m", "Base");
  git("remote", "add", "origin", "https://github.com/example/fixture.git");
  const store = new Store(join(root, "data")),
    tools = new ProjectTools(store);
  cleanup.push(async () => {
    await tools.dispose();
    store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const receipt = await tools.connect({
    id: "connect",
    type: "workspace.project.connect",
    payload: { name: "Fixture", path: source },
  });
  const projectId = (receipt.result as { projects: { id: string }[] }).projects[0].id;
  const thread = {
    id: "main",
    title: "Main",
    projectId,
    projectName: "Fixture",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "ready" as const,
    epoch: 0,
    runId: null,
    modelId: null,
    sessionPath: null,
    kind: "main" as const,
  };
  store.internal("fixture", null, () => store.put("thread", thread.id, thread.id, thread));
  await tools.prepareWorkspace(thread);
  return { tools, store, projectId, source, path: (await tools.binding(projectId, "main")).path };
}

it("reads index and worktree overlap separately and binds selected patches to the complete revision", async () => {
  const { tools, projectId, path } = await fixture();
  expect(tools.gitComparison).toBeTypeOf("function");
  await writeFile(join(path, "one.txt"), "staged\n");
  await tools.gitAction(projectId, "main", {
    type: "stage",
    paths: ["one.txt"],
    revision: (await tools.gitStatus(projectId, "main")).revision,
  });
  await writeFile(join(path, "one.txt"), "worktree\n");
  await writeFile(join(path, "one.txt.extra"), "unrelated\n");
  const staged = await tools.gitComparison(projectId, "main", { scope: "staged" });
  const worktree = await tools.gitComparison(projectId, "main", { scope: "worktree" });
  expect(staged.state).toBe("ready");
  expect(worktree.state).toBe("ready");
  if (staged.state !== "ready" || worktree.state !== "ready") throw Error("Expected comparisons");
  expect(staged.value.files[0]).toMatchObject({ path: "one.txt", index: "M", worktree: "M" });
  const indexPatch = await tools.gitComparisonFile(projectId, "main", {
    comparisonId: staged.value.identity.id,
    path: "one.txt",
  });
  const workPatch = await tools.gitComparisonFile(projectId, "main", {
    comparisonId: worktree.value.identity.id,
    path: "one.txt",
  });
  expect(indexPatch.text).toContain("-base");
  expect(indexPatch.text).toContain("+staged");
  expect(indexPatch.text).not.toContain("worktree");
  expect(workPatch.text).toContain("-staged");
  expect(workPatch.text).toContain("+worktree");
  expect(workPatch.text).not.toContain("unrelated");
  await writeFile(join(path, "one.txt.extra"), "changed again\n");
  await expect(
    tools.gitComparisonFile(projectId, "main", { comparisonId: worktree.value.identity.id, path: "one.txt" }),
  ).rejects.toMatchObject({ code: "REVISION_CHANGED" });
}, 60000);

it("reports clean, untracked text, binary and bounded large patches honestly", async () => {
  const { tools, projectId, path } = await fixture();
  const clean = await tools.gitComparison(projectId, "main", { scope: "worktree" });
  expect(clean.state).toBe("empty");
  await writeFile(join(path, "new [x].txt"), "untracked content\n");
  await writeFile(join(path, "binary.dat"), Buffer.from([0, 1, 2]));
  await writeFile(join(path, "one.txt"), "large line\n".repeat(60000));
  const comparison = await tools.gitComparison(projectId, "main", { scope: "worktree" });
  if (comparison.state !== "ready") throw Error("Expected comparison");
  const file = (name: string) =>
    tools.gitComparisonFile(projectId, "main", { comparisonId: comparison.value.identity.id, path: name });
  expect(await file("new [x].txt")).toMatchObject({
    state: "untracked",
    text: expect.stringContaining("+untracked content"),
  });
  expect(await file("binary.dat")).toMatchObject({ state: "binary", text: null });
  expect(await file("one.txt")).toMatchObject({ state: "truncated", text: null });
  await expect(file("../outside")).rejects.toBeDefined();
}, 60000);

const base = "a".repeat(40),
  head = "b".repeat(40),
  mergeBase = "c".repeat(40);
async function remoteFixture() {
  const local = await fixture(),
    github = new GitHubTools(local.tools, {} as TerminalHost);
  const item = {
    id: "PR_fixture",
    number: 12,
    title: "<script>inert</script>",
    url: "https://github.com/example/fixture/pull/12",
    baseRefOid: base,
    headRefOid: head,
    baseRefName: "main",
    headRefName: "feature",
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        name: "unit",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://github.com/example/fixture/actions/runs/1",
      },
      { __typename: "StatusContext", context: "lint", state: "PENDING", targetUrl: null },
    ],
  };
  const response: {
    base_commit: { sha: string };
    merge_base_commit: { sha: string };
    status: string;
    files: {
      sha: string;
      filename: string;
      previous_filename?: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
    }[];
  } = {
    base_commit: { sha: base },
    merge_base_commit: { sha: mergeBase },
    status: "ahead",
    files: [
      {
        sha: "d".repeat(40),
        filename: "renamed [x].txt",
        previous_filename: "old.txt",
        status: "renamed",
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: "@@ -1 +1 @@\n-remote base\n+remote head",
      },
    ],
  };
  const run = vi.fn(async (_path: string, args: string[]) => {
    if (
      JSON.stringify(args) ===
      JSON.stringify([
        "pr",
        "view",
        "12",
        "--repo",
        "example/fixture",
        "--json",
        "id,number,title,url,baseRefOid,headRefOid,baseRefName,headRefName,statusCheckRollup",
      ])
    )
      return JSON.stringify(item);
    if (JSON.stringify(args) === JSON.stringify(["api", `repos/example/fixture/compare/${base}...${head}?per_page=1`]))
      return JSON.stringify(response);
    throw Error("Unexpected transport: " + JSON.stringify(args));
  });
  (github as unknown as { run: typeof run }).run = run;
  return { ...local, github, item, response, run };
}
it("pins remote PR patches to exact three-dot identity without substituting local unstaged changes", async () => {
  const { github, tools, projectId, path, item } = await remoteFixture();
  expect(github.comparison).toBeTypeOf("function");
  await writeFile(join(path, "one.txt"), "LOCAL MUST NEVER APPEAR\n");
  vi.spyOn(tools, "gitStatus").mockRejectedValue(Error("Remote reads must not require a local matching head"));
  const result = await github.comparison(projectId, "main", 12);
  expect(result.state).toBe("ready");
  if (result.state !== "ready") throw Error("Expected remote");
  expect(result.value.identity).toMatchObject({
    kind: "pull-request",
    repo: "example/fixture",
    number: 12,
    pullRequestId: "PR_fixture",
    baseOid: base,
    headOid: head,
    mergeBaseOid: mergeBase,
    semantics: "merge-base",
  });
  expect(result.value.checks).toEqual([
    { name: "unit", status: "passed" },
    { name: "lint", status: "pending" },
  ]);
  item.headRefOid = "e".repeat(40);
  const patch = await github.comparisonFile(projectId, "main", {
    comparisonId: result.value.identity.id,
    path: "renamed [x].txt",
  });
  expect(patch.text).toContain("+remote head");
  expect(patch.text).not.toContain("LOCAL");
  expect(patch.identity.headOid).toBe(head);
  await expect(
    github.comparisonFile(projectId, "main", { comparisonId: result.value.identity.id, path: "one.txt" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
}, 60000);

it("returns explicit transport errors and never calls a local diff as fallback", async () => {
  const { github, tools, projectId, run } = await remoteFixture();
  run.mockRejectedValue(Error("private-token must not leak"));
  const status = vi.spyOn(tools, "gitStatus");
  const result = await github.comparison(projectId, "main", 12);
  expect(result).toMatchObject({ state: "error", error: { code: "COMPARISON_UNAVAILABLE" } });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(status).not.toHaveBeenCalled();
}, 60000);

it("reads staged deletions and renames by exact selected paths", async () => {
  const { tools, projectId, path } = await fixture();
  await tools.git(path, ["rm", "--", "one.txt"]);
  await tools.git(path, ["mv", "--", "one.txt.extra", "renamed [a].txt"]);
  const result = await tools.gitComparison(projectId, "main", { scope: "staged" });
  expect(result.state).toBe("ready");
  if (result.state !== "ready") throw Error(JSON.stringify(result));
  expect(result.value.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "one.txt", index: "D" }),
      expect.objectContaining({ path: "renamed [a].txt", oldPath: "one.txt.extra", index: "R" }),
    ]),
  );
  const read = (path: string) =>
    tools.gitComparisonFile(projectId, "main", { comparisonId: result.value.identity.id, path });
  expect((await read("one.txt")).text).toContain("-base");
  expect((await read("renamed [a].txt")).text).toContain("rename from one.txt.extra");
}, 60000);

it("keeps legacy reads tracked-only and can compare a remote PR without a managed checkout or matching HEAD", async () => {
  const { tools, github, projectId, source, item, run } = await remoteFixture();
  await writeFile(join(source, "untracked-private.txt"), "PRIVATE untracked");
  await writeFile(join(source, "one.txt"), "legacy tracked change\n");
  const local = await tools.gitComparison(projectId, undefined, { scope: "worktree" });
  expect(local.state).toBe("ready");
  if (local.state !== "ready") throw Error("Expected legacy");
  expect(local.value.access).toEqual({ mode: "legacy", untrackedIncluded: false });
  expect(local.value.files.map((file) => file.path)).toEqual(["one.txt"]);
  expect(
    (await tools.gitComparisonFile(projectId, undefined, { comparisonId: local.value.identity.id, path: "one.txt" }))
      .text,
  ).toContain("+legacy tracked change");
  expect(item.headRefOid).not.toBe(local.value.identity.headOid);
  expect((await github.comparison(projectId, undefined, 12)).state).toBe("ready");
  expect(run).toHaveBeenCalledTimes(2);
}, 60000);

it("denies delegates, Company, cross-project and replaced-directory reads before remote transport", async () => {
  const { tools, github, store, projectId, source, run } = await remoteFixture();
  const thread = store.get<Record<string, unknown>>("thread", "main");
  if (!thread) throw Error("Missing fixture thread");
  store.internal("fixture", null, () => {
    store.put("thread", "child", "child", { ...thread, id: "child", kind: "delegate" });
    store.put("thread", "other", "other", { ...thread, id: "other", projectId: "another" });
    store.put("workspaceProject", "company", null, {
      id: "company",
      authority: { kind: "company", companyId: "fixture" },
    });
  });
  for (const id of ["child", "other"]) {
    await expect(tools.gitComparison(projectId, id, { scope: "worktree" })).rejects.toMatchObject({
      code: "CAPABILITY_DENIED",
    });
    await expect(github.comparison(projectId, id, 12)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  }
  await expect(tools.gitComparison("company", undefined, { scope: "worktree" })).rejects.toMatchObject({
    code: "CAPABILITY_DENIED",
  });
  await rename(source, source + "-original");
  await mkdir(source);
  await expect(github.comparison(projectId, undefined, 12)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  expect(run).not.toHaveBeenCalled();
}, 60000);

it("keeps snapshots isolated from returned mutable data and never accepts another owner", async () => {
  const { github, projectId } = await remoteFixture();
  const result = await github.comparison(projectId, "main", 12);
  if (result.state !== "ready") throw Error("Expected remote");
  const id = result.value.identity.id;
  result.value.identity.headOid = "f".repeat(40);
  result.value.files[0].path = "changed-by-consumer";
  const patch = await github.comparisonFile(projectId, "main", { comparisonId: id, path: "renamed [x].txt" });
  expect(patch.identity.headOid).toBe(head);
  expect(patch.file.path).toBe("renamed [x].txt");
  await expect(
    github.comparisonFile(projectId, undefined, { comparisonId: id, path: "renamed [x].txt" }),
  ).rejects.toMatchObject({ code: "COMPARISON_EXPIRED" });
}, 60000);

it("distinguishes omitted, binary and incomplete remote patches without fetching metadata URLs", async () => {
  const { github, projectId, response, run } = await remoteFixture();
  response.files = [
    { sha: "d".repeat(40), filename: "binary.dat", status: "modified", additions: 0, deletions: 0, changes: 0 },
    { sha: "e".repeat(40), filename: "omitted.txt", status: "modified", additions: 5, deletions: 3, changes: 8 },
    {
      sha: "f".repeat(40),
      filename: "partial.txt",
      status: "modified",
      additions: 20,
      deletions: 3,
      changes: 23,
      patch: "@@ -1 +1 @@\n-one\n+two",
    },
  ] as typeof response.files;
  const original = run.getMockImplementation();
  if (!original) throw Error("Missing fixture transport");
  run.mockImplementation(async (path, args) => {
    if (JSON.stringify(args) === JSON.stringify(["api", `repos/example/fixture/git/blobs/${"d".repeat(40)}`]))
      return JSON.stringify({
        sha: "d".repeat(40),
        size: 3,
        encoding: "base64",
        content: Buffer.from([0, 1, 2]).toString("base64"),
      });
    if (JSON.stringify(args) === JSON.stringify(["api", `repos/example/fixture/git/blobs/${"e".repeat(40)}`]))
      return JSON.stringify({
        sha: "e".repeat(40),
        size: 5,
        encoding: "base64",
        content: Buffer.from("plain").toString("base64"),
      });
    return original(path, args);
  });
  const result = await github.comparison(projectId, "main", 12);
  if (result.state !== "ready") throw Error("Expected remote");
  const read = (path: string) =>
    github.comparisonFile(projectId, "main", { comparisonId: result.value.identity.id, path });
  expect(await read("binary.dat")).toMatchObject({ state: "binary", text: null });
  expect(await read("omitted.txt")).toMatchObject({ state: "unavailable", text: null, reason: "patch-omitted" });
  expect(await read("partial.txt")).toMatchObject({ state: "truncated", text: null });
  expect(run).toHaveBeenCalledTimes(4);
}, 60000);

it("never reads a hardlinked changed file into a patch", async () => {
  const { tools, projectId, path } = await fixture();
  await link(join(path, "one.txt"), join(path, "unowned-link.txt"));
  await writeFile(join(path, "one.txt"), "must remain unavailable\n");
  const result = await tools.gitComparison(projectId, "main", { scope: "worktree" });
  expect(result.state).toBe("ready");
  if (result.state !== "ready") throw Error(JSON.stringify(result));
  const patch = await tools.gitComparisonFile(projectId, "main", {
    comparisonId: result.value.identity.id,
    path: "one.txt",
  });
  expect(patch).toMatchObject({ state: "unavailable", text: null, reason: "unsupported-file" });
}, 60000);

it("reads an already-attested remote origin without a source Git checkout or source file projection", async () => {
  const { github, projectId, source, run } = await remoteFixture();
  await rename(join(source, ".git"), join(source, "retained-git-metadata"));
  const result = await github.comparison(projectId, undefined, 12);
  expect(result.state).toBe("ready");
  expect(run).toHaveBeenCalledTimes(2);
}, 60000);

it("rejects mismatched remote identities and reports empty and capped file inventories honestly", async () => {
  const { github, projectId, response, item } = await remoteFixture();
  response.base_commit.sha = "f".repeat(40);
  expect(await github.comparison(projectId, "main", 12)).toMatchObject({
    state: "error",
    error: { code: "COMPARISON_IDENTITY_CHANGED" },
  });
  response.base_commit.sha = base;
  response.files = [];
  expect(await github.comparison(projectId, "main", 12)).toMatchObject({
    state: "empty",
    value: { filesTruncated: false },
  });
  response.files = Array.from({ length: 300 }, (_, i) => ({
    sha: "d".repeat(40),
    filename: `file-${i}`,
    status: "modified",
    additions: 0,
    deletions: 0,
    changes: 0,
    patch: "",
  }));
  expect(await github.comparison(projectId, "main", 12)).toMatchObject({
    state: "ready",
    value: { filesTruncated: true },
  });
  item.url = "https://attacker.invalid/metadata";
  expect(await github.comparison(projectId, "main", 12)).toMatchObject({
    state: "error",
    error: { code: "COMPARISON_IDENTITY_CHANGED" },
  });
}, 60000);
