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
