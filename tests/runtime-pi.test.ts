import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunContext, StartRun } from "../packages/contracts/index.ts";
import { encodeInput, extractInputIds } from "../packages/runtime-pi/input-envelope.ts";
import { openTaskSession, taskPaths } from "../packages/runtime-pi/session.ts";
import { EventNormalizer } from "../packages/runtime-pi/events.ts";
import { ToolBridge, routeToolCall } from "../packages/runtime-pi/ipc.ts";
import { createHostTools, createHostResourceLoader } from "../packages/runtime-pi/tool-definitions.ts";
import { dispatchInput } from "../packages/runtime-pi/delivery.ts";
import { createPiRuntime } from "../packages/runtime-pi/index.ts";
import { getOrCreateDeviceId } from "../packages/runtime-pi/login.ts";
import { UI_TOOLS, loadDomainTools } from "../packages/runtime-pi/tool-definitions.ts";
import { safeError } from "../packages/runtime-pi/sdk.ts";
import { spawn } from "node:child_process";
import * as childProcess from "node:child_process";
import * as fileSystem from "node:fs/promises";
import { EventEmitter } from "node:events";
import * as processTree from "../packages/runtime-pi/process-tree.ts";
import { terminateProcessTree } from "../packages/runtime-pi/process-tree.ts";

vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>() }));
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>() }));

const ctx: RunContext = { threadId: "task-a", runId: "run-a", epoch: 3 };
const input: StartRun = { ...ctx, prompt: "Please inspect the granted file.", modelId: "openai/gpt-5.4", sessionPath: null, inputId: "input-001", resources: [] };
const temporary: string[] = [];
async function temp() { const dir = await mkdtemp(join(tmpdir(), "harness-pi-test-")); temporary.push(dir); return dir; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function isExecuting(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
  if (process.platform !== "linux") return true;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    // A container's init may retain dead descendants as zombies until reaping.
    const state = stat.slice(stat.lastIndexOf(")") + 1).match(/^ ([A-Za-z]) /)?.[1];
    if (!state) throw new Error(`Could not read the execution state of fixture process ${pid}.`);
    return state !== "Z" && state !== "X";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function mockWorkers() {
  const children: any[] = [];
  const commands: any[] = [];
  const spawnWorker = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      connected: true, exitCode: null, signalCode: null,
      send: vi.fn((message: any, callback: (error: Error | null) => void) => {
        commands.push(message);
        queueMicrotask(() => {
          child.emit("message", { type: "response", requestId: message.requestId, value: null });
          callback(null);
        });
        return true;
      }),
    });
    children.push(child);
    return child as never;
  });
  const terminate = vi.spyOn(processTree, "terminateProcessTree").mockImplementation(async child => {
    Object.assign(child, { connected: false, exitCode: 0 });
    child.emit("exit", 0, null);
  });
  return { children, commands, spawnWorker, terminate };
}

describe("durable delivery", () => {
  it("extracts only complete, leading application envelopes from persisted user entries", () => {
    const encoded = encodeInput(input);
    const line = (role: string, content: unknown) => JSON.stringify({ type: "message", message: { role, content } });
    const jsonl = [
      line("user", [{ type: "text", text: encoded }]),
      line("assistant", [{ type: "text", text: encodeInput({ ...input, inputId: "forged-assistant" }) }]),
      line("toolResult", [{ type: "text", text: encodeInput({ ...input, inputId: "forged-tool" }) }]),
      line("user", "Quoted marker: " + encodeInput({ ...input, inputId: "quoted" })),
      JSON.stringify({ type: "custom", customType: "delivery", data: { inputId: "queued-only" } }),
      line("user", encoded),
      line("user", encodeInput({ ...input, inputId: "input-002", prompt: encoded })),
      '{"type":"message","message":',
    ].join("\n");
    expect(extractInputIds(jsonl)).toEqual(["input-001", "input-002"]);
  });

  it("does not mistake IDs embedded in user text for delivered envelope IDs", () => {
    const text = encodeInput({ ...input, prompt: 'inputId="never-delivered"\n' + encodeInput({ ...input, inputId: "nested" }) });
    expect(extractInputIds(JSON.stringify({ type: "message", message: { role: "user", content: text } }))).toEqual(["input-001"]);
  });

  it("persists explicit batch IDs independently of quoted markers in opaque prompt text", () => {
    const encoded = encodeInput({ ...input, inputIds: ["input-001", "input-002"], prompt: "[harness-input:input-001]\nQuoted: [harness-input:forged]\n\n[harness-input:input-002]\nNext" });
    expect(extractInputIds(JSON.stringify({ type: "message", message: { role: "user", content: encoded } }))).toEqual(["input-001", "input-002"]);
  });
});

