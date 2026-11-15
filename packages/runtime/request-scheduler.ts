import { HarnessError } from '../contracts/index.ts';
import type { ModelRequestBudgetV1, ModelRequestPhaseV1, WarmTransportKey } from '../contracts/model-request.ts';
import { warmTransportKeyId } from '../contracts/model-request.ts';

export type RequestClass = 'foreground' | 'background';
export const requestClassFor = (phase: ModelRequestPhaseV1): RequestClass =>
  phase === 'foreground' ? 'foreground' : 'background';

export interface ModelPermit {
  release(): void;
  /** Milliseconds this request waited for a permit. */
  queuedMs: number;
  requestClass: RequestClass;
}

export interface RequestAdmission {
  requestClass?: RequestClass;
  /** Queue age after which a background waiter counts as foreground. */
  agingMs?: number;
  now?: () => number;
}

/**
 * Capacity scheduling with foreground/background class metadata. The
 * per-account concurrency limit is unchanged: a permit owns one actual model
 * request including its confirmed teardown, and a foreground request may pass
 * queued idle work but can never steal an active permit. Bounded aging promotes
 * a background waiter that has waited `agingMs`, so idle work cannot starve.
 * Queue delays are recorded in a bounded ring for request observations.
 */
export class RequestScheduler {
  private readonly lanes = new Map<string, Lane>();
  private readonly delayRing: number[] = [];
  constructor(private readonly limit = 2, private readonly agingMs = 5_000, private readonly delayBound = 256) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Capacity must be positive');
    if (!(agingMs > 0)) throw new Error('Aging bound must be positive');
  }

  acquire(providerId: string, accountId: string | null, signal?: AbortSignal, meta: RequestAdmission = {}): Promise<ModelPermit> {
    const now = meta.now ?? (() => Date.now());
    if (signal?.aborted) return Promise.reject(new HarnessError('MODEL_REQUEST_CANCELLED', 'The queued model request was cancelled.'));
    const key = JSON.stringify([providerId, accountId]);
    const lane = this.lanes.get(key) ?? { active: 0, queue: [] };
    this.lanes.set(key, lane);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject, requestClass: meta.requestClass ?? 'foreground', enqueuedAt: now(), agingMs: meta.agingMs ?? this.agingMs };
      waiter.abort = () => {
        const index = lane.queue.indexOf(waiter);
        if (index < 0) return;
        lane.queue.splice(index, 1);
        reject(new HarnessError('MODEL_REQUEST_CANCELLED', 'The queued model request was cancelled.'));
        this.drain(key, lane, now);
      };
      lane.queue.push(waiter);
      signal?.addEventListener('abort', waiter.abort, { once: true });
      this.drain(key, lane, now);
    });
  }

  private rank(waiter: Waiter, now: number): number {
    // A background waiter that has already waited the aging bound is promoted:
    // it keeps its queue position by enqueue time but cannot be passed again.
    return waiter.requestClass === 'background' && now - waiter.enqueuedAt < waiter.agingMs ? 1 : 0;
  }

  private drain(key: string, lane: Lane, now: () => number): void {
    while (lane.active < this.limit && lane.queue.length) {
      const at = now();
      let next = 0;
      for (let i = 1; i < lane.queue.length; i++)
        if (this.rank(lane.queue[i], at) < this.rank(lane.queue[next], at) ||
            (this.rank(lane.queue[i], at) === this.rank(lane.queue[next], at) && lane.queue[i].enqueuedAt < lane.queue[next].enqueuedAt))
          next = i;
      const waiter = lane.queue.splice(next, 1)[0];
      waiter.signal?.removeEventListener('abort', waiter.abort!);
      lane.active++;
      const queuedMs = Math.max(0, now() - waiter.enqueuedAt);
      this.delayRing.push(queuedMs);
      if (this.delayRing.length > this.delayBound) this.delayRing.shift();
      let released = false;
      waiter.resolve({
        queuedMs,
        requestClass: waiter.requestClass,
        release: () => {
          if (released) return;
          released = true;
          lane.active--;
          this.drain(key, lane, now);
        },
      });
    }
    if (!lane.active && !lane.queue.length && this.lanes.get(key) === lane) this.lanes.delete(key);
  }

  /** Bounded recent queue delays, oldest first. */
  queueDelays(): readonly number[] {
    return this.delayRing;
  }
}

type Waiter = {
  signal?: AbortSignal;
  resolve(permit: ModelPermit): void;
  reject(error: unknown): void;
  abort?: () => void;
  requestClass: RequestClass;
  enqueuedAt: number;
  agingMs: number;
};
type Lane = { active: number; queue: Waiter[] };

export const hermesRequestScheduler = new RequestScheduler(2);

/* ------------------------------------------------------------------ */
/* ModelRequestBudget — pre-dispatch admission plus measured-spend     */
/* reconciliation. Missing monetary pricing permits token/call budgets */
/* only; a breach or a rate-limit/account conflict is a visible error. */
/* ------------------------------------------------------------------ */

export class RequestBudget {
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  constructor(private readonly limits: ModelRequestBudgetV1) {}

