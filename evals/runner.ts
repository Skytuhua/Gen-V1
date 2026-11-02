import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { CASES, CASESET_SHA256, CASESET_VERSION, scoreResults, type EvalResult, type EvalCase } from "./cases.ts";
import { createFixtures } from "../scripts/create-fixtures.ts";
import type { Snapshot, HostCommand, ModelInfo } from "../packages/contracts/index.ts";

export interface EvalOptions { destination: string; host?: string; modelId?: string; repetitions?: number; timeoutMs?: number; signal?: AbortSignal }
export async function runEvals(options: EvalOptions) {
  const destination = resolve(options.destination), repetitions = options.repetitions ?? 3;
  if (!options.destination || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3) throw new Error("Explicit new destination and 1..3 repetitions are required");
  await mkdir(destination); // Exclusive output; never reuse an earlier evaluation run.
  const results: EvalResult[] = [];
  const save = async () => {
    const report = { createdAt: new Date().toISOString(), host: options.host ?? null, modelId: options.modelId ?? null, results, score: scoreResults(results, repetitions) };
    await writeFile(join(destination, "results.json"), JSON.stringify(report, null, 2)); return report;
  };
  await writeFile(join(destination, "frozen-cases.json"), JSON.stringify({ version: CASESET_VERSION, sha256: CASESET_SHA256, cases: CASES }, null, 2), { flag: "wx" });
  if (!options.host || !options.modelId) return save(); // Honest unexecuted manifest, with all gates pending.
  const host = new URL(options.host);
  if (host.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(host.hostname) || host.username || host.password || host.pathname !== "/") throw new Error("Use the actual local host's HTTP origin");
  let cookie = "", csrf = "";
  async function request(path: string, body?: HostCommand, recovery = false) {
    const response = await fetch(new URL(path, host), { method: body ? "POST" : "GET", redirect: "error", headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json", "x-harness-csrf": csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: options.signal && !recovery ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(c => c.split(";", 1)[0]).join("; ");
    const value = await response.json() as any;
    if (!response.ok) throw new Error(`Host ${path} ${response.status}: ${JSON.stringify(value)}`);
    return value;
  }
  async function command(type: string, payload: Record<string, unknown>, threadId?: string) { return request("/api/commands", { id: randomUUID(), type, payload, ...(threadId ? { threadId } : {}) }, type === "run.stop"); }
  const bootstrap = await request("/api/bootstrap"); csrf = bootstrap.csrfToken;
  const modelResponse = await request("/api/models") as { models: ModelInfo[]; error?: string };
  if (!modelResponse.models.some(model => model.id === options.modelId)) throw new Error(`Selected model is unavailable: ${modelResponse.error ?? options.modelId}`);
  for (const testCase of CASES) for (let repetition = 1; repetition <= repetitions; repetition++) {
    if (options.signal?.aborted) return save();
    const label = `${testCase.id}-${repetition}`;
    const fixture = await createFixtures(join(destination, label));
    const receipt = await command("thread.create", { title: `Held-out ${label}`, projectName: "Disposable evaluation" });
    const current = await request("/api/snapshot") as Snapshot;
    const thread = current.threads.find(t => t.id === receipt.result?.id);
    if (!thread) throw new Error("Host did not create an observable new eval thread");
    try {
      for (const grant of [{ path: fixture.repository, kind: "project", writable: true }, { path: fixture.database, kind: "database", writable: true }, { path: fixture.pdf, kind: "file", writable: false }, { path: join(fixture.root, "sources"), kind: "project", writable: false }, { path: join(fixture.root, "exports"), kind: "export", writable: true }]) await command("resource.grant", { ...grant, label: `Disposable ${label} ${grant.kind}` }, thread.id);
      await command("message.send", { modelId: options.modelId, content: `Held-out task ${testCase.id}. Granted resources refer to the disposable fixture described below. Use the actual granted IDs from tool context. Never touch any other project.\n${JSON.stringify({ repository: fixture.repository, database: fixture.database, pdf: fixture.pdf, sources: fixture.sources, exports: join(fixture.root, "exports") })}\n\n${testCase.prompt}` }, thread.id);
      const deadline = Date.now() + (options.timeoutMs ?? 120_000); let snapshot: Snapshot = current;
      while (Date.now() < deadline && !options.signal?.aborted) {
        snapshot = await request("/api/snapshot") as Snapshot;
        const state = snapshot.threads.find(t => t.id === thread.id);
        if (state && ["completed", "failed", "awaiting_input", "interrupted", "stopped"].includes(state.status)) break;
        if (state?.status === "ready" && !state.runId && snapshot.messages.some(m => m.threadId === thread.id && m.role === "assistant")) break;
        await new Promise<void>(done => {
          const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", finish); done(); };
          const timer = setTimeout(finish, 500); options.signal?.addEventListener("abort", finish, { once: true });
          if (options.signal?.aborted) finish();
        });
      }
      const state = snapshot.threads.find(t => t.id === thread.id);
      if (state?.status === "working" || options.signal?.aborted) await command("run.stop", {}, thread.id);
      await writeFile(join(destination, `${label}.snapshot.json`), JSON.stringify(snapshot, null, 2), { flag: "wx" });
      results.push(observeCase(testCase, repetition, options.modelId, thread.id, snapshot));
    } catch (error) {
      await command("run.stop", {}, thread.id).catch(() => {});
      results.push({ caseId: testCase.id, repetition, modelId: options.modelId, status: "pending", threadId: thread.id, assertions: testCase.checks.map(id => ({ id, status: "pending", evidence: `Host execution error: ${error instanceof Error ? error.message : String(error)}` })) });
    }
    await save();
  }
  return save();
}
export function observeCase(testCase: EvalCase, repetition: number, modelId: string, threadId: string, snapshot: Snapshot): EvalResult {
  const thread = snapshot.threads.find(t => t.id === threadId), data = snapshot.data.filter(d => d.threadId === threadId), artifacts = snapshot.artifacts.filter(a => a.threadId === threadId), operations = snapshot.operations.filter(o => o.threadId === threadId);
  const genuine = thread?.modelId === modelId && !!thread.sessionPath && snapshot.messages.some(m => m.threadId === threadId && m.role === "assistant");
  const assertions = testCase.checks.map(id => {
    let pass = false, evidence = "Requires review of actual task correctness or interaction; never auto-scored from canned responses";
    if (id === "source-provenance") { pass = data.some(d => d.provenance.includes("sha256:")); evidence = `Published data: ${data.map(d => `${d.id}@${d.revision}: ${d.provenance}`).join("; ")}`; }
    if (id === "structured-artifact") { pass = artifacts.some(a => a.kind === "structured"); evidence = `Structured artifacts: ${artifacts.filter(a => a.kind === "structured").map(a => a.id).join(",")}`; }
    if (id === "widget-artifact") { pass = artifacts.some(a => a.kind === "widget"); evidence = `Widget artifacts: ${artifacts.filter(a => a.kind === "widget").map(a => a.id).join(",")}`; }
    if (id === "data-binding") { pass = artifacts.some(a => Object.keys(a.bindings).length > 0); evidence = `Artifact bindings: ${JSON.stringify(artifacts.map(a => ({ id: a.id, bindings: a.bindings })))}`; }
    if (id === "prepared-operation") { pass = operations.length > 0; evidence = `Operations: ${operations.map(o => `${o.id}:${o.kind}:${o.status}`).join(",")}. Await user approval for effects.`; }
    if (id === "actual-test-failure") { pass = operations.some(o => o.kind === "repository.test" && typeof (o.result as any)?.exitCode === "number" && (o.result as any).exitCode !== 0); evidence = `Test operation results: ${JSON.stringify(operations.filter(o => o.kind === "repository.test").map(o => o.result))}`; }
    return { id, status: genuine && pass ? "pass" as const : "pending" as const, evidence };
  });
  return { caseId: testCase.id, repetition, modelId, status: "pending", executionOutcome: thread?.status, source: genuine ? "host-pi" : undefined, threadId, sessionPath: thread?.sessionPath ?? undefined, snapshotSeq: snapshot.seq, assertions };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) { if (!["--out", "--host", "--model", "--repetitions"].includes(args[i]) || !args[i + 1]) throw new Error("Usage: pnpm eval --out <NEW-directory> [--host http://localhost:4317 --model <actual-id> --repetitions 3]"); values[args[i]] = args[i + 1]; }
  if (!values["--out"]) { console.error("Required: --out <NEW-directory>. Without --host and --model, creates an honest pending report only."); process.exitCode = 2; }
  else {
    const controller = new AbortController(); process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort());
    runEvals({ destination: values["--out"], host: values["--host"], modelId: values["--model"], repetitions: values["--repetitions"] ? Number(values["--repetitions"]) : 3, signal: controller.signal }).then(report => { console.log(JSON.stringify(report.score, null, 2)); if (report.score.status !== "pass") process.exitCode = 2; }).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
  }
}
