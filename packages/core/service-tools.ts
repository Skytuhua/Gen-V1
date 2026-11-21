import { randomUUID } from "node:crypto";

import {
  HarnessError,
  type ArtifactRecord,
  type DataRecord,
  type HostCommand,
  type InputRequest,
  type Operation,
  type ResourceGrant,
  type RunContext,
  type SurfaceSpec,
  type Thread,
  type ToolCall,
  type UserStateRecord,
  type CompletedWriteReceipt,
  type WriteHookDiagnostic,
} from "../contracts/index.ts";
import type { CheckObservationV1, DeliverableAssessmentV1, VerificationDeclarationV1, VisualObservationV1 } from "../contracts/verification.ts";
import type { ToolEffectRecord } from "../contracts/tool-effects.ts";
import { verificationDeclarationV1Schema } from "../contracts/verification.ts";
import { PlanningQuestionSchema } from "../contracts/planning-question.ts";
import type { DomainContext } from "../capabilities/index.ts";
import { Store, digest } from "../storage/store.ts";
import type { PlanningCoordinator } from "./planning.ts";
import type { ToolAuthority } from "./tool-authority.ts";
import type { ActorRole } from "./tool-authority.ts";
import { ToolEffectLedger, createToolEffectFlags } from "./tool-effects.ts";
import type { createHostRelevanceObserver } from "./context-relevance-host.ts";
import type { createContextResults } from "./context-results.ts";
import { createContextResultLineage } from "./context-result-lineage.ts";
import { contextResultReadArgs } from "./context-result-tool.ts";
import { discoverCapabilities } from "./discovery.ts";
import { inspectTask } from "./task-inspection.ts";
import { changeTaskMemory, taskMemories } from "./task-memory.ts";
import { searchSessions } from "./learning-context.ts";
import { admitSchema, validateJson, widgetDefinition, GENERATED_APPS_ENABLED } from "./widgets.ts";
import { patchSpec, protectedFingerprint } from "./presentation.ts";
import { admitArtifactContents } from "./ui-admission.ts";
import { hostFlagEnabled } from "./host-flags.ts";
import { capabilityEnabled } from "./capability-flags.ts";
import { computeAssessment, observationMatchesThreadOwner } from "./verification-gate.ts";
import { assertVerificationSourceRoot, sourceDigestSync } from "./project-verification.ts";
import { attestVerificationArtifacts } from "./verification-artifacts.ts";
import type { createRepositoryMapReader } from "./repository-map-host.ts";
import type { LearningToolResult } from "./learning.ts";
import type { SkillActor } from "../contracts/skills.ts";
import type { HostToolContext } from "./service.ts";
import type { SendModeV1 } from "../contracts/source-selection.ts";
import type { WorkbenchQueuedInput } from "./source-workbench.ts";

type Outbox = WorkbenchQueuedInput & {
  messageId?: string;
  completedWrite?: CompletedWriteReceipt;
  hookClaimed?: boolean;
  hookDiagnostic?: WriteHookDiagnostic;
  sendMode?: SendModeV1;
};

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HarnessError("INVALID_INPUT", "Expected an object");
  return value as Record<string, unknown>;
};
const text = (p: Record<string, unknown>, key: string, max = 128 * 1024): string => {
  if (typeof p[key] !== "string" || !(p[key] as string).trim() || Buffer.byteLength(p[key] as string) > max) throw new HarnessError("INVALID_INPUT", key + " must be a nonempty string within its size limit");
  return p[key] as string;
};
const now = () => new Date().toISOString();

type RelevanceObserver = ReturnType<typeof createHostRelevanceObserver>;
type RelevanceOwner = Parameters<RelevanceObserver["begin"]>[0];
type RelevanceTicket = ReturnType<RelevanceObserver["begin"]>;
type ContextResultVault = ReturnType<typeof createContextResults>;
type Lease = { id: string; threadId: string; clientId: string; fields: string[]; expiresAt: number };

