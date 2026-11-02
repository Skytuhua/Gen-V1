import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { PDFDocument } from "pdf-lib";
import { CAPABILITIES, validateSurface } from "../packages/ui-catalog/index.ts";
import { DOMAIN_TOOLS, handleDomainTool, executeDomainOperation, reconcileDomainOperation, type DomainContext } from "../packages/capabilities/index.ts";
import type { Operation, DataRecord } from "../packages/contracts/index.ts";
import { HarnessError } from "../packages/contracts/index.ts";
import { createFixtures } from "../scripts/create-fixtures.ts";
import { CASES, scoreResults, type EvalResult } from "../evals/cases.ts";
import { runEvals } from "../evals/runner.ts";
import { applyReviews } from "../evals/review.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "harness-capability-")); roots.push(root);
  const calls: { id: string; path?: string; write: boolean }[] = [];
  const records: DataRecord[] = [], operations: Operation[] = [], progress: string[] = [];
  const controller = new AbortController();
  const ctx: DomainContext = {
    threadId: "test-thread", signal: controller.signal,
    async resolveResource(id, path, write = false) {
      calls.push({ id, path, write });
      if (id === "app-db") throw new Error("Harness database denied");
      if (!["project", "file", "database", "pdf", "export", "readonly"].includes(id)) throw new Error("Grant denied");
      if (id === "readonly" && write) throw new Error("Read only");
      const base = id === "database" ? join(root, "data.sqlite") : id === "pdf" ? join(root, "form.pdf") : id === "file" ? join(root, "file.txt") : root;
      const target = path ? resolve(base, path) : base, rel = relative(base, target);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) throw new Error("Outside grant");
      return target;
    },
    publishData(value, provenance) {
      const record = { id: randomUUID(), threadId: this.threadId, revision: 1, value, provenance, createdAt: new Date().toISOString() };
      records.push(record); return record;
    },
    prepareOperation(kind, args, resourceIds, preconditions, description) {
      const operation: Operation = { id: randomUUID(), threadId: this.threadId, revision: 1, kind, args, resourceIds, preconditions, description, status: "prepared", approved: false, createdAt: new Date().toISOString() };
      operations.push(operation); return operation;
    },
    progress(message) { progress.push(message); },
  };
  return { root, ctx, calls, records, operations, progress, controller };
}
function approve(op: Operation): Operation { return { ...op, approved: true, status: "running" }; }
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

