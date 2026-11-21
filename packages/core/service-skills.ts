import {
  HarnessError,
  type InputRequest,
  type Operation,
  type RunContext,
  type Snapshot,
  type Thread,
  type ToolCall,
} from "../contracts/index.ts";
import type { CompletedWriteReceipt, WriteHookDiagnostic } from "../contracts/index.ts";
import type { SendModeV1 } from "../contracts/source-selection.ts";
import type { UiPreferences } from "../contracts/preferences.ts";
import type { SkillActor, SkillChangeResult } from "../contracts/skills.ts";
import type { HermesSourceLibrary } from "../runtime-hermes/library.ts";
import type { Store } from "../storage/store.ts";
import type { LearningCoordinator, LearningJob, LearningOutcome, LearningToolResult } from "./learning.ts";
import type { ToolEffectLedger } from "./tool-effects.ts";
import { searchSessions } from "./learning-context.ts";
import { applySkillOperations, listSkills, viewSkill, viewSkillProposal } from "./skills.ts";
import type { WorkbenchQueuedInput } from "./source-workbench.ts";

type Outbox = WorkbenchQueuedInput & {
  messageId?: string;
  completedWrite?: CompletedWriteReceipt;
  hookClaimed?: boolean;
  hookDiagnostic?: WriteHookDiagnostic;
  sendMode?: SendModeV1;
};

const text = (p: Record<string, unknown>, key: string, max = 128 * 1024): string => {
  if (typeof p[key] !== "string" || !(p[key] as string).trim() || Buffer.byteLength(p[key] as string) > max)
    throw new HarnessError("INVALID_INPUT", key + " must be a nonempty string within its size limit");
  return p[key] as string;
};
const now = () => new Date().toISOString();

/** Cross-domain calls a `ServiceSkills` needs back into `Service`. */
export interface ServiceSkillsHost {
  store: Store;
  learning: LearningCoordinator;
  effects: ToolEffectLedger;
  /** Thread → calls-since-last-review counter; shared so curators see one count. */
  learningCalls: Map<string, number>;
  learningSupported(): boolean;
  isClosed(): boolean;
  thread(id: string): Thread;
  hasGate(id: string): boolean;
  preferences(): UiPreferences;
  source(): { library: Pick<HermesSourceLibrary, "view" | "proposal"> } | undefined;
}

/**
 * The skills/learning-tool domain: skill detail + proposal views, the skill tool
 * the agent and the learning review call, and the learning job's
 * tool/result/failure plumbing.
 */
export class ServiceSkills {
  constructor(private readonly host: ServiceSkillsHost) {}

  detail(name: string, options: Parameters<typeof viewSkill>[2] = {}) {
    const { host } = this;
    return host.source() ? host.source()!.library.view(name, options) : viewSkill(host.store, name, options);
  }

  proposal(id: string) {
    const { host } = this;
    return host.source() ? host.source()!.library.proposal(id) : viewSkillProposal(host.store, id);
  }

  actor(kind: SkillActor["kind"], ctx?: RunContext): SkillActor {
    return {
      kind,
      ...(ctx
        ? {
            threadId: ctx.threadId,
            runId: ctx.runId,
            evidence: this.host.store
              .all<Operation>("operation", ctx.threadId)
              .filter((op) => op.status === "succeeded")
              .slice(-8)
              .map((op) => op.id),
          }
        : {}),
    };
  }