/** Cross-domain calls a `ServiceTools` needs back into `Service`. */
export interface ServiceToolsHost {
  store: Store;
  effects: ToolEffectLedger;
  effectFlags: ReturnType<typeof createToolEffectFlags>;
  authority: ToolAuthority;
  planning: PlanningCoordinator;
  repositoryMaps: ReturnType<typeof createRepositoryMapReader>;
  relevanceObserver: RelevanceObserver;
  /** Shared counter — the same instance the learning curator reads. */
  learningCalls: Map<string, number>;
  /** Shared controller map — the same instance runtime events read. */
  aborts: Map<string, AbortController>;
  additionalTool: ((call: ToolCall, ctx: RunContext, host: HostToolContext) => Promise<unknown>) | undefined;
  hasHostOperationExecutor(kind: string): boolean;
  source(): boolean;
  assertRun(ctx: RunContext): Thread;
  thread(id: string): Thread;
  hasGate(id: string): boolean;
  request(threadId: string, id: unknown, revision: unknown): InputRequest;
  updateGateStatus(threadId: string): void;
  assertMutation(threadId: string): void;
  dispatchOperation(id: string): Promise<unknown>;
  artifact(threadId: string, id: unknown): ArtifactRecord;
  state(threadId: string, id: unknown): UserStateRecord;
  lease(stateId: string): Lease | null;
  data(threadId: string, id: string, revision?: number): DataRecord;
  publishData(threadId: string, value: unknown, provenance: string): DataRecord;
  contextResultsEnabled(): boolean;
  contextResultInvocation(thread: Thread): string;
  contextResultOwner(thread: Thread): { threadId: string; workspaceId: string; accountId: string | null };
  contextResultVault(): ContextResultVault;
  deliverContextResult(
    value: unknown,
    publicCatalog: boolean,
    thread: Thread,
    assertCurrent: () => void,
    lineage?: ReturnType<typeof createContextResultLineage>,
  ): Promise<unknown>;
  relevanceOwner(thread: Thread): RelevanceOwner | null;
  skillTool(call: ToolCall, actor: SkillActor): LearningToolResult;
  skillActor(kind: SkillActor["kind"], ctx?: RunContext): SkillActor;
  context(threadId: string, signal: AbortSignal | undefined, operationId: string | undefined, authority: RunContext): DomainContext;
}

/**
 * The tools domain: admission (`tool`), the audited/read-boundary wrapper
 * (`admittedTool`), the per-call dispatch (`toolBody`), the UI/artifact
 * transaction surface (`uiTool`) and the M06 completion projection
 * (`completionAssessment`).
 */
export class ServiceTools {
  private activeContextReads = 0;

  constructor(private readonly host: ServiceToolsHost) {}

  async tool(call: ToolCall, ctx: RunContext): Promise<unknown> {
    const { host } = this;
    const owningThread = host.assertRun(ctx);
    host.effects.assertAdmissionsEnabled();
    if (owningThread.kind === "delegate") throw new HarnessError("AGENT_TOOL_DENIED", "Delegated tools must use their parent-owned read-only coordinator.");
    if (owningThread.sideParentId && call.name !== "task_finish") throw new HarnessError("SIDE_CHAT_READ_ONLY", "Side conversations answer in text; files, mutations and delegation are unavailable.");
    const limited = capabilityEnabled("context.compilerV1") && host.authority.definition(call.name)?.risk === "READ";
    if (limited && this.activeContextReads >= 4) throw new HarnessError("CONTEXT_READ_LIMIT", "Wait for an admitted context read to finish before requesting another.");
    if (limited) this.activeContextReads++;
    // A revoked call retains its slot until actual read/retention work settles.
    // Releasing on cancellation alone would allow abandoned reads to accumulate.
    try {
      return await this.admittedTool(call, ctx, owningThread);
    } finally {
      if (limited) this.activeContextReads--;
    }
  }

