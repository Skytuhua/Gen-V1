import { randomUUID } from "node:crypto";
import { HarnessError, type HostCommand } from "../contracts/index.ts";
import { Store } from "../storage/store.ts";
import {
  BACKGROUND_HOST_EVENTS, BACKGROUND_SCHEDULER_LIMITS, occurrenceKeyForEvent, occurrenceKeyForTime,
  wakeupTriggerSchema, wakeupV1Schema, backgroundOccurrenceV1Schema,
  type BackgroundOccurrenceV1, type WakeupTriggerV1, type WakeupV1,
} from "../contracts/background-work.ts";

/** M10 S01: one scheduler over the existing Store. Claims are synchronous
 * transactions; dispatch happens outside them. A lease is custody, not proof
 * of dispatch: an expired lease after an uncertain submission never authorizes
 * a second submit (D02). */

export interface WakeupRecord extends WakeupV1 {
  nextDueAtMs: number | null;
  lastProcessedDueAtMs: number | null;
  paused: boolean;
  skippedTotal: number;
  lastRunAtMs: number | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WakeupDelivery { wakeup: WakeupRecord; occurrence: BackgroundOccurrenceV1 }
export type DeliveryOutcome =
  | { status: "DELIVERED"; receiptRef?: string }
  | { status: "UNCERTAIN"; reason: string }
  | { status: "BLOCKED"; blockedReason: string }
  | { status: "FAILED"; error: string; transient?: boolean };

export interface WakeupSchedulerOptions {
  store: Store;
  deliver: (delivery: WakeupDelivery) => Promise<DeliveryOutcome>;
  revalidate?: (delivery: WakeupDelivery) => { ok: true } | { ok: false; blockedReason: string };
  enabled?: () => boolean;
  now?: () => number;
  limits?: Partial<Pick<typeof BACKGROUND_SCHEDULER_LIMITS, "tickMs" | "dueBatchLimit" | "leaseMs" | "heartbeatMs" | "retryAttempts" | "retryDelaysMs">>;
}

const iso = (ms: number) => new Date(ms).toISOString();

export async function waitForBackgroundDrain(work: Promise<unknown>, boundedMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, boundedMs); })]);
  } finally {
    clearTimeout(timer);
  }
}

export class DurableWakeupScheduler {
  private readonly store: Store;
  private readonly now: () => number;
  private readonly deliver: (delivery: WakeupDelivery) => Promise<DeliveryOutcome>;
  private readonly revalidate?: WakeupSchedulerOptions["revalidate"];
  private readonly enabled: () => boolean;
  private readonly limits: typeof BACKGROUND_SCHEDULER_LIMITS;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private readonly inFlight = new Map<string, { wakeupId: string; promise: Promise<void> }>();

  constructor(options: WakeupSchedulerOptions) {
    this.store = options.store;
    this.deliver = options.deliver;
    this.revalidate = options.revalidate;
    this.enabled = options.enabled ?? (() => true);
    this.now = options.now ?? (() => Date.now());
    this.limits = { ...BACKGROUND_SCHEDULER_LIMITS, ...options.limits };
  }

