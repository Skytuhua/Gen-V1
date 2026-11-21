import { z } from 'zod';
import { Sha256Hex } from './hashing.ts';

const boundedText = (bytes: number) => z.string().min(1).max(bytes)
  .refine(value => new TextEncoder().encode(value).byteLength <= bytes);
const digest = Sha256Hex;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const NATIVE_COMPACTION_CAPABILITY = Object.freeze({
  apiVersion: 1, strategy: 'EXACT_PROTECTED_RECORDS', commitBoundary: 'NATIVE_IN_MEMORY_COMMIT',
} as const);

export const AUTOMATIC_COMPACTION_CAPABILITY = Object.freeze({
  apiVersion: 1, strategy: 'REFUSE_UNPROTECTED_FOREGROUND',
} as const);
/** Private host policy, separate from a manual protected-compaction plan. */
export const automaticCompactionRequirementSchema = z.strictObject({apiVersion: z.literal(1), required: z.literal(true)});
export type AutomaticCompactionRequirementV1 = z.infer<typeof automaticCompactionRequirementSchema>;
export const automaticCompactionRefusalSchema = z.strictObject({
  version: z.literal(1), status: z.literal('REFUSED'),
  reason: z.enum(['AUTOMATIC_PROTECTION_UNAVAILABLE', 'HOST_REVOKED']),
  method: z.enum(['compress', 'prune', 'micro']), trigger: boundedText(80).nullable(),
  owner: z.strictObject({
    ctx: z.strictObject({threadId: boundedText(200), runId: boundedText(200), epoch: count}),
    sessionPath: boundedText(32768), modelId: boundedText(200), accountId: boundedText(200).nullable(),
  }),
});

const nativeCompactionOwnerSchema = z.strictObject({
  threadId: boundedText(1024), runId: boundedText(1024), epoch: count,
  workspaceId: boundedText(1024), modelId: boundedText(1024), accountId: boundedText(1024).nullable(),
  generation: count, instructionDigest: digest, toolRegistryDigest: digest,
});
const reference = { id: boundedText(1024), revision: count, digest };
export const nativeCompactionReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('DECISION'), ...reference, content: boundedText(4096) }),
  z.strictObject({ kind: z.literal('PENDING_APPROVAL'), ...reference }),
  z.strictObject({ kind: z.literal('ACTIVE_WORK'), ...reference }),
  z.strictObject({ kind: z.literal('SOURCE_EVIDENCE'), ...reference, revision: z.union([count, boundedText(200)]) }),
]);
export const nativeCompactionPlanSchema = z.strictObject({
  version: z.literal(1), candidateId: boundedText(1024), owner: nativeCompactionOwnerSchema,
  sourceSha256: digest,
  retainedIndices: z.array(count.max(4095)).max(4096)
    .refine(indices => indices.every((value, index) => index === 0 || value > indices[index - 1])),
  references: z.array(nativeCompactionReferenceSchema).max(64)
    .refine(refs => new Set(refs.map(ref => JSON.stringify([ref.kind, ref.id]))).size === refs.length),
  maxRetainedBytes: z.literal(65536),
});
export const nativeCompactionEnvelopeSchema = z.strictObject({
  plan: nativeCompactionPlanSchema, planDigest: digest,
});
export const nativeCompactionCommitSchema = z.strictObject({
  version: z.literal(1), candidateId: boundedText(1024), planDigest: digest, sourceSha256: digest,
});
export const nativeCompactionAckSchema = z.strictObject({
  version: z.literal(1), accepted: z.literal(true), planDigest: digest,
});
export const nativeCompactionReceiptSchema = z.strictObject({
  version: z.literal(1), candidateId: boundedText(1024), planDigest: digest, sourceSha256: digest,
  status: z.enum(['APPLIED', 'REFUSED']),
  archiveRef: boundedText(128).nullable(), archiveSha256: digest.nullable(),
  retainedBytes: count.max(65536), protectedRecords: count.max(4096),
  referenceCount: count.max(64), toolPairs: count.max(4096),
  beforeBytes: count, afterBytes: count.nullable(), summarySha256: digest.nullable(),
  reason: z.enum(['HOST_REVOKED', 'PROTECTION_LIMIT', 'SOURCE_MISMATCH', 'MALFORMED_TOOL_PAIRS',
    'UNSUPPORTED_NATIVE', 'ARCHIVE_FAILED', 'RETENTION_LOST', 'NO_REDUCTION', 'NATIVE_REFUSED']).nullable(),
});

export type NativeCompactionOwnerV1 = z.infer<typeof nativeCompactionOwnerSchema>;
export type NativeCompactionReferenceV1 = z.infer<typeof nativeCompactionReferenceSchema>;
export type NativeCompactionPlanV1 = z.infer<typeof nativeCompactionPlanSchema>;
export type NativeCompactionEnvelopeV1 = z.infer<typeof nativeCompactionEnvelopeSchema>;
type NativeCompactionCommitV1 = z.infer<typeof nativeCompactionCommitSchema>;
export type NativeCompactionAckV1 = z.infer<typeof nativeCompactionAckSchema>;
export type NativeCompactionReceiptV1 = z.infer<typeof nativeCompactionReceiptSchema>;

/** Private host admission. Source references never grant permission.
 * The host check is synchronous after the runtime's final asynchronous source read. */
export type NativeCompactionAdmissionV1 = NativeCompactionCommitV1 & {
  readonly owner: NativeCompactionOwnerV1;
};
