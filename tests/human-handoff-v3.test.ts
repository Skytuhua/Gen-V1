import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/storage/store.ts";
import { Service } from "../packages/core/service.ts";
import { BackgroundWorkCoordinator, type BackgroundWorkRecord } from "../packages/core/background-work.ts";
import { __setCapabilityFlagForTests } from "../packages/core/capability-flags.ts";
import type { RuntimeAdapter, Thread } from "../packages/contracts/index.ts";
import type { HumanStepV1 } from "../packages/contracts/background-work.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const key of ["jobs.backgroundV1", "jobs.serviceLifetimeV1", "jobs.idleReviewV1", "integrations.intakeV1"] as const) __setCapabilityFlagForTests(key, undefined);
  vi.restoreAllMocks();
  while (cleanups.length) await cleanups.pop()!();
});

const command = (type: string, payload: Record<string, unknown> = {}, threadId?: string) => ({ id: randomUUID(), type, payload, ...(threadId ? { threadId } : {}) });
const SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "m10-handoff-"));
  const store = new Store(join(root, "state"));
  let clock = 1_700_000_000_000;
  const followUps: { id: string; threadId: string; content: string }[] = [];
  const coordinator = new BackgroundWorkCoordinator({
    store, now: () => clock,
    enqueueFollowUp: input => {
      followUps.push(input);
      store.put("outbox", input.id, input.threadId, { id: input.id, threadId: input.threadId, content: input.content, status: "persisted", runId: null });
    },
  });
  const thread: Thread = { id: "thread-1", title: "Owner", projectName: null, createdAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString(), status: "ready", epoch: 0, runId: null, modelId: null, sessionPath: null };
  const other: Thread = { ...thread, id: "thread-2", title: "Other" };
  store.internal("fixture.threads", null, () => { store.put("thread", thread.id, thread.id, thread); store.put("thread", other.id, other.id, other); });
  cleanups.push(() => { coordinator.dispose(); store.close(); rmSync(root, { recursive: true, force: true }); });
  __setCapabilityFlagForTests("jobs.backgroundV1", true);
  const owner = { threadId: thread.id, runId: null, epoch: 0, projectId: null, workspaceId: null, accountBinding: null };
  const work = coordinator.admit(command("background.work.admit"), { owner, kind: "MAINTENANCE", title: "blocked step" });
  const request = (revision: number, requiredAction: "answer" | "approval" | "credential" = "answer", responseSchema: Record<string, unknown> = SCHEMA) =>
    coordinator.requestHumanStep(command("background.human.request"), { requestId: "req-1", owner, questionRevision: revision, responseSchema, requiredAction, workId: work.workId });
  return { store, coordinator, followUps, owner, work, request, advance: (ms: number) => { clock += ms; } };
}

