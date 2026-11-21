import { randomUUID } from "node:crypto";

import {
  HarnessError,
  EMPTY_USAGE,
  type Message,
  type Operation,
  type RunContext,
  type RuntimeEvent,
  type RuntimeUsage,
  type Thread,
  type WriteHookDiagnostic,
  type CompletedWriteReceipt,
} from "../contracts/index.ts";
import type { ContextRequestObservationV1, ContextRelevanceObservationV1 } from "../contracts/request-context.ts";
import { automaticCompactionRefusalSchema } from "../contracts/native-compaction.ts";
import { nativeContextProjectionSchema, inferenceBudgetSchema } from "../contracts/request-context.ts";
import { MODEL_REQUEST_OBSERVATION_LIMIT, modelRequestObservationV1Schema } from "../contracts/model-request.ts";
import { MODEL_ONLY_MAX_PROMPT_BYTES } from "../runtime/model-only.ts";
import type { SendModeV1 } from "../contracts/source-selection.ts";
import type { WorkbenchQueuedInput } from "./source-workbench.ts";
import type { Store } from "../storage/store.ts";
import type { PlanningCoordinator } from "./planning.ts";
import type { ComposerPredictions, PredictionBasis } from "./composer-prediction.ts";
import type { BackgroundWorkCoordinator } from "./background-work.ts";
import type { ProjectMemoryHost } from "./project-memory-host.ts";
import type { RequestContextBasis, RequestContextCustody } from "./request-custody.ts";
import { modelProvider } from "./accounts.ts";
import { capabilityEnabled } from "./capability-flags.ts";

type Outbox = WorkbenchQueuedInput & {
  messageId?: string;
  completedWrite?: CompletedWriteReceipt;
  hookClaimed?: boolean;
  hookDiagnostic?: WriteHookDiagnostic;
  sendMode?: SendModeV1;
};

type FinishRecord = { inputIds: string[]; invalidated?: boolean; [key: string]: unknown };

type DeltaBuffer = {
  threadId: string;
  runId: string;
  epoch: number;
  messageId: string;
  parts: string[];
  timer: ReturnType<typeof setTimeout>;
};

const now = () => new Date().toISOString();

/** Cross-domain calls a `ServiceRuntimeEvents` needs back into `Service`. */
export interface ServiceRuntimeEventsHost {
  store: Store;
  planning: PlanningCoordinator;
  predictions: ComposerPredictions;
  backgroundWork: BackgroundWorkCoordinator;
  custody: RequestContextCustody;
  /** Shared maps — the same instances other domains read. */
  inferenceOwners: Map<string, { ctx: RunContext; basis: string; sequence: number }>;
  aborts: Map<string, AbortController>;
  isClosed(): boolean;
  thread(id: string): Thread;
  hasGate(id: string): boolean;
  binding(thread: Thread, providerId: string): { accountId: string | null; bound: boolean };
  requestContextEnabled(): boolean;
  requestBasis(thread: Thread, modelId: string, thinkingLevel: string | null | undefined): RequestContextBasis;
  observeReadRelevance(thread: Thread, sequence: number): ContextRelevanceObservationV1 | undefined;
  forgetReadRelevance(threadId: string): void;
  failUnansweredDetails(ctx: RunContext, error: string): void;
  operationData(operation: Operation, progress?: { message: string; counts?: unknown }): void;
  afterMaintenance(threadId: string, previous: Thread["status"]): Thread["status"];
  retireController(threadId: string, control: AbortController | undefined): void;
  cancelRun(ctx: RunContext, side: boolean): Promise<void>;
  deliverOutbox(threadId: string): Promise<void>;
  background(job: Promise<unknown>): void;
  predictionBasis(threadId: string, settling: boolean): PredictionBasis | null;
  memoryHostInstance(): ProjectMemoryHost | undefined;
  reviewAfter(ctx: RunContext, force?: boolean): Promise<boolean>;
}

/**
 * The runtime-events domain: failure settlement, streaming delta coalescing,
 * and the single projection that turns runtime events into store writes.
 */
export class ServiceRuntimeEvents {
  private readonly deltaBuffers = new Map<string, DeltaBuffer>();

  constructor(private readonly host: ServiceRuntimeEventsHost) {}

  /** Flush every coalesced delta before the host closes. */
  dispose(): void {
    for (const key of [...this.deltaBuffers.keys()]) this.flushDelta(key);
  }

