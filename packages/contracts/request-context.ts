import { z } from 'zod';

/** Observed request metadata. A content reference is not a grant or the native transcript. */
export type ContextCategory = 'SYSTEM' | 'INSTRUCTION' | 'MEMORY' | 'USER' | 'TOOL' | 'REFERENCE';
export type ContextMeasurement = 'PROVIDER' | 'TOKENIZER' | 'BYTE_ONLY';
export interface RequestContextSegmentV1 {
  readonly category: ContextCategory;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly utf8Bytes: number;
  readonly tokens: number | null;
  readonly measurement: ContextMeasurement;
  readonly inclusionReason: string;
  readonly contentRef: string | null;
}
export interface RequestContextOwnerV1 { readonly threadId: string; readonly workspaceId: string }
export interface RequestContextModelV1 { readonly modelId: string; readonly accountId: string | null }
/** Host-only request admission. No source text, grant or renderer input is accepted here. */
export interface InferenceAdmissionV1 {
  readonly ctx: { readonly threadId: string; readonly runId: string; readonly epoch: number };
  readonly modelId: string;
  readonly accountId: string | null;
  readonly thinkingLevel: string | null;
  readonly sequence: number;
  readonly inputIds: readonly string[];
}
export interface RequestContextV1 {
  readonly requestId: string;
  readonly owner: RequestContextOwnerV1;
  readonly contextGeneration: number;
  readonly sourceCut: { readonly sequence: number | null; readonly revisionDigest: string };
  readonly modelBinding: RequestContextModelV1;
  readonly instructionDigest: string;
  readonly toolRegistryDigest: string;
  readonly segments: readonly RequestContextSegmentV1[];
  readonly budget: { readonly utf8Bytes: number; readonly tokens: number | null; readonly measurement: ContextMeasurement };
  readonly nativeContext: { readonly visibility: 'OPAQUE_NATIVE_CONTEXT'; readonly totalBytes: number | null } | null;
}

/** Private host metadata. Delivery to a caller still requires current authorization. */
export interface ContextResultOwnerV1 extends RequestContextOwnerV1 { readonly accountId: string | null }
export interface ToolResultHandleV1 {
  readonly handle: string;
  readonly owner: ContextResultOwnerV1;
  readonly sourceInvocationId: string;
  readonly digest: string;
  readonly bytes: number;
  readonly mediaType: string;
  readonly expiresAtMs: number;
  readonly operation: 'read-result-range';
}

export interface CompactionBindingV1 {
  readonly generation: number;
  readonly modelId: string;
  readonly accountId: string | null;
  readonly workspaceId: string;
  readonly instructionDigest: string;
  readonly toolRegistryDigest: string;
  readonly sourceCut: string;
}
export interface CompactionCandidateV1 {
  readonly binding: CompactionBindingV1;
  readonly retained: readonly string[];
  readonly toolPairs: readonly { readonly call: string; readonly result: string }[];
  readonly status: 'PREPARING' | 'READY' | 'DISCARDED' | 'APPLIED' | 'FAILED';
}

/** Strict host sidecar for a compaction candidate; never merged into CompactionCandidateV1.
 * Referenced artifacts and observations still require their normal owner checks. */
export interface CompactionMetadataV1 {
  readonly version: 1;
  readonly candidateId: string;
  readonly binding: CompactionBindingV1;
  readonly summaryRef: string | null;
  readonly sourceInterval: { readonly firstSeq: number; readonly lastSeq: number } | null;
  readonly usageObservationRef: string | null;
}

/** Public counts at the admitted broker boundary; never the provider's actual context. */
export interface ContextRelevanceObservationV1 {
  readonly cutId: string;
  readonly observedAtSequence: number;
  readonly candidateIds: readonly string[];
  readonly estimatedSavingsBytes: number;
  readonly inspectionBudgetBytes: number;
  readonly inspectedResults: number;
  readonly protectedResults: number;
  readonly omittedResults: number;
  readonly source: 'HOST_READ_RESULTS';
  readonly measurement: 'BYTE_ONLY';
}

/** Public instruction provenance; contents remain in the admitted native input. */
export interface ProjectInstructionsManifestV1 {
  readonly entries: readonly { readonly filename: string; readonly resourceId: string; readonly scope: string; readonly precedence: number; readonly digest: string; readonly utf8Bytes: number }[];
  readonly duplicates: readonly { readonly path: string; readonly retainedPath: string }[];
  readonly overlaps: readonly { readonly scope: string; readonly filenames: readonly string[] }[];
  readonly exclusions: readonly { readonly filename: string; readonly resourceId: string; readonly reason: 'UNAVAILABLE_SOURCE' | 'UNAVAILABLE_CUSTODY' | 'DENIED_SOURCE' | 'UNSUPPORTED_DIRECTIVE' | 'SOURCE_TOO_LARGE' | 'SOURCE_NOT_TEXT' | 'BYTE_BUDGET' }[];
  readonly omittedRoots: number;
  readonly precedence: string;
}

/** Host-only input prepared under current resource custody. It conveys no grant. */
export interface ApprovedProjectContextV1 {
  readonly version: 1;
  readonly owner: { readonly threadId: string; readonly runId: string; readonly epoch: number; readonly modelId: string; readonly accountId: string | null };
  readonly grantDigest: string;
  readonly instructionText: string;
  readonly instructionDigest: string;
  readonly instructions: ProjectInstructionsManifestV1;
}

