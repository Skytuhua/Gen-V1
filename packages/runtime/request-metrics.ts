import type {
  ModelRequestObservationV1,
  ModelRequestOutcomeV1,
  ModelRequestTimingsV1,
  ModelRequestUsageV1,
} from '../contracts/model-request.ts';

export const MODEL_REQUEST_STAGES = [
  'acquired',
  'runtimeReady',
  'requestSent',
  'firstProviderDelta',
  'firstPublicDelta',
  'settled',
  'teardownConfirmed',
] as const;
export type ModelRequestStage = (typeof MODEL_REQUEST_STAGES)[number];

const STAGE_SET = new Set<string>(MODEL_REQUEST_STAGES);

/**
 * Records one owned model request: a stable request id, the owner/binding it
 * was admitted under and monotonic elapsed timings per stage. `queued` is the
 * epoch-ms admission point; each stage is an elapsed-ms offset from it on the
 * injected monotonic clock (never wall time). Stages that never complete stay
 * null — absent does not mean zero.
 */
export class RequestMetrics {
  private readonly start: number;
  private readonly timings: ModelRequestTimingsV1 = {
    queued: 0,
    acquired: null,
    runtimeReady: null,
    requestSent: null,
    firstProviderDelta: null,
    firstPublicDelta: null,
    settled: null,
    teardownConfirmed: null,
  };
  private done = false;

  constructor(
    private readonly observation: Omit<ModelRequestObservationV1, 'timings' | 'usage' | 'outcome' | 'usageConvention' | 'error'>,
    private readonly now: () => number = () => performance.now(),
    queuedAt: number = Date.now(),
  ) {
    this.start = now();
    this.timings.queued = queuedAt;
  }

  private elapsed(): number {
    return Math.max(0, this.now() - this.start);
  }

  /** Mark a stage; first write wins so a repeated signal cannot backdate it. */
  mark(stage: ModelRequestStage): number | null {
    if (!STAGE_SET.has(stage)) return null;
    // A buffered transport publishes after teardown is confirmed: the
    // observation is already finished when the response is actually sent, so
    // firstPublicDelta may still be stamped late. It can never be backdated.
    if (this.done) {
      if (stage !== 'firstPublicDelta') return null;
      if (this.timings.firstPublicDelta === null) {
        this.timings.firstPublicDelta = this.elapsed();
        if (this.snapshot) this.snapshot.timings.firstPublicDelta = this.timings.firstPublicDelta;
      }
      return this.timings.firstPublicDelta;
    }
    if (this.timings[stage] === null) this.timings[stage] = this.elapsed();
    return this.timings[stage];
  }

  /**
   * Complete the observation exactly once. `usage` may be partially reported;
   * `usageConvention` is 'provider-reported' only when the provider supplied a
   * usage record at all — every field inside it may still be null.
   */
  finish(outcome: ModelRequestOutcomeV1, usage: ModelRequestUsageV1 | null, error?: string): ModelRequestObservationV1 {
    if (this.done) return this.snapshot;
    this.done = true;
    // teardownConfirmed is only stamped by an explicit mark after a successful
    // teardown; an absent mark means the teardown was never confirmed.
    const result: ModelRequestObservationV1 = {
      ...this.observation,
      timings: { ...this.timings },
      usage: usage ?? { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null },
      usageConvention: usage ? 'provider-reported' : 'unreported',
      outcome,
      ...(error ? { error: error.slice(0, 500) } : {}),
    };
    this.snapshot = result;
    return result;
  }

  private snapshot!: ModelRequestObservationV1;

  /** The finished observation, including any late firstPublicDelta stamp. */
  get result(): ModelRequestObservationV1 | null {
    return this.snapshot ?? null;
  }

  get finished(): boolean {
    return this.done;
  }

  get requestId(): string {
    return this.observation.requestId;
  }
}

/** Bounded private diagnostics buffer; publication is a separate decision. */
export class RequestMetricsLog {
  private readonly entries: ModelRequestObservationV1[] = [];
  constructor(private readonly limit = 256) {}
  record(observation: ModelRequestObservationV1): void {
    this.entries.push(observation);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }
  list(): readonly ModelRequestObservationV1[] {
    return this.entries;
  }
}