  /** Throws before dispatch when a declared call/token budget is exhausted. */
  admit(): void {
    if (this.limits.maxCalls !== undefined && this.calls >= this.limits.maxCalls)
      throw new HarnessError('MODEL_BUDGET_EXCEEDED', 'The model request call budget is exhausted.');
    if (this.limits.maxInputTokens !== undefined && this.inputTokens >= this.limits.maxInputTokens)
      throw new HarnessError('MODEL_BUDGET_EXCEEDED', 'The model input-token budget is exhausted.');
    if (this.limits.maxOutputTokens !== undefined && this.outputTokens >= this.limits.maxOutputTokens)
      throw new HarnessError('MODEL_BUDGET_EXCEEDED', 'The model output-token budget is exhausted.');
  }

  /** Reconcile measured spend; unknown fields never count as spend. */
  reconcile(usage: { inputTokens?: number | null; outputTokens?: number | null } | null): void {
    this.calls++;
    this.inputTokens += usage?.inputTokens ?? 0;
    this.outputTokens += usage?.outputTokens ?? 0;
    if (this.limits.maxInputTokens !== undefined && this.inputTokens > this.limits.maxInputTokens)
      throw new HarnessError('MODEL_BUDGET_EXCEEDED', 'The model input-token budget is exhausted.');
    if (this.limits.maxOutputTokens !== undefined && this.outputTokens > this.limits.maxOutputTokens)
      throw new HarnessError('MODEL_BUDGET_EXCEEDED', 'The model output-token budget is exhausted.');
  }

  get spent(): { calls: number; inputTokens: number; outputTokens: number } {
    return { calls: this.calls, inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
}

/* ------------------------------------------------------------------ */
/* StatelessTransportPool — the flagged warm-reuse experiment. One idle */
/* transport per approved (provider, account, config, endpoint,         */
/* generation) key; reuse requires the adapter's demonstrated stateless */
/* API and an exact request — never borrowed chat history. Idle         */
/* transports close after 60s; account/config changes invalidate the    */
/* key. OFF by default; adapters without a stateless API never pool.    */
/* ------------------------------------------------------------------ */

export const STATELESS_IDLE_EXPIRY_MS = 60_000;

export interface StatelessTransport {
  /** True only when the adapter demonstrably has no retained conversation state. */
  readonly stateless: true;
  readonly outstanding: number;
  reset(): Promise<void> | void;
  close(): Promise<void> | void;
}

export class StatelessTransportPool {
  private readonly idle = new Map<string, { transport: StatelessTransport; expiresAt: number }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Return an idle transport that exactly matches `key`, or null. The caller
   * must have proven `adapter.stateless` via RequestCapabilitiesV1; pooled
   * transports have owner state cleared between uses.
   */
  async take(key: WarmTransportKey): Promise<StatelessTransport | null> {
    const id = warmTransportKeyId(key);
    const entry = this.idle.get(id);
    if (!entry) return null;
    this.idle.delete(id);
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
    if (this.now() >= entry.expiresAt || entry.transport.outstanding !== 0) {
      await entry.transport.close();
      return null;
    }
    // Owner state is cleared between uses before the transport is handed out.
    await entry.transport.reset();
    return entry.transport;
  }

  /** Return a transport to the idle pool only when it carries no owner work. */
  offer(key: WarmTransportKey, transport: StatelessTransport): boolean {
    if (transport.outstanding !== 0) return false;
    const id = warmTransportKeyId(key);
    if (this.idle.has(id)) return false;
    this.idle.set(id, { transport, expiresAt: this.now() + STATELESS_IDLE_EXPIRY_MS });
    const timer = setTimeout(() => { void this.expire(id); }, STATELESS_IDLE_EXPIRY_MS);
    timer.unref?.();
    this.timers.set(id, timer);
    return true;
  }

  private async expire(id: string): Promise<void> {
    this.timers.delete(id);
    const entry = this.idle.get(id);
    this.idle.delete(id);
    if (entry) await entry.transport.close();
  }

  /** Account or config change: close every transport for the old key. */
  async invalidate(key: WarmTransportKey): Promise<void> {
    await this.expire(warmTransportKeyId(key));
  }

  async close(): Promise<void> {
    for (const id of [...this.idle.keys()]) await this.expire(id);
  }
}

/* ------------------------------------------------------------------ */
/* resolveNewTaskProfile — task-role routing ONLY at the creation of a */
/* new task or explicit new child, against an operator-approved static  */
/* mapping. An unavailable selected model blocks; nothing silently     */
/* rebinds an existing thread.                                          */
/* ------------------------------------------------------------------ */

export function resolveNewTaskProfile(
  role: string,
  mapping: Readonly<Record<string, { providerId: string; accountId: string | null; modelId: string }>>,
  available: readonly string[],
): { providerId: string; accountId: string | null; modelId: string } {
  const profile = mapping[role];
  if (!profile) throw new HarnessError('MODEL_PROFILE_UNKNOWN', `No approved model profile exists for ${role}.`);
  if (!available.includes(profile.modelId))
    throw new HarnessError('MODEL_PROFILE_UNAVAILABLE', `The approved model for ${role} is unavailable; choose a new-task profile explicitly.`);
  return { ...profile };
}
