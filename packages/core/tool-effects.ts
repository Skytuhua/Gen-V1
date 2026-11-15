import { randomUUID } from "node:crypto";
import { HarnessError, type Operation, type Thread, type ToolCall } from "../contracts/index.ts";
import {
  toolEffectSchema,
  type ActorRole,
  type ApprovalV1,
  type EffectState,
  type EffectTransition,
  type ToolEffectRecord,
  type ToolOwner,
} from "../contracts/tool-effects.ts";
import { authorize, type RegistryEntry, type ToolAuthority } from "./tool-authority.ts";
import { capabilityEnabled } from "./capability-flags.ts";
import { digest, type Store } from "../storage/store.ts";

const now = () => new Date().toISOString();
export const APPROVAL_TTL_MS = 15 * 60_000;
const CONTROL_KEYS = new Set(["commandId", "invocationId"]);
const SECRET_KEY = /secret|token|password|credential|api[_-]?key/i;
const TRANSITION_CAP = 200;

/** Test-only seam: throws injected faults at durability boundaries
 * (admission/dispatch/settlement commits) for crash-matrix tests. */
let faultHook: ((at: string) => void) | null = null;
export function __setEffectFaultHookForTests(hook: ((at: string) => void) | null): void { faultHook = hook; }
const fault = (at: string) => { faultHook?.(at); };

export function ownerFor(thread: Thread, ctx?: { threadId: string; runId?: string | null; epoch?: number | null } | null): ToolOwner {
  return {
    threadId: thread.id,
    runId: ctx?.runId ?? thread.runId ?? null,
    epoch: ctx?.epoch ?? thread.epoch,
    projectId: thread.projectId ?? null,
    workspaceId: thread.workspaceId ?? null,
    accountBinding: thread.accountId ?? null,
  };
}

const stripControl = (args: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(args).filter(([key]) => !CONTROL_KEYS.has(key)));

export function privateArgumentCommitment(call: ToolCall): string {
  return digest({ name: call.name, args: stripControl(call.args) });
}

/** UI-safe summary: redacts secret-looking argument values by digest+length
 * only; secret material never enters this string (SecretRef-style identity). */
const redactValue = (key: string, value: unknown): unknown => {
  if (SECRET_KEY.test(key)) return "<redacted>";
  if (Array.isArray(value)) return value.map(item => redactValue("", item));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redactValue(childKey, child)]));
  const text = JSON.stringify(value);
  return typeof text === "string" && text.length > 200 ? "<digest:" + digest(value).slice(0, 12) + ">" : value;
};
export function publicRedactedSummary(call: ToolCall): string {
  const args = Object.fromEntries(Object.entries(stripControl(call.args)).map(([key, value]) => [key, redactValue(key, value)]));
  const summary = call.name + " " + JSON.stringify(args);
  return summary.length > 600 ? summary.slice(0, 600) + "…" : summary;
}

/** Binds args, executable identity (kind+digest), target revision and the
 * thread's account/project/workspace/epoch into one approval commitment. */
export function actionCommitment(operation: Operation, thread: Thread): string {
  return digest({
    operationId: operation.id,
    revision: operation.revision,
    kind: operation.kind,
    args: operation.args,
    schemaDigest: digest({ kind: operation.kind, args: operation.args }),
    resourceIds: operation.resourceIds,
    preconditions: operation.preconditions,
    accountId: thread.accountId ?? null,
    projectId: thread.projectId ?? null,
    workspaceId: thread.workspaceId ?? null,
    epoch: thread.epoch,
  });
}

const settled = (state: EffectState): boolean => ["SUCCEEDED", "FAILED", "CANCELLED", "DENIED"].includes(state);

export class ToolEffectLedger {
  constructor(private readonly store: Store, private readonly authority: ToolAuthority) {}

  get(invocationId: string): ToolEffectRecord | null {
    return this.store.get<ToolEffectRecord>("toolEffect", invocationId);
  }

  private applyTransition(effect: ToolEffectRecord, to: EffectState, note?: string): ToolEffectRecord {
    const transition: EffectTransition = { from: effect.state, to, at: now(), ...(note ? { note } : {}) };
    const next: ToolEffectRecord = { ...effect, state: to, updatedAt: transition.at, transitions: [...effect.transitions, transition].slice(-TRANSITION_CAP) };
    this.store.put("toolEffect", effect.invocationId, effect.threadId, next);
    return next;
  }

