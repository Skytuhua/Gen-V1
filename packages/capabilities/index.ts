import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { readdir, stat, lstat, open, realpath } from "node:fs/promises";
import { dirname, join, relative, basename } from "node:path";
import { HarnessError, type DataRecord, type Operation } from "../contracts/index.ts";
import { toolSchemas, descriptions, type ToolName, type PdfArgs } from "./schemas.ts";
import { databaseJob, validateStatements } from "./database.ts";
import { inspectPdf, renderPdf } from "./pdf.ts";
import { gitExecutable, runProcess } from "./process.ts";
import { readBoundFile, removeOwnedFile, replaceOwnedFile, withPathGuard } from "../core/file-access.ts";
import { withGitMetadata, type ManagedGitFamily } from "./git-access.ts";
import { validateCanonicalPng } from './signature-png.ts';
export interface DomainContext {
  threadId: string;
  signal: AbortSignal;
  resolveResource(id: string, relativePath?: string, write?: boolean): Promise<string>;
  withResource?<T>(id: string, relativePath: string | undefined, write: boolean, action: (path: string) => Promise<T>): Promise<T>;
  managedGitFamily?(cwd: string): ManagedGitFamily | undefined | Promise<ManagedGitFamily | undefined>;
  publishData(value: unknown, provenance: string): DataRecord;
  prepareOperation(kind: string, args: Record<string, unknown>, resourceIds: string[], preconditions: Record<string, string>, description: string): Operation;
  progress(message: string, counts?: Record<string, number>): void;
  completedWrite?(evidence:{path:string;sha256:string;bytes:number}):void;
}
export const DOMAIN_TOOLS = Object.entries(toolSchemas).map(([name, schema]) => ({ name, description: descriptions[name as ToolName], parameters: z.toJSONSchema(schema) as Record<string, unknown> }));
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function active(ctx: DomainContext) { if (ctx.signal.aborted) throw new HarnessError("CANCELLED", "Operation cancelled"); }
function parse<N extends ToolName>(name: N, args: unknown): z.infer<(typeof toolSchemas)[N]> {
  const result = toolSchemas[name].safeParse(args);
  if (!result.success) throw new HarnessError("INVALID_TOOL_ARGUMENTS", `Invalid ${name} arguments`, result.error.issues.map(i => ({ path: i.path, message: i.message })));
  return result.data as z.infer<(typeof toolSchemas)[N]>;
}
async function access<T>(ctx: DomainContext, id: string, path: string | undefined, write: boolean, action: (filename: string) => Promise<T>): Promise<T> {
  active(ctx);
  if (ctx.withResource) return ctx.withResource(id, path, write, async filename => { active(ctx); return action(filename); });
  // Embedders without the host API still receive a native pathname guard.
  const filename = await ctx.resolveResource(id, path, write);
  return withPathGuard([{ path: filename, leaf: !write }], ctx.signal, async () => { active(ctx); return action(filename); });
}
async function readResource(ctx: DomainContext, resourceId: string, path?: string, maxBytes = 8 * 1024 * 1024) {
  return access(ctx, resourceId, path, false, async filename => {
    const bytes = await readBoundFile(filename, maxBytes); active(ctx);
    return { filename, bytes, sha256: sha256(bytes) };
  });
}
function pdfResources(args: PdfArgs): string[] {
  return [...new Set([args.resourceId, args.exportResourceId, ...(args.signatures ?? []).flatMap(mark => mark.kind === 'image' ? [mark.resourceId] : [])])];
}
async function signatureImages(ctx: DomainContext, args: PdfArgs, expected?: Record<string, string>) {
  const images = new Map<string, Uint8Array>(), hashes: Record<string, string> = {};
  for (const mark of args.signatures ?? []) {
    if (mark.kind !== 'image' || images.has(mark.resourceId)) continue;
    const image = await readResource(ctx, mark.resourceId, undefined, 512 * 1024), key = 'signature:' + mark.resourceId;
    if (expected && image.sha256 !== expected[key]) throw new HarnessError('PRECONDITION_FAILED', 'Signature image changed since preparation');
    validateCanonicalPng(image.bytes); images.set(mark.resourceId, image.bytes); hashes[key] = image.sha256;
  }
  return { images, hashes };
}
function utf8(bytes: Uint8Array): string { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new HarnessError("UNSUPPORTED_ENCODING", "Select a UTF-8 text file"); } }
function provenance(resourceId: string, path: string | undefined, hash: string) { return `resource:${resourceId}${path ? `/${path}` : ""}; sha256:${hash}`; }
function publish(ctx: DomainContext, value: unknown, source: string) {
  // SQLite values may include bytes or bigint; publish JSON-compatible data for every category.
  return ctx.publishData(JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? { base64: Buffer.from(v).toString("base64") } : v)), source);
}
const gitPrefix = ["--no-pager", "--no-replace-objects", "-c", "core.fsmonitor=false", "-c", "diff.external=", "-c", "core.pager=cat", "-c", "core.hooksPath=", "-c", "core.untrackedCache=false", "-c", "core.attributesFile=", "-c", "core.excludesFile=", "-c", "mailmap.file=", "-c", "mailmap.blob=", "-c", "log.showSignature=false", "-c", "protocol.allow=never"];
async function git(ctx: DomainContext, resourceId: string, args: string[]) {
  return access(ctx, resourceId, undefined, false, async cwd => {
  return withGitMetadata(cwd, ctx.signal, async (metadata, worktree,signal) => {
  const prefix = [...gitPrefix, `--git-dir=${metadata}`, `--work-tree=${worktree}`];
  const top = await runProcess(gitExecutable(), [...prefix, "rev-parse", "--show-toplevel"], worktree, signal, m => ctx.progress(m));
  if (top.exitCode !== 0 || top.cancelled || top.timedOut) throw new HarnessError("GIT_ERROR", "Selected resource is not an available repository", top);
  const [grantedRoot, gitRoot] = await Promise.all([realpath(worktree), realpath(top.stdout.trim())]);
  if (relative(grantedRoot, gitRoot) !== "") throw new HarnessError("GRANT_REQUIRED", "Grant the repository root explicitly");
  const result = await runProcess(gitExecutable(), [...prefix, ...args], worktree, signal, m => ctx.progress(m));
  return publish(ctx, result, `resource:${resourceId}; git ${args[0]}; actual exit:${result.exitCode}`);
  }, await ctx.managedGitFamily?.(cwd));
  });
}
export async function handleDomainTool(name: string, rawArgs: unknown, ctx: DomainContext): Promise<unknown> {
  active(ctx);
  if (!Object.hasOwn(toolSchemas, name)) throw new HarnessError("UNKNOWN_TOOL", `Unknown domain tool ${name}`);
  // Dispatch parses each schema explicitly, preserving type narrowing and rejecting unknown props.
  switch (name as ToolName) {
    case "repository_files": {
      const a = parse("repository_files", rawArgs), entries: { path: string; bytes: number }[] = []; let visited = 0, truncated = false;
      async function walk(path?: string) {
        const contents = await access(ctx, a.resourceId, path, false, dir => readdir(dir, { withFileTypes: true }));
        for (const entry of contents) {
          if ([".git", "node_modules"].includes(entry.name) || entry.isSymbolicLink()) continue;
          if (++visited > 10_000 || entries.length >= (a.limit ?? 500)) { truncated = true; return; }
          const child = path ? `${path}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(child);
          else if (entry.isFile()) { const bytes = await access(ctx, a.resourceId, child, false, async resolved => (await stat(resolved)).size); entries.push({ path: child, bytes }); }
          if (truncated) return;
        }
      }
      await walk(a.path); return publish(ctx, { entries, truncated }, `resource:${a.resourceId}; file listing`);
    }
    case "repository_read":
    case "text_import": {
      const a = name === "repository_read" ? parse("repository_read", rawArgs) : parse("text_import", rawArgs);
      const source = await readResource(ctx, a.resourceId, a.path);
      return publish(ctx, { text: utf8(source.bytes), sha256: source.sha256, resourceId: a.resourceId, path: a.path ?? null, ...("title" in a ? { title: a.title } : {}) }, provenance(a.resourceId, a.path, source.sha256));
    }
    case "knowledge_publish": {
      const a = parse("knowledge_publish", rawArgs), sources = [];
      if (Buffer.byteLength(JSON.stringify(a.value)) > 512 * 1024) throw new HarnessError("RESOURCE_LIMIT", "Knowledge value exceeds 512 KiB");
      for (const source of a.sources) { const file = await readResource(ctx, source.resourceId, source.path); utf8(file.bytes); sources.push({ ...source, sha256: file.sha256 }); }
      return publish(ctx, { title: a.title, value: a.value, sources }, `Derived synthesis; ${sources.map(s => provenance(s.resourceId, s.path, s.sha256)).join("; ")}`);
    }
    case "repository_status": { const a = parse("repository_status", rawArgs); return git(ctx, a.resourceId, ["status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=all"]); }
    case "repository_diff": { const a = parse("repository_diff", rawArgs); if (a.path) await ctx.resolveResource(a.resourceId, a.path, false); return git(ctx, a.resourceId, ["diff", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all", ...(a.staged ? ["--cached"] : []), "--", ...(a.path ? [a.path] : [])]); }
    case "repository_log": { const a = parse("repository_log", rawArgs); return git(ctx, a.resourceId, ["log", `-n${a.limit ?? 10}`, "--format=%H%x09%aI%x09%s", "--no-decorate"]); }
    case "file_replace_prepare": {
      const a = parse("file_replace_prepare", rawArgs), source = await readResource(ctx, a.resourceId, a.path); utf8(source.bytes);
      if (source.sha256 !== a.expectedSha256) throw new HarnessError("PRECONDITION_FAILED", "File hash changed before preparation");
      return ctx.prepareOperation("file.replace", a, [a.resourceId], { sha256: source.sha256 }, `Replace ${a.path ?? a.resourceId} if SHA-256 ${source.sha256} still matches`);
    }
    case "repository_test_prepare": {
      const a = parse("repository_test_prepare", rawArgs), source = await readResource(ctx, a.resourceId, a.testFile);
      return ctx.prepareOperation("repository.test", { ...a, recipe: "node-test" }, [a.resourceId], { testSha256: source.sha256 }, `Run exactly node --test -- ${a.testFile}; this executes granted project code with local user privileges`);
    }
    case "database_inspect": {
      const a = parse("database_inspect", rawArgs);
      const result = await access(ctx, a.resourceId, a.path, false, path => databaseJob({ mode: "inspect", path, table: a.table, limit: a.limit }, ctx));
      return publish(ctx, result, provenance(a.resourceId, a.path, result.resourceVersion));
    }
    case "database_prepare": {
      const a = parse("database_prepare", rawArgs); validateStatements(a);
      const result = await access(ctx, a.resourceId, a.path, false, path => databaseJob({ mode: "prepare", path, statements: a.statements }, ctx));
      return ctx.prepareOperation(`database.${a.mode}`, a, [a.resourceId], { resourceVersion: result.resourceVersion }, `Apply ${a.statements.length} SQLite statements with exact counts, rollback and resource version ${result.resourceVersion}`);
    }
    case "pdf_inspect": {
      const a = parse("pdf_inspect", rawArgs), source = await readResource(ctx, a.resourceId, a.path, 32 * 1024 * 1024);
      return publish(ctx, { ...await inspectPdf(source.bytes, ctx.signal), sha256: source.sha256 }, provenance(a.resourceId, a.path, source.sha256));
    }
    case "pdf_prepare": {
      const a = parse("pdf_prepare", rawArgs), source = await readResource(ctx, a.resourceId, a.path, 32 * 1024 * 1024);
      const marks = await signatureImages(ctx, a);
      const rendered = await renderPdf(source.bytes, a, marks.images, ctx.signal); // Validate before offering approval; no writes.
      return ctx.prepareOperation("pdf.export", a, pdfResources(a), { sha256: source.sha256, ...marks.hashes, output: "absent", outputSha256: sha256(rendered) }, `Fill PDF and place ${(a.signatures ?? []).length} visual signature marks in new local export ${a.outputPath}; no certificate or delivery`);
    }
  }
}
function operationResources(operation: Operation, expected: string[]) {
  if (operation.resourceIds.length !== expected.length || expected.some(id => !operation.resourceIds.includes(id))) throw new HarnessError("INVALID_OPERATION", "Operation resources differ from prepared arguments");
}
export async function executeDomainOperation(operation: Operation, ctx: DomainContext): Promise<unknown> {
  active(ctx);
  if (operation.threadId !== ctx.threadId || !operation.approved || operation.status !== "running") throw new HarnessError("OPERATION_NOT_APPROVED", "Only the owning thread's approved running operation can execute");
  ctx.progress(`Executing ${operation.kind}`);
  switch (operation.kind) {
    case "file.replace": {
      const a = parse("file_replace_prepare", operation.args); operationResources(operation, [a.resourceId]);
      if (operation.preconditions.sha256 !== a.expectedSha256) throw new HarnessError("PRECONDITION_FAILED", "Prepared file hash differs from arguments");
      return access(ctx, a.resourceId, a.path, true, async filename => {
      const source = await readResource(ctx, a.resourceId, a.path);
      if (source.sha256 !== operation.preconditions.sha256) throw new HarnessError("PRECONDITION_FAILED", "File hash changed since preparation");
      const info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink()) throw new HarnessError("INVALID_RESOURCE", "Replacement requires a regular file");
      const temp = join(dirname(filename), `.${basename(filename)}.harness-${randomUUID()}.tmp`);
      const file = await open(temp, "wx", info.mode); let moved = false;
      const identity = await file.stat({ bigint: true });
      try {
        await file.writeFile(a.content, "utf8"); await file.sync(); await file.close();
        active(ctx); await ctx.resolveResource(a.resourceId, a.path, true);
        if ((await readResource(ctx, a.resourceId, a.path)).sha256 !== operation.preconditions.sha256) throw new HarnessError("PRECONDITION_FAILED", "File changed immediately before replacement");
        await replaceOwnedFile(temp, filename, identity, sha256(a.content), ctx.signal, operation.preconditions.sha256); moved = true;
      } finally { await file.close().catch(() => {}); if (!moved) await removeOwnedFile(temp, identity, new AbortController().signal).catch(() => {}); }
      const result = { resourceId: a.resourceId, path: a.path ?? null, sha256: sha256(a.content), bytes: Buffer.byteLength(a.content) };
      ctx.completedWrite?.({path:filename,sha256:result.sha256,bytes:result.bytes});
      publish(ctx, result, `operation:${operation.id}; ${provenance(a.resourceId, a.path, result.sha256)}`); ctx.progress("File replacement complete", { completed: 1, total: 1 }); return result;
      });
    }
    case "repository.test": {
      const a = parse("repository_test_prepare", operation.args); operationResources(operation, [a.resourceId]);
      return access(ctx, a.resourceId, undefined, true, async cwd => {
      const test = await readResource(ctx, a.resourceId, a.testFile);
      if (test.sha256 !== operation.preconditions.testSha256) throw new HarnessError("PRECONDITION_FAILED", "Test file changed since preparation");
      const result = await runProcess(process.execPath, ["--test", "--", a.testFile], cwd, ctx.signal, m => ctx.progress(m));
      publish(ctx, result, `operation:${operation.id}; resource:${a.resourceId}; node --test -- ${a.testFile}; test sha256:${test.sha256}`); return result;
      });
    }
    case "database.transaction":
    case "database.migration": {
      const a = parse("database_prepare", operation.args); operationResources(operation, [a.resourceId]); validateStatements(a);
      if (operation.kind !== `database.${a.mode}` || !/^[a-f0-9]{64}$/.test(operation.preconditions.resourceVersion ?? "")) throw new HarnessError("INVALID_OPERATION", "Invalid database operation or version");
      const result = await access(ctx, a.resourceId, a.path, true, path => databaseJob({ mode: "execute", path, statements: a.statements, expectedVersion: operation.preconditions.resourceVersion }, ctx));
      ctx.progress("Database transaction committed", { completed: a.statements.length, total: a.statements.length, changes: result.changes ?? 0 });
      publish(ctx, result, `operation:${operation.id}; ${provenance(a.resourceId, a.path, result.resourceVersion)}`); return result;
    }
    case "pdf.export": {
      const a = parse("pdf_prepare", operation.args); operationResources(operation, pdfResources(a));
      if (operation.preconditions.output !== "absent") throw new HarnessError("INVALID_OPERATION", "PDF exports require an absent destination");
      const source = await readResource(ctx, a.resourceId, a.path, 32 * 1024 * 1024);
      if (source.sha256 !== operation.preconditions.sha256) throw new HarnessError("PRECONDITION_FAILED", "PDF hash changed since preparation");
      const marks = await signatureImages(ctx, a, operation.preconditions);
      return access(ctx, a.exportResourceId, a.outputPath, true, async output => {
      const bytes = await renderPdf(source.bytes, a, marks.images, ctx.signal); active(ctx);
      if (sha256(bytes) !== operation.preconditions.outputSha256) throw new HarnessError("PRECONDITION_FAILED", "Rendered PDF differs from prepared export hash");
      const file = await open(output, "wx");
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      const result = { resourceId: a.exportResourceId, path: a.outputPath, sha256: sha256(bytes), bytes: bytes.length, fieldsFilled: Object.keys(a.fields ?? {}).length, signaturesPlaced: a.signatures?.length ?? 0 };
      publish(ctx, result, `operation:${operation.id}; source ${provenance(a.resourceId, a.path, source.sha256)}; exported ${provenance(a.exportResourceId, a.outputPath, result.sha256)}`); ctx.progress("PDF exported locally", { completed: 1, total: 1 }); return result;
      });
    }
    default: throw new HarnessError("UNKNOWN_OPERATION", `Unknown domain operation ${operation.kind}`);
  }
}
export interface Reconciliation { status: "succeeded" | "failed" | "cancelled" | "unknown"; basis: "postcondition" | "recorded-result" | "unresolved"; result?: unknown; message: string }
/** Observe interrupted effects only; never writes, approves, reruns or prepares a retry. */
export async function reconcileDomainOperation(operation: Operation, ctx: DomainContext): Promise<Reconciliation> {
  active(ctx);
  if (operation.threadId !== ctx.threadId) throw new HarnessError("INVALID_OPERATION", "Operation belongs to another thread");
  const unknown = (message: string, result?: unknown): Reconciliation => ({ status: "unknown", basis: "unresolved", message, ...(result === undefined ? {} : { result }) });
  try { switch (operation.kind) {
    case "file.replace": {
      const a = parse("file_replace_prepare", operation.args); operationResources(operation, [a.resourceId]);
      const current = await readResource(ctx, a.resourceId, a.path);
      if (current.sha256 === sha256(a.content)) return { status: "succeeded", basis: "postcondition", result: { sha256: current.sha256, bytes: current.bytes.length }, message: "Current file matches the prepared replacement. This establishes the current postcondition, not which actor wrote it." };
      return unknown(current.sha256 === operation.preconditions.sha256 ? "File matches its before hash; execution history remains unknown. No automatic retry." : "File matches neither before nor after hash; preserve concurrent edits. No automatic retry.", { sha256: current.sha256 });
    }
    case "pdf.export": {
      const a = parse("pdf_prepare", operation.args); operationResources(operation, pdfResources(a));
      try {
        const exported = await readResource(ctx, a.exportResourceId, a.outputPath, 32 * 1024 * 1024);
        if (exported.sha256 === operation.preconditions.outputSha256) return { status: "succeeded", basis: "postcondition", result: { sha256: exported.sha256, resourceId: a.exportResourceId, path: a.outputPath }, message: "Export bytes match the prepared output hash; the original PDF was not changed by this operation." };
        return unknown("Export exists but its hash differs from the prepared output. Never overwrite it.", { sha256: exported.sha256 });
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return unknown("Export is absent; execution history remains unknown. No automatic retry."); throw error; }
    }
    case "database.transaction":
    case "database.migration": {
      const a = parse("database_prepare", operation.args); operationResources(operation, [a.resourceId]);
      const current = await access(ctx, a.resourceId, a.path, false, path => databaseJob({ mode: "inspect", path }, ctx));
      const recorded = operation.result as { resourceVersion?: unknown; changes?: unknown } | undefined;
      if (typeof recorded?.resourceVersion === "string" && recorded.resourceVersion === current.resourceVersion) return { status: "succeeded", basis: "recorded-result", result: { ...recorded, integrity: current.integrity }, message: "Database integrity is valid and bytes match the recorded committed result version." };
      return unknown(current.resourceVersion === operation.preconditions.resourceVersion ? "Database still matches its before version; execution history remains unknown." : "Database version changed but no matching committed after version was recorded. Outcome remains unknown; inspect before taking a new action.", { resourceVersion: current.resourceVersion, integrity: current.integrity });
    }
    case "repository.test": {
      const a = parse("repository_test_prepare", operation.args); operationResources(operation, [a.resourceId]);
      await readResource(ctx, a.resourceId, a.testFile);
      const result = operation.result as { exitCode?: unknown; cancelled?: boolean; timedOut?: boolean; signal?: unknown } | undefined;
      if (result && (typeof result.exitCode === "number" || result.cancelled || result.signal)) return { status: result.cancelled ? "cancelled" : result.exitCode === 0 && !result.timedOut ? "succeeded" : "failed", basis: "recorded-result", result, message: "Recovered recorded process termination evidence. The test was not rerun." };
      return unknown("No persisted process exit evidence exists. File state cannot establish a past test outcome; no automatic rerun.");
    }
    default: return unknown(`No read-only reconciliation is defined for ${operation.kind}`);
  } } catch (error) {
    const code = error instanceof HarnessError ? error.code : (error as NodeJS.ErrnoException).code;
    if (["ENOENT", "INVALID_RESOURCE", "DATABASE_ERROR", "DATABASE_TIMEOUT"].includes(code ?? "")) return unknown(`Resource observation is unavailable: ${error instanceof Error ? error.message : String(error)}. Outcome remains unknown; no automatic retry.`);
    throw error;
  }
}