describe("M10-S05/T04 human handoff correlation", () => {
  it("pauses the work and blocks automatic retry while a step is pending", async () => {
    const f = fixture();
    f.request(1);
    expect(f.coordinator.work(f.work.workId).state).toBe("WAITING_HUMAN");
    f.coordinator.scheduler.register(command("background.wakeup.register"), { taskId: f.work.workId, trigger: { kind: "AT_UTC", dueAtMs: 1_700_000_000_000 } });
    await f.coordinator.scheduler.tick();
    expect(f.coordinator.scheduler.schedules()[0]!.state).toBe("BLOCKED");
    expect(f.followUps).toHaveLength(0);
  });
  it("rejects a stale answer to a superseded request revision", () => {
    const f = fixture();
    f.request(1);
    f.request(2);
    const steps = f.coordinator.humanSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.questionRevision).toBe(2);
    expect(() => f.coordinator.respondHumanStep(command("background.human.respond", { requestId: "req-1", revision: 1, response: { answer: "old" } }, "thread-1"), { requestId: "req-1", revision: 1, response: { answer: "old" } })).toThrowError(expect.objectContaining({ code: "STALE_REQUEST" }));
    expect(f.followUps).toHaveLength(0);
    expect(f.coordinator.work(f.work.workId).state).toBe("WAITING_HUMAN");
  });
  it("rejects a response for another thread without resuming any work", () => {
    const f = fixture();
    f.request(1);
    expect(() => f.coordinator.respondHumanStep(command("background.human.respond", { requestId: "req-1", revision: 1, response: { answer: "x" } }, "thread-2"), { requestId: "req-1", revision: 1, response: { answer: "x" } })).toThrowError(expect.objectContaining({ code: "CAPABILITY_DENIED" }));
    expect(f.followUps).toHaveLength(0);
    expect(f.coordinator.work(f.work.workId).state).toBe("WAITING_HUMAN");
  });
  it("validates the response against the exact request schema", () => {
    const f = fixture();
    f.request(1);
    expect(() => f.coordinator.respondHumanStep(command("background.human.respond", {}, "thread-1"), { requestId: "req-1", revision: 1, response: { answer: 42 } })).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(f.followUps).toHaveLength(0);
  });
  it("accepts one correlated answer and enqueues exactly one durable follow-up", () => {
    const f = fixture();
    f.request(1);
    const result = f.coordinator.respondHumanStep(command("background.human.respond", {}, "thread-1"), { requestId: "req-1", revision: 1, response: { answer: "proceed" } });
    expect(result.inputId).toBe("human:req-1:1");
    expect(f.followUps).toHaveLength(1);
    expect(f.followUps[0]!.content).toContain("human-step-response");
    expect(f.coordinator.work(f.work.workId).state).toBe("QUEUED");
    expect(f.coordinator.humanSteps()[0]!.deliveryState).toBe("ANSWERED");
    expect(f.store.all("approval")).toHaveLength(0);
  });
  it("decline settles the request as declined, never approved, with no follow-up or grant", () => {
    const f = fixture();
    f.request(1);
    f.store.internal("fixture.request", "thread-1", () => f.store.put("request", "req-1", "thread-1", { id: "req-1", threadId: "thread-1", artifactId: null, revision: 1, title: "Step", prompt: "Approve?", responseSchema: SCHEMA, basis: [], status: "pending" }));
    const result = f.coordinator.declineHumanStep(command("background.human.decline", {}, "thread-1"), { requestId: "req-1", revision: 1 });
    expect(result.declined).toBe(true);
    expect(f.coordinator.humanSteps()[0]!.deliveryState).toBe("DECLINED");
    const work = f.coordinator.work(f.work.workId);
    expect(work.state).toBe("SETTLED");
    expect(work.outcome).toBe("CANCELLED");
    expect(f.store.get<{ status: string }>("request", "req-1")!.status).toBe("withdrawn");
    expect(f.followUps).toHaveLength(0);
    expect(f.store.all("approval")).toHaveLength(0);
    expect(() => f.coordinator.respondHumanStep(command("background.human.respond", {}, "thread-1"), { requestId: "req-1", revision: 1, response: { answer: "late" } })).toThrowError(expect.objectContaining({ code: "STALE_REQUEST" }));
  });
  it("credential steps never accept plaintext message content", () => {
    const f = fixture();
    expect(() => f.request(1, "credential", SCHEMA)).toThrowError(expect.objectContaining({ code: "CREDENTIAL_SURFACE_REQUIRED" }));
    f.request(1, "credential", {});
    expect(() => f.coordinator.respondHumanStep(command("background.human.respond", {}, "thread-1"), { requestId: "req-1", revision: 1, response: { secret: "hunter2" } })).toThrowError(expect.objectContaining({ code: "CREDENTIAL_SURFACE_REQUIRED" }));
    expect(f.followUps).toHaveLength(0);
  });
});

