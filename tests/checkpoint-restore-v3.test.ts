import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/store.ts";
import { checkpointScope } from "../packages/workspace/edit-journal.ts";
import { CheckpointService } from "../packages/workspace/checkpoints.ts";
import { readCheckpointDetail, readCheckpointList, readCheckpointReview } from "../apps/web/src/file-checkpoint-api.ts";
import type { CheckpointOwner } from "../apps/web/src/file-checkpoint-api.ts";

const roots: string[] = [];
const stores: Store[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "harness-checkpoint-v3-"));
  roots.push(root);
  const store = new Store(join(root, "state"));
  stores.push(store);
  const project = join(root, "project");
  await mkdir(project);
  const service = new CheckpointService(store);
  const owner = checkpointScope({ projectId: "project", threadId: "thread", workingCopyId: "wc-1", binding: { path: project } });
  return { root, store, project, service, owner };
}

const adapter = (owner: CheckpointOwner) => owner;

it("captures approved files and keeps excluded files visible as outside coverage", async () => {
  const { project, service, owner } = await fixture();
  await writeFile(join(project, "code.ts"), "export const a = 1;\n");
  await writeFile(join(project, ".env"), "TOKEN=secret\n");
  await writeFile(join(project, "blob.bin"), Buffer.from([0, 1, 2, 0, 3]));
  const checkpoint = await service.create({ owner, root: project, paths: ["code.ts", ".env", "blob.bin"], label: "cut-1" });
  expect(checkpoint.files.map((file) => file.path)).toEqual(["code.ts"]);
  expect(checkpoint.exclusions).toEqual([
    { path: ".env", reason: "secret" },
    { path: "blob.bin", reason: "binary" },
  ]);
  // The provider payloads satisfy the frozen adapter contract.
  const list = readCheckpointList(await service.list(owner), adapter(owner));
  expect(list.items).toHaveLength(1);
  const detail = readCheckpointDetail(await service.detail(owner, checkpoint.id), adapter(owner), list.items[0]!);
  const env = detail.files.find((file) => file.path === ".env")!;
  expect(env.restorable).toBe(false);
  expect(env.reason).toBe("unsupported");
  expect(detail.files.find((file) => file.path === "code.ts")!.restorable).toBe(true);
});

it("reviews a checkpoint with bounded side-by-side diffs", async () => {
  const { project, service, owner } = await fixture();
  await writeFile(join(project, "code.ts"), "old\nshared\n");
  const checkpoint = await service.create({ owner, root: project, paths: ["code.ts"] });
  await writeFile(join(project, "code.ts"), "new\nshared\n");
  const detail = readCheckpointDetail(await service.detail(owner, checkpoint.id), adapter(owner), (await service.list(owner)).items[0]!);
  const review = readCheckpointReview(await service.review(owner, checkpoint.id, { paths: ["code.ts"], root: project }), adapter(owner), detail.checkpoint, ["code.ts"]);
  const file = review.files[0]!;
  expect(file.status).toBe("ready");
  // The diff shows what restoring changes: current (-) becomes target (+).
  expect(file.diff).toContain("-new");
  expect(file.diff).toContain("+old");
});

it("restores selected paths exactly with a recorded pre-restore checkpoint", async () => {
  const { project, service, owner, store } = await fixture();
  await writeFile(join(project, "a.txt"), "a-old\n");
  await writeFile(join(project, "b.txt"), "b-old\n");
  const checkpoint = await service.create({ owner, root: project, paths: ["a.txt", "b.txt"] });
  await writeFile(join(project, "a.txt"), "a-new\n");
  await writeFile(join(project, "b.txt"), "b-new\n");
  const plan = await service.planRestore(owner, { checkpointId: checkpoint.id, root: project, selectedPaths: ["a.txt"], approvalId: "approval-1" });
  expect(plan.state).toBe("PREVIEW");
  const applied = await service.applyRestore(owner, { planId: plan.id, approvalId: "approval-1", root: project });
  expect(applied.state).toBe("APPLIED");
  expect(applied.preRestoreCheckpointId).toBeTruthy();
  expect((await readFile(join(project, "a.txt"), "utf8"))).toBe("a-new\n".replace("a-new", "a-old"));
  expect((await readFile(join(project, "b.txt"), "utf8"))).toBe("b-new\n");
  const backup = store.get<{ id: string }>("workspaceCheckpoint", applied.preRestoreCheckpointId!);
  expect(backup).toBeTruthy();
});

