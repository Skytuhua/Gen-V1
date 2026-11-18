import type { ModelExecutionProfileV1 } from '../contracts/model-request.ts';

type Segment = {
  readonly id: string;
  readonly inputSequence: number;
  readonly bytes: number;
  readonly kind: string;
  readonly completed: boolean;
  readonly protected: boolean;
};
type Observation = { readonly candidateIds: readonly string[]; readonly estimatedSavingsBytes: number };

/**
 * One report per cut over host-supplied metadata only. This observer never
 * consumes an inference slot, opens content, or alters a request.
 */
export function createRelevanceObserver() {
  const seen = new Set<string>();
  return {
    observe(input: { cutId: string; retainedTailStart: number; inspectionBudgetBytes: number; segments: readonly Segment[] }): Observation | null {
      if (!input.cutId || input.cutId.length > 256 || seen.has(input.cutId) || seen.size >= 2048 ||
        !Number.isSafeInteger(input.retainedTailStart) || !Number.isSafeInteger(input.inspectionBudgetBytes) ||
        input.inspectionBudgetBytes < 0 || input.segments.length > 4096) return null;
      seen.add(input.cutId);
      let remaining = input.inspectionBudgetBytes;
      const candidateIds: string[] = [], ids = new Set<string>();
      for (const segment of input.segments) {
        if (!segment.id || segment.id.length > 512 || ids.has(segment.id)) return null;
        ids.add(segment.id);
        if (segment.kind !== 'tool-result' || segment.completed !== true || segment.protected !== false ||
            !Number.isSafeInteger(segment.inputSequence) || segment.inputSequence >= input.retainedTailStart ||
            !Number.isSafeInteger(segment.bytes) || segment.bytes <= 0 || segment.bytes > remaining) continue;
        remaining -= segment.bytes;
        candidateIds.push(segment.id);
      }
      return Object.freeze({ candidateIds: Object.freeze(candidateIds), estimatedSavingsBytes: input.inspectionBudgetBytes - remaining });
    },
  };
}

export const SHADOW_OBSERVER_TIMEOUT_MS = 6000;
type ShadowCut = { cutId: string; retainedTailStart: number; inspectionBudgetBytes: number; segments: readonly Segment[] };
type ShadowObservation = { candidateIds: readonly string[]; estimatedSavingsBytes: number };
type ShadowApproval = { modelId: string; accountId: ModelExecutionProfileV1['allowedProviderAccount']['accountId']; budgetCalls: number };
type ShadowStatus = 'OBSERVER_UNAVAILABLE' | 'COMPLETED' | 'TIMED_OUT' | 'FAILED' | 'CANCELLED';
type ShadowResult = { status: ShadowStatus; observation: ShadowObservation | null };

/** Opt-in shadow phase over one immutable cut. Without an explicit approved model/account and auxiliary
 * budget it returns OBSERVER_UNAVAILABLE and makes no model call. It never alters the foreground request. */
export function createShadowRelevancePhase(options: {
  approval: ShadowApproval | null;
  observe: (cut: ShadowCut) => Promise<ShadowObservation>;
  schedule?: (callback: () => void, ms: number) => unknown;
  unschedule?: (handle: unknown) => void;
}) {
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
  const unschedule = options.unschedule ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let budget = options.approval && Number.isSafeInteger(options.approval.budgetCalls) ? options.approval.budgetCalls : 0;
  const approved = () => {
    const approval = options.approval;
    return Boolean(typeof approval?.modelId === 'string' && approval.modelId.length > 0 && budget > 0 && (approval.accountId === null ||
      typeof approval.accountId === 'string' && approval.accountId.length > 0));
  };
  const seen = new Set<string>();
  let cancelled = false;
  type Pending = { resolve: (result: ShadowResult) => void; timer: unknown };
  let pending: Pending | null = null;
  const settle = (current: Pending, status: ShadowStatus, observation: ShadowObservation | null) => {
    if (pending !== current) return;
    pending = null;
    unschedule(current.timer);
    current.resolve({ status, observation });
  };
  return {
    run(cut: ShadowCut): Promise<ShadowResult> {
      if (!approved() || cancelled || pending || !cut.cutId || cut.cutId.length > 256 || seen.has(cut.cutId))
        return Promise.resolve({ status: 'OBSERVER_UNAVAILABLE', observation: null });
      seen.add(cut.cutId);
      budget--;
      return new Promise(resolve => {
        const current: Pending = { resolve, timer: undefined };
        pending = current;
        current.timer = schedule(() => settle(current, 'TIMED_OUT', null), SHADOW_OBSERVER_TIMEOUT_MS);
        let observation: Promise<ShadowObservation>;
        try { observation = options.observe(cut); } catch { settle(current, 'FAILED', null); return; }
        void observation.then(result => {
          if (result && Array.isArray(result.candidateIds) && Number.isSafeInteger(result.estimatedSavingsBytes))
            settle(current, 'COMPLETED', Object.freeze({ candidateIds: Object.freeze([...result.candidateIds]), estimatedSavingsBytes: result.estimatedSavingsBytes }));
          else settle(current, 'FAILED', null);
        }, () => settle(current, 'FAILED', null));
      });
    },
    cancel() { cancelled = true; if (pending) settle(pending, 'CANCELLED', null); },
  };
}