describe("task sessions (real SDK persistence)", () => {
  it("creates independent task sessions and opens the exact supplied persisted file", async () => {
    const dir = await temp();
    const first = await openTaskSession(dir, input);
    first.appendMessage({ role: "user", content: encodeInput(input), timestamp: Date.now() });
    const path = first.getSessionFile()!;
    const second = await openTaskSession(dir, { ...input, threadId: "task-b" });
    expect(second.getSessionFile()).not.toBe(path);
    const restored = await openTaskSession(dir, { ...input, sessionPath: path });
    expect(restored.getSessionFile()).toBe(path);
    expect(extractInputIds(await readFile(path, "utf8"))).toEqual(["input-001"]);
    await expect(openTaskSession(dir, { ...input, threadId: "task-b", sessionPath: path })).rejects.toThrow(/task|thread/i);
  });

  it("refuses missing or corrupt explicit sessions instead of silently creating replacements", async () => {
    const dir = await temp();
    const paths = taskPaths(dir, "../../escape");
    expect(paths.sessionsDir.startsWith(join(dir, "pi", "tasks"))).toBe(true);
    await mkdir(paths.sessionsDir, { recursive: true });
    const missing = join(paths.sessionsDir, "missing.jsonl");
    await expect(openTaskSession(dir, { ...input, threadId: "../../escape", sessionPath: missing })).rejects.toThrow();
    const broken = join(paths.sessionsDir, "broken.jsonl");
    await writeFile(broken, "not a Pi session\n");
    await expect(openTaskSession(dir, { ...input, threadId: "../../escape", sessionPath: broken })).rejects.toThrow(/session/i);
  });
});