it("rolls written files back on a conflict and reports CONFLICT", async () => {
  const { project, service, owner } = await fixture();
  await writeFile(join(project, "a.txt"), "a-old\n");
  await writeFile(join(project, "b.txt"), "b-old\n");
  const checkpoint = await service.create({ owner, root: project, paths: ["a.txt", "b.txt"] });
  const plan = await service.planRestore(owner, { checkpointId: checkpoint.id, root: project, selectedPaths: ["a.txt", "b.txt"], approvalId: "approval-2" });
  // External change lands between preview and apply on the second file only.
  await writeFile(join(project, "b.txt"), "b-external\n");
  const applied = await service.applyRestore(owner, { planId: plan.id, approvalId: "approval-2", root: project });
  expect(applied.state).toBe("CONFLICT");
  expect(applied.conflicts).toEqual(["b.txt"]);
  // The applied file was rolled back to its preview bytes.
  expect((await readFile(join(project, "a.txt"), "utf8"))).toBe("a-old\n");
  expect((await readFile(join(project, "b.txt"), "utf8"))).toBe("b-external\n");
});

it("recreates a file the working copy deleted", async () => {
  const { project, service, owner } = await fixture();
  await writeFile(join(project, "a.txt"), "a-old\n");
  const checkpoint = await service.create({ owner, root: project, paths: ["a.txt"] });
  await rm(join(project, "a.txt"));
  const review = await service.review(owner, checkpoint.id, { paths: ["a.txt"], root: project });
  expect(review.files[0]!.status).toBe("missing");
  expect(review.files[0]!.targetHash).toBeTruthy();
  const plan = await service.planRestore(owner, { checkpointId: checkpoint.id, root: project, selectedPaths: ["a.txt"], approvalId: "approval-del" });
  const applied = await service.applyRestore(owner, { planId: plan.id, approvalId: "approval-del", root: project });
  expect(applied.state).toBe("APPLIED");
  expect((await readFile(join(project, "a.txt"), "utf8"))).toBe("a-old\n");
});

it("conflicts rather than overwrite content the recovery checkpoint cannot hold", async () => {
  const { project, service, owner } = await fixture();
  await writeFile(join(project, "a.txt"), "a-old\n");
  await writeFile(join(project, "b.txt"), "b-old\n");
  const checkpoint = await service.create({ owner, root: project, paths: ["a.txt", "b.txt"] });
  // a.txt is now binary: the pre-restore checkpoint cannot back it up.
  await writeFile(join(project, "a.txt"), Buffer.from([0, 1, 2, 0, 3]));
  const plan = await service.planRestore(owner, { checkpointId: checkpoint.id, root: project, selectedPaths: ["a.txt", "b.txt"], approvalId: "approval-bin" });
  const applied = await service.applyRestore(owner, { planId: plan.id, approvalId: "approval-bin", root: project });
  expect(applied.state).toBe("CONFLICT");
  expect(applied.conflicts).toEqual(["a.txt"]);
  expect(Buffer.from(await readFile(join(project, "a.txt")))).toEqual(Buffer.from([0, 1, 2, 0, 3]));
  expect((await readFile(join(project, "b.txt"), "utf8"))).toBe("b-old\n");
});

