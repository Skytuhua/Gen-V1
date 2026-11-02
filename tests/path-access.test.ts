import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rename, symlink, unlink, rm, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Store } from "../packages/storage/store.ts";
import { Service } from "../packages/core/service.ts";
import { buildServer } from "../apps/server/server.ts";
import type { RuntimeAdapter, ResourceGrant, Thread, Operation } from "../packages/contracts/index.ts";
import { withResourceGrant, readBoundFile, withPathGuard, replaceOwnedFile, removeOwnedFile } from "../packages/core/file-access.ts";
import { handleDomainTool, executeDomainOperation, type DomainContext } from "../packages/capabilities/index.ts";
import { stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { PDFDocument } from "pdf-lib";
import { renameSync, statSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
const race = vi.hoisted(() => ({ beforeWorker: undefined as ((path: string) => void) | undefined, beforeGit: undefined as ((args: string[], cwd: string) => void) | undefined }));
// Inject at the real process boundary, retaining the actual Git executable and output.
vi.mock("../packages/capabilities/process.ts", async importOriginal => {
  const original = await importOriginal<typeof import("../packages/capabilities/process.ts")>();
  return { ...original, runProcess: (...args: Parameters<typeof original.runProcess>) => {
    if (args[0] === "git") race.beforeGit?.(args[1], args[2]);
    return original.runProcess(...args);
  } };
});
// Retain the real SQLite worker; inject the swap at its actual process boundary.
vi.mock("node:worker_threads", async importOriginal => {
  const original = await importOriginal<typeof import("node:worker_threads")>();
  return { ...original, Worker: class extends original.Worker {
    constructor(filename: string | URL, options?: import("node:worker_threads").WorkerOptions) {
      if (typeof options?.workerData?.path === "string") race.beforeWorker?.(options.workerData.path);
      super(filename, options);
    }
  } };
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { race.beforeWorker = undefined; race.beforeGit = undefined; vi.restoreAllMocks(); for (const clean of cleanups.splice(0).reverse()) await clean(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "harness-path-access-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "storage"));
  const runtime: RuntimeAdapter = { configure() {}, async models() { return []; }, async start() {}, async followUp() {}, async cancel() {}, async compact() {}, async history() { return []; }, async dispose() {} };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: true });
  cleanups.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const thread = (await service.command({ id: randomUUID(), type: "thread.create", payload: { title: "Disposable filesystem test" } })).result as Thread;
  const grant = async (path: string, kind: ResourceGrant["kind"] = "file", writable = false) => (await service.command({ id: randomUUID(), type: "resource.grant", threadId: thread.id, payload: { path, kind, writable } })).result as ResourceGrant;
  const boot = await app.inject({ url: "/api/bootstrap", headers: { host: "127.0.0.1:4317" } });
  const headers = { host: "127.0.0.1:4317", cookie: String(boot.headers["set-cookie"]).split(";")[0] };
  return { root, store, service, app, thread, grant, headers };
}
function context(f: Awaited<ReturnType<typeof fixture>>, grant: ResourceGrant): DomainContext {
  return {
    threadId: f.thread.id, signal: new AbortController().signal,
    resolveResource: (_id, path, write) => f.service.resolveResource(f.thread.id, grant.id, path, write),
    withResource: (_id, path, write, action) => withResourceGrant(grant, f.store.dataDir, path, write, new AbortController().signal, action),
    publishData: (value, provenance) => f.service.publishData(f.thread.id, value, provenance),
    prepareOperation(kind, args, resourceIds, preconditions, description) { return { id: randomUUID(), threadId: f.thread.id, revision: 1, kind, args, resourceIds, preconditions, description, approved: false, status: "prepared", createdAt: new Date().toISOString() }; },
    progress() {},
  };
}
const approve = (operation: Operation): Operation => ({ ...operation, approved: true, status: "running" });

it("denies resource content when its parent becomes a protected junction after resolveResource", async () => {
  const f = await fixture(), selected = join(f.root, "selected"), pi = join(f.store.dataDir, "pi");
  await mkdir(selected); await mkdir(pi);
  await writeFile(join(selected, "note.txt"), "PUBLIC"); await writeFile(join(pi, "note.txt"), "TEMPORARY PRIVATE SENTINEL");
  const grant = await f.grant(join(selected, "note.txt"));
  const resolve = f.service.resolveResource.bind(f.service);
  vi.spyOn(f.service, "resolveResource").mockImplementation(async (...args) => {
    const path = await resolve(...args);
    await rename(selected, selected + "-original"); await symlink(pi, selected, "junction");
    cleanups.push(() => unlink(selected));
    return path;
  });
  const response = await f.app.inject({ url: `/api/resources/${grant.id}/content`, headers: f.headers });
  expect(response.statusCode).toBe(403);
  expect(response.body).not.toContain("TEMPORARY PRIVATE SENTINEL");
});

it.each(["pi", "artifacts", "official"])("rejects grants when protected %s is redirected to an external directory", async child => {
  const f = await fixture(), target = join(f.root, "redirected-private"); await mkdir(target);
  await writeFile(join(target, "note.txt"), "TEMPORARY PRIVATE SENTINEL");
  const redirected = join(f.store.dataDir, child); await symlink(target, redirected, "junction");
  cleanups.push(() => unlink(redirected));
  await expect(f.grant(join(target, "note.txt"))).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});
it.each(['claude-code','gemini-cli'])('denies native %s storage both directly and through an ancestor grant',async provider=>{
  const f=await fixture(),home=join(f.store.dataDir,'official',provider,'home');await mkdir(home,{recursive:true});
  const secret=join(home,'synthetic-credential.json');await writeFile(secret,'DISPOSABLE NATIVE CREDENTIAL SENTINEL');
  await expect(f.grant(secret)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
  const parent=await f.grant(f.root,'project');
  await expect(f.service.resolveResource(f.thread.id,parent.id,`storage/official/${provider}/home/synthetic-credential.json`,false)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
});

it("denies a hardlink alias of a protected temporary file", async () => {
  const f = await fixture(), pi = join(f.store.dataDir, "pi"); await mkdir(pi);
  const secret = join(pi, "note.txt"), alias = join(f.root, "alias.txt");
  await writeFile(secret, "TEMPORARY PRIVATE SENTINEL"); await link(secret, alias);
  await expect(f.grant(alias)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  expect(await readFile(secret, "utf8")).toBe("TEMPORARY PRIVATE SENTINEL");
});

it("denies alternate streams and device namespace spellings at grant admission", async () => {
  const f = await fixture(), path = join(f.root, "note.txt"); await writeFile(path, "TEMPORARY SENTINEL");
  await expect(f.grant(path + "::$DATA")).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  await expect(f.grant("\\\\?\\" + path)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});

it("serves approved ordinary bytes and holds every directory ancestor through final access", async () => {
  const f = await fixture(), folder = join(f.root, "selected"); await mkdir(folder);
  const path = join(folder, "note-雪-$(not-a-command).txt"); await writeFile(path, "PUBLIC"); const grant = await f.grant(path);
  const response = await f.app.inject({ url: `/api/resources/${grant.id}/content`, headers: f.headers });
  expect(response.statusCode).toBe(200); expect(response.body).toBe("PUBLIC");
  await withResourceGrant(grant, f.store.dataDir, undefined, false, new AbortController().signal, async stable => {
    await expect(rename(folder, folder + "-moved")).rejects.toMatchObject({ code: expect.stringMatching(/^(EPERM|EACCES|EBUSY)$/) });
    expect((await readBoundFile(stable, 100)).toString()).toBe("PUBLIC");
  });
  await rename(folder, folder + "-moved");
});

it("allows ordinary child replacement while its parent directory is guarded", async () => {
  const f = await fixture(), a = join(f.root, "a.txt"), b = join(f.root, "b.txt");
  await writeFile(a, "after"); await writeFile(b, "before");
  const identity = await stat(a, { bigint: true });
  await withPathGuard([{ path: f.root, leaf: false }], new AbortController().signal, async () => { await replaceOwnedFile(a, b, identity, createHash("sha256").update("after").digest("hex"), new AbortController().signal); });
  expect(await readFile(b, "utf8")).toBe("after");
});

it("rejects a substituted replacement source and preserves a nonowned cleanup inode", async () => {
  const f = await fixture(), a = join(f.root, "a.txt"), b = join(f.root, "b.txt");
  await writeFile(a, "after"); await writeFile(b, "before"); const identity = await stat(a, { bigint: true });
  await rename(a, a + ".original"); await writeFile(a, "concurrent bytes");
  await expect(replaceOwnedFile(a, b, identity, createHash("sha256").update("after").digest("hex"), new AbortController().signal)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  await removeOwnedFile(a, identity, new AbortController().signal);
  expect(await readFile(a, "utf8")).toBe("concurrent bytes"); expect(await readFile(b, "utf8")).toBe("before");
});

it("denies an approved replacement after the resolved parent is swapped to protected storage", async () => {
  const f = await fixture(), folder = join(f.root, "selected"), pi = join(f.store.dataDir, "pi"); await mkdir(folder); await mkdir(pi);
  const path = join(folder, "note.txt"), sentinel = join(pi, "note.txt"); await writeFile(path, "before"); await writeFile(sentinel, "TEMPORARY PRIVATE SENTINEL");
  const grant = await f.grant(path, "file", true), ctx = context(f, grant);
  const op = await handleDomainTool("file_replace_prepare", { resourceId: grant.id, content: "after", expectedSha256: createHash("sha256").update("before").digest("hex") }, ctx) as Operation;
  ctx.withResource = undefined;
  ctx.resolveResource = async () => { const resolved = await f.service.resolveResource(f.thread.id, grant.id, undefined, true); await rename(folder, folder + ".original"); await symlink(pi, folder, "junction"); cleanups.push(() => unlink(folder)); return resolved; };
  await expect(executeDomainOperation(approve(op), ctx)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  expect(await readFile(sentinel, "utf8")).toBe("TEMPORARY PRIVATE SENTINEL"); expect(await readFile(join(folder + ".original", "note.txt"), "utf8")).toBe("before");
});

it("domain text reads do not follow a parent swap after the host resolver returns", async () => {
  const f = await fixture(), selected = join(f.root, "selected"), pi = join(f.store.dataDir, "pi");
  await mkdir(selected); await mkdir(pi); const path = join(selected, "note.txt");
  await writeFile(path, "PUBLIC"); await writeFile(join(pi, "note.txt"), "TEMPORARY PRIVATE SENTINEL");
  const grant = await f.grant(path);
  const ctx: DomainContext = {
    threadId: f.thread.id, signal: new AbortController().signal,
    async resolveResource() { const path = await f.service.resolveResource(f.thread.id, grant.id); await rename(selected, selected + "-original"); await symlink(pi, selected, "junction"); cleanups.push(() => unlink(selected)); return path; },
    publishData(value, provenance) { return f.service.publishData(f.thread.id, value, provenance); },
    prepareOperation() { throw new Error("Not used"); }, progress() {},
  };
  await expect(handleDomainTool("text_import", { resourceId: grant.id }, ctx)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});

it("keeps the original database parent and journal inode pinned through actual COMMIT", async () => {
  const f = await fixture(), folder = join(f.root, "selected"); await mkdir(folder);
  const path = join(folder, "data.sqlite"), db = new DatabaseSync(path);
  db.exec("CREATE TABLE notes(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO notes VALUES(1, 'before')"); db.close();
  const grant = await f.grant(path, "database", true), ctx = context(f, grant);
  const op = await handleDomainTool("database_prepare", { resourceId: grant.id, mode: "transaction", statements: [{ sql: "UPDATE notes SET value='after' WHERE id=1", expectedChanges: 1 }] }, ctx) as Operation;
  let mutationGuarded = false, sidecarGuarded = false;
  race.beforeWorker = opened => {
    expect(opened).toBe(path);
    expect(statSync(path + "-journal").size).toBe(0);
    try { renameSync(folder, folder + "-moved"); } catch { mutationGuarded = true; }
    try { renameSync(path + "-journal", path + "-stolen-journal"); } catch { sidecarGuarded = true; }
  };
  const result = await executeDomainOperation(approve(op), ctx) as { changes: number };
  expect(result.changes).toBe(1); expect(mutationGuarded).toBe(true); expect(sidecarGuarded).toBe(true);
  const observed = new DatabaseSync(path); expect(observed.prepare("SELECT value FROM notes").get()).toMatchObject({ value: "after" }); observed.close();
  await expect(stat(path + "-journal")).rejects.toMatchObject({ code: "ENOENT" });
});

it("denies preexisting SQLite journal aliases without changing their temporary sentinel", async () => {
  const f = await fixture(), path = join(f.root, "data.sqlite"), db = new DatabaseSync(path);
  db.exec("CREATE TABLE notes(value TEXT)"); db.close();
  const grant = await f.grant(path, "database", true), ctx = context(f, grant);
  const sentinel = join(f.root, "temporary-private"); await writeFile(sentinel, "TEMPORARY PRIVATE SENTINEL");
  await link(sentinel, path + "-journal");
  await expect(handleDomainTool("database_inspect", { resourceId: grant.id }, ctx)).rejects.toThrow();
  expect(await readFile(sentinel, "utf8")).toBe("TEMPORARY PRIVATE SENTINEL");
});

it("performs approved ordinary replacement and PDF export under native guards", async () => {
  const f = await fixture(), file = join(f.root, "note.txt"); await writeFile(file, "before");
  const grant = await f.grant(file, "file", true), ctx = context(f, grant);
  const operation = await handleDomainTool("file_replace_prepare", { resourceId: grant.id, content: "after", expectedSha256: createHash("sha256").update("before").digest("hex") }, ctx) as Operation;
  await executeDomainOperation(approve(operation), ctx); expect(await readFile(file, "utf8")).toBe("after");
  const pdf = await PDFDocument.create(); pdf.addPage(); const input = join(f.root, "source.pdf"); await writeFile(input, await pdf.save());
  const source = await f.grant(input), outputFolder = join(f.root, "exports"); await mkdir(outputFolder);
  const output = await f.grant(outputFolder, "export", true), sourceCtx = context(f, source), outputCtx = context(f, output);
  sourceCtx.withResource = (id, path, write, action) => (id === output.id ? outputCtx : context(f, source)).withResource!(id, path, write, action);
  sourceCtx.resolveResource = (id, path, write) => (id === output.id ? outputCtx : context(f, source)).resolveResource(id, path, write);
  const exportOp = await handleDomainTool("pdf_prepare", { resourceId: source.id, exportResourceId: output.id, outputPath: "result.pdf", fields: {} }, sourceCtx) as Operation;
  await executeDomainOperation(approve(exportOp), sourceCtx);
  expect((await PDFDocument.load(await readFile(join(outputFolder, "result.pdf")))).getPageCount()).toBe(1);
});

it('retains a user save made after the final capability read but before replacement',async()=>{
 const f=await fixture(),filename=join(f.root,'conditional.txt');await writeFile(filename,'before');const grant=await f.grant(filename,'file',true),ctx=context(f,grant),expected=createHash('sha256').update('before').digest('hex');const operation=await handleDomainTool('file_replace_prepare',{resourceId:grant.id,content:'approved replacement',expectedSha256:expected},ctx) as Operation;
 const access=ctx.withResource!;let reads=0;ctx.withResource=async(id,path,write,action)=>{const value=await access(id,path,write,action);if(!write&&++reads===2)await writeFile(filename,'concurrent user edit');return value;};
 await expect(executeDomainOperation(approve(operation),ctx)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});expect(reads).toBe(2);expect(await readFile(filename,'utf8')).toBe('concurrent user edit');
});

it('does not bypass another read-only destination lease during conditional replacement',async()=>{
 const f=await fixture(),source=join(f.root,'replace.tmp'),destination=join(f.root,'note.txt'),other=join(f.root,'other.tmp');await writeFile(source,'approved');await writeFile(destination,'before');await writeFile(other,'other');const identity=await stat(source,{bigint:true}),hash=(text:string)=>createHash('sha256').update(text).digest('hex'),signal=new AbortController().signal;
 await expect(withPathGuard([{path:destination,leaf:true,readOnly:true}],signal,async()=>{
  await expect(writeFile(destination,'late edit')).rejects.toBeDefined();await expect(rename(other,destination)).rejects.toBeDefined();
  await expect(replaceOwnedFile(source,destination,identity,hash('approved'),signal,hash('before'))).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 })).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 expect(await readFile(destination,'utf8')).toBe('before');expect(await readFile(source,'utf8')).toBe('approved');expect(await readFile(other,'utf8')).toBe('other');
});

it.each(["git-junction", "metadata-junction", "metadata-hardlink", "commondir", "alternates", "include", "includeIf", "filter"])("rejects Git metadata redirect %s before launching Git", async attack => {
  const f = await fixture(), project = join(f.root, "project"), outside = join(f.root, "outside"); await mkdir(project); await mkdir(outside);
  const initialized = spawnSync("git", ["init", "--quiet", project], { windowsHide: true, shell: false, encoding: "utf8" }); expect(initialized.status, initialized.stderr).toBe(0);
  const metadata = join(project, ".git"), config = join(metadata, "config"), sentinel = join(outside, "sentinel.txt"); await writeFile(sentinel, "TEMPORARY PRIVATE SENTINEL");
  if (attack === "git-junction") { await rename(metadata, join(outside, "metadata")); await symlink(join(outside, "metadata"), metadata, "junction"); cleanups.push(() => unlink(metadata)); }
  if (attack === "metadata-junction") { const redirect = join(metadata, "info", "redirect"); await symlink(outside, redirect, "junction"); cleanups.push(() => unlink(redirect)); }
  if (attack === "metadata-hardlink") await link(sentinel, join(metadata, "info", "alias"));
  if (attack === "commondir") await writeFile(join(metadata, "commondir"), outside);
  if (attack === "alternates") await writeFile(join(metadata, "objects", "info", "alternates"), outside);
  if (["include", "includeIf", "filter"].includes(attack)) await writeFile(config, (await readFile(config, "utf8")) + `\n[${attack}${attack === "includeIf" ? ' "gitdir:*"' : attack === "filter" ? ' "unsafe"' : ""}]\n${attack === "filter" ? "clean" : "path"} = ${sentinel.replaceAll("\\", "/")}\n`);
  const grant = await f.grant(project, "project"), ctx = context(f, grant);
  await expect(handleDomainTool("repository_status", { resourceId: grant.id }, ctx)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  expect(await readFile(sentinel, "utf8")).toBe("TEMPORARY PRIVATE SENTINEL");
});

it("does not consume a protected temporary ignore file configured by a selected repository", async () => {
  const f = await fixture(), project = join(f.root, "project"), pi = join(f.store.dataDir, "pi"); await mkdir(project); await mkdir(pi);
  const initialized = spawnSync("git", ["init", "--quiet", project], { windowsHide: true, shell: false, encoding: "utf8" }); expect(initialized.status, initialized.stderr).toBe(0);
  const sentinel = join(pi, "temporary-ignore.txt"); await writeFile(sentinel, "probe.txt\n"); await writeFile(join(project, "probe.txt"), "PUBLIC");
  const config = join(project, ".git", "config"); await writeFile(config, (await readFile(config, "utf8")) + `\n[core]\nexcludesFile = ${sentinel.replaceAll("\\", "/")}\n`);
  const grant = await f.grant(project, "project");
  const result = await handleDomainTool("repository_status", { resourceId: grant.id }, context(f, grant)) as { value: { stdout: string } };
  expect(result.value.stdout).toContain("?? probe.txt");
});

it("does not expose a protected sentinel through a tracked working-directory junction in a whole-repository diff", async () => {
  const f = await fixture(), project = join(f.root, "project"), folder = join(project, "selected"), pi = join(f.store.dataDir, "pi"); await mkdir(folder, { recursive: true }); await mkdir(pi);
  await writeFile(join(folder, "note.txt"), "PUBLIC\n"); await writeFile(join(pi, "note.txt"), "TEMPORARY PRIVATE SENTINEL\n");
  for (const args of [["init", "--quiet"], ["add", "selected/note.txt"], ["-c", "user.name=Disposable Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "Fixture"]]) {
    const result = spawnSync("git", args, { cwd: project, windowsHide: true, shell: false, encoding: "utf8" }); expect(result.status, result.stderr).toBe(0);
  }
  await rename(folder, folder + ".original"); await symlink(pi, folder, "junction"); cleanups.push(() => unlink(folder));
  const grant = await f.grant(project, "project");
  await expect(handleDomainTool("repository_diff", { resourceId: grant.id }, context(f, grant))).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});

it("diffs the acquired deletion when a protected junction is inserted immediately before real Git launch", async () => {
  const f = await fixture(), project = join(f.root, "project"), folder = join(project, "selected"), pi = join(f.store.dataDir, "pi");
  await mkdir(folder, { recursive: true }); await mkdir(pi);
  await writeFile(join(folder, "note.txt"), "PUBLIC\n"); await writeFile(join(pi, "note.txt"), "TEMPORARY PRIVATE SENTINEL\n");
  for (const args of [["init", "--quiet"], ["add", "selected/note.txt"], ["-c", "user.name=Disposable Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "Fixture"]]) {
    const result = spawnSync("git", args, { cwd: project, windowsHide: true, shell: false, encoding: "utf8" }); expect(result.status, result.stderr).toBe(0);
  }
  // This tracked directory is absent from the acquired namespace, a legitimate deletion.
  await rename(folder, join(f.root, "original-selected"));
  const grant = await f.grant(project, "project"); let inserted = false, snapshot = "";
  race.beforeGit = (args, cwd) => {
    if (!args.includes("diff")) return;
    snapshot = cwd;
    symlinkSync(pi, folder, "junction"); cleanups.push(() => unlink(folder)); inserted = true;
  };
  const result = await handleDomainTool("repository_diff", { resourceId: grant.id }, context(f, grant)) as { value: { stdout: string; exitCode: number } };
  expect(inserted).toBe(true); expect(result.value.exitCode).toBe(0);
  expect(result.value.stdout).not.toContain("TEMPORARY PRIVATE SENTINEL");
  expect(result.value.stdout).toContain("deleted file mode"); expect(result.value.stdout).toContain("-PUBLIC");
  expect(snapshot.startsWith(project)).toBe(false);
  await expect(stat(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(pi, "note.txt"), "utf8")).toBe("TEMPORARY PRIVATE SENTINEL\n");
});

it("ignores metadata paths inserted after acquisition immediately before real Git status", async () => {
  const f = await fixture(), project = join(f.root, "project"), pi = join(f.store.dataDir, "pi"); await mkdir(project); await mkdir(pi);
  const initialized = spawnSync("git", ["init", "--quiet", project], { windowsHide: true, shell: false, encoding: "utf8" }); expect(initialized.status, initialized.stderr).toBe(0);
  await writeFile(join(project, "probe.txt"), "PUBLIC\n"); await writeFile(join(pi, "exclude"), "probe.txt\n");
  const info = join(project, ".git", "info"); await rename(info, join(f.root, "original-info"));
  const grant = await f.grant(project, "project"); let inserted = false;
  race.beforeGit = args => {
    if (!args.includes("status")) return;
    symlinkSync(pi, info, "junction"); cleanups.push(() => unlink(info)); inserted = true;
  };
  const result = await handleDomainTool("repository_status", { resourceId: grant.id }, context(f, grant)) as { value: { stdout: string; exitCode: number } };
  expect(inserted).toBe(true); expect(result.value.exitCode).toBe(0);
  expect(result.value.stdout).toContain("?? probe.txt");
  expect(await readFile(join(pi, "exclude"), "utf8")).toBe("probe.txt\n");
});

it("does not let repository config redirect snapshot Git to a post-acquisition metadata file", async () => {
  const f = await fixture(), project = join(f.root, "project"), pi = join(f.store.dataDir, "pi"); await mkdir(project); await mkdir(pi);
  await writeFile(join(project, "a.txt"), "before\n"); await writeFile(join(project, "b.txt"), "before\n");
  for (const args of [["init", "--quiet"], ["add", "."], ["-c", "user.name=Disposable Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "Fixture"]]) {
    const result = spawnSync("git", args, { cwd: project, windowsHide: true, shell: false, encoding: "utf8" }); expect(result.status, result.stderr).toBe(0);
  }
  await writeFile(join(project, "a.txt"), "after\n"); await writeFile(join(project, "b.txt"), "after\n");
  const late = join(project, ".git", "late"), order = join(late, "order.txt"), sentinel = join(pi, "order.txt"); await writeFile(sentinel, "b.txt\na.txt\n");
  const config = join(project, ".git", "config"); await writeFile(config, (await readFile(config, "utf8")) + `\n[diff]\norderFile = ${order.replaceAll("\\", "/")}\n`);
  const grant = await f.grant(project, "project"); let inserted = false;
  race.beforeGit = args => {
    if (!args.includes("diff")) return;
    symlinkSync(pi, late, "junction"); cleanups.push(() => unlink(late)); inserted = true;
  };
  const result = await handleDomainTool("repository_diff", { resourceId: grant.id }, context(f, grant)) as { value: { stdout: string; exitCode: number } };
  expect(inserted).toBe(true); expect(result.value.exitCode).toBe(0);
  expect(result.value.stdout.indexOf("diff --git a/a.txt")).toBeGreaterThanOrEqual(0);
  expect(result.value.stdout.indexOf("diff --git a/a.txt")).toBeLessThan(result.value.stdout.indexOf("diff --git a/b.txt"));
  expect(await readFile(sentinel, "utf8")).toBe("b.txt\na.txt\n");
});