  start(): void {
    if (this.tickTimer || this.draining) return;
    this.tickTimer = setInterval(() => { void this.tick().catch(() => {}); }, this.limits.tickMs);
    this.tickTimer.unref();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.limits.heartbeatMs);
    this.heartbeatTimer.unref();
  }
  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.tickTimer = null; this.heartbeatTimer = null;
  }

  register(command: HostCommand, input: { wakeupId?: string; taskId: string; trigger: unknown; scheduleTimezone?: string | null; deadlineMs?: number }): WakeupRecord {
    return this.store.command(command, () => this.registerRecord(input)).result as WakeupRecord;
  }

  /** Transaction-safe registration for callers already inside a Store write. */
  registerRecord(input: { wakeupId?: string; taskId: string; trigger: unknown; scheduleTimezone?: string | null; deadlineMs?: number }): WakeupRecord {
    let trigger: WakeupTriggerV1;
    try { trigger = wakeupTriggerSchema.parse(input.trigger); }
    catch { throw new HarnessError("SCHEDULE_KIND_UNSUPPORTED", "Only UTC one-shot, UTC interval and allowlisted host events are supported."); }
    {
      const stamp = this.now(), wakeupId = input.wakeupId ?? randomUUID();
      if (this.store.get("backgroundWakeup", wakeupId)) throw new HarnessError("DUPLICATE_COMMAND", "Wakeup already registered.");
      const nextDueAtMs = trigger.kind === "AT_UTC" ? trigger.dueAtMs
        : trigger.kind === "INTERVAL_UTC" ? (stamp <= trigger.anchorMs ? trigger.anchorMs : trigger.anchorMs + Math.ceil((stamp - trigger.anchorMs) / trigger.intervalMs) * trigger.intervalMs)
        : null;
      const v1 = wakeupV1Schema.parse({
        wakeupId, taskId: input.taskId, scheduleRevision: 1, trigger,
        scheduleTimezone: input.scheduleTimezone ?? null, occurrenceKey: null,
        state: "PENDING", claimGeneration: 0, leaseExpiresAtMs: null,
        deadlineMs: input.deadlineMs ?? stamp + 24 * 60 * 60 * 1000,
      });
      const record: WakeupRecord = {
        ...v1, nextDueAtMs, lastProcessedDueAtMs: null, paused: false, skippedTotal: 0,
        lastRunAtMs: null, blockedReason: null, createdAt: iso(stamp), updatedAt: iso(stamp),
      };
      this.store.put("backgroundWakeup", wakeupId, null, record);
      return record;
    }
  }

  /** Host events are allowlisted and correlated by exact key; the payload is
   * never execution authority. */
  hostEvent(eventKind: string, correlationKey: string, hostEventId: string): WakeupDelivery[] {
    if (this.draining || !this.enabled()) return [];
    if (!(BACKGROUND_HOST_EVENTS as readonly string[]).includes(eventKind))
      throw new HarnessError("SCHEDULE_KIND_UNSUPPORTED", "Host event is not allowlisted.");
    const claimed: WakeupDelivery[] = [];
    for (const wakeup of this.store.all<WakeupRecord>("backgroundWakeup")) {
      if (wakeup.paused || wakeup.state === "CANCELLED" || wakeup.state === "DELIVERED" || wakeup.state === "BLOCKED") continue;
      if (wakeup.trigger.kind !== "HOST_EVENT" || wakeup.trigger.eventKind !== eventKind || wakeup.trigger.correlationKey !== correlationKey) continue;
      const key = occurrenceKeyForEvent(wakeup.wakeupId, wakeup.scheduleRevision, hostEventId);
      const delivery = this.claimOccurrence(wakeup.wakeupId, key, { hostEventId, scheduledDueAtMs: null });
      if (delivery) claimed.push(delivery);
    }
    for (const delivery of claimed) this.dispatch(delivery);
    return claimed;
  }

  async tick(): Promise<WakeupDelivery[]> {
    if (this.draining || !this.enabled()) return [];
    const stamp = this.now(), claimed: WakeupDelivery[] = [];
    const due = this.store.all<WakeupRecord>("backgroundWakeup")
      .filter(wakeup => !wakeup.paused && wakeup.state !== "CANCELLED" && wakeup.state !== "DELIVERED" && wakeup.state !== "BLOCKED"
        && wakeup.trigger.kind !== "HOST_EVENT" && wakeup.nextDueAtMs !== null && wakeup.nextDueAtMs <= stamp)
      .sort((a, b) => (a.nextDueAtMs ?? 0) - (b.nextDueAtMs ?? 0))
      .slice(0, this.limits.dueBatchLimit);
    for (const wakeup of due) {
      const trigger = wakeup.trigger;
      if (trigger.kind === "AT_UTC") {
        const delivery = this.claimOccurrence(wakeup.wakeupId, occurrenceKeyForTime(wakeup.wakeupId, wakeup.scheduleRevision, trigger.dueAtMs), { scheduledDueAtMs: trigger.dueAtMs, hostEventId: null });
        if (delivery) claimed.push(delivery);
        continue;
      }
      if (trigger.kind !== "INTERVAL_UTC" || stamp < trigger.anchorMs) continue;
      // D02/D03: due instants are anchor + k*interval. A forward jump admits
      // only the latest missed occurrence; earlier missed occurrences are
      // persisted as skipped, never burst-replayed. A backward jump cannot
      // redeliver a consumed key.
      const latestDue = trigger.anchorMs + Math.floor((stamp - trigger.anchorMs) / trigger.intervalMs) * trigger.intervalMs;
      const delivery = this.claimOccurrence(wakeup.wakeupId, occurrenceKeyForTime(wakeup.wakeupId, wakeup.scheduleRevision, latestDue), { scheduledDueAtMs: latestDue, hostEventId: null, intervalAnchor: trigger });
      if (delivery) claimed.push(delivery);
    }
    for (const delivery of claimed) this.dispatch(delivery);
    // Reconcile expired claims within the same bounded inspection: a lease
    // expiry after an uncertain dispatch never authorizes a second submit.
    // S01: at most 50 due records inspected per tick, shared across new due
    // wakeups and expired claims needing reconciliation.
    const recoverable = new Set(this.store.all<WakeupRecord>("backgroundWakeup")
      .filter(wakeup => !wakeup.paused && wakeup.state !== "CANCELLED" && wakeup.state !== "DELIVERED" && wakeup.state !== "BLOCKED")
      .map(wakeup => wakeup.wakeupId));
    const expired = this.store.all<BackgroundOccurrenceV1>("backgroundOccurrence")
      .filter(item => item.state === "CLAIMED" && item.leaseExpiresAtMs !== null && item.leaseExpiresAtMs <= stamp && recoverable.has(item.wakeupId))
      .slice(0, Math.max(0, this.limits.dueBatchLimit - due.length));
    for (const occurrence of expired) {
      const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", occurrence.wakeupId);
      if (!wakeup || wakeup.paused || wakeup.state === "CANCELLED" || wakeup.state === "DELIVERED" || wakeup.state === "BLOCKED") continue;
      if (occurrence.dispatch !== "NOT_DISPATCHED") {
        this.store.internal("background.occurrence.expired", null, () => {
          const current = this.store.get<BackgroundOccurrenceV1>("backgroundOccurrence", occurrence.occurrenceKey);
          if (!current || current.state !== "CLAIMED") return;
          this.store.put("backgroundOccurrence", occurrence.occurrenceKey, null, { ...current, state: "UNKNOWN", leaseExpiresAtMs: null, updatedAt: iso(this.now()) });
          const owner = this.store.get<WakeupRecord>("backgroundWakeup", occurrence.wakeupId);
          if (owner?.state === "CLAIMED" && owner.occurrenceKey === occurrence.occurrenceKey) this.store.put("backgroundWakeup", owner.wakeupId, null, { ...owner, state: "PENDING", leaseExpiresAtMs: null, occurrenceKey: null, updatedAt: iso(this.now()) });
        });
        continue;
      }
      const trigger = wakeup.trigger;
      const delivery = this.claimOccurrence(wakeup.wakeupId, occurrence.occurrenceKey, {
        scheduledDueAtMs: occurrence.scheduledDueAtMs, hostEventId: occurrence.hostEventId,
        ...(trigger.kind === "INTERVAL_UTC" ? { intervalAnchor: trigger } : {}),
      });
      if (delivery) { claimed.push(delivery); this.dispatch(delivery); }
    }
    return claimed;
  }

  /** One synchronous claim transaction per occurrence. Re-reads inside the
   * transaction so two racing schedulers produce exactly one admission. */
  private claimOccurrence(wakeupId: string, key: string, input: { scheduledDueAtMs: number | null; hostEventId: string | null; intervalAnchor?: { anchorMs: number; intervalMs: number } }): WakeupDelivery | null {
    return this.store.internal("background.occurrence.claimed", null, () => {
      const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", wakeupId);
      if (!wakeup || wakeup.paused || wakeup.state === "CANCELLED" || wakeup.state === "DELIVERED" || wakeup.state === "BLOCKED") return null;
      const stamp = this.now();
      let occurrence = this.store.get<BackgroundOccurrenceV1>("backgroundOccurrence", key);
      if (occurrence) {
        if (occurrence.state === "DELIVERED" || occurrence.state === "SKIPPED" || occurrence.state === "CANCELLED" || occurrence.state === "UNKNOWN") return null;
        if (occurrence.state === "CLAIMED") {
          if (occurrence.leaseExpiresAtMs !== null && occurrence.leaseExpiresAtMs > stamp) return null;
          if (occurrence.dispatch !== "NOT_DISPATCHED") {
            // Lease expiry alone never proves a previous dispatch did not occur.
            const unknown: BackgroundOccurrenceV1 = { ...occurrence, state: "UNKNOWN", leaseExpiresAtMs: null, updatedAt: iso(stamp) };
            this.store.put("backgroundOccurrence", key, null, unknown);
            if (wakeup.occurrenceKey === key)
              this.store.put("backgroundWakeup", wakeupId, null, { ...wakeup, state: "PENDING", leaseExpiresAtMs: null, occurrenceKey: null, updatedAt: iso(stamp) });
            return null;
          }
          occurrence = { ...occurrence, claimGeneration: occurrence.claimGeneration + 1, leaseExpiresAtMs: stamp + this.limits.leaseMs, updatedAt: iso(stamp) };
        } else {
          occurrence = { ...occurrence, state: "CLAIMED", claimGeneration: occurrence.claimGeneration + 1, leaseExpiresAtMs: stamp + this.limits.leaseMs, updatedAt: iso(stamp) };
        }
      } else {
        occurrence = backgroundOccurrenceV1Schema.parse({
          occurrenceKey: key, wakeupId, scheduleRevision: wakeup.scheduleRevision,
          scheduledDueAtMs: input.scheduledDueAtMs, hostEventId: input.hostEventId,
          state: "CLAIMED", dispatch: "NOT_DISPATCHED", claimGeneration: 1, admissionId: null,
          leaseExpiresAtMs: stamp + this.limits.leaseMs, createdAt: iso(stamp), updatedAt: iso(stamp),
        });
      }
      // Lease recovery may reclaim an earlier firing after a newer interval
      // has already advanced the cadence. Reclaim only the old occurrence.
      if (input.intervalAnchor && input.scheduledDueAtMs !== null && wakeup.lastProcessedDueAtMs !== null && input.scheduledDueAtMs < wakeup.lastProcessedDueAtMs) {
        this.store.put("backgroundOccurrence", key, null, occurrence);
        return { wakeup, occurrence };
      }
      let nextDueAtMs = wakeup.nextDueAtMs, skippedTotal = wakeup.skippedTotal, lastProcessedDueAtMs = wakeup.lastProcessedDueAtMs;
      if (input.intervalAnchor && input.scheduledDueAtMs !== null) {
        const { anchorMs, intervalMs } = input.intervalAnchor;
        const previousDue = Math.max(wakeup.nextDueAtMs ?? anchorMs, wakeup.lastProcessedDueAtMs !== null ? wakeup.lastProcessedDueAtMs + intervalMs : anchorMs);
        // Persist missed occurrences between the previous due instant and the
        // latest admitted one (bounded per tick; the count is always exact).
        // The initial anchor does not count as a skipped interval. For a
        // previously active cadence, previousDue is itself still unprocessed.
        const firstMissableDue = Math.max(previousDue, anchorMs + intervalMs);
        const missed = Math.max(0, Math.round((input.scheduledDueAtMs - firstMissableDue) / intervalMs));
        skippedTotal += missed;
        // S11: persist every intended missed occurrence; the hard cap is only
        // a host memory guard for pathological multi-year jumps.
        const persist = Math.min(missed, 100_000);
        for (let index = 0; index < persist; index++) {
          const skippedDue = input.scheduledDueAtMs - (index + 1) * intervalMs;
          const skippedKey = occurrenceKeyForTime(wakeupId, wakeup.scheduleRevision, skippedDue);
          if (this.store.get("backgroundOccurrence", skippedKey)) continue;
          this.store.put("backgroundOccurrence", skippedKey, null, backgroundOccurrenceV1Schema.parse({
            occurrenceKey: skippedKey, wakeupId, scheduleRevision: wakeup.scheduleRevision,
            scheduledDueAtMs: skippedDue, hostEventId: null, state: "SKIPPED", dispatch: "NOT_DISPATCHED",
            claimGeneration: 0, admissionId: null, leaseExpiresAtMs: null, createdAt: iso(stamp), updatedAt: iso(stamp),
          }));
        }
        nextDueAtMs = input.scheduledDueAtMs + intervalMs;
        lastProcessedDueAtMs = input.scheduledDueAtMs;
      } else if (wakeup.trigger.kind === "AT_UTC") {
        nextDueAtMs = null;
        lastProcessedDueAtMs = input.scheduledDueAtMs;
      }
      this.store.put("backgroundOccurrence", key, null, occurrence);
      const next: WakeupRecord = { ...wakeup, state: "CLAIMED", claimGeneration: wakeup.claimGeneration + 1, leaseExpiresAtMs: stamp + this.limits.leaseMs, occurrenceKey: key, nextDueAtMs, skippedTotal, lastProcessedDueAtMs, updatedAt: iso(stamp) };
      this.store.put("backgroundWakeup", wakeupId, null, next);
      return { wakeup: next, occurrence };
    }) as WakeupDelivery | null;
  }

  private dispatch(delivery: WakeupDelivery): void {
    const key = delivery.occurrence.occurrenceKey;
    const promise = this.dispatchOnce(delivery).catch(() => {}).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, { wakeupId: delivery.wakeup.wakeupId, promise });
  }

  private async dispatchOnce(delivery: WakeupDelivery): Promise<void> {
    const key = delivery.occurrence.occurrenceKey;
    const current = this.store.get<WakeupRecord>("backgroundWakeup", delivery.wakeup.wakeupId);
    if (!current || current.paused || current.state === "CANCELLED") {
      this.setOccurrence(key, { state: "CANCELLED", leaseExpiresAtMs: null });
      return;
    }
    const revalidation = this.revalidate?.(delivery) ?? { ok: true as const };
    if (!revalidation.ok) {
      // A WAITING_HUMAN block is a deferral, not a consumption: the claimed
      // firing stays claimable under its own occurrence key so a later resume
      // can deliver it (host events never re-arrive with the same identity).
      const held = revalidation.blockedReason === "WAITING_HUMAN";
      this.store.internal("background.occurrence.blocked", null, () => {
        this.setOccurrence(key, held ? { state: "PENDING", leaseExpiresAtMs: null } : { state: "CANCELLED", leaseExpiresAtMs: null });
        const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", delivery.wakeup.wakeupId);
        if (wakeup?.state === "CLAIMED" && wakeup.occurrenceKey === key) this.store.put("backgroundWakeup", wakeup.wakeupId, null, { ...wakeup, state: "BLOCKED", blockedReason: revalidation.blockedReason, leaseExpiresAtMs: null, occurrenceKey: null, updatedAt: iso(this.now()) });
      });
      return;
    }
    // Persist the dispatch intent and the single admission receipt before any
    // executor call. A crash after this point is uncertain, never replayable.
    const admitted = this.store.internal("background.occurrence.admitted", null, () => {
      const occurrence = this.store.get<BackgroundOccurrenceV1>("backgroundOccurrence", key);
      if (!occurrence || occurrence.state !== "CLAIMED" || occurrence.dispatch !== "NOT_DISPATCHED") return null;
      // One admission receipt per occurrence key: a proven NOT_DISPATCHED
      // reconciliation reuses the original receipt identity.
      const priorAdmission = this.store.get<{ admissionId: string }>("backgroundAdmission", key);
      const admissionId = priorAdmission?.admissionId ?? randomUUID();
      const next: BackgroundOccurrenceV1 = { ...occurrence, dispatch: "DISPATCHED_UNCONFIRMED", admissionId, updatedAt: iso(this.now()) };
      this.store.put("backgroundOccurrence", key, null, next);
      if (!priorAdmission) this.store.put("backgroundAdmission", key, null, { occurrenceKey: key, admissionId, wakeupId: occurrence.wakeupId, admittedAt: iso(this.now()) });
      return next;
    }) as BackgroundOccurrenceV1 | null;
    if (!admitted) return;
    const attempts = this.limits.retryAttempts;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let outcome: DeliveryOutcome;
      try { outcome = await this.deliver({ wakeup: this.store.get<WakeupRecord>("backgroundWakeup", delivery.wakeup.wakeupId) ?? delivery.wakeup, occurrence: admitted }); }
      catch (error) {
        const code = (error as HarnessError)?.code;
        outcome = code === "OPERATION_OUTCOME_UNKNOWN" ? { status: "UNCERTAIN", reason: error instanceof Error ? error.message : String(error) } : { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
      }
      if (outcome.status === "DELIVERED") {
        this.store.internal("background.occurrence.delivered", null, () => {
          this.setOccurrence(key, { state: "DELIVERED", dispatch: "RECEIPT_CONFIRMED", leaseExpiresAtMs: null });
          const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", delivery.wakeup.wakeupId);
          if (!wakeup || wakeup.scheduleRevision !== admitted.scheduleRevision || wakeup.state === "CANCELLED") return;
          const stamp = this.now();
          const lastRunAtMs = Math.max(wakeup.lastRunAtMs ?? stamp, stamp);
          if (wakeup.state === "CLAIMED" && wakeup.occurrenceKey === key) {
            this.store.put("backgroundWakeup", wakeup.wakeupId, null, { ...wakeup, state: wakeup.trigger.kind === "AT_UTC" ? "DELIVERED" : "PENDING", leaseExpiresAtMs: null, occurrenceKey: null, lastRunAtMs, blockedReason: null, updatedAt: iso(stamp) });
          } else if (wakeup.trigger.kind === "INTERVAL_UTC" && wakeup.lastRunAtMs !== lastRunAtMs) {
            // A successful older occurrence contributes history, not ownership.
            this.store.put("backgroundWakeup", wakeup.wakeupId, null, { ...wakeup, lastRunAtMs, updatedAt: iso(stamp) });
          }
        });
        return;
      }
      if (outcome.status === "UNCERTAIN") {
        this.store.internal("background.occurrence.unknown", null, () => {
          this.setOccurrence(key, { state: "UNKNOWN", leaseExpiresAtMs: null });
          const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", delivery.wakeup.wakeupId);
          if (wakeup?.state === "CLAIMED" && wakeup.occurrenceKey === key) this.store.put("backgroundWakeup", wakeup.wakeupId, null, { ...wakeup, state: "PENDING", leaseExpiresAtMs: null, occurrenceKey: null, updatedAt: iso(this.now()) });
        });
        return;
      }
      if (outcome.status === "BLOCKED") {
        // Same deferral rule as the revalidation path: a human wait holds the
        // firing for redelivery; any other block consumes it.
        const held = outcome.blockedReason === "WAITING_HUMAN";
        this.store.internal("background.occurrence.blocked", null, () => {
          this.setOccurrence(key, held ? { state: "PENDING", dispatch: "NOT_DISPATCHED", leaseExpiresAtMs: null } : { state: "CANCELLED", leaseExpiresAtMs: null });
          const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", delivery.wakeup.wakeupId);
          if (wakeup?.state === "CLAIMED" && wakeup.occurrenceKey === key) this.store.put("backgroundWakeup", wakeup.wakeupId, null, { ...wakeup, state: "BLOCKED", blockedReason: outcome.blockedReason, leaseExpiresAtMs: null, occurrenceKey: null, updatedAt: iso(this.now()) });
        });
        return;
      }
      // S11: only host-classified transient read failures retry, with fixed
      // 1000ms/2000ms delays. Cancellation/authorization/validation failures
      // and uncertain nonreplayable dispatches never retry.
      if (!outcome.transient || attempt >= attempts) {
        this.store.internal("background.occurrence.blocked", null, () => {
          this.setOccurrence(key, { state: "CANCELLED", leaseExpiresAtMs: null });
          const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", delivery.wakeup.wakeupId);
          if (wakeup?.state === "CLAIMED" && wakeup.occurrenceKey === key) this.store.put("backgroundWakeup", wakeup.wakeupId, null, { ...wakeup, state: "BLOCKED", blockedReason: "DELIVERY_FAILED", leaseExpiresAtMs: null, occurrenceKey: null, updatedAt: iso(this.now()) });
        });
        return;
      }
      const delay = this.limits.retryDelaysMs[attempt - 1] ?? 2_000;
      await new Promise(resolve => setTimeout(resolve, delay));
      if (this.draining) return;
      const still = this.store.get<BackgroundOccurrenceV1>("backgroundOccurrence", key);
      if (!still || still.state !== "CLAIMED") return;
    }
  }

  private setOccurrence(key: string, patch: Partial<BackgroundOccurrenceV1>): void {
    const occurrence = this.store.get<BackgroundOccurrenceV1>("backgroundOccurrence", key);
    if (occurrence) this.store.put("backgroundOccurrence", key, null, { ...occurrence, ...patch, updatedAt: iso(this.now()) });
  }

  private heartbeat(): void {
    if (this.draining) return;
    const stamp = this.now();
    for (const [key, owner] of this.inFlight) {
      this.store.internal("background.occurrence.heartbeat", null, () => {
        const occurrence = this.store.get<BackgroundOccurrenceV1>("backgroundOccurrence", key);
        if (occurrence && occurrence.state === "CLAIMED") this.store.put("backgroundOccurrence", key, null, { ...occurrence, leaseExpiresAtMs: stamp + this.limits.leaseMs, updatedAt: iso(stamp) });
        const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", owner.wakeupId);
        if (wakeup?.state === "CLAIMED" && wakeup.occurrenceKey === key) this.store.put("backgroundWakeup", owner.wakeupId, null, { ...wakeup, leaseExpiresAtMs: stamp + this.limits.leaseMs, updatedAt: iso(stamp) });
      });
    }
  }

  /** Restart reconciliation runs before any replacement delivery: an
   * uncertain dispatched occurrence becomes UNKNOWN and waits for an observed
   * receipt; a never-dispatched claim is reclaimable only after lease expiry. */
  recover(): void {
    this.store.internal("background.wakeups.recovered", null, () => {
      const stamp = this.now();
      for (const occurrence of this.store.all<BackgroundOccurrenceV1>("backgroundOccurrence")) {
        if (occurrence.state !== "CLAIMED") continue;
        if (occurrence.dispatch === "DISPATCHED_UNCONFIRMED") {
          this.store.put("backgroundOccurrence", occurrence.occurrenceKey, null, { ...occurrence, state: "UNKNOWN", leaseExpiresAtMs: null, updatedAt: iso(stamp) });
          const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", occurrence.wakeupId);
          if (wakeup?.state === "CLAIMED" && wakeup.occurrenceKey === occurrence.occurrenceKey) this.store.put("backgroundWakeup", wakeup.wakeupId, null, { ...wakeup, state: "PENDING", leaseExpiresAtMs: null, occurrenceKey: null, updatedAt: iso(stamp) });
        }
      }
    });
    // A host interruption can strand a held firing: the resume committed the
    // wakeup PENDING but deliverHeld never claimed its deferred occurrence.
    // Redeliver any held occurrence bound to a live wakeup.
    for (const wakeup of this.store.all<WakeupRecord>("backgroundWakeup")) this.deliverHeld(wakeup);
  }

  reconcile(command: HostCommand, occurrenceKey: string, receipt: { observed: "DELIVERED" | "NOT_DISPATCHED"; receiptRef?: string }): BackgroundOccurrenceV1 {
    return this.store.command(command, () => {
      const occurrence = this.store.get<BackgroundOccurrenceV1>("backgroundOccurrence", occurrenceKey);
      if (!occurrence) throw new HarnessError("NOT_FOUND", "Occurrence unavailable.");
      if (occurrence.state !== "UNKNOWN" && !(occurrence.state === "CLAIMED" && occurrence.dispatch === "DISPATCHED_UNCONFIRMED"))
        throw new HarnessError("INVALID_INPUT", "Only an uncertain occurrence can be reconciled.");
      const stamp = this.now();
      const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", occurrence.wakeupId);
      const cancelled = wakeup?.state === "CANCELLED";
      // Late evidence settles history, but cannot reverse an operator cancellation.
      const next: BackgroundOccurrenceV1 = receipt.observed === "DELIVERED"
        ? { ...occurrence, state: "DELIVERED", dispatch: "RECEIPT_CONFIRMED", leaseExpiresAtMs: null, updatedAt: iso(stamp) }
        : { ...occurrence, state: cancelled ? "CANCELLED" : "PENDING", dispatch: "NOT_DISPATCHED", leaseExpiresAtMs: null, updatedAt: iso(stamp) };
      this.store.put("backgroundOccurrence", occurrenceKey, null, next);
      if (wakeup && !cancelled) {
        const lastRunAtMs = receipt.observed === "DELIVERED" ? Math.max(wakeup.lastRunAtMs ?? stamp, stamp) : wakeup.lastRunAtMs;
        const anotherClaim = wakeup.state === "CLAIMED" && wakeup.occurrenceKey !== occurrenceKey;
        if (anotherClaim || wakeup.state === "BLOCKED") {
          // An older receipt may update history, not the live lease or a newer block.
          if (wakeup.trigger.kind === "INTERVAL_UTC" && lastRunAtMs !== wakeup.lastRunAtMs)
            this.store.put("backgroundWakeup", wakeup.wakeupId, null, { ...wakeup, lastRunAtMs, updatedAt: iso(stamp) });
        } else {
          this.store.put("backgroundWakeup", wakeup.wakeupId, null, {
            ...wakeup,
            state: receipt.observed === "DELIVERED" && wakeup.trigger.kind === "AT_UTC" ? "DELIVERED" : "PENDING",
            nextDueAtMs: receipt.observed === "NOT_DISPATCHED" && wakeup.trigger.kind === "AT_UTC" ? wakeup.trigger.dueAtMs : wakeup.nextDueAtMs,
            lastRunAtMs, leaseExpiresAtMs: null, occurrenceKey: null, updatedAt: iso(stamp),
          });
        }
      }
      return next;
    }).result as BackgroundOccurrenceV1;
  }

  pause(command: HostCommand, wakeupId: string): WakeupRecord {
    return this.store.command(command, () => this.pauseRecord(wakeupId)).result as WakeupRecord;
  }
  pauseRecord(wakeupId: string): WakeupRecord {
    const wakeup = this.requireWakeup(wakeupId);
    const next = { ...wakeup, paused: true, updatedAt: iso(this.now()) };
    this.store.put("backgroundWakeup", wakeupId, null, next);
    return next;
  }
  resume(command: HostCommand, wakeupId: string): WakeupRecord {
    const resumed = this.store.command(command, () => this.resumeRecord(this.requireWakeup(wakeupId), true)).result as WakeupRecord;
    this.deliverHeld(resumed);
    return resumed;
  }

  /** A blocked AT_UTC wakeup cleared its due instant and cancelled its claimed
   * occurrence before delivery; unblocking it must re-arm the firing or it can
   * never deliver. Bumping scheduleRevision mints a fresh occurrence key for
   * the same due instant, so the cancelled receipt stays as history while the
   * firing becomes claimable again. A firing deferred by a human wait keeps a
   * PENDING occurrence under its original key, so no new key is minted for it.
   * Interval schedules already carry a future nextDueAtMs and host-event
   * wakeups re-arm on the next event, so they need only the state flip.
   * `clearPaused` stays an explicit operator decision: the auto-resume path
   * never releases a schedule the operator paused. */
  private resumeRecord(wakeup: WakeupRecord, clearPaused: boolean): WakeupRecord {
    const unblocking = wakeup.state === "BLOCKED";
    const held = unblocking ? this.store.all<BackgroundOccurrenceV1>("backgroundOccurrence").some(item => item.wakeupId === wakeup.wakeupId && item.state === "PENDING" && item.dispatch === "NOT_DISPATCHED") : false;
    let next = { ...wakeup, paused: clearPaused ? false : wakeup.paused, state: unblocking ? "PENDING" : wakeup.state, blockedReason: unblocking ? null : wakeup.blockedReason, updatedAt: iso(this.now()) };
    if (unblocking && !held && wakeup.trigger.kind === "AT_UTC" && wakeup.nextDueAtMs === null)
      next = { ...next, scheduleRevision: wakeup.scheduleRevision + 1, nextDueAtMs: wakeup.trigger.dueAtMs };
    this.store.put("backgroundWakeup", wakeup.wakeupId, null, next);
    return next;
  }

  /** After an unblock, re-claim and dispatch any occurrence that was held
   * (PENDING, never dispatched) by the block. An operator-paused wakeup keeps
   * its firing held until the explicit resume, and a disabled feature never
   * executes — the occurrence stays durable for an enabled resume/recover. */
  private deliverHeld(wakeup: WakeupRecord): void {
    if (!this.enabled() || wakeup.paused || wakeup.state !== "PENDING") return;
    for (const occurrence of this.store.all<BackgroundOccurrenceV1>("backgroundOccurrence").filter(item => item.wakeupId === wakeup.wakeupId && item.state === "PENDING" && item.dispatch === "NOT_DISPATCHED")) {
      const delivery = this.claimOccurrence(wakeup.wakeupId, occurrence.occurrenceKey, {
        scheduledDueAtMs: occurrence.scheduledDueAtMs, hostEventId: occurrence.hostEventId,
        ...(wakeup.trigger.kind === "INTERVAL_UTC" ? { intervalAnchor: wakeup.trigger } : {}),
      });
      if (delivery) this.dispatch(delivery);
    }
  }

  /** Auto-resume only wakeups parked for a specific reason (for example a
   * human wait that has now been answered); operator-paused schedules keep
   * their pause, and otherwise-blocked schedules stay untouched. */
  resumeBlockedForWork(taskId: string, blockedReason: string): void {
    const resumed = this.store.internal("background.wakeups.resumedForWork", taskId, () => {
      const out: WakeupRecord[] = [];
      for (const wakeup of this.store.all<WakeupRecord>("backgroundWakeup")) {
        if (wakeup.taskId !== taskId || wakeup.state !== "BLOCKED" || wakeup.blockedReason !== blockedReason) continue;
        out.push(this.resumeRecord(wakeup, false));
      }
      return out;
    }) as WakeupRecord[];
    for (const wakeup of resumed) this.deliverHeld(wakeup);
  }
  cancel(command: HostCommand, wakeupId: string): WakeupRecord {
    return this.store.command(command, () => this.cancelRecord(wakeupId)).result as WakeupRecord;
  }
  cancelRecord(wakeupId: string): WakeupRecord {
    const wakeup = this.requireWakeup(wakeupId);
    const stamp = this.now();
    for (const occurrence of this.store.all<BackgroundOccurrenceV1>("backgroundOccurrence").filter(item => item.wakeupId === wakeupId)) {
      if (occurrence.state === "CLAIMED" && occurrence.dispatch === "NOT_DISPATCHED")
        this.store.put("backgroundOccurrence", occurrence.occurrenceKey, null, { ...occurrence, state: "CANCELLED", leaseExpiresAtMs: null, updatedAt: iso(stamp) });
    }
    const next: WakeupRecord = { ...wakeup, state: "CANCELLED", paused: true, nextDueAtMs: null, leaseExpiresAtMs: null, occurrenceKey: null, updatedAt: iso(stamp) };
    this.store.put("backgroundWakeup", wakeupId, null, next);
    return next;
  }

  private requireWakeup(wakeupId: string): WakeupRecord {
    const wakeup = this.store.get<WakeupRecord>("backgroundWakeup", wakeupId);
    if (!wakeup) throw new HarnessError("NOT_FOUND", "Wakeup unavailable.");
    return wakeup;
  }

  /** S12 shutdown: no new admission, cancel eligible work, bounded wait for
   * owned dispatch, record uncertainty. Never settles on disappearance. */
  async drain(boundedMs: number = BACKGROUND_SCHEDULER_LIMITS.shutdownDrainMs): Promise<{ cancelled: number; uncertain: number }> {
    this.draining = true;
    this.stop();
    let cancelled = 0;
    this.store.internal("background.wakeups.draining", null, () => {
      const stamp = this.now();
      for (const occurrence of this.store.all<BackgroundOccurrenceV1>("backgroundOccurrence")) {
        if (occurrence.state === "CLAIMED" && occurrence.dispatch === "NOT_DISPATCHED") {
          this.store.put("backgroundOccurrence", occurrence.occurrenceKey, null, { ...occurrence, state: "CANCELLED", leaseExpiresAtMs: null, updatedAt: iso(stamp) });
          cancelled++;
        }
      }
    });
    const waiters = [...this.inFlight.values()].map(owner => owner.promise);
    let uncertain = 0;
    await waitForBackgroundDrain(Promise.allSettled(waiters), boundedMs);
    this.store.internal("background.wakeups.drained", null, () => {
      const stamp = this.now();
      for (const [key] of this.inFlight) {
        const occurrence = this.store.get<BackgroundOccurrenceV1>("backgroundOccurrence", key);
        if (occurrence && occurrence.state === "CLAIMED") {
          this.store.put("backgroundOccurrence", key, null, { ...occurrence, state: "UNKNOWN", leaseExpiresAtMs: null, updatedAt: iso(stamp) });
          uncertain++;
        }
      }
    });
    return { cancelled, uncertain };
  }

  get busy(): boolean { return this.inFlight.size > 0; }
  /** Display read: bounded to the UI schema cap. Lifecycle code must use
   * allSchedules() — a capped list can never drive pause or cancel. */
  schedules(): WakeupRecord[] {
    return this.store.all<WakeupRecord>("backgroundWakeup")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  }
  /** Unbounded inventory for lifecycle operations (pauseAll, cancelWork). */
  allSchedules(): WakeupRecord[] { return this.store.all<WakeupRecord>("backgroundWakeup"); }
  occurrences(wakeupId?: string): BackgroundOccurrenceV1[] {
    return this.store.all<BackgroundOccurrenceV1>("backgroundOccurrence").filter(item => wakeupId === undefined || item.wakeupId === wakeupId);
  }
}