it("requires the exact approval for a restore plan", async () => {
  const { project, service, owner } = await fixture();
  await writeFile(join(project, "a.txt"), "a-old\n");
  const checkpoint = await service.create({ owner, root: project, paths: ["a.txt"] });
  const plan = await service.planRestore(owner, { checkpointId: checkpoint.id, root: project, selectedPaths: ["a.txt"], approvalId: "approval-3" });
  await expect(service.applyRestore(owner, { planId: plan.id, approvalId: "wrong", root: project })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});

it("refuses restore of a checkpoint whose blobs expired and reports MISSING blobs", async () => {
  const { project, service, owner, store, root } = await fixture();
  await writeFile(join(project, "a.txt"), "a-old\n");
  const checkpoint = await service.create({ owner, root: project, paths: ["a.txt"] });
  const blob = join(root, "state", "checkpoint-store", "blobs", checkpoint.files[0]!.blobRef);
  await rm(blob);
  const detail = await service.detail(owner, checkpoint.id);
  expect(detail.files[0]!.bytes).toBe(0);
  expect(store.get<{ retention: string }>("workspaceCheckpoint", checkpoint.id)!.retention).toBe("MISSING");
  await expect(service.planRestore(owner, { checkpointId: checkpoint.id, root: project, selectedPaths: ["a.txt"], approvalId: "x" })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});

it("collects unreferenced blobs only", async () => {
  const { project, service, owner, store } = await fixture();
  await writeFile(join(project, "a.txt"), "a-old\n");
  const checkpoint = await service.create({ owner, root: project, paths: ["a.txt"] });
  const orphan = join(store.dataDir, "checkpoint-store", "blobs", "0".repeat(64));
  await mkdir(join(store.dataDir, "checkpoint-store", "blobs"), { recursive: true });
  await writeFile(orphan, "orphan");
  const result = await service.collectGarbage();
  expect(result.removed).toBe(1);
  await expect(readFile(join(store.dataDir, "checkpoint-store", "blobs", checkpoint.files[0]!.blobRef))).resolves.toBeTruthy();
  await expect(readFile(orphan)).rejects.toThrow();
});

it("provisions only manifest-pinned non-secret files", async () => {
  const { service, root } = await fixture();
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source);
  await mkdir(target);
  await writeFile(join(source, "example.json"), '{ "ok": true }\n');
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(await readFile(join(source, "example.json"))).digest("hex");
  const manifest = { version: 1 as const, id: "manifest-1", entries: [{ path: "example.json", digest, bytes: Buffer.byteLength('{ "ok": true }\n') }], approvedBy: "reviewer-1" };
  const result = await service.provisionManifest(manifest, source, target);
  expect(result.copied).toEqual(["example.json"]);
  expect((await readFile(join(target, "example.json"), "utf8"))).toBe('{ "ok": true }\n');
  await expect(service.provisionManifest({ ...manifest, entries: [{ path: ".env", digest, bytes: 10 }] }, source, target)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});

it("selects exactly one repository or an approved recipe in a group", async () => {
  const { service, store } = await fixture();
  const identity = { dev: "1", ino: "2" };
  const group = {
    version: 1 as const,
    id: "group-1",
    repositories: [
      { repositoryId: "repo-a", worktreeBinding: "a".repeat(64), commonDirectoryIdentity: identity },
      { repositoryId: "repo-b", worktreeBinding: "b".repeat(64), commonDirectoryIdentity: identity },
    ],
  };
  expect(service.selectRepository(group, { repositoryId: "repo-a" }).map((entry) => entry.repositoryId)).toEqual(["repo-a"]);
  expect(() => service.selectRepository(group, {})).toThrow(expect.objectContaining({ code: "CAPABILITY_DENIED" }));
  expect(() => service.selectRepository(group, { repositoryId: "repo-c" })).toThrow(expect.objectContaining({ code: "CAPABILITY_DENIED" }));
  store.internal("fixture.recipe", null, () => store.put("workspaceRepositoryRecipe", "recipe-1", null, { id: "recipe-1", repositories: ["repo-a", "repo-b"] }));
  expect(service.selectRepository(group, { recipeId: "recipe-1" })).toHaveLength(2);
});