  runtimeFailure(ctx: RunContext, error: unknown): void {
    const { host } = this;
    if (host.isClosed()) return;
    const thread = host.store.get<Thread>("thread", ctx.threadId);
    if (!thread || thread.epoch !== ctx.epoch || thread.runId !== ctx.runId) return;
    host.inferenceOwners.delete(thread.id);
    this.flushDeltas(thread.id);
    host.store.internal("run.failed", thread.id, () => {
      host.failUnansweredDetails(ctx, "The explanation could not finish. Resume the task to retry.");
      const intent = host.store.get<{ kind: string; previousStatus: Thread["status"] }>("runtimeIntent", ctx.runId);
      const stamp = now();
      if (intent?.kind !== "compaction") {
        host.planning.endRun(ctx, "failed");
        if (!host.store.get("runFailure", ctx.runId))
          host.store.put("runFailure", ctx.runId, thread.id, { threadId: ctx.threadId, runId: ctx.runId, epoch: ctx.epoch, projectId: thread.projectId ?? null, occurredAt: stamp });
      }
      host.store.put("thread", thread.id, thread.id, {
        ...thread,
        runId: null,
        status: intent?.kind === "compaction" ? host.afterMaintenance(thread.id, intent.previousStatus) : "interrupted",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: stamp,
      });
      return { runId: ctx.runId };
    });
    // Clearing the projection must never detach a still-busy SDK session.
    host.aborts.get(thread.id)?.abort();
    host.background(host.cancelRun(ctx, !!thread.sideParentId).then(() => host.deliverOutbox(thread.id)));
  }

  private bufferDelta(event: RuntimeEvent, thread: Thread): void {
    if (typeof event.messageId !== "string") {
      // Without a stable message id chunks cannot be coalesced safely.
      this.commitRuntimeProjection(thread, event);
      return;
    }
    const key = `${thread.id}:${event.runId}:${event.messageId}`;
    const existing = this.deltaBuffers.get(key);
    if (existing && existing.epoch === event.epoch) {
      existing.parts.push(String(event.delta ?? ""));
      return;
    }
    if (existing) this.flushDelta(key);
    const timer = setTimeout(() => this.flushDelta(key), 40);
    timer.unref();
    this.deltaBuffers.set(key, { threadId: thread.id, runId: event.runId, epoch: event.epoch, messageId: event.messageId, parts: [String(event.delta ?? "")], timer });
  }

  private flushDelta(key: string): void {
    const { host } = this;
    const buffer = this.deltaBuffers.get(key);
    if (!buffer) return;
    this.deltaBuffers.delete(key);
    clearTimeout(buffer.timer);
    if (host.isClosed()) return;
    const thread = host.store.get<Thread>("thread", buffer.threadId);
    if (!thread || thread.epoch !== buffer.epoch || thread.runId !== buffer.runId) return;
    const delta = buffer.parts.join("");
    if (!delta) return;
    this.commitRuntimeProjection(thread, { type: "assistant.delta", threadId: thread.id, runId: buffer.runId, epoch: buffer.epoch, messageId: buffer.messageId, delta });
  }

  flushDeltas(threadId: string): void {
    for (const [key, buffer] of this.deltaBuffers) if (buffer.threadId === threadId) this.flushDelta(key);
  }

  onRuntimeEvent(event: RuntimeEvent): void {
    const { host } = this;
    if (host.isClosed()) return;
    const thread = host.store.get<Thread>("thread", event.threadId);
    if (!thread || event.epoch !== thread.epoch || event.runId !== thread.runId) return;
    if (["context.request", "context.budget"].includes(event.type) && !capabilityEnabled("context.compilerV1")) return;
    if (event.type === "error") {
      this.flushDeltas(thread.id);
      this.runtimeFailure(event, new Error(String(event.message)));
      return;
    }
    if (event.type === "assistant.delta") {
      this.bufferDelta(event, thread);
      return;
    }
    // Preserve event order: buffered deltas precede every other commit here.
    this.flushDeltas(thread.id);
    const control = host.aborts.get(thread.id);
    this.commitRuntimeProjection(thread, event);
    if (event.type === "input.processing")
      try {
        host.memoryHostInstance()?.acceptedInput(event);
      } catch {
        /* Runtime acceptance remains authoritative; revoked memory cannot be re-read for a usage projection. */
      }
    if (event.type === "settled") {
      host.retireController(thread.id, control);
      // Allowlisted host event for HOST_EVENT wakeups; schedules may correlate
      // on the settled run or its thread. Never supplies execution authority.
      try {
        host.backgroundWork.notifyHostEvent("runtime.settled", event.runId, `runtime.settled:${event.runId}`);
        host.backgroundWork.notifyHostEvent("runtime.settled", thread.id, `runtime.settled:${event.runId}`);
      } catch {
        /* A disabled background surface must not break settlement. */
      }
    }
    if (event.type === "settled" && !event.aborted) {
      // Hermes may still be closing its background review here. Only this
      // accepted transition mints the slot; request admission waits for cleanup.
      const basis = host.predictionBasis(thread.id, true),
        reply = basis ? host.store.get<Message>("message", basis.replyId) : null;
      if (basis && reply?.runId === event.runId && !host.store.get("runtimeIntent", event.runId)) host.predictions.settled(basis);
      host.background(
        host.deliverOutbox(thread.id).then(async () => {
          await host.memoryHostInstance()?.runSettled(event);
          return host.reviewAfter(event);
        }),
      );
    }
  }

