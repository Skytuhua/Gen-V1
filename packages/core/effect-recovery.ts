import { HarnessError, type Operation } from "../contracts/index.ts";
import type { EffectState, ObservationFreshness, ToolEffectRecord } from "../contracts/tool-effects.ts";
import type { RegistryEntry } from "./tool-authority.ts";
import type { Store } from "../storage/store.ts";

const now = () => new Date().toISOString();
const appendTransition = (effect: ToolEffectRecord, to: EffectState, note: string): ToolEffectRecord => ({
  ...effect,
  state: to,
  updatedAt: now(),
  transitions: [...effect.transitions, { from: effect.state, to, at: now(), note }].slice(-200),
});

/** Crash recovery: an effect persisted as DISPATCHED but never settled is
 * explicitly uncertain — the external outcome may or may not have happened.
 * PREPARED effects never left the host and stay durable; their owner was
 * revoked by recovery, so they fail closed rather than being replayable. */
export function recoverEffects(store: Store): { uncertain: string[]; interrupted: string[] } {
  const uncertain: string[] = [], interrupted: string[] = [];
  for (const effect of store.all<ToolEffectRecord>("toolEffect")) {
    if (effect.state === "DISPATCHED") {
      // An operation dispatch that committed its own record before the crash is
      // a recorded result, not an uncertainty: settle the effect from it. The
      // binding is validated — a caller can choose any invocationId, so the
      // effect must genuinely be that operation's dispatch (same tool, thread
      // and revision) before the operation's outcome is inherited.
      const opMatch = /^operation:(.+)@(\d+)$/.exec(effect.invocationId);
      const operation = opMatch ? store.get<Operation>("operation", opMatch[1]) : null;
      const bound = Boolean(
        operation &&
        effect.toolId === "operation:" + operation!.kind &&
        effect.threadId === operation!.threadId &&
        effect.owner.threadId === operation!.threadId &&
        Number(opMatch![2]) === operation!.revision);
      const recorded = bound && ["succeeded", "failed", "cancelled"].includes(operation!.status)
        ? ({ succeeded: "SUCCEEDED", failed: "FAILED", cancelled: "CANCELLED" } as const)[operation!.status as "succeeded" | "failed" | "cancelled"]
        : null;
      store.internal("toolEffect.recovered", effect.threadId, () => {
        const current = store.get<ToolEffectRecord>("toolEffect", effect.invocationId);
        if (current?.state !== "DISPATCHED") return { effectId: effect.effectId };
        if (recorded)
          store.put("toolEffect", current.invocationId, current.threadId, { ...appendTransition(current, recorded, "host_restart: recorded in operation ledger"), outcome: { value: operation?.result ?? null, error: operation?.error ?? undefined } });
        else
          store.put("toolEffect", current.invocationId, current.threadId, appendTransition(current, "UNKNOWN_EXTERNAL_OUTCOME", "host_restart"));
        return { effectId: effect.effectId };
      });
      if (!recorded) uncertain.push(effect.invocationId);
    } else if (effect.state === "PREPARED") {
      store.internal("toolEffect.recovered", effect.threadId, () => {
        const current = store.get<ToolEffectRecord>("toolEffect", effect.invocationId);
        if (current?.state === "PREPARED") store.put("toolEffect", current.invocationId, current.threadId, { ...appendTransition(current, "FAILED", "interrupted"), outcome: { error: "Interrupted before dispatch" } });
        return { effectId: effect.effectId };
      });
      interrupted.push(effect.invocationId);
    }
  }
  return { uncertain, interrupted };
}

/** Rollback path while a flag is disabled: admissions stop, outstanding
 * effects are marked uncertain, and the ledger (including consumed approvals)
 * is preserved — pending writes are never replayed. */
export function disableEffects(store: Store): { marked: string[] } {
  const marked: string[] = [];
  for (const effect of store.all<ToolEffectRecord>("toolEffect")) {
    if (effect.state !== "DISPATCHED" && effect.state !== "PREPARED") continue;
    store.internal("toolEffect.rolledback", effect.threadId, () => {
      const current = store.get<ToolEffectRecord>("toolEffect", effect.invocationId);
      if (current && !["SUCCEEDED", "FAILED", "CANCELLED", "DENIED"].includes(current.state))
        store.put("toolEffect", current.invocationId, current.threadId, appendTransition(current, "UNKNOWN_EXTERNAL_OUTCOME", "rolled_back"));
      return { effectId: effect.effectId };
    });
    marked.push(effect.invocationId);
  }
  return { marked };
}

/** Replay policy: only READ_RETRYABLE calls may be retried automatically, and
 * only under a fresh valid owner with unchanged authorization. Provider-
 * idempotent classes additionally require a documented contract and the exact
 * same idempotency key; process-bound and ambiguous effects are never
 * re-dispatched by recovery. */
export function retryDecision(effect: ToolEffectRecord, definition: RegistryEntry | undefined, ownerValid: boolean): { retry: boolean; reason: string } {
  if (!ownerValid) return { retry: false, reason: "owner_revoked" };
  if (!definition) return { retry: false, reason: "unregistered" };
  if (effect.state !== "UNKNOWN_EXTERNAL_OUTCOME" && effect.state !== "FAILED") return { retry: false, reason: "not_retryable_state" };
  switch (definition.replayClass) {
    case "READ_RETRYABLE": return { retry: true, reason: "read_retryable" };
    case "PROVIDER_IDEMPOTENT": return { retry: true, reason: "provider_idempotent_same_key" };
    case "PROCESS_BOUND":
    case "NONREPLAYABLE": return { retry: false, reason: "not_replayable" };
  }
}

/** Read-only reconciliation: reports what the ledger recorded; unknown
 * external outcomes stay unresolved until a reconciler or the operator marks
 * the verified result as a new labeled record — process disappearance or a
 * disappearing artifact is never proof of success. */
export function reconcileEffect(store: Store, invocationId: string): { invocationId: string; state: EffectState; basis: "recorded-result" | "unresolved"; transitions: ToolEffectRecord["transitions"] } {
  const effect = store.get<ToolEffectRecord>("toolEffect", invocationId);
  if (!effect) throw new HarnessError("NOT_FOUND", "Tool effect unavailable");
  if (effect.state === "UNKNOWN_EXTERNAL_OUTCOME") return { invocationId, state: effect.state, basis: "unresolved", transitions: effect.transitions };
  return { invocationId, state: effect.state, basis: "recorded-result", transitions: effect.transitions };
}

/** Observation freshness: separate from outcome. A page read at a sequence
 * fence older than the store is STALE; a record whose owner scope can no
 * longer be verified is INDETERMINATE. */
export function observationFreshness(store: Store, fencedSequence: number | null): ObservationFreshness {
  if (fencedSequence === null) return "INDETERMINATE";
  if (fencedSequence < store.sequence) return "STALE";
  return "CURRENT";
}