describe("SDK lifecycle normalization", () => {
  it("binds consecutive leading application batches to the response, never quoted or foreign input IDs", () => {
    const events: Record<string, unknown>[] = [];
    const normalizer = new EventNormalizer(ctx, event => events.push(event));
    const state = { isIdle: false };
    const user = (content: unknown) => normalizer.accept({ type: "message_start", message: { role: "user", content } }, state);
    user([{ type: "text", text: encodeInput({ ...input, inputIds: ["input-001", "input-002"], prompt: encodeInput({ ...input, inputId: "quoted" }) }) }]);
    user(encodeInput({ ...input, inputId: "input-003" }));
    user("Quoted: " + encodeInput({ ...input, inputId: "quoted-prefix" }));
    user([{ type: "text", text: "ordinary text" }, { type: "text", text: encodeInput({ ...input, inputId: "nonleading" }) }]);
    user(encodeInput({ ...input, runId: "foreign", inputId: "foreign" }));
    normalizer.accept({ type: "message_start", message: { role: "assistant" } }, state);
    // Even an input event arriving mid-response belongs to the next response.
    user(encodeInput({ ...input, inputId: "later" }));
    normalizer.accept({ type: "message_end", message: { role: "assistant", content: "First" } }, state);
    normalizer.accept({ type: "message_start", message: { role: "assistant" } }, state);
    normalizer.accept({ type: "message_end", message: { role: "assistant", content: "Second" } }, state);
    expect(events.filter(event => event.type === "input.processing").map(event => event.inputIds)).toEqual([["input-001", "input-002"], ["input-003"], ["later"]]);
    expect(events.filter(event => event.type === "assistant.message").map(event => event.inputIds)).toEqual([["input-001", "input-002", "input-003"], ["later"]]);
  });

  it("retains the input batch through tool continuations and retries without treating settled as processing", () => {
    const events: Record<string, unknown>[] = [];
    const normalizer = new EventNormalizer(ctx, event => events.push(event));
    normalizer.accept({ type: "message_start", message: { role: "user", content: encodeInput(input) } }, { isIdle: false });
    for (const stopReason of ["toolUse", "error", "stop"]) {
      normalizer.accept({ type: "message_start", message: { role: "assistant" } }, { isIdle: false });
      normalizer.accept({ type: "message_end", message: { role: "assistant", content: "Response", stopReason } }, { isIdle: false });
    }
    normalizer.accept({ type: "agent_settled", aborted: false }, { isIdle: true });
    expect(events.filter(event => event.type === "assistant.message").map(event => event.inputIds)).toEqual([["input-001"], ["input-001"], ["input-001"]]);
    expect(events.filter(event => event.type === "input.processing")).toHaveLength(1);
    expect(events.find(event => event.type === "settled")).not.toHaveProperty("inputIds");
  });

  it("streams deltas once and keeps the finalized authoritative message under the same ID", () => {
    const events: Record<string, unknown>[] = [];
    const normalizer = new EventNormalizer(ctx, e => events.push(e));
    const state = { isIdle: false, isCompacting: false, isRetrying: false };
    normalizer.accept({ type: "message_start", message: { role: "assistant", content: [] } }, state);
    normalizer.accept({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hel", partial: { content: [{ type: "text", text: "Hel" }] } } }, state);
    normalizer.accept({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "lo", partial: { content: [{ type: "text", text: "Hello" }] } } }, state);
    normalizer.accept({ type: "message_update", assistantMessageEvent: { type: "text_end", content: "Hello" } }, state);
    normalizer.accept({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } }, state);
    expect(events.filter(e => e.type === "assistant.delta").map(e => e.delta)).toEqual(["Hel", "lo"]);
    const final = events.find(e => e.type === "assistant.message")!;
    expect(final.content).toBe("Hello");
    expect(events.filter(e => e.type === "assistant.delta").every(e => e.messageId === final.messageId)).toBe(true);
    expect(events.every(e => e.threadId === "task-a" && e.runId === "run-a" && e.epoch === 3)).toBe(true);
  });

  it("never settles on agent_end, during retries, or before the SDK is idle", () => {
    const events: Record<string, unknown>[] = [];
    const normalizer = new EventNormalizer(ctx, e => events.push(e));
    normalizer.accept({ type: "agent_end", willRetry: true }, { isIdle: false });
    normalizer.accept({ type: "agent_settled", aborted: false }, { isIdle: false });
    normalizer.accept({ type: "agent_settled", aborted: false }, { isIdle: true, isRetrying: true });
    expect(events.some(e => e.type === "settled")).toBe(false);
    normalizer.accept({ type: "agent_settled", aborted: false }, { isIdle: true });
    expect(events.filter(e => e.type === "settled")).toEqual([{ ...ctx, type: "settled", aborted: false }]);
  });

  it("correlates activity by SDK toolCallId and reports unavailable subscription quotas as null", () => {
    const events: Record<string, unknown>[] = [];
    const normalizer = new EventNormalizer(ctx, e => events.push(e));
    normalizer.accept({ type: "tool_execution_start", toolCallId: "tc-7", toolName: "ui_compose" }, { isIdle: false });
    normalizer.usage({ tokens: 87, contextWindow: 1000, percent: 8.7 }, { tokens: { input: 50, output: 12 }, cost: 0 }, "running");
    expect(events[0]).toMatchObject({ ...ctx, type: "activity", toolCallId: "tc-7" });
    expect(events[1]).toMatchObject({ type: "usage", usage: { contextTokens: 87, contextWindow: 1000, inputTokens: 50, outputTokens: 12, cost: null, sessionPercent: null, weeklyPercent: null } });
  });
});