/** Native source metadata before ACP flattening. It does not describe provider roles. */
export interface NativeContextProjectionV1 {
  readonly source: 'ORIGINAL_ACP_MESSAGES';
  readonly measurement: 'BYTE_ONLY';
  readonly generation: number;
  readonly revisionDigest: string;
  readonly change: 'RESET' | 'APPEND' | 'UNCHANGED';
  readonly sourceCount: number;
  readonly sourceBytes: number;
  readonly reusedSources: number;
  readonly compiledSources: number;
  readonly inspectedSources: number;
  readonly newToolResults: number | null;
  readonly newToolResultBytes: number | null;
  readonly sources: readonly { readonly category: ContextCategory; readonly sourceId: string; readonly sourceRevision: number; readonly utf8Bytes: number; readonly sha256: string }[];
  readonly omittedSources: number;
}

const nativeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const nativeContextProjectionSchema = z.strictObject({ source: z.literal('ORIGINAL_ACP_MESSAGES'), measurement: z.literal('BYTE_ONLY'), generation: nativeCount.min(1),
  revisionDigest: z.string().regex(/^[a-f0-9]{64}$/), change: z.enum(['RESET', 'APPEND', 'UNCHANGED']), sourceCount: nativeCount.max(4096), sourceBytes: nativeCount.max(32 * 1024 * 1024),
  reusedSources: nativeCount.max(4096), compiledSources: nativeCount.max(4096), inspectedSources: nativeCount.max(4096), newToolResults: nativeCount.max(4096).nullable(), newToolResultBytes: nativeCount.max(32 * 1024 * 1024).nullable(),
  sources: z.array(z.strictObject({ category: z.enum(['SYSTEM', 'INSTRUCTION', 'MEMORY', 'USER', 'TOOL', 'REFERENCE']), sourceId: z.string().regex(/^native:[1-9][0-9]*:[0-9]+$/).max(100), sourceRevision: z.literal(1), utf8Bytes: nativeCount.max(32 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(32),
  omittedSources: nativeCount.max(4096) }).refine(value => value.sources.length + value.omittedSources === value.sourceCount && value.inspectedSources === value.sourceCount && value.reusedSources + value.compiledSources === value.sourceCount &&
    value.sources.every((source, index) => source.sourceId === `native:${value.generation}:${index}`) && value.sources.reduce((sum, source) => sum + source.utf8Bytes, 0) <= value.sourceBytes,
  'Native source projection does not match its bounded cut');

export interface ContextRequestObservationV1 {
  readonly threadId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly promptBytes: number;
  readonly knownInputs: number;
  readonly visibility: 'OPAQUE_NATIVE_CONTEXT';
  readonly source: 'hermes';
  readonly toolSnapshot?: { readonly count: number; readonly schemaBytes: number; readonly digest: string };
  readonly relevance?: ContextRelevanceObservationV1;
  readonly nativeSources?: NativeContextProjectionV1;
  readonly nativeSourcesUnavailable?: 'SOURCE_LIMIT' | 'UNSUPPORTED_SOURCE' | 'UNSUPPORTED_ADAPTER';
}

/** Projection of app-owned submission fragments, not native/provider history. */
export interface HostRequestProjectionV1 {
  readonly threadId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly sourceCutDigest: string;
  readonly measurement: 'BYTE_ONLY';
  readonly sources: readonly {
    readonly category: ContextCategory; readonly revision: number; readonly utf8Bytes: number;
    readonly inclusionReason: string | null; readonly tokens: number | null;
    readonly measurement: ContextMeasurement; readonly exclusionReason: string | null;
  }[];
  readonly omittedSources: number;
  readonly projectInstructions?: ProjectInstructionsManifestV1;
}

/** Host projection of the compaction candidate registry into usage; metadata only, never a grant or history change. */
export interface CompactionProjectionV1 {
  readonly version: 1;
  readonly candidates: readonly {
    readonly metadata: CompactionMetadataV1;
    readonly status: CompactionCandidateV1['status'];
    readonly verdict: 'ELIGIBLE' | 'DISCARDED' | 'UNSUPPORTED_COMPACTION' | 'FAILED' | 'APPLIED' | null;
    readonly retainedConstraints: readonly string[];
    readonly toolPairs: number;
    readonly estimatedByteReduction: number | null;
    readonly measuredBeforeBytes: number | null;
    readonly measuredAfterBytes: number | null;
  }[];
  readonly accounting: { readonly attempts: number; readonly failed: number; readonly discarded: number; readonly costBytes: number };
}

/** Host-issued draft custody. Hashes attest a cut; they never authorize access. */
export interface RequestPreparationV1 {
  readonly version: 1;
  readonly requestId: string;
  readonly contextGeneration: number;
  readonly profileId: string;
  readonly threadId: string;
  readonly projectId: string | null;
  readonly workspaceId: string;
  readonly modelId: string;
  readonly accountId: string | null;
  readonly thinkingLevel: string | null;
  readonly promptDigest: string;
  readonly bindingDigest: string;
  readonly grantDigest: string;
  readonly sourceCutDigest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}
