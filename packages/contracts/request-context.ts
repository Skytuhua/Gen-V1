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
}

/** Projection of app-owned submission fragments, not native/provider history. */
export interface HostRequestProjectionV1 {
  readonly threadId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly sourceCutDigest: string;
  readonly measurement: 'BYTE_ONLY';
  readonly sources: readonly { readonly category: ContextCategory; readonly revision: number; readonly utf8Bytes: number }[];
  readonly omittedSources: number;
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