describe("authoritative parent tool IPC", () => {
  it("ignores mismatched epochs and tool IDs even when the request ID matches", async () => {
    const sent: any[] = [];
    const bridge = new ToolBridge(ctx, m => { sent.push(m); });
    let completed = false;
    const result = bridge.call("tc-9", "ui_compose", { title: "Receipt" }).then(value => { completed = true; return value; });
    const request = sent[0];
    bridge.receive({ type: "tool.result", requestId: request.requestId, ctx: { ...ctx, epoch: 2 }, toolCallId: "tc-9", value: "stale" });
    bridge.receive({ type: "tool.result", requestId: request.requestId, ctx, toolCallId: "other", value: "wrong-call" });
    await Promise.resolve();
    expect(completed).toBe(false);
    bridge.receive({ type: "tool.result", requestId: request.requestId, ctx, toolCallId: "tc-9", value: { artifactId: "accepted-by-host" } });
    expect(await result).toEqual({ artifactId: "accepted-by-host" });
  });

  it("rejects unallowed and stale calls before parent callbacks run", async () => {
    const onTool = vi.fn(async () => ({ accepted: true }));
    const request = { type: "tool.call" as const, requestId: "req-1", ctx, toolCallId: "tc-1", name: "bash", args: { command: "whoami" } };
    await expect(routeToolCall(request, ctx, new Set(["ui_compose"]), onTool)).rejects.toThrow(/allow/i);
    await expect(routeToolCall({ ...request, name: "ui_compose", ctx: { ...ctx, epoch: 1 } }, ctx, new Set(["ui_compose"]), onTool)).rejects.toThrow(/stale|context/i);
    expect(onTool).not.toHaveBeenCalled();
    const reply = await routeToolCall({ ...request, name: "ui_compose" }, ctx, new Set(["ui_compose"]), onTool);
    expect(reply).toMatchObject({ requestId: "req-1", toolCallId: "tc-1", ctx, value: { accepted: true } });
    expect(onTool).toHaveBeenCalledWith({ name: "ui_compose", args: { command: "whoami" }, toolCallId: "tc-1" }, ctx);
  });

  it("cancels a pending callback without pretending the host completed it", async () => {
    const bridge = new ToolBridge(ctx, () => {});
    const control = new AbortController();
    const result = bridge.call("tc", "ui_compose", {}, control.signal);
    control.abort();
    await expect(result).rejects.toThrow(/abort/i);
    bridge.close();
  });
});

describe("real SDK tool policy", () => {
  it("advertises the seven implemented host handlers and real JSON domain schemas", async () => {
    expect(UI_TOOLS.map(tool => tool.name).sort()).toEqual(["ui_arrange", "ui_close", "ui_create_widget", "ui_discover", "ui_inspect", "ui_present", "ui_request_input"]);
    const domain = await loadDomainTools();
    expect(domain.some(tool => tool.name === "repository_read")).toBe(true);
    expect(domain.every(tool => tool.parameters.type === "object" && !("_def" in tool.parameters))).toBe(true);
  });
  it("activates only application tools and delegates all execution to the host", async () => {
    const sdk = await import("@earendil-works/pi-coding-agent");
    const dir = await temp();
    const calls: unknown[] = [];
    const tools = createHostTools([{ name: "files_inspect", description: "Inspect a granted resource", parameters: { type: "object", properties: { resourceId: { type: "string" } }, required: ["resourceId"], additionalProperties: false } }], async (...args) => { calls.push(args); return { source: "host" }; });
    const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    const model = runtime.getModels("openai")[0]!;
    const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model, tools: tools.map(t => t.name), customTools: tools, resourceLoader: createHostResourceLoader(sdk), sessionManager: sdk.SessionManager.inMemory(dir), settingsManager: sdk.SettingsManager.inMemory({ cacheWarming: "off" }) });
    try {
      expect(session.getActiveToolNames()).toContain("files_inspect");
      expect(session.getActiveToolNames()).toContain("task_finish");
      expect(session.getActiveToolNames()).toContain("operation_execute");
      expect(session.getActiveToolNames().filter(n => n.startsWith("ui_"))).toHaveLength(7);
      expect(session.getActiveToolNames().some(n => ["read", "bash", "powershell", "write", "edit", "codemode", "tool_search"].includes(n))).toBe(false);
      expect(session.getCallableToolNames().some(n => ["read", "bash", "powershell", "write", "edit", "codemode", "tool_search"].includes(n))).toBe(false);
      expect(session.resourceLoader.getExtensions().extensions).toEqual([]);
      expect(session.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
      const result = await tools.find(t => t.name === "files_inspect")!.execute("tc-real", { resourceId: "r-1" }, undefined, undefined, {} as never);
      expect(calls).toEqual([["tc-real", "files_inspect", { resourceId: "r-1" }, undefined]]);
      expect(result).toMatchObject({ details: { source: "host" }, content: [{ type: "text", text: '{"source":"host"}' }] });
    } finally { session.dispose(); }
  });

  it("rejects built-in tool metadata and Zod objects at the registration boundary", () => {
    expect(() => createHostTools([{ name: "bash", description: "bypass", parameters: { type: "object" } }], async () => null)).toThrow(/metadata/i);
    expect(() => createHostTools([{ name: "unsafe_tool", description: "bad schema", parameters: { _def: {}, parse() {} } }], async () => null)).toThrow(/JSON Schema|Zod/i);
  });
});