describe("M10-D04 answer replay semantics", () => {
  it("replays the original receipt for an identical answer and conflicts on changed content", () => {
    const f = fixture();
    f.request(1);
    const first = f.coordinator.respondHumanStep(command("background.human.respond", {}, "thread-1"), { requestId: "req-1", revision: 1, response: { answer: "yes" } });
    const replay = f.coordinator.respondHumanStep(command("background.human.respond", {}, "thread-1"), { requestId: "req-1", revision: 1, response: { answer: "yes" } });
    expect(replay.replayed).toBe(true);
    expect(replay.inputId).toBe(first.inputId);
    expect(f.followUps).toHaveLength(1);
    expect(f.store.all("outbox")).toHaveLength(1);
    expect(() => f.coordinator.respondHumanStep(command("background.human.respond", {}, "thread-1"), { requestId: "req-1", revision: 1, response: { answer: "no" } })).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(f.followUps).toHaveLength(1);
    expect(f.store.all("approval")).toHaveLength(0);
  });
});

describe("M10 human handoff host binding", () => {
  it("runs respond/decline through Service.command with durable outbox receipts", async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "m10-handoff-service-"));
    const store = new Store(join(root, "state"));
    const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [{ id: "test/model", provider: "test", name: "Test" }], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
    const service = new Service(store, runtime);
    cleanups.push(async () => { await service.dispose().catch(() => {}); store.close(); rmSync(root, { recursive: true, force: true }); });
    __setCapabilityFlagForTests("jobs.backgroundV1", true);
    const thread = (await service.command(command("thread.create", { title: "Handoff" }))).result as Thread;
    const work = (await service.command(command("background.work.admit", { kind: "MAINTENANCE", title: "step" }, thread.id))).result as BackgroundWorkRecord;
    await service.command(command("background.human.request", { requestId: "req-http", questionRevision: 1, responseSchema: SCHEMA, requiredAction: "answer", workId: work.workId }, thread.id));
    const answered = await service.command(command("background.human.respond", { requestId: "req-http", revision: 1, response: { answer: "ok" } }, thread.id));
    const inputId = (answered.result as { inputId: string }).inputId;
    expect(store.get("outbox", inputId)).toMatchObject({ id: inputId, threadId: thread.id, status: "persisted" });
    const replay = await service.command(command("background.human.respond", { requestId: "req-http", revision: 1, response: { answer: "ok" } }, thread.id));
    expect((replay.result as { replayed: boolean }).replayed).toBe(true);
    expect(store.all<{ id: string }>("outbox").filter(input => input.id === inputId)).toHaveLength(1);
    const step = service.backgroundWork.humanSteps(thread.id)[0] as HumanStepV1;
    expect(step.deliveryState).toBe("ANSWERED");
    expect(step.resumeBinding.workId).toBe(work.workId);
  });
  it("delivers the follow-up outside the answer transaction on a model-bound thread", async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "m10-handoff-delivery-"));
    const store = new Store(join(root, "state"));
    const starts: string[] = [];
    const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [{ id: "test/model", provider: "test", name: "Test" }], start: async input => { starts.push(input.inputId); }, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
    const service = new Service(store, runtime);
    cleanups.push(async () => { await service.dispose().catch(() => {}); store.close(); rmSync(root, { recursive: true, force: true }); });
    __setCapabilityFlagForTests("jobs.backgroundV1", true);
    const thread = (await service.command(command("thread.create", { title: "Bound" }))).result as Thread;
    store.internal("fixture.model", thread.id, () => store.put("thread", thread.id, thread.id, { ...thread, modelId: "test/model", accountId: null }));
    const work = (await service.command(command("background.work.admit", { kind: "MAINTENANCE", title: "step" }, thread.id))).result as BackgroundWorkRecord;
    await service.command(command("background.human.request", { requestId: "req-bound", questionRevision: 1, responseSchema: SCHEMA, requiredAction: "answer", workId: work.workId }, thread.id));
    const answered = await service.command(command("background.human.respond", { requestId: "req-bound", revision: 1, response: { answer: "go" } }, thread.id));
    const inputId = (answered.result as { inputId: string }).inputId;
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(starts).toContain(inputId);
    expect(store.get<{ status: string }>("outbox", inputId)!.status).toBe("processing");
  });
});