  private async admittedTool(call: ToolCall, ctx: RunContext, owningThread: Thread): Promise<unknown> {
    const { host } = this;
    const role: ActorRole = owningThread.sideParentId ? "side" : "run";
    const rangeRead = call.name === "context_result_read";
    const bound = host.contextResultsEnabled() && !rangeRead,
      basis = bound ? host.contextResultInvocation(owningThread) : undefined;
    const publicCatalog = call.name === "ui_discover";
    const assertResultCurrent = () => {
      if (!host.contextResultsEnabled() || host.contextResultInvocation(host.assertRun(ctx)) !== basis)
        throw new HarnessError("STALE_REQUEST_CONTEXT", "Tool result owner changed.");
    };
    const definition = host.authority.definition(call.name);
    const readRetryable = definition?.risk === "READ" && definition.replayClass === "READ_RETRYABLE";
    const lineage =
      bound && readRetryable
        ? createContextResultLineage({ store: host.store, threadId: ctx.threadId, signal: host.aborts.get(ctx.threadId)?.signal ?? new AbortController().signal, assertCurrent: assertResultCurrent })
        : undefined;
    let ticket: RelevanceTicket;
    try {
      const definition = host.authority.definition(call.name),
        owner = host.relevanceOwner(owningThread);
      if (owner && definition?.risk === "READ" && definition.replayClass === "READ_RETRYABLE") ticket = host.relevanceObserver.begin(owner);
    } catch {
      /* Observation is optional for an otherwise authorized tool result. */
    }
    let entered = false;
    const execute = () => {
      entered = true;
      return this.toolBody(call, ctx, owningThread, lineage);
    };
    let result = await (host.effectFlags.enabled("audit.effectsV1") || host.effectFlags.enabled("security.authorityV1")
      ? host.effects.invoke({ call, ctx, thread: owningThread, role }, execute)
      : execute());
    // A cached effect skips the domain guard. Its previous bytes cannot mint
    // fresh resource authority, including when the old result was small.
    if (readRetryable && !entered && !publicCatalog)
      result = rangeRead ? { status: "UNAVAILABLE" } : { status: "FULL_RESULT_UNAVAILABLE", handle: null, preview: "", omittedBytes: null, totalBytes: null };
    else if (bound) result = await host.deliverContextResult(result, publicCatalog, owningThread, assertResultCurrent, lineage);
    try {
      const owner = ticket && host.relevanceOwner(host.assertRun(ctx));
      if (owner) host.relevanceObserver.complete(ticket, owner, result);
    } catch {
      /* Never change the delivered result because diagnostics failed. */
    }
    return result;
  }