  private transition(invocationId: string, type: string, update: (effect: ToolEffectRecord) => ToolEffectRecord | void): ToolEffectRecord {
    const existing = this.get(invocationId);
    if (!existing) throw new HarnessError("NOT_FOUND", "Tool effect unavailable");
    let record!: ToolEffectRecord;
    this.store.internal(type, existing.threadId, () => {
      record = update(this.get(invocationId)!) ?? existing;
      return { effectId: record.effectId, invocationId, state: record.state, threadId: record.threadId };
    });
    return record;
  }

  /** One synchronous transaction: dedupe invocation IDs, consume the single-use
   * approval when present, then persist the DISPATCHED state — all before any
   * executor call. */
  admit(input: {
    call: ToolCall;
    owner: ToolOwner;
    definition: RegistryEntry;
    approvalId?: string | null;
    parentInvocationId?: string | null;
    targetPreconditions?: string[];
    extraPut?: () => void;
  }): ToolEffectRecord {
    const { call, owner, definition } = input;
    const invocationId = String(call.args.commandId ?? call.args.invocationId ?? randomUUID());
    const commitment = privateArgumentCommitment(call);
    let effect!: ToolEffectRecord;
    this.store.internal("toolEffect.admitted", owner.threadId, () => {
      fault("admission");
      const prior = this.get(invocationId);
      if (prior) {
        if (prior.owner.threadId === owner.threadId && prior.owner.runId === owner.runId && prior.owner.epoch === owner.epoch && prior.privateArgumentCommitment === commitment) {
          effect = prior;
          return { effectId: prior.effectId, invocationId, state: prior.state, reused: true };
        }
        throw new HarnessError("INVOCATION_CONFLICT", "This invocation ID was already used with different arguments or owner");
      }
      if (input.approvalId) this.consumeApproval(input.approvalId, owner);
      const created = toolEffectSchema.parse({
        effectId: "eff_" + invocationId.slice(0, 48),
        invocationId,
        attemptId: 1,
        parentInvocationId: input.parentInvocationId ?? null,
        owner,
        toolId: definition.id,
        definitionDigest: definition.schemaDigest,
        privateArgumentCommitment: commitment,
        publicRedactedSummary: publicRedactedSummary(call),
        targetPreconditions: input.targetPreconditions ?? [],
        approvalId: input.approvalId ?? null,
        state: "PREPARED" satisfies EffectState,
        providerReceiptRef: null,
        createdAt: now(),
        updatedAt: now(),
      });
      const prepared: ToolEffectRecord = { ...created, threadId: owner.threadId, transitions: [{ from: null, to: "PREPARED", at: created.createdAt }] };
      this.store.put("toolEffect", invocationId, owner.threadId, prepared);
      fault("dispatch");
      effect = this.applyTransition(prepared, "DISPATCHED");
      input.extraPut?.();
      return { effectId: effect.effectId, invocationId, state: effect.state };
    });
    return effect;
  }

  private consumeApproval(approvalId: string, owner: ToolOwner): void {
    const approval = this.store.get<ApprovalV1>("approval", approvalId);
    if (!approval || approval.owner.threadId !== owner.threadId) throw new HarnessError("APPROVAL_REQUIRED", "Approval is unavailable for this owner");
    if (approval.remainingUses < 1 || approval.expiresAt <= now()) throw new HarnessError("APPROVAL_REQUIRED", "Approval has expired or is already consumed");
    this.store.put("approval", approvalId, approval.owner.threadId, { ...approval, remainingUses: 0 });
  }

  settle(invocationId: string, outcome: { value?: unknown; error?: string }, state: "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN_EXTERNAL_OUTCOME", providerReceiptRef?: string | null): ToolEffectRecord {
    fault("settlement");
    return this.transition(invocationId, "toolEffect.settled", current =>
      current.state !== "DISPATCHED" && current.state !== "PREPARED"
        ? current
        : this.applyTransition({ ...current, outcome, providerReceiptRef: providerReceiptRef ?? current.providerReceiptRef }, state));
  }