  private commitRuntimeProjection(thread: Thread, event: RuntimeEvent): void {
    const { host } = this;
    host.store.internal("runtime." + event.type, thread.id, () => {
      // Accepted queued inputs follow this owner's ordinary session and settle
      // transitions. Unclaimed previews remain stale. A revoked source never
      // blocks native settlement; it simply cannot advance its custody fence.
      let lifecycleBasis: RequestContextBasis | null = null;
      if (host.requestContextEnabled() && thread.modelId && (event.type === "session" || (event.type === "settled" && !event.aborted)))
        try {
          lifecycleBasis = host.requestBasis(thread, thread.modelId, thread.thinkingLevel);
        } catch {
          /* The queued claim will fail its current-source check. */
        }
      const advanceLifecycle = () => {
        if (lifecycleBasis && thread.modelId)
          try {
            host.custody.advanceAdmission(lifecycleBasis, host.requestBasis(host.thread(thread.id), thread.modelId, thread.thinkingLevel));
          } catch {
            /* Retain the old fence for a failed or revoked owner. */
          }
      };
      if (event.type === "write.hook" && event.diagnostic && typeof event.diagnostic === "object") {
        const diagnostic = event.diagnostic as WriteHookDiagnostic,
          input = host.store.get<Outbox>("outbox", diagnostic.inputId),
          receipt = input?.completedWrite;
        if (
          input?.hookClaimed &&
          input.runId === event.runId &&
          input.hookDiagnostic?.status === "unknown" &&
          receipt?.operationId === diagnostic.operationId &&
          receipt.revision === diagnostic.revision &&
          ["applied", "failed", "stale", "disabled", "no_project", "scope_unavailable", "unknown"].includes(diagnostic.status) &&
          typeof diagnostic.message === "string" &&
          diagnostic.message.length <= 500
        ) {
          host.store.put("outbox", input.id, thread.id, { ...input, hookDiagnostic: diagnostic });
          const op = host.store.get<Operation>("operation", receipt.operationId);
          if (op) host.operationData(op, { message: "Post-edit hook: " + diagnostic.status });
        }
      }
      if (event.type === "input.processing" && Array.isArray(event.inputIds)) {
        for (const id of event.inputIds) {
          const input = typeof id === "string" ? host.store.get<Outbox>("outbox", id) : null;
          if (input?.threadId === thread.id && input.runId === event.runId && input.status === "processing")
            host.store.put("outbox", input.id, thread.id, { ...input, enteredRuntime: true });
        }
      }
      if (event.type === "session") {
        host.store.put("thread", thread.id, thread.id, { ...thread, sessionPath: String(event.sessionPath) });
        advanceLifecycle();
      }
      if (event.type === "assistant.delta" || event.type === "assistant.message" || event.type === "activity") {
        const id = typeof event.messageId === "string" ? event.messageId : randomUUID();
        const old = host.store.get<Message>("message", id);
        if (old && old.threadId !== thread.id) throw new HarnessError("CAPABILITY_DENIED", "Message belongs to another thread");
        const message: Message = {
          id,
          threadId: thread.id,
          role: event.type === "activity" ? "activity" : "assistant",
          content: event.type === "assistant.delta" ? (old?.content ?? "") + String(event.delta ?? "") : String(event.content ?? event.message ?? ""),
          runId: event.runId,
          createdAt: old?.createdAt ?? now(),
        };
        host.store.put("message", id, thread.id, message);
        if (event.type === "assistant.message") {
          const previous = host.store.get<{ inputIds: string[] }>("responseCheckpoint", event.runId)?.inputIds ?? [];
          const ids = Array.isArray(event.inputIds) ? event.inputIds.filter((id): id is string => typeof id === "string" && host.store.get<Outbox>("outbox", id)?.enteredRuntime === true) : [];
          host.store.put("responseCheckpoint", event.runId, thread.id, { inputIds: [...new Set([...previous, ...ids])], messageId: id });
        }
        // Carrying the upserted entity lets SSE clients patch their cached
        // snapshot instead of re-fetching it for every streamed chunk.
        return { runId: event.runId, message };
      }
      if (event.type === "context.budget") {
        const parsed = inferenceBudgetSchema.safeParse(event.budget),
          old = host.store.get<{ value: RuntimeUsage }>("usage", thread.id)?.value ?? EMPTY_USAGE;
        if (!parsed.success || event.provider !== "hermes" || (old.inferenceBudget?.runId === event.runId && old.inferenceBudget.epoch === event.epoch && old.inferenceBudget.budget.sequence >= parsed.data.sequence))
          return { runId: event.runId };
        const inferenceBudget = { threadId: thread.id, runId: event.runId, epoch: event.epoch, budget: parsed.data },
          usage = { ...old, inferenceBudget };
        host.store.put("usage", thread.id, thread.id, { id: thread.id, value: usage });
        return { runId: event.runId, usage };
      }
      if (event.type === "context.compaction.refused") {
        const parsed = automaticCompactionRefusalSchema.safeParse(event.refusal);
        if (!capabilityEnabled("context.lossAwareCompactionV1") || !parsed.success || !thread.modelId) return { runId: event.runId };
        const owner = parsed.data.owner;
        if (
          owner.ctx.threadId !== thread.id ||
          owner.ctx.runId !== event.runId ||
          owner.ctx.epoch !== event.epoch ||
          owner.modelId !== thread.modelId ||
          (thread.sessionPath !== null && owner.sessionPath !== thread.sessionPath) ||
          owner.accountId !== host.binding(thread, modelProvider(thread.modelId)).accountId
        )
          return { runId: event.runId };
        return { runId: event.runId, refusal: parsed.data };
      }
      if (event.type === "context.request") {
        const count = (value: unknown, maximum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
        const { sequence, promptBytes, knownInputs } = event;
        const old = host.store.get<{ value: RuntimeUsage }>("usage", thread.id)?.value ?? EMPTY_USAGE;
        const last = old.lastRequest;
        if (
          event.provider !== "hermes" ||
          !count(sequence, Number.MAX_SAFE_INTEGER) ||
          sequence < 1 ||
          !count(promptBytes, MODEL_ONLY_MAX_PROMPT_BYTES) ||
          !count(knownInputs, 4096) ||
          (last?.runId === event.runId && last.epoch === event.epoch && last.sequence >= sequence)
        )
          return { runId: event.runId };
        const tool = event.toolSnapshot as Record<string, unknown> | undefined;
        const toolSnapshot =
          tool && count(tool.count, 5000) && count(tool.schemaBytes, 128 * 1024) && typeof tool.digest === "string" && /^[a-f0-9]{64}$/.test(tool.digest)
            ? { count: tool.count, schemaBytes: tool.schemaBytes, digest: tool.digest }
            : undefined;
        const relevance = host.observeReadRelevance(thread, sequence),
          native = nativeContextProjectionSchema.safeParse(event.nativeSources);
        const nativeSourcesUnavailable = ["SOURCE_LIMIT", "UNSUPPORTED_SOURCE", "UNSUPPORTED_ADAPTER"].includes(String(event.nativeSourcesUnavailable))
          ? (event.nativeSourcesUnavailable as "SOURCE_LIMIT" | "UNSUPPORTED_SOURCE" | "UNSUPPORTED_ADAPTER")
          : event.nativeSources !== undefined && !native.success
            ? ("UNSUPPORTED_SOURCE" as const)
            : undefined;
        const observation: ContextRequestObservationV1 = {
          threadId: thread.id,
          runId: event.runId,
          epoch: event.epoch,
          sequence,
          promptBytes,
          knownInputs,
          visibility: "OPAQUE_NATIVE_CONTEXT",
          source: "hermes",
          ...(toolSnapshot ? { toolSnapshot } : {}),
          ...(relevance ? { relevance } : {}),
          ...(native.success ? { nativeSources: native.data } : nativeSourcesUnavailable ? { nativeSourcesUnavailable } : {}),
        };
        const usage = { ...old, lastRequest: observation };
        host.store.put("usage", thread.id, thread.id, { id: thread.id, value: usage });
        return { runId: event.runId, usage };
      }
      if (event.type === "usage" || event.type === "compaction.start" || event.type === "compaction.end") {
        const old = host.store.get<{ value: RuntimeUsage }>("usage", thread.id)?.value ?? EMPTY_USAGE;
        let lastRequest = old.lastRequest;
        if (event.type === "compaction.end" && event.aborted === false) {
          host.forgetReadRelevance(thread.id);
          if (lastRequest) {
            const { relevance: _retired, ...retained } = lastRequest;
            lastRequest = retained;
          }
        }
        const next = {
          ...old,
          ...(typeof event.usage === "object" ? event.usage : {}),
          lastRequest,
          inferenceBudget: old.inferenceBudget,
          hostProjection: old.hostProjection,
          compaction: old.compaction,
          ...(event.type === "compaction.start" ? { activity: "compacting" } : event.type === "compaction.end" ? { activity: "idle" } : {}),
        };
        host.store.put("usage", thread.id, thread.id, { id: thread.id, value: next });
        return { runId: event.runId, usage: next };
      }
      if (event.type === "model.observation" && capabilityEnabled("models.requestMetricsV1")) {
        const candidate = event.observation;
        const parsed = modelRequestObservationV1Schema.safeParse(candidate);
        if (parsed.success && parsed.data.owner.threadId === thread.id && parsed.data.owner.runId === event.runId) {
          const id = "modelRequest:" + parsed.data.requestId;
          const old = host.store.get<{ value?: { owner?: { threadId?: string } } }>("modelRequest", id);
          if (old?.value?.owner?.threadId && old.value.owner.threadId !== thread.id) throw new HarnessError("CAPABILITY_DENIED", "Request observation belongs to another thread");
          host.store.put("modelRequest", id, thread.id, { id, value: parsed.data });
          // Bounded per-thread retention: drop the oldest completed records.
          const kept = host.store.all<{ id: string; value: { timings?: { settled?: unknown } } }>("modelRequest", thread.id);
          if (kept.length > MODEL_REQUEST_OBSERVATION_LIMIT)
            for (const stale of kept.slice(0, kept.length - MODEL_REQUEST_OBSERVATION_LIMIT)) host.store.remove("modelRequest", stale.id);
          return { runId: event.runId, modelRequest: parsed.data };
        }
      }
      if (event.type === "settled") {
        host.inferenceOwners.delete(thread.id);
        host.forgetReadRelevance(thread.id);
        host.failUnansweredDetails(event, event.aborted ? "The explanation was stopped. Resume the task to retry." : "The agent finished without updating this option. Try again.");
        const intent = host.store.get<{ kind: string; previousStatus: Thread["status"] }>("runtimeIntent", event.runId);
        const finished = host.store.get<FinishRecord>("finish", event.runId),
          finalized = host.store.get<{ inputIds: string[] }>("responseCheckpoint", event.runId);
        const handled = new Set([...(finished?.inputIds ?? []), ...(finalized?.inputIds ?? [])]);
        for (const input of host.store.all<Outbox>("outbox", thread.id).filter((i) => i.runId === event.runId && i.status !== "handled" && i.enteredRuntime && handled.has(i.id)))
          host.store.put("outbox", input.id, thread.id, { ...input, status: "handled" });
        const unresolved = host.store.all<Outbox>("outbox", thread.id).some((i) => i.runId === event.runId && i.status !== "handled");
        if (intent?.kind !== "compaction") host.planning.endRun(event, event.aborted ? "cancelled" : unresolved ? "interrupted" : "review_required");
        const queuedNext = host.store
          .all<Outbox>("outbox", thread.id)
          .some((input) => input.status === "persisted" && (input.sendMode === "AFTER_CURRENT" || input.sourceFailure || input.sourceRecovery?.resumeRequired));
        host.store.put("thread", thread.id, thread.id, {
          ...thread,
          runId: null,
          status: event.aborted ? "stopped" : unresolved ? "interrupted" : intent?.kind === "compaction" ? host.afterMaintenance(thread.id, intent.previousStatus) : host.hasGate(thread.id) ? "awaiting_input" : finished && !finished.invalidated && !queuedNext ? "completed" : "ready",
          updatedAt: now(),
        });
        const old = host.store.get<{ value: RuntimeUsage }>("usage", thread.id)?.value ?? EMPTY_USAGE;
        host.store.put("usage", thread.id, thread.id, { id: thread.id, value: { ...old, activity: "idle" } });
        advanceLifecycle();
        if (!event.aborted && !unresolved && intent?.kind !== "compaction") host.memoryHostInstance()?.scheduleSettled(event);
      }
      return { runId: event.runId };
    });
  }
}