describe("follow-up dispatch", () => {
  it.each([false, true])("tracks actual SDK initial and batched follow-up user events without network (abort queued: %s)", async abortQueued => {
    const sdk = await import("@earendil-works/pi-coding-agent");
    const dir = await temp();
    const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    // Only bypass local preflight: every provider response is supplied below.
    vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected network request in scripted SDK test"); });
    const model = runtime.getModels("openai")[0]!;
    const { session } = await sdk.createAgentSession({
      cwd: dir, agentDir: dir, modelRuntime: runtime, model,
      tools: [], customTools: [], resourceLoader: createHostResourceLoader(sdk),
      sessionManager: sdk.SessionManager.inMemory(dir),
      settingsManager: sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false }, compaction: { enabled: false }, followUpMode: "all" }),
    });
    const entered = [barrier(), barrier()];
    const responses = [barrier(), barrier()];
    const events: any[] = [];
    const raw: any[] = [];
    const normalizer = new EventNormalizer(ctx, event => events.push(event));
    session.subscribe(event => { raw.push(event); normalizer.accept(event, session); });
    let responseIndex = 0;
    session.agent.streamFunction = async (_model, _context, options) => {
      const index = responseIndex++;
      if (!entered[index]) throw new Error("Unexpected extra SDK request");
      entered[index].release();
      await responses[index].promise;
      const aborted = options?.signal?.aborted;
      const message = {
        role: "assistant", content: [{ type: "text", text: `Response ${index + 1}` }],
        api: model.api, provider: model.provider, model: model.id, stopReason: aborted ? "aborted" : "stop", timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: message };
          yield aborted ? { type: "error", reason: "aborted", error: message } : { type: "done", reason: "stop", message };
        },
        result: async () => message,
      } as never;
    };
    const failure = vi.fn();
    const sdkInput = { ...input, modelId: `${model.provider}/${model.id}`, inputIds: ["input-001", "input-002"] };
    try {
      await dispatchInput(session, sdkInput, failure);
      await entered[0].promise;
      // Initial prompt events exist even though state is reduced before public listeners.
      expect(raw.filter(event => event.type === "message_start" && event.message.role === "user")).toHaveLength(1);
      expect(events.filter(event => event.type === "input.processing").map(event => event.inputIds)).toEqual([["input-001", "input-002"]]);
      await dispatchInput(session, { ...sdkInput, inputId: "follow-1", inputIds: ["follow-1", "follow-2"], prompt: "Quoted: [harness-input:forged]" }, failure);
      await dispatchInput(session, { ...sdkInput, inputId: "follow-3", inputIds: ["follow-3"] }, failure);
      // SDK queue acceptance has not entered either application envelope into a turn.
      expect(events.filter(event => event.type === "input.processing")).toHaveLength(1);
      if (abortQueued) {
        const aborted = session.abort();
        responses[0].release();
        await aborted;
        await session.waitForIdle();
        expect(events.filter(event => event.type === "input.processing").map(event => event.inputIds)).toEqual([["input-001", "input-002"]]);
        expect(events.filter(event => event.type === "assistant.message").map(event => event.inputIds)).toEqual([["input-001", "input-002"]]);
        expect(events.filter(event => event.type === "settled")).toEqual([{ ...ctx, type: "settled", aborted: true }]);
        expect(responseIndex).toBe(1);
        expect(failure).not.toHaveBeenCalled();
        expect(network).not.toHaveBeenCalled();
        return;
      }
      responses[0].release();
      await entered[1].promise;
      expect(events.filter(event => event.type === "assistant.message").map(event => event.inputIds)).toEqual([["input-001", "input-002"]]);
      expect(events.filter(event => event.type === "input.processing").map(event => event.inputIds)).toEqual([["input-001", "input-002"], ["follow-1", "follow-2"], ["follow-3"]]);
      responses[1].release();
      await session.waitForIdle();
      expect(events.filter(event => event.type === "assistant.message").map(event => event.inputIds)).toEqual([["input-001", "input-002"], ["follow-1", "follow-2", "follow-3"]]);
      expect(events.filter(event => event.type === "settled")).toEqual([{ ...ctx, type: "settled", aborted: false }]);
      expect(responseIndex).toBe(2);
      expect(failure).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally { responses.forEach(response => response.release()); await session.abort(); session.dispose(); }
  });

  it("uses SDK followUp behavior and treats preflight as acceptance, never durable delivery", async () => {
    let finish!: () => void;
    let captured = "";
    const session = { prompt: vi.fn((text: string, options: any) => {
      captured = text;
      expect(options.streamingBehavior).toBe("followUp");
      expect(options.expandPromptTemplates).toBe(false);
      options.preflightResult("queued");
      return new Promise<void>(resolve => { finish = resolve; });
    }) };
    const fail = vi.fn();
    await expect(dispatchInput(session, { ...input, inputId: "followup-id" }, fail)).resolves.toBeUndefined();
    expect(extractInputIds("")).toEqual([]);
    expect(extractInputIds(JSON.stringify({ type: "message", message: { role: "user", content: captured } }))).toEqual(["followup-id"]);
    finish();
    expect(fail).not.toHaveBeenCalled();
  });

  it("rejects failed preflight and reports a failure after acceptance without an unhandled rejection", async () => {
    await expect(dispatchInput({ prompt: async () => { throw new Error("authentication failed"); } }, input, () => {})).rejects.toThrow(/authentication/);
    const failure = vi.fn();
    let reject!: (error: Error) => void;
    await dispatchInput({ prompt: (_text, options) => { options!.preflightResult!("started"); return new Promise<void>((_resolve, fail) => { reject = fail; }); } }, input, failure);
    reject(new Error("provider disconnected"));
    await vi.waitFor(() => expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: "provider disconnected" })));
  });
});

