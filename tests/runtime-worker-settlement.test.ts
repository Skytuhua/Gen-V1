import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunContext, RuntimeEvent, StartRun } from "../packages/contracts/index.ts";

const doubles = vi.hoisted(() => ({ selectModel: vi.fn(), spawn: vi.fn() }));
vi.mock("../packages/runtime-pi/models.ts", async original => ({ ...await original<typeof import("../packages/runtime-pi/models.ts")>(), selectSubscriptionModel: doubles.selectModel, subscriptionModels: vi.fn() }));
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawn: doubles.spawn }));
vi.mock("../packages/runtime-pi/process-tree.ts", () => ({ terminateProcessTree: async (child: EventEmitter) => { child.emit("exit", 0, null); } }));

const ctx: RunContext = { threadId: "settlement-task", runId: "run-a", epoch: 7 };
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); }
});

/** Real worker listener, delivery/normalizer, and installed SDK; only transport and provider I/O are scripted. */
async function workerFixture(onSession?: (session: AgentSession) => void) {
  vi.resetModules();
  const sdk = await import("@earendil-works/pi-coding-agent");
  const dir = await mkdtemp(join(tmpdir(), "harness-worker-settlement-"));
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network is forbidden in worker settlement tests."));
  const model = runtime.getModels("openai")[0]!;
  const input: StartRun = { ...ctx, inputId: "input-a", prompt: "A", modelId: `${model.provider}/${model.id}`, sessionPath: null, resources: [] };
  const ipc = new EventEmitter(), outgoing = new EventEmitter();
  const messages: any[] = [], requests: any[] = [], held: any[] = [];
  const sessions: AgentSession[] = [];
  const entered = [barrier(), barrier(), barrier()], replies = [barrier(), barrier(), barrier()];
  let providerCalls = 0, requestId = 0, holdFollowUps = false;
  const child = Object.assign(new EventEmitter(), {
    connected: true, exitCode: null, signalCode: null,
    send(message: any, callback: (error: Error | null) => void) {
      requests.push(message);
      if (holdFollowUps && message.command === "followUp") held.push(message);
      else ipc.emit("message", message);
      callback(null);
      return true;
    },
  });
  doubles.spawn.mockReset().mockReturnValue(child);
  doubles.selectModel.mockReset().mockResolvedValue({ runtime, model, sdk: {
    ...sdk,
    async createAgentSession(options: Parameters<typeof sdk.createAgentSession>[0]) {
      const created = await sdk.createAgentSession({ ...options, settingsManager: sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false }, compaction: { enabled: false }, followUpMode: "all" }) });
      sessions.push(created.session);
      created.session.agent.streamFunction = async (_model, _context, options) => {
        const index = providerCalls++;
        if (!entered[index]) throw new Error("Unexpected extra provider request.");
        entered[index].release();
        await Promise.race([replies[index].promise, new Promise<void>(resolve => {
          if (options?.signal?.aborted) resolve();
          else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        })]);
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
      onSession?.(created.session);
      return created;
    },
  } });
  const nativeProcess = process;
  vi.stubGlobal("process", new Proxy(nativeProcess, {
    get(target, property) {
      if (property === "connected") return true;
      if (property === "on") return ipc.on.bind(ipc);
      if (property === "send") return (message: any) => {
        messages.push(message);
        child.emit("message", message);
        outgoing.emit("message", message);
      };
      return Reflect.get(target, property, target);
    },
  }));
  cleanups.push(async () => {
    replies.forEach(reply => reply.release());
    for (const session of sessions) { await session.abort(); session.dispose(); }
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    expect(network).not.toHaveBeenCalled();
  });
  await import("../packages/runtime-pi/worker.ts");
  function response(id: string): Promise<any> {
    return new Promise(resolve => {
      const receive = (message: any) => {
        if (message.type === "response" && message.requestId === id) { outgoing.off("message", receive); resolve(message); }
      };
      outgoing.on("message", receive);
    });
  }
  function command(command: string, value = input) {
    const id = `direct-${++requestId}`, result = response(id);
    ipc.emit("message", { type: "command", command, requestId: id, dataDir: dir, input: value, ctx: value });
    return result;
  }
  const events = () => messages.filter(message => message.type === "event").map(message => message.event as RuntimeEvent);
  async function start() { expect(await command("start")).toMatchObject({ value: null }); await entered[0].promise; }
  async function settle() { replies[0].release(); await sessions[0].waitForIdle(); }
  return {
    dir, input, command, start, settle, events, messages, requests, held, sessions, entered, replies, ipc,
    holdFollowUps: () => { holdFollowUps = true; },
    deliverHeld: () => { for (const message of held.splice(0)) ipc.emit("message", message); },
    providerCalls: () => providerCalls,
  };
}

