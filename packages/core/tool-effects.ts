import { randomUUID } from "node:crypto";
import { HarnessError, type Operation, type Thread, type ToolCall } from "../contracts/index.ts";
import {
  toolEffectSchema,
  authenticatedApprovalSchema,
  type ActorRole,
  type ApprovalV1,
  type EffectState,
  type EffectTransition,
  type ToolEffectRecord,
  type ToolOwner,
} from "../contracts/tool-effects.ts";
import { authorize, type RegistryEntry, type ToolAuthority } from "./tool-authority.ts";
import { createCapabilityFlags, type CapabilityFlags } from "./capability-flags.ts";
import { digest, type Store } from "../storage/store.ts";
import type { EffectAuthenticator } from "./host-effect-authenticator.ts";
import { EffectAdmissionPolicy } from "./effect-admission-policy.ts";

const now = () => new Date().toISOString();
export const APPROVAL_TTL_MS = 15 * 60_000;
export const toolDefinitionCommitment = (definition: RegistryEntry): string => digest(definition);

const CONTROL_KEYS = new Set(["commandId", "invocationId"]);
const SECRET_KEY = /secret|token|password|credential|api[_-]?key|authorization|cookie/i;
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

/** A cached outcome is private to the complete original owner and schema. */
function matchesInvocation(prior: ToolEffectRecord, owner: ToolOwner, definition: RegistryEntry, commitment: string): boolean {
  return prior.owner.threadId === owner.threadId && prior.owner.runId === owner.runId && prior.owner.epoch === owner.epoch
    && prior.owner.accountBinding === owner.accountBinding && prior.owner.projectId === owner.projectId && prior.owner.workspaceId === owner.workspaceId
    && prior.toolId === definition.id && prior.definitionDigest === definition.schemaDigest && prior.privateArgumentCommitment === commitment;
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
function actionPayload(operation: Operation, thread: Thread) {
  return {
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
  };
}
export function actionCommitment(operation: Operation, thread: Thread): string { return digest(actionPayload(operation, thread)); }

const settled = (state: EffectState): boolean => ["SUCCEEDED", "FAILED", "CANCELLED", "DENIED"].includes(state);

export type ToolEffectFlag = 'audit.effectsV1' | 'security.authorityV1';

export function createToolEffectFlags(overrides?: Partial<Record<ToolEffectFlag, boolean>>): CapabilityFlags<ToolEffectFlag> {
  return createCapabilityFlags<ToolEffectFlag>([
    { key: 'audit.effectsV1', owner: 'host', description: 'Record tool execution evidence' },
    { key: 'security.authorityV1', owner: 'host', description: 'Require bound tool approvals' },
  ], overrides);
}

export class ToolEffectLedger {
  private readonly admissionPolicy: EffectAdmissionPolicy;
  constructor(private readonly store: Store, private readonly authority: ToolAuthority, private readonly flags = createToolEffectFlags(), private readonly authenticator?: EffectAuthenticator) {
    this.admissionPolicy = new EffectAdmissionPolicy(store, flags);
  }
  admissionsDisabled(): boolean { return this.admissionPolicy.disabled; }
  assertAdmissionsEnabled(): void { this.admissionPolicy.assertEnabled(); }

  private authenticated(): boolean { return this.flags.enabled("audit.effectsV1") || this.flags.enabled("security.authorityV1"); }
  private signer(): EffectAuthenticator {
    if (!this.authenticator) throw new HarnessError("EFFECT_KEY_UNAVAILABLE", "Protected effect authority is unavailable.");
    return this.authenticator;
  }
  privateArgumentCommitment(call: ToolCall): string {
    return this.authenticated() ? this.signer().commit("arguments", { name: call.name, args: stripControl(call.args) }) : privateArgumentCommitment(call);
  }
  private actionCommitment(operation: Operation, thread: Thread): string {
    return this.authenticated() ? this.signer().commit("action", actionPayload(operation, thread)) : actionCommitment(operation, thread);
  }
  private stampApproval(approval: ApprovalV1): ApprovalV1 {
    const signer = this.signer(), { hostAuthenticator: _previous, ...fields } = approval;
    return { ...fields, hostAuthenticator: { version: 1, keyId: signer.keyId, tag: signer.commit("grant", fields) } };
  }
  private verifyAuthenticatedApproval(approval: ApprovalV1, owner: ToolOwner, operation: Operation, thread: Thread): void {
    const signer = this.signer(), parsed = authenticatedApprovalSchema.safeParse(approval);
    if (!parsed.success) throw new HarnessError("APPROVAL_REQUIRED", "The approval is not authenticated; approve the current intent again");
    const { hostAuthenticator, ...fields } = parsed.data;
    const issued = Date.parse(fields.issuedAt), expires = Date.parse(fields.expiresAt), time = Date.now();
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > time || expires <= issued || expires - issued > APPROVAL_TTL_MS)
      throw new HarnessError("APPROVAL_REQUIRED", "The approval has invalid authenticated timing");
    if (fields.remainingUses !== 1 || expires <= time) throw new HarnessError("APPROVAL_REQUIRED", "Approval has expired or is already consumed");
    if (hostAuthenticator.keyId !== signer.keyId || !signer.verify("grant", fields, hostAuthenticator.tag))
      throw new HarnessError("APPROVAL_REQUIRED", "The approval authenticator is invalid; approve the current intent again");
    if (digest(fields.owner) !== digest(owner)) throw new HarnessError("APPROVAL_REQUIRED", "The approved owner changed; approve the current intent again");
    if (fields.operationId !== operation.id || fields.actionCommitment !== this.actionCommitment(operation, thread)
      || digest(fields.targetPreconditions) !== digest(Object.entries(operation.preconditions).map(([key, value]) => key + "=" + value)))
      throw new HarnessError("APPROVAL_REQUIRED", "The approved action changed; approve the current intent again");
  }

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
    approvalContext?: { operation: Operation; thread: Thread };
    parentInvocationId?: string | null;
    privateArguments?: boolean;
    targetPreconditions?: string[];
    extraPut?: () => void;
  }): ToolEffectRecord {
    this.assertAdmissionsEnabled();
    const { call, owner, definition } = input;
    const invocationId = String(call.args.commandId ?? call.args.invocationId ?? randomUUID());
    const commitment = this.privateArgumentCommitment(call);
    let effect!: ToolEffectRecord;
    this.store.internal("toolEffect.admitted", owner.threadId, () => {
      fault("admission");
      const prior = this.get(invocationId);
      if (prior) {
        if (matchesInvocation(prior, owner, definition, commitment) && prior.parentInvocationId === (input.parentInvocationId ?? null)) {
          effect = prior;
          return { effectId: prior.effectId, invocationId, state: prior.state, reused: true };
        }
        throw new HarnessError("INVOCATION_CONFLICT", "This invocation ID was already used with different arguments or owner");
      }
      if (input.approvalId) this.consumeApproval(input.approvalId, owner, input.approvalContext);
      const created = toolEffectSchema.parse({
        effectId: "eff_" + invocationId.slice(0, 48),
        invocationId,
        attemptId: 1,
        parentInvocationId: input.parentInvocationId ?? null,
        owner,
        toolId: definition.id,
        definitionDigest: definition.schemaDigest,
        privateArgumentCommitment: commitment,
        publicRedactedSummary: input.privateArguments ? call.name + " (private program arguments)" : publicRedactedSummary(call),
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

  private consumeApproval(approvalId: string, owner: ToolOwner, context?: { operation: Operation; thread: Thread }): void {
    const approval = this.store.get<ApprovalV1>("approval", approvalId);
    if (!approval || approval.approvalId !== approvalId || approval.owner?.threadId !== owner.threadId) throw new HarnessError("APPROVAL_REQUIRED", "Approval is unavailable for this owner");
    if (this.authenticated()) {
      if (!context) throw new HarnessError("APPROVAL_REQUIRED", "Approval requires its exact operation context");
      this.verifyAuthenticatedApproval(approval, owner, context.operation, context.thread);
    }
    if (approval.remainingUses < 1 || approval.expiresAt <= now()) throw new HarnessError("APPROVAL_REQUIRED", "Approval has expired or is already consumed");
    const spent = { ...approval, remainingUses: 0 };
    this.store.put("approval", approvalId, approval.owner.threadId, this.authenticated() ? this.stampApproval(spent) : spent);
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
    this.assertAdmissionsEnabled();
    const time = Date.now(), issuedAt = new Date(time).toISOString();
    const approval: ApprovalV1 = {
      approvalId: randomUUID(),
      operationId: operation.id,
      actionCommitment: this.actionCommitment(operation, thread),
      owner: ownerFor(thread),
      targetPreconditions: Object.entries(operation.preconditions).map(([key, value]) => key + "=" + value),
      issuedAt,
      expiresAt: new Date(time + APPROVAL_TTL_MS).toISOString(),
      remainingUses: 1,
      issuer: "authenticated_user",
    };
    return this.authenticated() ? this.stampApproval(approval) : approval;
  }

  /** Admission for a prepared Operation: consume its single-use approval and
   * persist DISPATCHED in the same synchronous transaction that marks the
   * operation running. Any post-approval drift (args/cwd/account/workspace/
   * schema/grant/epoch) changes the commitment and denies before dispatch. */
  admitOperationDispatch(operation: Operation, thread: Thread, markRunning: () => void): ToolEffectRecord | null {
    const invocationId = "operation:" + operation.id + "@" + operation.revision;
    // Callers cannot replace the host's effect identity through operation payload.
    if (["commandId", "invocationId", "operationId"].some(key => Object.hasOwn(operation.args, key)))
      throw new HarnessError("INVOCATION_CONFLICT", "Operation arguments must not override ledger control fields");
    if (operation.threadId !== thread.id)
      throw new HarnessError("INVOCATION_CONFLICT", "The operation and current thread do not share an owner");
    const owner = ownerFor(thread);
    const call: ToolCall = { name: "operation:" + operation.kind, args: { invocationId, operationId: operation.id, ...operation.args } };
    // Resource grants and preconditions are part of the exact admitted action,
    // not just the display payload. A changed grant must never inherit a settled result.
    const binding = { kind: operation.kind, args: operation.args, resourceIds: operation.resourceIds, preconditions: operation.preconditions };
    const definition: RegistryEntry = {
      id: "operation:" + operation.kind, version: 1,
      schemaDigest: this.authenticated() ? this.signer().commit("operation-definition", binding) : digest(binding),
      risk: "HOST_EXECUTE", replayClass: "NONREPLAYABLE",
      allowedRoles: ["run", "user"], executorBinding: "domain", approval: "operation",
    };
    const targetPreconditions = Object.entries(operation.preconditions).map(([key, value]) => key + "=" + value);
    const prior = this.get(invocationId);
    if (prior) {
      // A completed operation is historical evidence, not permission to return
      // its outcome under a new owner, action schema, resource grant or target.
      const sameAction = prior.threadId === operation.threadId
        && matchesInvocation(prior, owner, definition, this.privateArgumentCommitment(call))
        && prior.targetPreconditions.length === targetPreconditions.length
        && prior.targetPreconditions.every((entry, index) => entry === targetPreconditions[index]);
      if (!sameAction) throw new HarnessError("INVOCATION_CONFLICT", "This operation receipt belongs to another action or owner");
      if (settled(prior.state)) return prior;
      throw new HarnessError("INVOCATION_IN_FLIGHT", "This operation dispatch is already in flight");
    }
    this.assertAdmissionsEnabled();
    const approvalId = this.flags.enabled("security.authorityV1") ? (this.approvalFor(operation.id)?.approvalId ?? null) : null;
    if (this.flags.enabled("security.authorityV1") && !approvalId) throw new HarnessError("APPROVAL_REQUIRED", "Approve this prepared operation first");
    return this.admit({
      call, owner, definition, approvalId,
      approvalContext: { operation, thread }, targetPreconditions, extraPut: markRunning,
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
    this.assertAdmissionsEnabled();
    if (!this.flags.enabled("security.authorityV1")) return;
    const approval = this.approvalFor(operation.id);
    if (!approval) throw new HarnessError("APPROVAL_REQUIRED", "Approve this prepared operation first");
    this.verifyAuthenticatedApproval(approval, ownerFor(thread), operation, thread);
  }

  /** Gate + admit + dispatch + settle one host tool call. ctx may omit runId/
   * epoch to bind the invocation to the thread's current owner (e.g. learning
   * jobs that outlive the run they review). */
  async invoke(input: { call: ToolCall; ctx: { threadId: string; runId?: string | null; epoch?: number | null }; thread: Thread; role: ActorRole; parentInvocationId?: string; privateArguments?: boolean }, executor: () => Promise<unknown>): Promise<unknown> {
    this.assertAdmissionsEnabled();
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
    // Dedupe does not grant access to cached output after current authority is
    // revoked. Preserve the original receipt rather than overwriting its history
    // with a new denial under the same invocation ID.
    if (prior && decision.kind === "DENY")
      throw new HarnessError("AUTHORITY_DENIED", "Tool call denied by authority: " + decision.reason);
    if (prior) {
      if (matchesInvocation(prior, owner, definition, this.privateArgumentCommitment(call)) && prior.parentInvocationId === (input.parentInvocationId ?? null)) {
        // Reusing a receipt is still a read under today's authority. Refusal
        // must not overwrite the original effect or its historical outcome.
        if (decision.kind === "DENY")
          throw new HarnessError("AUTHORITY_DENIED", "Tool call denied by authority: " + decision.reason, { effectId: prior.effectId });
        if (decision.kind === "REQUIRE_APPROVAL")
          throw new HarnessError("APPROVAL_REQUIRED", "This effect requires explicit user approval before dispatch", { effectId: prior.effectId });
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
    const effect = this.admit({ call, owner, definition, parentInvocationId: input.parentInvocationId, privateArguments: input.privateArguments });
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
      this.settle(effect.invocationId, { error: input.privateArguments ? "Private nested tool failed; inspect the program result reference" : error instanceof Error ? error.message : String(error) }, unknown ? "UNKNOWN_EXTERNAL_OUTCOME" : "FAILED");
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
        privateArgumentCommitment: this.privateArgumentCommitment(call),
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