describe("isolated process adapter", () => {
  it("rejects a follow-up queued behind startup when that run already settled", async () => {
    const workers = mockWorkers(), runtime = createPiRuntime({dataDir:await temp()}), acknowledgement=barrier(), entered=barrier();
    const events:unknown[]=[];runtime.configure({onTool:async()=>null,onEvent:event=>events.push(event)});
    const spawnWorker=workers.spawnWorker.getMockImplementation()!;
    workers.spawnWorker.mockImplementationOnce((...args)=>{
      const child:any=spawnWorker(...args), send=child.send.getMockImplementation();
      child.send.mockImplementation((message:any,callback:any)=>{if(message.command==='start'){entered.release();void acknowledgement.promise.then(()=>send(message,callback));return true;}return send(message,callback);});
      return child;
    });
    try{
      const starting=runtime.start(input);await entered.promise;
      const follow=runtime.followUp({...input,inputId:'queued-follow-up'});
      const rejection=expect(follow).rejects.toThrow(/active|stale|revok/i);
      workers.children[0].emit('message',{type:'event',ctx,event:{...ctx,type:'settled',aborted:false}});
      acknowledgement.release();await starting;await rejection;
      expect(workers.commands.filter(c=>c.command==='followUp')).toHaveLength(0);
      expect(events).toContainEqual({...ctx,type:'settled',aborted:false});
    }finally{acknowledgement.release();await runtime.dispose();}
  });
  it("revokes a start before its serial queue callback runs", async () => {
    const workers = mockWorkers();
    const runtime = createPiRuntime({ dataDir: await temp() });
    runtime.configure({ onTool: async () => null, onEvent: () => {} });
    try {
      const starting = runtime.start(input);
      const outcome = expect(starting).rejects.toThrow(/abort|cancel|revok/i);
      await runtime.cancel(ctx);
      await outcome;
      expect(workers.spawnWorker).not.toHaveBeenCalled();
      expect(workers.commands.some(command => command.command === "start")).toBe(false);
    } finally { await runtime.dispose(); }
  });

  it("revokes a replacement queued behind another run's asynchronous startup acknowledgement", async () => {
    const workers = mockWorkers();
    const runtime = createPiRuntime({ dataDir: await temp() });
    runtime.configure({ onTool: async () => null, onEvent: () => {} });
    const entered = barrier();
    const acknowledgement = barrier();
    const spawnWorker = workers.spawnWorker.getMockImplementation()!;
    workers.spawnWorker.mockImplementationOnce((...args) => {
      const child: any = spawnWorker(...args);
      const send = child.send.getMockImplementation();
      child.send.mockImplementation((message: any, callback: any) => {
        if (message.command === "start") {
          entered.release();
          void acknowledgement.promise.then(() => send(message, callback));
          return true;
        }
        return send(message, callback);
      });
      return child;
    });
    try {
      const first = runtime.start(input);
      await entered.promise;
      const nextInput = { ...input, runId: "run-b", epoch: ctx.epoch + 1 };
      const next = runtime.start(nextInput);
      const outcome = expect(next).rejects.toThrow(/abort|cancel|revok/i);
      await runtime.cancel(nextInput);
      acknowledgement.release();
      await first;
      await outcome;
      expect(workers.spawnWorker).toHaveBeenCalledTimes(1);
      expect(workers.commands.filter(command => command.command === "abort")).toEqual([]);
    } finally { acknowledgement.release(); await runtime.dispose(); }
  });

  it("revokes asynchronous mkdir setup without cancelling a newer run on the same thread", async () => {
    const workers = mockWorkers();
    const runtime = createPiRuntime({ dataDir: await temp() });
    runtime.configure({ onTool: async () => null, onEvent: () => {} });
    const entered = barrier();
    const setup = barrier();
    vi.spyOn(fileSystem, "mkdir").mockImplementationOnce(async () => { entered.release(); await setup.promise; return undefined; });
    const starting = runtime.start(input);
    const outcome = expect(starting).rejects.toThrow(/abort|cancel|revok/i);
    try {
      await entered.promise;
      await runtime.cancel(ctx);
      const nextInput = { ...input, runId: "run-b", epoch: ctx.epoch + 1 };
      const next = runtime.start(nextInput);
      setup.release();
      await outcome;
      await next;
      await runtime.cancel(ctx);
      expect(workers.commands.filter(command => command.command === "start").map(command => command.input.runId)).toEqual(["run-b"]);
      expect(workers.commands.filter(command => command.command === "abort")).toEqual([]);
    } finally { setup.release(); await runtime.dispose(); }
  });

  it.each(["cancel", "dispose"] as const)("rechecks %s after asynchronous worker creation before sending start", async action => {
    const workers = mockWorkers();
    const runtime = createPiRuntime({ dataDir: await temp() });
    runtime.configure({ onTool: async () => null, onEvent: () => {} });
    const spawnWorker = workers.spawnWorker.getMockImplementation()!;
    let cancellation: Promise<void> | undefined;
    workers.spawnWorker.mockImplementationOnce((...args) => {
      const child = spawnWorker(...args);
      queueMicrotask(() => { cancellation = action === "cancel" ? runtime.cancel(ctx) : runtime.dispose(); });
      return child;
    });
    try {
      await expect(runtime.start(input)).rejects.toThrow(/abort|cancel|revok|disposed/i);
      await cancellation;
      expect(workers.commands.some(command => command.command === "start")).toBe(false);
      expect(workers.terminate).toHaveBeenCalledTimes(1);
    } finally { await runtime.dispose(); }
  });

  it("rechecks revocation while terminating the previous run before replacement setup", async () => {
    const workers = mockWorkers();
    const runtime = createPiRuntime({ dataDir: await temp() });
    runtime.configure({ onTool: async () => null, onEvent: () => {} });
    const terminating = barrier();
    const termination = barrier();
    try {
      await runtime.start(input);
      const terminate = workers.terminate.getMockImplementation()!;
      workers.terminate.mockImplementationOnce(async child => { terminating.release(); await termination.promise; await terminate(child); });
      const nextInput = { ...input, runId: "run-b", epoch: ctx.epoch + 1 };
      const starting = runtime.start(nextInput);
      const outcome = expect(starting).rejects.toThrow(/abort|cancel|revok/i);
      await terminating.promise;
      await runtime.cancel(nextInput);
      termination.release();
      await outcome;
      expect(workers.spawnWorker).toHaveBeenCalledTimes(1);
      expect(workers.commands.filter(command => command.command === "start")).toHaveLength(1);
    } finally { termination.release(); await runtime.dispose(); }
  });

  it("terminates the real worker process tree, including a descendant", async () => {
    const child = spawn(process.execPath, ["-e", "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); process.send({pid:c.pid}); setInterval(()=>{},1000);"], { stdio: ["ignore", "ignore", "ignore", "ipc"], detached: process.platform !== "win32", windowsHide: true });
    const descendant = await new Promise<number>((resolve, reject) => { child.once("message", (message: any) => resolve(message.pid)); child.once("error", reject); });
    try {
      expect(await isExecuting(descendant)).toBe(true);
      await terminateProcessTree(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      await vi.waitFor(async () => { expect(await isExecuting(descendant)).toBe(false); });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      try { process.kill(descendant, "SIGKILL"); } catch {}
    }
  });
  it("keeps actionable auth prose while redacting credentials and OAuth redirect URLs", () => {
    expect(safeError(new Error("API-key billing fallback is disabled."))).toBe("API-key billing fallback is disabled.");
    const output = safeError(new Error('access_token=secret-access refresh_token:secret-refresh api_key="secret-key" Authorization: Bearer secret-bearer https://localhost/auth?code=private-code'));
    expect(output).not.toMatch(/secret-access|secret-refresh|secret-key|secret-bearer|private-code/);
  });
  it("does not start a new worker after disposal races with asynchronous setup", async () => {
    const dir = await temp();
    const runtime = createPiRuntime({ dataDir: dir });
    const result = runtime.models();
    const failure = expect(result).rejects.toThrow(/disposed/);
    await runtime.dispose();
    await failure;
  });
  it("returns useful subscription auth errors with the original run context, never API-key fallback", async () => {
    const dir = await temp();
    await mkdir(join(dir, "pi"), { recursive: true });
    await writeFile(join(dir, "pi", "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "dummy-not-an-oauth-credential" } }));
    const runtime = createPiRuntime({ dataDir: dir });
    const events: any[] = [];
    runtime.configure({ onTool: async () => { throw new Error("must never run"); }, onEvent: event => events.push(event) });
    try {
      const models = runtime.models();
      await expect(models).rejects.toThrow(/pnpm agent:login/);
      await expect(models).rejects.toMatchObject({ code: "PI_AUTH_REQUIRED" });
      await expect(runtime.start(input)).rejects.toThrow(/pnpm agent:login/);
      expect(events.find(e => e.type === "error")).toMatchObject({ ...ctx, message: expect.stringMatching(/subscription|ChatGPT/i) });
      expect(events.some(e => e.type === "assistant.delta")).toBe(false);
    } finally { await runtime.dispose(); }
  }, 30_000);
});

describe("subscription login storage", () => {
  it("uses one stable app installation ID across logins, including concurrent first use", async () => {
    const dir = await temp();
    const ids = await Promise.all([getOrCreateDeviceId(dir), getOrCreateDeviceId(dir), getOrCreateDeviceId(dir)]);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await getOrCreateDeviceId(dir)).toBe(ids[0]);
    expect(await readFile(join(dir, "pi", "device-id"), "utf8")).toBe(ids[0]);
  });
});
