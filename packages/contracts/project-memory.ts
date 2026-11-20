import { z } from 'zod';

export const PROJECT_MEMORY_LIMITS = Object.freeze({ textBytes: 2048, recallItems: 8, recallBytes: 4096, foregroundMs: 750, items: 500, sources: 64, sourceBytes: 65536, purgeRetentionMs: 7 * 24 * 60 * 60 * 1000 });
const id = z.string().min(1).max(200).regex(/^[a-zA-Z0-9:_.-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.iso.datetime();
const revision = z.number().int().positive();
export const memoryTextSchema = z.string().max(2048).refine(text => new TextEncoder().encode(text).length <= PROJECT_MEMORY_LIMITS.textBytes, 'Memory text exceeds 2 KiB UTF-8.');
export const memorySourceRefV1Schema = z.strictObject({
  ownerThreadId: id, sourceKind: z.enum(['MESSAGE', 'FILE', 'TASK_NOTE']), sourceId: z.string().min(1).max(1024),
  sourceRevision: z.string().min(1).max(128), capturedSeq: z.number().int().nonnegative(), digest: hash,
  observedStatus: z.enum(['OBSERVED', 'PROPOSED', 'REPORTED', 'UNCERTAIN']),
});
export type MemorySourceRefV1 = z.infer<typeof memorySourceRefV1Schema>;
export const memoryRevisionRefSchema = z.strictObject({ itemId: id, revision });
export type MemoryRevisionRef = z.infer<typeof memoryRevisionRefSchema>;
const memoryReviewDecisionSchema = z.strictObject({ action: z.enum(['ACCEPT', 'EDIT_ACCEPT', 'REJECT', 'EXPIRE', 'RESOLVE', 'FORGET']), userId: id, at: time, note: z.string().max(1000).optional() });
export const memoryItemV1Schema = z.strictObject({
  id, projectIdentity: hash, scope: z.enum(['PROJECT', 'USER_APPROVED']), kind: z.enum(['DECISION', 'CONSTRAINT', 'PROCEDURE', 'FACT', 'PREFERENCE']),
  text: memoryTextSchema, revision, state: z.enum(['PROPOSED', 'ACCEPTED', 'CONFLICT', 'EXPIRED', 'DELETED']),
  sourceRefs: z.array(memorySourceRefV1Schema).min(1).max(8), assertedBy: z.strictObject({ kind: z.enum(['USER', 'AGENT']), id }),
  observedAt: time, expiresAt: time.nullable(), supersedes: z.array(memoryRevisionRefSchema).max(32),
  sensitivity: z.enum(['NORMAL', 'SENSITIVE']), reviewDecision: memoryReviewDecisionSchema.nullable(),
}).refine(item => item.state === 'DELETED' || item.text.trim().length > 0, 'Active memory must contain text.');
export type MemoryItemV1 = z.infer<typeof memoryItemV1Schema>;
export const memoryRecallV1Schema = z.strictObject({
  requestId: id, projectIdentity: hash, contextGeneration: z.number().int().nonnegative(), queryDigest: hash,
  candidateIds: z.array(id).max(PROJECT_MEMORY_LIMITS.items), selectedRevisions: z.array(memoryRevisionRefSchema).max(8),
  scores: z.array(z.strictObject({ itemId: id, revision, projectOverlap: z.number().int().nonnegative(), symbolOverlap: z.number().int().nonnegative(), matchedTerms: z.array(z.string().max(200)).max(32) })).max(PROJECT_MEMORY_LIMITS.items),
  exclusions: z.array(z.strictObject({ itemId: id, reason: z.string().min(1).max(100) })).max(1000),
  budgetBytes: z.number().int().min(0).max(4096), producedAt: time, status: z.enum(['COMPLETE', 'PARTIAL', 'TIMEOUT', 'UNAVAILABLE']),
});
export type MemoryRecallV1 = z.infer<typeof memoryRecallV1Schema>;
export const memoryTombstoneV1Schema = z.strictObject({ itemId: id, deletionRevision: revision, projectIdentity: hash, deletedAt: time,
  sourceExclusions: z.array(memorySourceRefV1Schema).max(256), affectedDerivedArtifacts: z.array(id).max(500), purgeStatus: z.enum(['PENDING', 'COMPLETE']) });
export type MemoryTombstoneV1 = z.infer<typeof memoryTombstoneV1Schema>;

/** Host-owned admission, never accepted from a renderer or model payload. */
export interface MemoryAccess { profileId: string; projectId: string; projectIdentity: string; threadId: string; accountId: string | null; bindingDigest: string }
export interface StoredMemory { item: MemoryItemV1; profileId: string; projectId: string; accountId: string | null; lastUsedAt: string | null }
export interface MemorySourceSnapshot { ref: MemorySourceRefV1; projectIdentity: string; accountId: string | null; content: string; label: string; fileGrant?: { resourceId: string; grantDigest: string } }
export interface MemoryRecallResult { recall: MemoryRecallV1; items: MemoryItemV1[]; injection: string }
export const memoryScopeSchema = z.strictObject({ projectId: id, projectIdentity: hash, threadId: id, accountId: id.nullable(), bindingDigest: hash });
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
const memoryRowSchema = z.strictObject({ item: memoryItemV1Schema, lastUsedAt: time.nullable(), conflictRevisions: z.array(memoryItemV1Schema).max(32) });
export const projectMemoryViewSchema = z.strictObject({
  scope: memoryScopeSchema, projectName: z.string().max(100), available: z.boolean(), disabledReason: z.string().max(1000).nullable(),
  enabled: z.boolean(), configRevision: z.number().int().nonnegative(), sourceThreadIds: z.array(id).max(200),
  eligibleThreads: z.array(z.strictObject({ id, title: z.string().max(1000) })).max(200),
  items: z.array(memoryRowSchema).max(500), tombstones: z.array(memoryTombstoneV1Schema).max(500),
});
export type ProjectMemoryView = z.infer<typeof projectMemoryViewSchema>;
export const memorySourceDetailSchema = z.strictObject({ scope: memoryScopeSchema, ref: memorySourceRefV1Schema, content: z.string().max(65536), label: z.string().max(1024) });
export type MemorySourceDetail = z.infer<typeof memorySourceDetailSchema>;
export const memoryForgetPreviewSchema = z.strictObject({ scope: memoryScopeSchema, itemId: id, revision, affectedDerivedArtifacts: z.array(id).max(500), immediateExclusion: z.literal(true), localPurgeAfter: time, externalDeletion: z.literal('NOT_SUPPORTED') });
export type MemoryForgetPreview = z.infer<typeof memoryForgetPreviewSchema>;
export const memoryActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('configure'), baseRevision: z.number().int().nonnegative(), enabled: z.boolean(), sourceThreadIds: z.array(id).max(200) }),
  z.strictObject({ action: z.literal('accept'), itemId: id, baseRevision: revision }),
  z.strictObject({ action: z.literal('edit'), itemId: id, baseRevision: revision, text: memoryTextSchema, expiresAt: time.nullable().optional() }),
  z.strictObject({ action: z.literal('confirm-preference'), itemId: id, baseRevision: revision, text: memoryTextSchema, expiresAt: time.nullable().optional(), confirmation: z.literal('PROJECT_ONLY') }),
  z.strictObject({ action: z.literal('reject'), itemId: id, baseRevision: revision }),
  z.strictObject({ action: z.literal('expire'), itemId: id, baseRevision: revision }),
  z.strictObject({ action: z.literal('forget'), itemId: id, baseRevision: revision }),
  z.strictObject({ action: z.literal('resolve'), itemId: id, baseRevision: revision, survivingRevisions: z.array(revision).min(1).max(2), note: z.string().trim().min(1).max(1000) }),
]);
export type MemoryAction = z.infer<typeof memoryActionSchema>;
export const memoryActionEnvelopeSchema = z.strictObject({ commandId: id, scope: memoryScopeSchema, operation: memoryActionSchema });
export const memoryMutationResultSchema = z.strictObject({ commandId: id, eventSeq: z.number().int().nonnegative(), result: z.strictObject({ itemId: id.optional(), revision: z.number().int().nonnegative(), state: z.string().max(50), additionalItemIds: z.array(id).max(2).optional() }) });
export type MemoryMutationResult = z.infer<typeof memoryMutationResultSchema>;
export const memoryPreparedRequestSchema = z.strictObject({
  scope: memoryScopeSchema, requestId: id, contextGeneration: z.number().int().nonnegative(), phase: z.enum(['PREPARING', 'CAPTURED']),
  recall: memoryRecallV1Schema, items: z.array(memoryItemV1Schema).max(PROJECT_MEMORY_LIMITS.recallItems),
  injectedBytes: z.number().int().min(0).max(PROJECT_MEMORY_LIMITS.recallBytes), expiresAt: time,
});
export type MemoryPreparedRequest = z.infer<typeof memoryPreparedRequestSchema>;
const memorySpendSchema = z.strictObject({modelCalls: z.number().int().nonnegative(), inputTokens: z.number().nonnegative().nullable(), outputTokens: z.number().nonnegative().nullable(), cost: z.number().nonnegative().nullable(), pending: z.number().int().nonnegative()});
export const memoryUsageReportSchema = z.strictObject({
  scope: memoryScopeSchema, extraction: memorySpendSchema, consolidation: memorySpendSchema,
  retrieval: z.strictObject({requests: z.number().int().nonnegative(), injectedBytes: z.number().int().nonnegative(), latencyMs: z.number().nonnegative()}),
});
export type MemoryUsageReport = z.infer<typeof memoryUsageReportSchema>;
export const memoryExportSchema = z.strictObject({ scope: memoryScopeSchema, redacted: z.literal(true), items: z.array(z.strictObject({ id, revision, kind: memoryItemV1Schema.shape.kind, state: memoryItemV1Schema.shape.state, text: memoryTextSchema, sourceDigests: z.array(hash).max(8) })).max(500), tombstones: z.array(z.strictObject({ itemId: id, deletionRevision: revision, deletedAt: time, purgeStatus: memoryTombstoneV1Schema.shape.purgeStatus })).max(500) });
export type MemoryExport = z.infer<typeof memoryExportSchema>;

export function memoryScope(access: MemoryAccess): MemoryScope { const { profileId: _, ...scope } = access; return memoryScopeSchema.parse(scope); }
