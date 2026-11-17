import { createHash } from 'node:crypto';
import type {
  ContextCategory, RequestContextModelV1, RequestContextOwnerV1, RequestContextSegmentV1, RequestContextV1,
} from '../contracts/request-context.ts';

export interface ContextSource {
  readonly sequence: number;
  readonly id: string;
  readonly revision: number;
  readonly category: ContextCategory;
  readonly contentRef?: string | null;
  readonly inclusionReason?: string;
}
export interface ImmutableContextCut {
  readonly owner: RequestContextOwnerV1;
  readonly modelBinding: RequestContextModelV1;
  readonly contextGeneration: number;
  readonly instructionDigest: string;
  readonly toolRegistryDigest: string;
  /** Supplied by the host. Without it, external references are never reused. */
  readonly grantDigest?: string;
  readonly sources: readonly ContextSource[];
  readonly opaqueNativeBytes?: number | null;
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const measuredCount = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Expected a nonnegative exact count');
  return value;
};

export function calculateNextContextBudget(input: {
  observedInputTokens: number; cacheReadSubsetTokens: number;
  newUnreportedToolTokens: number; reservedOutputTokens: number;
  turnNeedsAnotherRequest: boolean; contextWindowTokens?: number;
}): { requiredTokens: number; shouldConsiderCompaction: boolean };
export function calculateNextContextBudget(input: {
  observedInputTokens: number | null; cacheReadSubsetTokens: number | null;
  newUnreportedToolTokens: number | null; reservedOutputTokens: number | null;
  turnNeedsAnotherRequest: boolean; contextWindowTokens?: number | null;
}): { requiredTokens: number | null; shouldConsiderCompaction: boolean | null };
export function calculateNextContextBudget(input: {
  observedInputTokens: number | null; cacheReadSubsetTokens: number | null;
  newUnreportedToolTokens: number | null; reservedOutputTokens: number | null;
  turnNeedsAnotherRequest: boolean; contextWindowTokens?: number | null;
}): { requiredTokens: number | null; shouldConsiderCompaction: boolean | null } {
  const count = (value: number | null) => value === null ? null : measuredCount(value);
  const observed = count(input.observedInputTokens), cached = count(input.cacheReadSubsetTokens), tools = count(input.newUnreportedToolTokens), reserve = count(input.reservedOutputTokens);
  if (observed !== null && cached !== null && cached > observed) throw new RangeError('Cached input must be a subset of measured input');
  const requiredTokens = observed === null || tools === null || reserve === null ? null : measuredCount(observed + tools + reserve);
  const window = input.contextWindowTokens === undefined ? undefined : count(input.contextWindowTokens);
  const overBudget = window === undefined ? false : requiredTokens === null || window === null ? null : requiredTokens > window;
  return { requiredTokens, shouldConsiderCompaction: input.turnNeedsAnotherRequest && overBudget };
}

/** No I/O except the supplied host reader. Does not build native role messages or cache content. */
export function createContextCompiler(options: {
  readSource: (source: ContextSource) => string;
  tokenize?: (text: string) => number;
  readSourceBytes?: never;
} | {
  /** Exact bytes measured by an owned source boundary; never fabricated text. */
  readSourceBytes: (source: ContextSource) => number;
  readSource?: never;
  tokenize?: never;
}) {
  type Entry = { sourceKeys: readonly string[]; segments: readonly RequestContextSegmentV1[] };
  const cache = new Map<string, Entry>();
  const maxScopes = 8, maxSources = 4096;
  return {
    compile(input: ImmutableContextCut): RequestContextV1 {
      const { owner, modelBinding, contextGeneration, instructionDigest, toolRegistryDigest, grantDigest } = input;
      const sources = input.sources.map(source => ({ ...source }));
      if (sources.length > maxSources) throw new RangeError('Context source cut exceeds the supported size');
      measuredCount(contextGeneration);
      const ids = new Set<string>();
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index]!;
        if (!source.id || ids.has(source.id) || !Number.isSafeInteger(source.sequence) || (index > 0 && source.sequence <= sources[index - 1]!.sequence))
          throw new Error('Context cut must have unique, strictly ordered sources');
        measuredCount(source.revision);
        ids.add(source.id);
      }
      const scope = hash([owner.threadId, owner.workspaceId, modelBinding.modelId, modelBinding.accountId, contextGeneration, instructionDigest, toolRegistryDigest, grantDigest ?? null]);
      const sourceKeys = sources.map(source => hash([source.id, source.revision, source.sequence, source.category, source.contentRef ?? null, source.inclusionReason ?? null]));
      const canReuse = Boolean(grantDigest) || !sources.some(source => source.category === 'REFERENCE' || source.contentRef != null);
      const previous = canReuse ? cache.get(scope) : undefined;
      const append = previous !== undefined && previous.sourceKeys.length <= sourceKeys.length &&
        previous.sourceKeys.every((key, index) => key === sourceKeys[index]);
      const segments: RequestContextSegmentV1[] = append ? [...previous.segments] : [];
      for (const source of sources.slice(segments.length)) {
        const text = options.readSource?.(source);
        const utf8Bytes = options.readSourceBytes ? measuredCount(options.readSourceBytes(source)) : Buffer.byteLength(text!);
        const tokens = options.tokenize ? measuredCount(options.tokenize(text!)) : null;
        segments.push(Object.freeze({
          category: source.category, sourceId: source.id, sourceRevision: source.revision, utf8Bytes,
          tokens, measurement: tokens === null ? 'BYTE_ONLY' : 'TOKENIZER', inclusionReason: source.inclusionReason ?? 'selected by host',
          contentRef: source.contentRef ?? null,
        }));
      }
      if (canReuse) {
        cache.delete(scope);
        cache.set(scope, { sourceKeys, segments: Object.freeze(segments.slice()) });
        if (cache.size > maxScopes) cache.delete(cache.keys().next().value!);
      }
      const revisionDigest = hash(sourceKeys);
      const totalBytes = input.opaqueNativeBytes == null ? null : measuredCount(input.opaqueNativeBytes);
      return {
        requestId: hash([scope, revisionDigest, input.opaqueNativeBytes !== undefined, totalBytes]),
        owner: { threadId: owner.threadId, workspaceId: owner.workspaceId }, contextGeneration,
        sourceCut: { sequence: sources.at(-1)?.sequence ?? null, revisionDigest },
        modelBinding: { modelId: modelBinding.modelId, accountId: modelBinding.accountId }, instructionDigest, toolRegistryDigest,
        segments, budget: {
          utf8Bytes: segments.reduce((total, segment) => total + segment.utf8Bytes, 0),
          tokens: options.tokenize ? segments.reduce((total, segment) => total + segment.tokens!, 0) : null,
          measurement: options.tokenize ? 'TOKENIZER' : 'BYTE_ONLY',
        },
        nativeContext: input.opaqueNativeBytes === undefined ? null : { visibility: 'OPAQUE_NATIVE_CONTEXT', totalBytes },
      };
    },
  };
}