  deny(invocationId: string, reason: string): ToolEffectRecord {
    return this.transition(invocationId, "toolEffect.denied", current => this.applyTransition(current, "DENIED", reason));
  }

  issueApproval(operation: Operation, thread: Thread): ApprovalV1 {
    const issuedAt = now();
    return {
      approvalId: randomUUID(),
      operationId: operation.id,
      actionCommitment: actionCommitment(operation, thread),
      owner: ownerFor(thread),
      targetPreconditions: Object.entries(operation.preconditions).map(([key, value]) => key + "=" + value),
      issuedAt,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
      remainingUses: 1,
      issuer: "authenticated_user",
    };
  }

  /** Admission for a prepared Operation: consume its single-use approval and
   * persist DISPATCHED in the same synchronous transaction that marks the
   * operation running. Any post-approval drift (args/cwd/account/workspace/
   * schema/grant/epoch) changes the commitment and denies before dispatch. */
  admitOperationDispatch(operation: Operation, thread: Thread, markRunning: () => void): ToolEffectRecord | null {
    const invocationId = "operation:" + operation.id + "@" + operation.revision;
    const prior = this.get(invocationId);
    if (prior && settled(prior.state)) return prior;
    if (prior) throw new HarnessError("INVOCATION_IN_FLIGHT", "This operation dispatch is already in flight");
    const call: ToolCall = { name: "operation:" + operation.kind, args: { invocationId, operationId: operation.id, ...operation.args } };
    const approvalId = capabilityEnabled("security.authorityV1") ? (this.approvalFor(operation.id)?.approvalId ?? null) : null;
    return this.admit({
      call,
      owner: ownerFor(thread),
      definition: {
        id: "operation:" + operation.kind,
        version: 1,
        schemaDigest: digest({ kind: operation.kind, args: operation.args }),
        risk: "HOST_EXECUTE",
        replayClass: "NONREPLAYABLE",
        allowedRoles: ["run", "user"],
        executorBinding: "domain",
        approval: "operation",
      },
      approvalId,
      targetPreconditions: Object.entries(operation.preconditions).map(([key, value]) => key + "=" + value),
      extraPut: markRunning,
    });
  }

  approvalFor(operationId: string): ApprovalV1 | undefined {
    // A stopped operation can be approved again: honor the latest grant, not the first.
    let latest: ApprovalV1 | undefined;
    for (const approval of this.store.all<ApprovalV1>("approval"))
      if (approval.operationId === operationId && (!latest || approval.issuedAt >= latest.issuedAt)) latest = approval;
    return latest;
  }

  /** Consume a recorded approval for dispatch; verifies the commitment still
   * matches the current operation and thread before the single use is spent. */
  verifyOperationApproval(operation: Operation, thread: Thread): void {
    if (!capabilityEnabled("security.authorityV1")) return;
    const approval = this.approvalFor(operation.id);
    if (!approval) throw new HarnessError("APPROVAL_REQUIRED", "Approve this prepared operation first");
    if (approval.actionCommitment !== actionCommitment(operation, thread)) throw new HarnessError("APPROVAL_REQUIRED", "The approved action changed; approve the current intent again");
    if (approval.owner.accountBinding !== (thread.accountId ?? null) || approval.owner.projectId !== (thread.projectId ?? null) || approval.owner.workspaceId !== (thread.workspaceId ?? null) || approval.owner.epoch !== thread.epoch)
      throw new HarnessError("APPROVAL_REQUIRED", "The approved owner changed; approve the current intent again");
  }