  tool(call: ToolCall, actor: SkillActor, readVersions?: Map<string, number>): LearningToolResult {
    const { host } = this;
    const a = call.args,
      allowed =
        call.name === "skills_list"
          ? ["query", "category", "offset", "limit"]
          : call.name === "skill_view"
            ? ["name", "path", "revision", "versionOffset"]
            : ["operations", "commandId"];
    if (Object.keys(a).some((key) => !allowed.includes(key))) throw new HarnessError("INVALID_SKILL", "Unsupported skill tool argument.");
    if (call.name === "skills_list") return { value: listSkills(host.store, a) };
    if (call.name === "skill_view") {
      const name = text(a, "name", 64),
        options = {
          ...(a.path === undefined ? {} : { path: text(a, "path", 1024) }),
          ...(a.revision === undefined ? {} : { revision: a.revision as number }),
          ...(a.versionOffset === undefined ? {} : { versionOffset: a.versionOffset as number }),
          useId: actor.runId,
        };
      let value!: ReturnType<typeof viewSkill>;
      host.store.internal("skill.viewed", actor.threadId ?? null, () => {
        value = viewSkill(host.store, name, options);
        return { name, revision: value.skill.revision };
      });
      if (readVersions) readVersions.set(name + (a.path && a.path !== "SKILL.md" ? "/" + String(a.path) : ""), value.skill.revision);
      return {
        value: {
          skill: value.skill,
          content: value.content,
          files: value.files,
          ...(a.versionOffset === undefined ? {} : { versions: value.versions, nextVersionOffset: value.nextVersionOffset }),
        },
      };
    }
    let committed = 0;
    const apply = () => {
      const result = applySkillOperations(host.store, a.operations, actor, {
        requireApproval: host.preferences().learningApproval,
        readVersions,
      });
      if (result.status === "applied") committed = result.appliedOperations ?? result.changes.length;
      return result;
    };
    const result = (
      a.commandId === undefined
        ? host.store.internal("skill.managed", actor.threadId ?? null, apply)
        : host.store.command({ id: text(a, "commandId", 200), type: "skill_manage", threadId: actor.threadId, payload: a }, apply).result
    ) as SkillChangeResult;
    if (actor.threadId && committed) host.learningCalls.set(actor.threadId, 0);
    return { value: result, appliedChanges: committed };
  }

  private assertLearningSource(job: LearningJob): Thread {
    const { host } = this;
    host.learning.assertCurrent(job);
    const source = host.thread(job.source.threadId);
    if (
      host.isClosed() ||
      source.epoch !== job.source.epoch ||
      source.runId ||
      !["ready", "completed"].includes(source.status) ||
      host.store.all<Thread>("thread").some((thread) => thread.runId) ||
      host.hasGate(source.id) ||
      host.store.all<Operation>("operation", source.id).some((op) => ["prepared", "running", "unknown"].includes(op.status))
    )
      throw new HarnessError("CANCELLED_RUN", "The source task changed during learning.");
    return source;
  }

  learningTool(call: ToolCall, job: LearningJob, reads: Map<string, number>): LearningToolResult {
    const { host } = this;
    host.effects.assertAdmissionsEnabled();
    this.assertLearningSource(job);
    if (!host.preferences().learningEnabled) throw new HarnessError("CANCELLED_RUN", "Automatic learning was disabled.");
    if (call.name === "session_search") return { value: searchSessions(host.store, call.args) };
    try {
      return this.tool(call, this.actor("agent", job.source), reads);
    } catch (error) {
      if (
        error instanceof HarnessError &&
        ["INVALID_SKILL", "STALE_SKILL", "SKILL_READ_REQUIRED", "SKILL_PROTECTED", "SKILL_DISABLED", "NOT_FOUND", "SKILL_FULL"].includes(error.code)
      )
        return { value: { error: { code: error.code, message: error.message } } };
      throw error;
    }
  }

  learningResult(job: LearningJob, outcome: LearningOutcome): void {
    const { host } = this;
    host.store.internal("learning.finished", job.source.threadId, () => {
      const old = host.store.get<Snapshot["learning"]>("learningStatus", "global");
      host.store.put("learningStatus", "global", null, {
        ...old,
        supported: host.learningSupported(),
        status: outcome.cleanupConfirmed === false ? "blocked" : "idle",
        lastReview: {
          sourceThreadId: job.source.threadId,
          sourceRunId: job.source.runId,
          modelId: job.modelId,
          accountId: job.accountId,
          startedAt: old?.lastReview?.startedAt ?? now(),
          finishedAt: now(),
          ...outcome,
        },
      });
    });
  }

  /** Called inside the same transaction as terminal authority changes. */
  failUnansweredDetails(ctx: RunContext, error: string): void {
    const { host } = this;
    for (const request of host.store.all<InputRequest>("request", ctx.threadId).filter((item) => item.status === "pending")) {
      let changed = false;
      const details = request.detailRequests?.map((detail) => {
        const input = host.store.get<Outbox>("outbox", detail.id);
        if (detail.status !== "pending" || input?.runId !== ctx.runId) return detail;
        changed = true;
        return { ...detail, status: "failed" as const, error };
      });
      if (changed) host.store.put("request", request.id, ctx.threadId, { ...request, revision: request.revision + 1, detailRequests: details });
    }
  }
}