  private async toolBody(call: ToolCall, ctx: RunContext, owningThread: Thread, lineage?: ReturnType<typeof createContextResultLineage>): Promise<unknown> {
    const { host } = this;
    if (!host.source() && !owningThread.sideParentId && owningThread.mode !== "plan") host.learningCalls.set(ctx.threadId, (host.learningCalls.get(ctx.threadId) ?? 0) + 1);
    const controller = host.aborts.get(ctx.threadId);
    const args = call.args;
    if (["skills_list", "skill_view", "skill_manage"].includes(call.name)) {
      if (host.source()) throw new HarnessError("HERMES_SKILL_TOOL_OWNER", "Original Hermes owns the skill tool schemas and execution.");
      if (call.name === "skill_manage" && owningThread.mode === "plan") throw new HarnessError("PLAN_MODE_READ_ONLY", "Switch to Build before changing shared skills.");
      return host.skillTool(call, host.skillActor("agent", ctx)).value;
    }
    if (call.name === "session_search" || (host.source() && call.name === "harness_session_search")) return searchSessions(host.store, args);
    if (call.name === "task_memory") {
      if (args.action === "list") return { notes: taskMemories(host.store, ctx.threadId), scope: "this thread", authority: "Notes are reminders, not source evidence or approval." };
      if (args.action !== "save" && args.action !== "delete") throw new HarnessError("INVALID_MEMORY", "Choose list, save or delete.");
      const apply = () => {
        host.assertRun(ctx);
        return changeTaskMemory(host.store, ctx.threadId, args.action as "save" | "delete", args, "agent");
      };
      return args.commandId === undefined ? host.store.internal("memory.updated", ctx.threadId, apply) : host.store.command({ id: text(args, "commandId", 200), type: "task_memory", threadId: ctx.threadId, payload: args }, apply).result;
    }
    if (call.name === "plan_update") return host.planning.updatePlan({ ...ctx }, args);
    if (call.name === "integration_list" || call.name === "integration_call" || call.name === "integration_prepare") {
      if (!host.additionalTool) throw new HarnessError("INTEGRATION_UNAVAILABLE", "Managed integrations are unavailable in this host.");
      const selected = { modelId: owningThread.modelId, accountId: owningThread.accountId ?? null, projectId: owningThread.projectId };
      const context = host.context(ctx.threadId, controller?.signal, undefined, { ...ctx });
      const host_ = Object.freeze<HostToolContext>({
        authenticatedApprovals: host.effectFlags.enabled("security.authorityV1"),
        prepareOperation: (kind, args, resourceIds, preconditions, description) => {
          if (!host.hasHostOperationExecutor(kind)) throw new HarnessError("HOST_OPERATION_UNAVAILABLE", "This host operation is unavailable.");
          return context.prepareOperation(kind, args, resourceIds, preconditions, description);
        },
      });
      const result = await host.additionalTool(call, { ...ctx }, host_),
        current = host.assertRun(ctx);
      if (current.modelId !== selected.modelId || (current.accountId ?? null) !== selected.accountId || current.projectId !== selected.projectId)
        throw new HarnessError("CANCELLED_RUN", "The integration scope changed during execution.");
      return result;
    }
    if (call.name === "task_delegate") return host.planning.delegate({ ...ctx }, args, controller?.signal ?? new AbortController().signal);
    if (call.name === "agent_progress") throw new HarnessError("AGENT_TOOL_DENIED", "Agent progress belongs to a delegated session");
    if (call.name === "repository_map")
      return host.repositoryMaps.read({ store: host.store, ctx, signal: controller?.signal ?? new AbortController().signal, owner: () => host.assertRun(ctx) }, args, (value, provenance) => host.publishData(ctx.threadId, value, provenance));
    if (call.name === "context_result_read") {
      if (!host.contextResultsEnabled()) throw new HarnessError("CAPABILITY_UNAVAILABLE", "Context result retrieval is disabled");
      const parsed = contextResultReadArgs.safeParse(args);
      if (!parsed.success) throw new HarnessError("INVALID_INPUT", "Choose a valid context result range");
      const result = await host.contextResultVault().read({ owner: host.contextResultOwner(owningThread), ...parsed.data });
      host.assertRun(ctx);
      if (result.status !== "OK") return result;
      const { bytes, ...summary } = result;
      try {
        return { ...summary, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
      } catch {
        return { ...summary, encoding: "base64", data: Buffer.from(bytes).toString("base64") };
      }
    }
    if (call.name === "ui_discover") return discoverCapabilities(args);
    if (call.name === "ui_inspect") return inspectTask(host.store, host.thread(ctx.threadId), host.planning.inspect(ctx.threadId), args);
    if (call.name.startsWith("ui_") || call.name === "task_finish" || call.name === "verification_declare") return this.uiTool(call, ctx);
    if (call.name === "operation_execute") {
      host.assertMutation(ctx.threadId);
      const op = host.store.get<Operation>("operation", text(args, "operationId", 200));
      if (!op || op.threadId !== ctx.threadId || !op.approved) throw new HarnessError("APPROVAL_REQUIRED", "The user must approve the exact prepared operation");
      return host.dispatchOperation(op.id);
    }
    const domain = await import("../capabilities/index.ts");
    host.assertRun(ctx);
    const context = host.context(ctx.threadId, controller?.signal, undefined, { ...ctx });
    return domain.handleDomainTool(call.name, args, lineage ? lineage.wrap(context) : context);
  }

  private async uiTool(call: ToolCall, ctx: RunContext): Promise<unknown> {
    const { host } = this;
    if (call.name === "ui_create_widget" && !GENERATED_APPS_ENABLED) throw new HarnessError("CAPABILITY_UNAVAILABLE", "Generated apps are disabled until execution isolation passes its integrity gates");
    const a = call.args;
    if (Buffer.byteLength(JSON.stringify(a)) > 128 * 1024) throw new HarnessError("INVALID_SPEC", "UI transaction exceeds 128 KiB");
    const command: HostCommand | null = a.commandId === undefined ? null : { id: text(a, "commandId", 200), type: call.name, threadId: ctx.threadId, payload: a };
    const duplicate = command ? host.store.receipt(command) : null;
    if (duplicate) return duplicate.result;
    let spec: SurfaceSpec | null = null;
    if (call.name === "ui_present") {
      if ((a.spec === undefined) === (a.patches === undefined)) throw new HarnessError("INVALID_SPEC", "Provide exactly one of spec or patches");
      spec = a.patches !== undefined ? patchSpec(host.artifact(ctx.threadId, a.artifactId).spec!, a.patches) : (object(a.spec) as unknown as SurfaceSpec);
      const catalog = await import("../ui-catalog/index.ts");
      try {
        catalog.validateSurface(spec);
      } catch (error) {
        if (error instanceof HarnessError && error.code === "INVALID_SURFACE") throw new HarnessError("INVALID_SPEC", error.message, error.details);
        throw error;
      }
    }
    const widget = call.name === "ui_create_widget" ? widgetDefinition(a) : null;
    host.assertRun(ctx);
    const apply = () => {
      host.assertRun(ctx);
      if (["ui_present", "ui_create_widget"].includes(call.name)) {
        const existing = a.artifactId ? host.artifact(ctx.threadId, a.artifactId) : null;
        if (existing && a.baseRevision !== existing.revision) throw new HarnessError("STALE_REVISION", "Artifact revision changed", { currentRevision: existing.revision });
        if (existing?.widget && widget && existing.widget.stateSchemaVersion !== widget.stateSchemaVersion)
          throw new HarnessError("USER_EDIT_CONFLICT", "State schema upgrades require a new artifact or an explicit state migration; the previous checkpoint is retained");
        const lease = existing ? host.lease(existing.stateId) : null;
        if (existing && ((lease && (widget || protectedFingerprint(existing.spec, lease.fields) !== protectedFingerprint(spec, lease.fields))) || (existing.pinned && existing.placement !== (a.placement ?? existing.placement))))
          throw new HarnessError("USER_EDIT_CONFLICT", "The user is editing or has pinned this artifact");
        const { presentation, bindings, actions } = admitArtifactContents(host.store, ctx.threadId, a, spec, existing);
        const artifactId = existing?.id ?? randomUUID(),
          stateId = existing?.stateId ?? randomUUID();
        if (!existing) host.store.put("userState", stateId, ctx.threadId, { id: stateId, threadId: ctx.threadId, revision: 0, schemaVersion: 1, values: a.initialState ? object(a.initialState) : {} });
        if (widget) validateJson(widget.stateSchema, host.state(ctx.threadId, stateId).values);
        const messageId = existing?.messageId ?? randomUUID();
        if (!existing) host.store.put("message", messageId, ctx.threadId, { id: messageId, threadId: ctx.threadId, role: "assistant", content: "", runId: ctx.runId, createdAt: now() });
        const record: ArtifactRecord = {
          id: artifactId,
          threadId: ctx.threadId,
          messageId,
          title: typeof a.title === "string" ? a.title.slice(0, 140) : existing?.title ?? "Task interface",
          purpose: typeof a.purpose === "string" ? a.purpose : existing?.purpose ?? "",
          revision: (existing?.revision ?? 0) + 1,
          kind: widget ? "widget" : "structured",
          spec,
          widget,
          bindings,
          actions,
          stateId,
          lifecycle: "active",
          placement: existing?.placement ?? "inline",
          pinned: existing?.pinned ?? false,
          presentation,
          catalogVersion: "1",
          createdAt: existing?.createdAt ?? now(),
          updatedAt: now(),
        };
        host.store.put("artifact", artifactId, ctx.threadId, record);
        host.store.put("artifactVersion", artifactId + "@" + record.revision, ctx.threadId, record);
        return { artifactId, surfaceId: artifactId, revision: record.revision, presentationRevision: record.revision, stateId };
      }
      if (call.name === "ui_request_input") {
        if (a.artifactId) host.artifact(ctx.threadId, a.artifactId);
        const schema = object(a.responseSchema);
        admitSchema(schema);
        const existing = a.requestId ? host.request(ctx.threadId, a.requestId, a.baseRevision) : null;
        if (existing && digest(schema) !== digest(existing.responseSchema)) throw new HarnessError("USER_EDIT_CONFLICT", "Keep the decision response schema while explaining its options");
        const presentation = a.presentation === undefined ? existing?.presentation : PlanningQuestionSchema.parse(a.presentation);
        if (presentation) {
          if (schema.type !== "string") throw new HarnessError("INVALID_INPUT", "Option questions require a string response schema");
          for (const option of presentation.options) validateJson(schema, option.id);
          if (presentation.allowCustom && (schema.enum !== undefined || schema.const !== undefined)) throw new HarnessError("INVALID_INPUT", "Custom options require an open string response schema");
          for (const option of presentation.options)
            for (const example of option.examples ?? [])
              if (example.resourceId) {
                const grant = host.store.get<ResourceGrant>("resource", example.resourceId);
                if (!grant || grant.threadId !== ctx.threadId) throw new HarnessError("CAPABILITY_DENIED", "Example image is not granted to this thread");
              }
          if (existing?.presentation && !existing.presentation.options.every((option) => presentation.options.some((next) => next.id === option.id)))
            throw new HarnessError("USER_EDIT_CONFLICT", "Preserve existing options while a user is deciding");
        }
        const basis = Array.isArray(a.basis) ? (a.basis as InputRequest["basis"]) : existing?.basis ?? [];
        for (const ref of basis) host.data(ctx.threadId, ref.id, ref.revision);
        const request: InputRequest = {
          id: existing?.id ?? randomUUID(),
          threadId: ctx.threadId,
          artifactId: typeof a.artifactId === "string" ? a.artifactId : existing?.artifactId ?? null,
          revision: (existing?.revision ?? 0) + 1,
          title: text(a, "title", 200),
          prompt: text(a, "prompt", 6000),
          responseSchema: schema,
          basis,
          status: "pending",
          ...(presentation ? { presentation } : {}),
          ...(existing?.detailRequests
            ? {
                detailRequests: existing.detailRequests.map((detail) => {
                  const option = presentation?.options.find((item) => item.id === detail.optionId),
                    resolved =
                      detail.kind === "more-options"
                        ? (presentation?.options.length ?? 0) > (existing.presentation?.options.length ?? 0)
                        : detail.kind === "examples"
                          ? Boolean(option?.examples?.length)
                          : Boolean(option?.explanation?.trim());
                  return { ...detail, status: resolved ? ("resolved" as const) : detail.status };
                }),
              }
            : {}),
        };
        host.store.put("request", request.id, ctx.threadId, request);
        host.updateGateStatus(ctx.threadId);
        return { requestId: request.id, status: "pending", revision: request.revision };
      }
      if (call.name === "ui_arrange" || call.name === "ui_close") {
        const artifact = host.artifact(ctx.threadId, a.artifactId);
        if (a.baseRevision !== artifact.revision) throw new HarnessError("STALE_REVISION", "Artifact revision changed");
        if (artifact.pinned || host.lease(artifact.stateId)) throw new HarnessError("USER_EDIT_CONFLICT", "User ownership prevents this change");
        const next = { ...artifact, placement: a.placement === "expanded" ? "expanded" : "inline", lifecycle: call.name === "ui_close" ? "archived" : artifact.lifecycle } as ArtifactRecord;
        host.store.put("artifact", artifact.id, ctx.threadId, next);
        return { artifactId: artifact.id, revision: artifact.revision };
      }
      if (call.name === "verification_declare") {
        if (!hostFlagEnabled("verification.workflowV1")) throw new HarnessError("CAPABILITY_DENIED", "The verification workflow capability is disabled on this host.");
        // commandId is host plumbing for receipt dedup, not declaration data.
        const { commandId: _commandId, ...declarationArgs } = a;
        const declaration = verificationDeclarationV1Schema.parse({ version: 1, ...declarationArgs });
        assertVerificationSourceRoot(host.store, ctx.threadId, declaration.rootPath);
        host.store.put("verificationDeclaration", ctx.threadId, ctx.threadId, declaration);
        return { requirements: declaration.requirements.length };
      }
      if (call.name === "task_finish") {
        if (host.hasGate(ctx.threadId) || host.store.all<Operation>("operation", ctx.threadId).some((o) => ["running", "unknown", "prepared"].includes(o.status)))
          throw new HarnessError("REQUEST_GATED", "Resolve decisions and outstanding operations before completion");
        const current = host.store
          .all<Outbox>("outbox", ctx.threadId)
          .filter((i) => i.status !== "handled" && !(i.status === "persisted" && (i.sendMode === "AFTER_CURRENT" || i.sourceFailure || i.sourceRecovery?.resumeRequired) && i.runId === null));
        const pending = current.filter((i) => i.runId !== ctx.runId || !i.enteredRuntime);
        if (pending.length) throw new HarnessError("REQUEST_GATED", "There is unfinished input");
        host.store.put("finish", ctx.runId, ctx.threadId, { outcome: a.outcome ?? a.summary, evidence: a.evidence ?? [], assessment: true, inputIds: current.map((i) => i.id) });
        if (hostFlagEnabled("verification.workflowV1")) {
          const assessment = this.completionAssessment(ctx, call);
          if (assessment) host.store.put("assessment", assessment.assessmentId, ctx.threadId, assessment);
        }
        return { accepted: true, settlesAfterRuntime: true };
      }
      throw new HarnessError("UNKNOWN_CAPABILITY", "Unknown UI tool");
    };
    return command ? host.store.command(command, apply).result : host.store.internal(call.name, ctx.threadId, apply);
  }

  /** M06 additive completion projection. Runs synchronously inside the
   * task_finish store transaction — no awaits. Verified only when every
   * declared requirement carries a fresh PASS observation against the current
   * source/environment digests and no external effect is unresolved. */
  private completionAssessment(ctx: RunContext, call: ToolCall): DeliverableAssessmentV1 | null {
    const { host } = this;
    const thread = host.assertRun(ctx);
    const declaration = host.store.get<VerificationDeclarationV1>("verificationDeclaration", ctx.threadId);
    const observations: (CheckObservationV1 | VisualObservationV1)[] = [
      ...host.store.all<CheckObservationV1>("checkObservation", ctx.threadId),
      ...host.store.all<VisualObservationV1>("visualObservation", ctx.threadId),
    ].filter((observation) => observationMatchesThreadOwner(observation, thread));
    if (!declaration && !observations.length) return null;
    // When effect auditing wraps task_finish, the ledger admits this very call
    // as DISPATCHED and settles it only after the body returns. That record is
    // the invocation itself, not an outstanding external effect — exclude it by
    // its argument commitment so audited completion does not block on itself.
    const selfCommitment = host.effects.privateArgumentCommitment(call);
    const unresolvedEffects = host.store
      .all<ToolEffectRecord>("toolEffect", ctx.threadId)
      .filter((effect) => !["SUCCEEDED", "FAILED", "CANCELLED", "DENIED"].includes(effect.state) || effect.state === "UNKNOWN_EXTERNAL_OUTCOME")
      .filter((effect) => !(effect.toolId === "task_finish" && effect.privateArgumentCommitment === selfCommitment))
      .map((effect) => effect.invocationId);
    const empty = "0".repeat(64);
    let sourceAvailable = false;
    let sourceCut: { headSha: string | null; codeDigest: string; dependencyDigest: string; environmentId: string };
    if (declaration) {
      sourceCut = { headSha: null, codeDigest: empty, dependencyDigest: empty, environmentId: declaration.environmentId };
      try {
        assertVerificationSourceRoot(host.store, ctx.threadId, declaration.rootPath);
        sourceCut = {
          headSha: null,
          codeDigest: sourceDigestSync(declaration.rootPath, declaration.sourceFiles),
          dependencyDigest: sourceDigestSync(declaration.rootPath, declaration.dependencyFiles),
          environmentId: declaration.environmentId,
        };
        sourceAvailable = true;
      } catch {
        /* Unavailable or revoked sources cannot establish verification. */
      }
    } else {
      const last = observations.at(-1)!;
      sourceCut = { headSha: null, codeDigest: last.codeDigest, dependencyDigest: last.dependencyDigest, environmentId: last.environmentId };
    }
    const assessment = computeAssessment({
      threadId: ctx.threadId,
      sourceCut,
      requirements: declaration?.requirements ?? [],
      observations,
      artifactAttestations: attestVerificationArtifacts(host.store, observations, declaration?.requirements ?? []),
      unresolvedEffects,
      verifierIdentity: "service/" + ctx.runId,
      provenance: "task_finish completion projection",
    });
    if (!sourceAvailable) {
      for (const requirement of assessment.requirements) {
        if (requirement.assessment === "VERIFIED") requirement.assessment = "UNVERIFIED";
        requirement.missing = [...requirement.missing, "current authorized source inputs are unavailable"].slice(0, 64);
      }
      if (assessment.label === "VERIFIED") assessment.label = "COMPLETED_UNVERIFIED";
    }
    return assessment;
  }
}
