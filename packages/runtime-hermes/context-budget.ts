import type { RuntimeUsage } from '../contracts/index.ts';
import { inferenceBudgetSchema, type ContextInferenceBudgetV1 } from '../contracts/request-context.ts';
import { calculateNextContextBudget } from '../core/context-compiler.ts';
import { MODEL_ONLY_MAX_PROMPT_BYTES } from '../runtime/model-only.ts';
import type { ModelRequest } from './broker.ts';

export interface InferenceBudgetAnchor {
  scope: string | null; requestId: string; sequence: number;
  source: { generation: number; digest: string; bytes: number } | null;
  usage: Omit<NonNullable<ContextInferenceBudgetV1['previousRequest']>, 'requestId' | 'sequence'>;
}
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Bounded measured metadata only. No tokenizer, output reserve or provider
 * input convention is inferred from source bytes or an SDK context estimate. */
export function createInferenceBudgetLedger(scope: string | null, initial?: InferenceBudgetAnchor) {
  let previous = scope && initial?.scope === scope ? structuredClone(initial) : undefined;
  return {
    preview(request: ModelRequest, promptBytes: number): ContextInferenceBudgetV1 {
      const native = request.nativeContext, source = native?.projection;
      const linked = Boolean(scope && previous?.source && source && source.change !== 'RESET' && source.generation === previous.source.generation &&
        native!.previousDigest === previous.source.digest && source.sourceBytes >= previous.source.bytes && source.newToolResultBytes !== null && source.newToolResults !== null);
      const newToolResultBytes = linked ? source!.newToolResultBytes : null, newUnreportedToolTokens = newToolResultBytes === 0 ? 0 : null;
      const calculation = calculateNextContextBudget({ observedInputTokens: null, cacheReadSubsetTokens: null, newUnreportedToolTokens, reservedOutputTokens: null,
        contextWindowTokens: previous?.usage.contextWindowTokens ?? null, turnNeedsAnotherRequest: true });
      const unknown: ContextInferenceBudgetV1['unknown'] = ['NORMALIZED_INPUT', 'OUTPUT_RESERVE'];
      if (!linked || source!.sourceBytes !== previous!.source!.bytes) unknown.push('TOKENIZER');
      if (previous?.usage.contextWindowTokens == null) unknown.push('CONTEXT_WINDOW');
      if (!linked) unknown.push('SOURCE_CONTINUITY');
      return inferenceBudgetSchema.parse({ version: 1, sequence: request.sequence, promptBytes, maxPromptBytes: MODEL_ONLY_MAX_PROMPT_BYTES, measurement: 'BYTE_ONLY',
        byteAdmission: promptBytes > MODEL_ONLY_MAX_PROMPT_BYTES ? 'BLOCKED' : 'WITHIN_LIMIT', tokenAdmission: 'UNAVAILABLE', sourceContinuity: linked ? 'VERIFIED' : 'UNAVAILABLE',
        newSourceBytes: linked ? source!.sourceBytes - previous!.source!.bytes : null, newToolResultBytes, newToolResults: linked ? source!.newToolResults : null,
        previousRequest: previous ? { requestId: previous.requestId, sequence: previous.sequence, ...previous.usage } : null,
        normalizedInputTokens: null, newUnreportedToolTokens, reservedOutputTokens: null, requiredTokens: calculation.requiredTokens,
        shouldConsiderCompaction: calculation.shouldConsiderCompaction, unknown });
    },
    record(request: ModelRequest, requestId: string, usage: RuntimeUsage | null, outcome: 'completed' | 'failed' | 'cancelled'): void {
      if (request.phase !== 'foreground') return;
      if (outcome !== 'completed') { previous = undefined; return; }
      const source = request.nativeContext?.projection;
      const measured = { inputTokens: count(usage?.inputTokens), outputTokens: count(usage?.outputTokens), cacheReadTokens: count(usage?.cacheReadTokens), cacheWriteTokens: count(usage?.cacheWriteTokens) };
      previous = { scope, requestId, sequence: request.sequence, source: source ? { generation: source.generation, digest: source.revisionDigest, bytes: source.sourceBytes } : null,
        usage: { ...measured, reportedContextTokens: count(usage?.contextTokens), contextWindowTokens: count(usage?.contextWindow), contextMeasurement: 'UNSPECIFIED',
          usageConvention: Object.values(measured).some(value => value !== null) ? 'provider-reported' : 'unreported' } };
    },
    anchor(): InferenceBudgetAnchor | undefined { return previous ? structuredClone(previous) : undefined; },
  };
}