  /** Gate + admit + dispatch + settle one host tool call. ctx may omit runId/
   * epoch to bind the invocation to the thread's current owner (e.g. learning
   * jobs that outlive the run they review). */
  async invoke(input: { call: ToolCall; ctx: { threadId: string; runId?: string | null; epoch?: number | null }; thread: Thread; role: ActorRole }, executor: () => Promise<unknown>): Promise<unknown> {
    const { call, ctx, thread, role } = input;
    const definition = this.authority.require(call.name);
    const owner = ownerFor(thread, ctx);
    const decision = authorize(definition, role, owner, {
      epoch: thread.epoch,
      runId: thread.runId,
      accountId: thread.accountId ?? null,
      projectId: thread.projectId ?? null,
      workspaceId: thread.workspaceId ?? null,
    });
    const invocationId = String(call.args.commandId ?? call.args.invocationId ?? "");
    const prior = invocationId ? this.get(invocationId) : undefined;
    if (prior) {
      if (prior.owner.threadId === owner.threadId && prior.owner.runId === owner.runId && prior.owner.epoch === owner.epoch && prior.privateArgumentCommitment === privateArgumentCommitment(call)) {
        if (prior.state === "SUCCEEDED") return prior.outcome?.value;
        if (prior.state === "FAILED" || prior.state === "DENIED" || prior.state === "CANCELLED")
          throw new HarnessError("EFFECT_" + prior.state, prior.outcome?.error ?? "This invocation already settled: " + prior.state);
        if (prior.state === "UNKNOWN_EXTERNAL_OUTCOME")
          throw new HarnessError("OPERATION_OUTCOME_UNKNOWN", "The previous identical invocation settled as uncertain; inspect it before retrying");
        throw new HarnessError("INVOCATION_IN_FLIGHT", "An identical invocation is already dispatched");
      }
      throw new HarnessError("INVOCATION_CONFLICT", "This invocation ID was already used with different arguments or owner");
    }
    if (decision.kind === "DENY") {
      const effect = this.recordTerminal(call, owner, definition, "DENIED", decision.reason);
      throw new HarnessError("AUTHORITY_DENIED", "Tool call denied by authority: " + decision.reason, { effectId: effect.effectId });
    }
    if (decision.kind === "REQUIRE_APPROVAL") {
      const effect = this.recordTerminal(call, owner, definition, "PREPARED", decision.reason);
      throw new HarnessError("APPROVAL_REQUIRED", "This effect requires explicit user approval before dispatch", { effectId: effect.effectId });
    }
    const effect = this.admit({ call, owner, definition });
    if (effect.state !== "DISPATCHED") {
      // Coalesced duplicate admitted in a racing call.
      return this.settledOutcome(effect);
    }
    try {
      fault("effect");
      const value = await executor();
      this.settle(effect.invocationId, { value }, "SUCCEEDED");
      return value;
    } catch (error) {
      const unknown = error instanceof HarnessError && error.code === "OPERATION_OUTCOME_UNKNOWN";
      this.settle(effect.invocationId, { error: error instanceof Error ? error.message : String(error) }, unknown ? "UNKNOWN_EXTERNAL_OUTCOME" : "FAILED");
      throw error;
    }
  }

  private settledOutcome(effect: ToolEffectRecord): unknown {
    if (effect.state === "SUCCEEDED") return effect.outcome?.value;
    if (effect.state === "DISPATCHED" || effect.state === "PREPARED") throw new HarnessError("INVOCATION_IN_FLIGHT", "An identical invocation is already dispatched");
    throw new HarnessError("EFFECT_" + effect.state, effect.outcome?.error ?? "This invocation already settled: " + effect.state);
  }

  private recordTerminal(call: ToolCall, owner: ToolOwner, definition: RegistryEntry, state: EffectState, note: string): ToolEffectRecord {
    const invocationId = String(call.args.commandId ?? call.args.invocationId ?? randomUUID());
    let effect!: ToolEffectRecord;
    this.store.internal("toolEffect." + state.toLowerCase(), owner.threadId, () => {
      const at = now();
      const created = toolEffectSchema.parse({
        effectId: "eff_" + invocationId.slice(0, 48),
        invocationId,
        attemptId: 1,
        parentInvocationId: null,
        owner,
        toolId: definition.id,
        definitionDigest: definition.schemaDigest,
        privateArgumentCommitment: privateArgumentCommitment(call),
        publicRedactedSummary: publicRedactedSummary(call),
        targetPreconditions: [],
        approvalId: null,
        state: "PREPARED" satisfies EffectState,
        providerReceiptRef: null,
        createdAt: at,
        updatedAt: at,
      });
      const prepared: ToolEffectRecord = { ...created, threadId: owner.threadId, transitions: [{ from: null, to: "PREPARED", at }] };
      this.store.put("toolEffect", invocationId, owner.threadId, prepared);
      effect = state === "PREPARED" ? prepared : this.applyTransition(prepared, state, note);
      return { effectId: effect.effectId, invocationId, state: effect.state };
    });
    return effect;
  }
}