describe("trusted surface admission", () => {
  it("publishes strict schemas and valid examples for every requested component", () => {
    expect(CAPABILITIES.map(c => c.name).sort()).toEqual("Stack Grid Split Tabs Panel Disclosure Text Markdown EvidenceList Metric Progress Timeline Table Chart Tree Form Input Select Toggle Button Code Diff Document Image ChoiceList Steps RelationshipGraph Status DocumentPreview SignaturePad MapView Diagnostics ChangeSet ApiExplorer Pipeline ImageCompare Stats Comparison CredentialEntry ReviewQueue EditableTable ParameterControls ImageAnnotator SchedulePicker LogExplorer WorkflowBoard ArchitectureCanvas TraceWaterfall".split(" ").sort());
    for (const capability of CAPABILITIES) {
      expect(capability.props.additionalProperties).toBe(false);
      validateSurface({ root: "a", elements: { a: { type: capability.name, props: capability.example as Record<string, unknown> } } });
    }
  });
  it("admits local disclosure state and table selection state without expressions", () => {
    validateSurface({ root: "faq", elements: { faq: { type: "Disclosure", props: { title: "FAQ", text: "Source-backed answer", stateKey: "faqOpen", defaultOpen: false }, children: ["table"] }, table: { type: "Table", props: { rowsBinding: "evidence", columns: [{ key: "title", label: "Title" }], stateKey: "selectedRows", rowKey: "id" } } } });
  });
  it("accepts opaque resource UUIDs starting with digits independently of state aliases", () => {
    for (const type of ["Document", "Image"]) validateSurface({ root: "a", elements: { a: { type, props: { resourceId: "01234567-89ab-cdef-0123-456789abcdef", ...(type === "Image" ? { alt: "Source" } : {}) } } } });
  });
  it("rejects unknown props, types, references, cycles and executable styling", () => {
    const invalid = [
      { root: "a", elements: { a: { type: "Nope", props: {} } } },
      { root: "a", elements: { a: { type: "Text", props: { text: "a", style: "color:red" } } } },
      { root: "a", elements: { a: { type: "Stack", props: {}, children: ["missing"] } } },
      { root: "a", elements: { a: { type: "Stack", props: {}, children: ["a"] } } },
      { root: "a", elements: { a: { type: "Image", props: { src: "javascript:alert(1)", alt: "x" } } } },
      { root: "a", elements: { a: { type: "Text", props: { text: { $eval: "secret()" } } } } },
    ];
    for (const spec of invalid) expect(() => validateSurface(spec)).toThrow();
  });
  it("enforces node, byte and deepest graph path limits including shared children", () => {
    const elements: Record<string, any> = {};
    for (let i = 0; i < 201; i++) elements[`${i}`] = { type: "Stack", props: {}, children: i < 200 ? [`${i + 1}`] : [] };
    expect(() => validateSurface({ root: "0", elements })).toThrow();
    const chain = Object.fromEntries(Object.entries(elements).slice(0, 13)); chain["12"].children = [];
    expect(() => validateSurface({ root: "0", elements: chain })).toThrow();
    expect(() => validateSurface({ root: "a", elements: { a: { type: "Text", props: { text: "x".repeat(128 * 1024) } } } })).toThrow();
    expect(() => validateSurface({ root: "a", elements: { a: { type: "Stack", props: {} }, orphan: { type: "Stack", props: {}, children: ["orphan"] } } })).toThrow();
  });
  it("accepts exact graph bounds and rejects UTF-8 byte overflow across valid props", () => {
    const children = Array.from({ length: 199 }, (_, i) => `n${i}`);
    validateSurface({ root: "root", elements: { root: { type: "Stack", props: {}, children }, ...Object.fromEntries(children.map(id => [id, { type: "Text", props: { text: id } }])) } });
    const chain = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`n${i}`, { type: "Stack", props: {}, children: i < 11 ? [`n${i + 1}`] : [] }]));
    validateSurface({ root: "n0", elements: chain });
    expect(() => validateSurface({ root: "root", elements: { root: { type: "Stack", props: {}, children: ["a", "b"] }, a: { type: "Text", props: { text: "x".repeat(70_000) } }, b: { type: "Text", props: { text: "x".repeat(70_000) } } } })).toThrow(/128 KiB/);
    expect(() => validateSurface({ root: "a", elements: { a: { type: "Text", props: { text: "é".repeat(70_000) } } } })).toThrow(/128 KiB/);
  });
});