describe("worker settlement authority", () => {
  it("rejects B held in parent-to-worker IPC until A settles and the host has cleared its run", async () => {
    const fixture = await workerFixture();
    const { createPiRuntime } = await import("../packages/runtime-pi/index.ts");
    const parent = createPiRuntime({ dataDir: fixture.dir });
    let hostRunId: string | null = ctx.runId;
    parent.configure({ onTool: async () => null, onEvent: event => { if (event.type === "settled") hostRunId = null; } });
    cleanups.push(() => parent.dispose());
    await parent.start(fixture.input);
    await fixture.entered[0].promise;
    fixture.holdFollowUps();
    const outcome = parent.followUp({ ...fixture.input, inputId: "input-b", prompt: "B" }).then(() => "accepted", error => error);
    await vi.waitFor(() => expect(fixture.held).toHaveLength(1));
    await fixture.settle();
    expect(hostRunId).toBeNull();
    // Stop has no active host run to cancel, so no abort reaches this worker.
    if (hostRunId) await parent.cancel(ctx);
    expect(fixture.requests.some(request => request.command === "abort")).toBe(false);
    fixture.deliverHeld();
    expect(await outcome).toMatchObject({ code: "PI_STALE_RUN" });
    expect(fixture.messages.find(message => message.type === "response" && message.requestId === fixture.requests.find(request => request.command === "followUp").requestId)).toMatchObject({ error: expect.any(String), code: "PI_STALE_RUN" });
    expect(fixture.providerCalls()).toBe(1);
    expect(fixture.events().filter(event => event.type === "input.processing").map(event => event.inputIds)).toEqual([["input-a"]]);
    await expect(parent.followUp({ ...fixture.input, inputId: "retry-b" })).rejects.toMatchObject({ code: "PI_STALE_RUN" });
    expect(doubles.spawn).toHaveBeenCalledTimes(1);
  });

  it("cannot start B under the old context when settlement occurs during SDK input preflight", async () => {
    const fixture = await workerFixture();
    await fixture.start();
    const gate = barrier(), preflight = barrier();
    cleanups.push(async () => gate.release());
    const session = fixture.sessions[0];
    // Gate the actual SDK's shared asynchronous input processing, without replacing prompt/queue behavior.
    const internals = session as unknown as { _runInputHandlers: (...args: unknown[]) => Promise<unknown> };
    const original = internals._runInputHandlers.bind(session);
    vi.spyOn(internals, "_runInputHandlers").mockImplementationOnce(async (...args) => { preflight.release(); await gate.promise; return original(...args); });
    const result = fixture.command("followUp", { ...fixture.input, inputId: "input-b", prompt: "B" });
    await preflight.promise;
    await fixture.settle();
    gate.release();
    expect(await result).toMatchObject({ error: expect.any(String), code: "PI_STALE_RUN" });
    expect(fixture.providerCalls()).toBe(1);
    expect(session.getFollowUpMessages()).toEqual([]);
    expect(session.pendingMessageCount).toBe(0);
    expect(fixture.events().filter(event => event.type === "input.processing").map(event => event.inputIds)).toEqual([["input-a"]]);
  });

  it("still queues an active B into the same session and durable run context", async () => {
    const fixture = await workerFixture();
    await fixture.start();
    const session = fixture.sessions[0], sessionPath = session.sessionFile!;
    const result = await fixture.command("followUp", { ...fixture.input, inputId: "input-b", prompt: "B", sessionPath });
    expect(result).toMatchObject({ value: null });
    expect(result).not.toHaveProperty("error");
    fixture.replies[0].release();
    await fixture.entered[1].promise;
    fixture.replies[1].release();
    await session.waitForIdle();
    expect(fixture.providerCalls()).toBe(2);
    expect(fixture.sessions).toEqual([session]);
    expect(fixture.events().filter(event => event.type === "input.processing")).toEqual([
      { ...ctx, type: "input.processing", inputIds: ["input-a"] },
      { ...ctx, type: "input.processing", inputIds: ["input-b"] },
    ]);
    expect(fixture.events().filter(event => event.type === "settled")).toEqual([{ ...ctx, type: "settled", aborted: false }]);
    expect(session.sessionFile).toBe(sessionPath);
  });

  it("does not revive a settled worker with another start command", async () => {
    const fixture = await workerFixture();
    await fixture.start();
    await fixture.settle();
    expect(await fixture.command("start", { ...fixture.input, runId: "run-b", epoch: 8, inputId: "input-b" })).toMatchObject({ error: expect.any(String), code: "PI_STALE_RUN" });
    expect(fixture.sessions).toHaveLength(1);
    expect(fixture.providerCalls()).toBe(1);
  });

  it("keeps follow-ups eligible after agent_end until normalized settlement", async () => {
    const fixture = await workerFixture();
    await fixture.start();
    const boundary = barrier(), gate = barrier(), session = fixture.sessions[0];
    cleanups.push(async () => gate.release());
    const internals = session as unknown as { _runBeforeSettleBoundary: () => Promise<boolean> };
    const original = internals._runBeforeSettleBoundary.bind(session);
    vi.spyOn(internals, "_runBeforeSettleBoundary").mockImplementationOnce(async () => { boundary.release(); await gate.promise; return original(); });
    let agentEnds = 0;
    session.subscribe(event => { if (event.type === "agent_end") agentEnds++; });
    fixture.replies[0].release();
    await boundary.promise;
    expect(agentEnds).toBe(1);
    expect(fixture.events().some(event => event.type === "settled")).toBe(false);
    expect(await fixture.command("followUp", { ...fixture.input, inputId: "input-b" })).toMatchObject({ value: null });
    gate.release();
    await fixture.entered[1].promise;
    fixture.replies[1].release();
    await session.waitForIdle();
    expect(fixture.events().filter(event => event.type === "input.processing").map(event => event.inputIds)).toEqual([["input-a"], ["input-b"]]);
    expect(fixture.events().filter(event => event.type === "settled")).toHaveLength(1);
  });

  it("rejects B if settlement wins the final queue-acceptance-to-IPC-response window", async () => {
    const fixture = await workerFixture();
    await fixture.start();
    const boundary = barrier(), gate = barrier(), session = fixture.sessions[0];
    cleanups.push(async () => gate.release());
    const internals = session as unknown as { _runBeforeSettleBoundary: () => Promise<boolean> };
    const original = internals._runBeforeSettleBoundary.bind(session);
    vi.spyOn(internals, "_runBeforeSettleBoundary").mockImplementationOnce(async () => {
      const continueRun = await original();
      boundary.release();
      await gate.promise;
      return continueRun;
    });
    fixture.replies[0].release();
    await boundary.promise;
    // The real SDK has completed its final queue check. This interleaving settles after
    // queue acceptance but before the worker replies; assert that observable ordering below.
    session.subscribe(event => { if (event.type === "queue_update" && event.followUp.length) queueMicrotask(() => gate.release()); });
    const response = await fixture.command("followUp", { ...fixture.input, inputId: "input-b" });
    await session.waitForIdle();
    expect(fixture.messages.findIndex(message => message.type === "event" && message.event.type === "settled")).toBeLessThan(fixture.messages.indexOf(response));
    expect(response).toMatchObject({ error: expect.any(String), code: "PI_STALE_RUN" });
    expect(fixture.providerCalls()).toBe(1);
    expect(session.pendingMessageCount).toBe(0);
    expect(fixture.events().filter(event => event.type === "input.processing").map(event => event.inputIds)).toEqual([["input-a"]]);
  });

  it("rejects an in-flight B when abort completes during SDK preflight", async () => {
    const fixture = await workerFixture();
    await fixture.start();
    const preflight = barrier(), gate = barrier(), session = fixture.sessions[0];
    cleanups.push(async () => gate.release());
    const internals = session as unknown as { _runInputHandlers: (...args: unknown[]) => Promise<unknown> };
    const original = internals._runInputHandlers.bind(session);
    vi.spyOn(internals, "_runInputHandlers").mockImplementationOnce(async (...args) => { preflight.release(); await gate.promise; return original(...args); });
    const result = fixture.command("followUp", { ...fixture.input, inputId: "input-b" });
    await preflight.promise;
    expect(await fixture.command("abort")).toMatchObject({ value: null });
    gate.release();
    expect(await result).toMatchObject({ error: expect.any(String) });
    expect(fixture.providerCalls()).toBe(1);
    expect(session.pendingMessageCount).toBe(0);
    expect(fixture.events().filter(event => event.type === "input.processing").map(event => event.inputIds)).toEqual([["input-a"]]);
    expect(fixture.events().filter(event => event.type === "settled")).toEqual([{ ...ctx, type: "settled", aborted: true }]);
  });

  it("also retires a fresh compaction worker when its normalized settlement is emitted", async () => {
    const fixture = await workerFixture(session => { vi.spyOn(session, "compact").mockResolvedValue({} as never); });
    expect(await fixture.command("compact")).toMatchObject({ value: null });
    expect(fixture.events().filter(event => event.type === "settled")).toEqual([{ ...ctx, type: "settled", aborted: false }]);
    expect(await fixture.command("followUp", { ...fixture.input, inputId: "input-b" })).toMatchObject({ error: expect.any(String), code: "PI_STALE_RUN" });
    expect(fixture.providerCalls()).toBe(0);
    expect(fixture.sessions[0].pendingMessageCount).toBe(0);
  });

  it("preserves exact run, model, and session checks for active follow-ups", async () => {
    const fixture = await workerFixture();
    await fixture.start();
    for (const invalid of [
      { ...fixture.input, epoch: ctx.epoch + 1 },
      { ...fixture.input, modelId: "other/model" },
      { ...fixture.input, sessionPath: join(fixture.dir, "other-session.jsonl") },
    ]) expect(await fixture.command("followUp", invalid)).toMatchObject({ error: expect.any(String) });
    expect(fixture.providerCalls()).toBe(1);
    expect(fixture.sessions[0].pendingMessageCount).toBe(0);
  });
});