describe("domain permission wrapper and file operations", () => {
  it("advertises strict metadata and rejects unknown tool/argument/command admission", async () => {
    const { ctx } = await sandbox();
    for (const t of DOMAIN_TOOLS) expect(t.parameters.additionalProperties).toBe(false);
    await expect(handleDomainTool("shell", { command: "echo hacked" }, ctx)).rejects.toThrow();
    await expect(handleDomainTool("repository_test_prepare", { resourceId: "project", testFile: "x.test.js", command: "echo hacked" }, ctx)).rejects.toThrow();
    await expect(handleDomainTool("repository_test_prepare", { resourceId: "project", testFile: "--eval=evil" }, ctx)).rejects.toThrow();
  });
  it("publishes resource sourced text with an exact content hash", async () => {
    const s = await sandbox(); await writeFile(join(s.root, "file.txt"), "source evidence");
    const result = await handleDomainTool("text_import", { resourceId: "file" }, s.ctx) as DataRecord;
    expect(result.value).toMatchObject({ text: "source evidence", sha256: hash("source evidence") });
    expect(result.provenance).toContain("file"); expect(s.calls).toContainEqual({ id: "file", path: undefined, write: false });
    const knowledge = await handleDomainTool("knowledge_publish", { sources: [{ resourceId: "file" }], title: "Reusable evidence", value: { rows: [{ title: "Finding" }] } }, s.ctx) as DataRecord;
    expect(knowledge.value).toMatchObject({ sources: [{ resourceId: "file", sha256: hash("source evidence") }], value: { rows: [{ title: "Finding" }] } });
    expect(knowledge.provenance).toContain("Derived synthesis");
  });
  it("prepares without writing and rejects absent approval and changed source bytes", async () => {
    const s = await sandbox(); await writeFile(join(s.root, "file.txt"), "original");
    const op = await handleDomainTool("file_replace_prepare", { resourceId: "file", content: "replacement", expectedSha256: hash("original") }, s.ctx) as Operation;
    expect(await readFile(join(s.root, "file.txt"), "utf8")).toBe("original");
    await expect(executeDomainOperation(op, s.ctx)).rejects.toThrow();
    await writeFile(join(s.root, "file.txt"), "concurrent edit");
    await expect(executeDomainOperation(approve(op), s.ctx)).rejects.toThrow(/changed|precondition|hash/i);
    expect(await readFile(join(s.root, "file.txt"), "utf8")).toBe("concurrent edit");
  });
  it("executes approved replacement, publishes actual results and re-resolves write permissions", async () => {
    const s = await sandbox(); await writeFile(join(s.root, "file.txt"), "original");
    const op = await handleDomainTool("file_replace_prepare", { resourceId: "file", content: "new", expectedSha256: hash("original") }, s.ctx) as Operation;
    const result = await executeDomainOperation(approve(op), s.ctx) as any;
    expect(await readFile(join(s.root, "file.txt"), "utf8")).toBe("new");
    expect(result.sha256).toBe(hash("new")); expect(s.records.length).toBeGreaterThan(0);
    expect(s.calls).toContainEqual({ id: "file", path: undefined, write: true });
    expect(s.progress.length).toBeGreaterThan(0);
    await expect(handleDomainTool("database_inspect", { resourceId: "app-db" }, s.ctx)).rejects.toThrow(/denied/i);
  });
  it("rechecks readonly grants and rejects cross-thread or non-running operation dispatch", async () => {
    const s = await sandbox(); await writeFile(join(s.root, "file.txt"), "original");
    const op = await handleDomainTool("file_replace_prepare", { resourceId: "readonly", path: "file.txt", content: "new", expectedSha256: hash("original") }, s.ctx) as Operation;
    await expect(executeDomainOperation(approve(op), s.ctx)).rejects.toThrow(/read only/i);
    await expect(executeDomainOperation({ ...approve(op), threadId: "other" }, s.ctx)).rejects.toThrow();
    await expect(executeDomainOperation({ ...approve(op), status: "succeeded" }, s.ctx)).rejects.toThrow();
  });
  it("reconciles before/after replacement hashes read-only and leaves changed bytes unknown", async () => {
    const s = await sandbox(); await writeFile(join(s.root, "file.txt"), "before");
    const op = await handleDomainTool("file_replace_prepare", { resourceId: "file", content: "after", expectedSha256: hash("before") }, s.ctx) as Operation;
    expect(await reconcileDomainOperation({ ...op, status: "unknown" }, s.ctx)).toMatchObject({ status: "unknown" });
    await executeDomainOperation(approve(op), s.ctx); s.calls.length = 0;
    expect(await reconcileDomainOperation({ ...op, status: "unknown" }, s.ctx)).toMatchObject({ status: "succeeded", basis: "postcondition" });
    expect(s.calls.every(call => !call.write)).toBe(true);
    await writeFile(join(s.root, "file.txt"), "unrelated edit");
    expect(await reconcileDomainOperation({ ...op, status: "unknown" }, s.ctx)).toMatchObject({ status: "unknown" });
  });
  it("runs the exact node-test recipe and reports actual success and failure exits", async () => {
    const s = await sandbox();
    await writeFile(join(s.root, "pass.test.mjs"), "import test from 'node:test'; import assert from 'node:assert/strict'; test('pass',()=>assert.equal(1,1));");
    await writeFile(join(s.root, "fail.test.mjs"), "import test from 'node:test'; import assert from 'node:assert/strict'; test('fail',()=>assert.equal(1,2));");
    for (const [testFile, exitCode, status] of [["pass.test.mjs", 0, "succeeded"], ["fail.test.mjs", 1, "failed"]] as const) {
      const op = await handleDomainTool("repository_test_prepare", { resourceId: "project", testFile }, s.ctx) as Operation;
      const result = await executeDomainOperation(approve(op), s.ctx) as any;
      expect(result).toMatchObject({ exitCode, status, cancelled: false }); expect(result.stdout).toContain("tests 1");
    }
  });
  it("cancels the actual process tree and records cancellation instead of success", async () => {
    const s = await sandbox();
    await writeFile(join(s.root, "tree.test.mjs"), "import test from 'node:test'; import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; test('tree',async()=>{const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); writeFileSync('child.pid',String(child.pid)); await new Promise(()=>{});});");
    const op = await handleDomainTool("repository_test_prepare", { resourceId: "project", testFile: "tree.test.mjs" }, s.ctx) as Operation;
    const running = executeDomainOperation(approve(op), s.ctx) as Promise<any>;
    let pid = 0;
    for (let i = 0; i < 100 && !pid; i++) { try { pid = Number(await readFile(join(s.root, "child.pid"), "utf8")); } catch { await new Promise(done => setTimeout(done, 30)); } }
    s.controller.abort(); const result = await running;
    expect(pid).toBeGreaterThan(0); expect(result).toMatchObject({ cancelled: true, status: "cancelled" });
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe("real selected SQLite", () => {
  async function database(s: Awaited<ReturnType<typeof sandbox>>) {
    const db = new DatabaseSync(join(s.root, "data.sqlite"));
    db.exec("CREATE TABLE tasks(id INTEGER PRIMARY KEY, title TEXT, done INTEGER); INSERT INTO tasks VALUES(1,'A',0),(2,'B',0)"); db.close();
  }
  it("inspects real rows and applies exact prepared counts with integrity/version checks", async () => {
    const s = await sandbox(); await database(s);
    const inspection = await handleDomainTool("database_inspect", { resourceId: "database", table: "tasks" }, s.ctx) as DataRecord;
    expect(inspection.value).toMatchObject({ rows: [{ id: 1, title: "A", done: 0 }, { id: 2, title: "B", done: 0 }], integrity: "ok" });
    const op = await handleDomainTool("database_prepare", { resourceId: "database", mode: "transaction", statements: [{ sql: "UPDATE tasks SET done = ? WHERE id = ?", params: [1, 1], expectedChanges: 1 }] }, s.ctx) as Operation;
    const result = await executeDomainOperation(approve(op), s.ctx) as any;
    expect(result.changes).toBe(1); expect(result.integrity).toBe("ok");
    const db = new DatabaseSync(join(s.root, "data.sqlite"), { readOnly: true }); expect(db.prepare("SELECT done FROM tasks WHERE id=1").get()?.done).toBe(1); db.close();
  });
  it("rolls back wrong counts, denies attachment and rejects stale database versions", async () => {
    const s = await sandbox(); await database(s);
    const wrong = await handleDomainTool("database_prepare", { resourceId: "database", mode: "transaction", statements: [{ sql: "UPDATE tasks SET done=1", expectedChanges: 1 }] }, s.ctx) as Operation;
    await expect(executeDomainOperation(approve(wrong), s.ctx)).rejects.toThrow(/count|changes/i);
    const db = new DatabaseSync(join(s.root, "data.sqlite")); expect(db.prepare("SELECT SUM(done) AS n FROM tasks").get()?.n).toBe(0); db.close();
    await expect(handleDomainTool("database_prepare", { resourceId: "database", mode: "migration", statements: [{ sql: "ATTACH DATABASE 'other.db' AS other" }] }, s.ctx)).rejects.toThrow();
    const op = await handleDomainTool("database_prepare", { resourceId: "database", mode: "migration", statements: [{ sql: "ALTER TABLE tasks ADD COLUMN note TEXT" }] }, s.ctx) as Operation;
    const edit = new DatabaseSync(join(s.root, "data.sqlite")); edit.exec("UPDATE tasks SET title='changed' WHERE id=1"); edit.close();
    await expect(executeDomainOperation(approve(op), s.ctx)).rejects.toThrow(/version|changed|precondition/i);
  });
  it("reports actual migration DML counts independently from schema statements", async () => {
    const s = await sandbox(); await database(s);
    const op = await handleDomainTool("database_prepare", { resourceId: "database", mode: "migration", statements: [{ sql: "UPDATE tasks SET done=1 WHERE id=1", expectedChanges: 1 }, { sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, text TEXT)" }] }, s.ctx) as Operation;
    const result = await executeDomainOperation(approve(op), s.ctx) as any;
    expect(result.changes).toBe(1); expect(result.statements.map((x: any) => x.changes)).toEqual([1, 0]);
    s.calls.length = 0;
    expect(await reconcileDomainOperation({ ...op, status: "unknown" }, s.ctx)).toMatchObject({ status: "unknown" });
    expect(await reconcileDomainOperation({ ...op, status: "unknown", result }, s.ctx)).toMatchObject({ status: "succeeded" });
    expect(s.calls.every(call => !call.write)).toBe(true);
  });
});

describe("PDF local export", () => {
  it("inspects fields, fills supported types and places typed/drawn marks in a new local export", async () => {
    const s = await sandbox(); const pdf = await PDFDocument.create(); const page = pdf.addPage([400, 500]);
    page.drawText("Evidence document"); const form = pdf.getForm(); form.createTextField("name").addToPage(page, { x: 10, y: 20, width: 180, height: 25 }); form.createCheckBox("agree").addToPage(page, { x: 210, y: 20, width: 15, height: 15 });
    await writeFile(join(s.root, "form.pdf"), await pdf.save());
    const inspection = await handleDomainTool("pdf_inspect", { resourceId: "pdf" }, s.ctx) as DataRecord;
    expect(inspection.value).toMatchObject({ pageCount: 1, fields: expect.arrayContaining([expect.objectContaining({ name: "name", type: "PDFTextField" })]) });
    const op = await handleDomainTool("pdf_prepare", { resourceId: "pdf", exportResourceId: "export", outputPath: "filled.pdf", fields: { name: "Test User", agree: true }, signatures: [{ kind: "typed", text: "Test User", page: 1, x: 30, y: 100, width: 150, height: 30 }, { kind: "drawn", page: 1, x: 30, y: 150, width: 150, height: 30, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] }, s.ctx) as Operation;
    const unavailable = { ...s.ctx, resolveResource: async () => { throw new HarnessError("INVALID_RESOURCE", "The selected path is unavailable"); } };
    expect(await reconcileDomainOperation({ ...op, status: "unknown" }, unavailable)).toMatchObject({ status: "unknown" });
    const result = await executeDomainOperation(approve(op), s.ctx) as any;
    const saved = await PDFDocument.load(await readFile(join(s.root, "filled.pdf")));
    expect(saved.getForm().getTextField("name").getText()).toBe("Test User"); expect(saved.getForm().getCheckBox("agree").isChecked()).toBe(true);
    expect(result.signaturesPlaced).toBe(2); expect(result.sha256).toBe(hash(await readFile(join(s.root, "filled.pdf"))));
    s.calls.length = 0; expect(await reconcileDomainOperation({ ...op, status: "unknown" }, s.ctx)).toMatchObject({ status: "succeeded" }); expect(s.calls.every(call => !call.write)).toBe(true);
    expect((inspection.value as any).pages[0].text).toContain("Evidence document");
    expect((inspection.value as any).limitations.join(" ")).toMatch(/OCR/);
    await expect(executeDomainOperation(approve(op), s.ctx)).rejects.toThrow(/exist/i);
  });
});

describe("disposable fixtures and held-out evaluations", () => {
  it("creates fixtures only at an exclusive new destination including real git conflict", async () => {
    const s = await sandbox(); const destination = join(s.root, "fixtures");
    const manifest = await createFixtures(destination);
    expect(manifest).toMatchObject({ version: 1 });
    expect(await readFile(join(destination, "repository", "conflict.txt"), "utf8")).toContain("<<<<<<<");
    expect((await PDFDocument.load(await readFile(join(destination, "editable.pdf")))).getForm().getFields().length).toBeGreaterThan(0);
    const ctx = { ...s.ctx, async resolveResource(id: string, path?: string, write = false) { if (id !== "project") return s.ctx.resolveResource(id, path, write); return path ? join(manifest.repository, path) : manifest.repository; } };
    const status = await handleDomainTool("repository_status", { resourceId: "project" }, ctx) as DataRecord;
    expect(status.value).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("UU conflict.txt") });
    const diff = await handleDomainTool("repository_diff", { resourceId: "project", path: "conflict.txt" }, ctx) as DataRecord;
    expect(diff.value).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("conflict.txt") });
    const log = await handleDomainTool("repository_log", { resourceId: "project", limit: 2 }, ctx) as DataRecord;
    expect(log.value).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("Fixture main") });
    const files = await handleDomainTool("repository_files", { resourceId: "project" }, ctx) as DataRecord;
    expect((files.value as any).entries.some((entry: any) => entry.path.startsWith(".git"))).toBe(false);
    await expect(createFixtures(destination)).rejects.toThrow(/exist/i);
    await expect(createFixtures(s.root)).rejects.toThrow(/exist/i);
  });
  it("freezes 12 cases and keeps category and novel gates pending without real model results", () => {
    expect(CASES).toHaveLength(12);
    const counts = Object.fromEntries(["coding", "research-data", "documents", "planning", "novel-apps"].map(c => [c, CASES.filter(x => x.category === c).length]));
    expect(counts).toEqual({ coding: 3, "research-data": 3, documents: 2, planning: 2, "novel-apps": 2 });
    expect(scoreResults([])).toMatchObject({ status: "pending", aggregate: null, mandatoryNovelGate: "pending" });
    const fake = CASES.map(c => ({ caseId: c.id, modelId: "fake", status: "pending" as const, assertions: [] }));
    expect(scoreResults(fake).status).toBe("pending");
  });
  it("writes a pending unexecuted eval report and never promotes fabricated results through reviews", async () => {
    const s = await sandbox(); const report = await runEvals({ destination: join(s.root, "unexecuted") });
    expect(report.score).toMatchObject({ status: "pending", aggregate: null, expected: 36 }); expect(report.results).toEqual([]);
    const c = CASES[0]; const fake = [{ caseId: c.id, repetition: 1, modelId: "fake", status: "pending" as const, assertions: c.checks.map(id => ({ id, status: "pending" as const, evidence: "No real run" })) }];
    const reviewed = applyReviews(fake, c.checks.map(checkId => ({ caseId: c.id, repetition: 1, checkId, status: "pass" as const, evidence: "Reviewed fixture", reviewer: "Tester" })));
    expect(scoreResults(reviewed, 1).status).toBe("pending");
  });
  it("runs the installed CLI entry points in disposable destinations with honest pending exit", async () => {
    const s = await sandbox();
    const fixture = spawnSync(process.execPath, ["--import", "tsx", "scripts/create-fixtures.ts", join(s.root, "cli-fixture")], { encoding: "utf8", windowsHide: true, shell: false, timeout: 15_000 });
    expect(fixture.status, fixture.stderr).toBe(0); expect(JSON.parse(fixture.stdout).version).toBe(1);
    const evaluation = spawnSync(process.execPath, ["--import", "tsx", "evals/runner.ts", "--out", join(s.root, "cli-eval")], { encoding: "utf8", windowsHide: true, shell: false, timeout: 15_000 });
    expect(evaluation.status, evaluation.stderr).toBe(2); expect(JSON.parse(evaluation.stdout)).toMatchObject({ status: "pending", expected: 36, aggregate: null, mandatoryNovelGate: "pending" });
  });
  it("enforces independent category and mandatory novel gates over real-run evidence", () => {
    const results = CASES.flatMap(c => [1,2,3].map(repetition => ({ caseId: c.id, repetition, modelId: "scoring-fixture", status: "completed" as const, executionOutcome: "completed" as const, source: "host-pi" as const, threadId: `thread-${c.id}`, sessionPath: `session-${c.id}.jsonl`, snapshotSeq: 42, assertions: c.checks.map(id => ({ id, status: "pass" as const, evidence: "Synthetic scoring fixture; not execution evidence" })) })));
    expect(scoreResults(results)).toMatchObject({ status: "pass", aggregate: 1, categoryGate: "pass", mandatoryNovelGate: "pass" });
    const categoryFailure: EvalResult[] = structuredClone(results); for(const row of categoryFailure.filter(r=>CASES.find(c=>c.id===r.caseId)?.category==="coding"))row.assertions.forEach(a=>{a.status="fail";});
    expect(scoreResults(categoryFailure)).toMatchObject({ status: "fail", categoryGate: "fail", mandatoryNovelGate: "pass" });
    const novelFailure: EvalResult[] = structuredClone(results); for(const row of novelFailure.filter(r=>r.caseId==="novel-custody").slice(0,2))row.assertions[0].status="fail";
    expect(scoreResults(novelFailure)).toMatchObject({ status: "fail", mandatoryNovelGate: "fail" });
    expect(scoreResults(results.filter(r=>r.repetition===1),1)).toMatchObject({status:"pending",pilotEligible:false});
  });
});
