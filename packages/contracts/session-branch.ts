import { z } from 'zod';

/** M14 contracts: branchable sessions and inert history imports.
 * A branch action never mutates source history, files, approvals, native
 * sessions or remote effects. ArchiveV1 is the only admitted import format;
 * imported content is inert historical data and grants no authority. */

export const branchIntentSchema = z.enum(['INSPECT', 'START_NEW_WITH_QUOTE', 'FORK_CONVERSATION']);
export type BranchIntent = z.infer<typeof branchIntentSchema>;

export const branchModelBindingV1Schema = z.strictObject({
  modelId: z.string().min(1).max(200),
  accountId: z.string().min(1).max(200).nullable(),
});
export type BranchModelBindingV1 = z.infer<typeof branchModelBindingV1Schema>;

/** Host-captured immutable cut. `sequence` is the host event-log position at
 * capture time; `revisionDigest` binds the ordered [id:revision] message set.
 * It never claims a native engine checkpoint. */
export const sourceCutV1Schema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  revisionDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SourceCutV1 = z.infer<typeof sourceCutV1Schema>;

export const branchRequestV1Schema = z.strictObject({
  version: z.literal(1),
  sourceThreadId: z.string().min(1).max(200),
  sourceCut: sourceCutV1Schema,
  nativeCheckpointRef: z.string().max(512).nullable(),
  requestedModelBinding: branchModelBindingV1Schema.nullable(),
  intent: branchIntentSchema,
});
export type BranchRequestV1 = z.infer<typeof branchRequestV1Schema>;

/** A fork's native ability is SUPPORTED only with tested adapter runtime
 * proof. UNPROVEN means no evaluated evidence either way — it is never
 * inferred from the UI timeline. */
export const forkCapabilitySchema = z.enum(['SUPPORTED', 'UNSUPPORTED', 'UNPROVEN']);
export type ForkCapability = z.infer<typeof forkCapabilitySchema>;

/** Adapter capability matrix entry. `receiptHistory` is input-delivery
 * reconciliation, never a transcript or a fork proof. `fixedCutInspect`
 * describes a native fixed-cut read API only — the host's own immutable
 * capture path is reported separately. */
export const adapterCapabilityV1Schema = z.strictObject({
  adapterId: z.string().min(1).max(80),
  receiptHistory: z.boolean(),
  fixedCutInspect: z.enum(['SUPPORTED', 'UNSUPPORTED']),
  nativeFork: forkCapabilitySchema,
});
export type AdapterCapabilityV1 = z.infer<typeof adapterCapabilityV1Schema>;

/** HistoricalCursorV1 — owner-bound snapshot pagination position. */
export const historicalCursorV1Schema = z.strictObject({
  version: z.literal(1),
  owner: z.strictObject({
    threadId: z.string().min(1).max(200),
    projectId: z.string().max(200).nullable(),
    accountId: z.string().max(200).nullable(),
  }),
  sourceSession: z.string().min(1).max(200),
  snapshotUpperSequence: z.number().int().nonnegative(),
  filters: z.strictObject({ roles: z.array(z.enum(['user', 'assistant', 'system', 'tool', 'activity'])).max(8) }).nullable(),
  forkCapability: forkCapabilitySchema,
});
export type HistoricalCursorV1 = z.infer<typeof historicalCursorV1Schema>;

/* ------------------------------------------------------------------ */
/* ArchiveV1 — the single admitted inert import format.                */
/* ------------------------------------------------------------------ */

export const ARCHIVE_V1_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxConversations: 100,
  maxMessages: 10_000,
  maxMessageTextBytes: 1024 * 1024,
  maxAttachmentRefsPerMessage: 64,
  maxAttachmentRefBytes: 512,
  maxImportWarnings: 256,
  maxProvenanceBytes: 64 * 1024,
});

export const archiveV1RoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type ArchiveV1Role = z.infer<typeof archiveV1RoleSchema>;

export const archiveV1MessageSchema = z.strictObject({
  id: z.string().min(1).max(200),
  parentId: z.string().min(1).max(200).nullable(),
  role: archiveV1RoleSchema,
  text: z.string(),
  sourceTimestamp: z.string().min(1).max(64),
  attachmentRefs: z.array(z.string().min(1).max(ARCHIVE_V1_LIMITS.maxAttachmentRefBytes)).max(ARCHIVE_V1_LIMITS.maxAttachmentRefsPerMessage),
});
export type ArchiveV1Message = z.infer<typeof archiveV1MessageSchema>;

export const archiveV1ConversationSchema = z.strictObject({
  externalId: z.string().min(1).max(200),
  messages: z.array(archiveV1MessageSchema),
});
export type ArchiveV1Conversation = z.infer<typeof archiveV1ConversationSchema>;

export const archiveV1DocumentSchema = z.strictObject({
  version: z.literal(1),
  sourceProduct: z.string().min(1).max(200),
  exportedAt: z.string().min(1).max(64),
  conversations: z.array(archiveV1ConversationSchema).min(1).max(ARCHIVE_V1_LIMITS.maxConversations),
  provenance: z.record(z.string().min(1).max(200), z.unknown()).optional(),
  importWarnings: z.array(z.string().max(1000)).max(ARCHIVE_V1_LIMITS.maxImportWarnings).optional(),
});
export type ArchiveV1Document = z.infer<typeof archiveV1DocumentSchema>;

/* ------------------------------------------------------------------ */
/* Stored import records — inert, owner-bound, immutable after commit. */
/* ------------------------------------------------------------------ */

/** Historical text only. `system` and `tool` roles never become live policy,
 * pending tool calls, approvals or credentials. */
export const importedMessageV1Schema = z.strictObject({
  id: z.string().min(1).max(200),
  parentId: z.string().min(1).max(200).nullable(),
  role: archiveV1RoleSchema,
  text: z.string(),
  sourceTimestamp: z.string().min(1).max(64),
  attachmentRefs: z.array(z.string().min(1).max(ARCHIVE_V1_LIMITS.maxAttachmentRefBytes)).max(ARCHIVE_V1_LIMITS.maxAttachmentRefsPerMessage),
});
export type ImportedMessageV1 = z.infer<typeof importedMessageV1Schema>;

export const importedConversationV1Schema = z.strictObject({
  version: z.literal(1),
  conversationId: z.string().min(1).max(240),
  importId: z.string().min(1).max(200),
  externalId: z.string().min(1).max(200),
  owner: z.strictObject({
    threadId: z.string().min(1).max(200),
    projectId: z.string().max(200).nullable(),
  }),
  sourceProduct: z.string().min(1).max(200),
  exportedAt: z.string().min(1).max(64),
  messages: z.array(importedMessageV1Schema),
  attachmentOmissions: z.number().int().nonnegative(),
  provenance: z.record(z.string().min(1).max(200), z.unknown()).optional(),
  importWarnings: z.array(z.string().max(1000)).max(ARCHIVE_V1_LIMITS.maxImportWarnings).optional(),
});
export type ImportedConversationV1 = z.infer<typeof importedConversationV1Schema>;

/** Staged import. Private to its staging identity: cancellation before
 * commit removes exactly this record; it is never half-active. */
export const importStagingV1Schema = z.strictObject({
  version: z.literal(1),
  importId: z.string().min(1).max(200),
  owner: z.strictObject({
    threadId: z.string().min(1).max(200),
    projectId: z.string().max(200).nullable(),
  }),
  ownerKey: z.string().min(1).max(200),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  document: archiveV1DocumentSchema,
  secretFields: z.number().int().nonnegative(),
  blocked: z.boolean(),
  createdAt: z.string().min(1).max(64),
});
export type ImportStagingV1 = z.infer<typeof importStagingV1Schema>;

/** Immutable dedup receipt. `receiptId` is `ownerKey:digest` — a committed
 * digest re-import in the same owner returns this receipt instead of
 * duplicating conversations. Another owner cannot see it. */
export const importReceiptV1Schema = z.strictObject({
  version: z.literal(1),
  receiptId: z.string().min(1).max(300),
  importId: z.string().min(1).max(200),
  ownerKey: z.string().min(1).max(200),
  threadId: z.string().min(1).max(200),
  projectId: z.string().max(200).nullable(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  conversations: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  committedAt: z.string().min(1).max(64),
});
export type ImportReceiptV1 = z.infer<typeof importReceiptV1Schema>;

export const importIndexV1Schema = z.strictObject({
  version: z.literal(1),
  importId: z.string().min(1).max(200),
  receiptId: z.string().min(1).max(300),
});
export type ImportIndexV1 = z.infer<typeof importIndexV1Schema>;

/* ------------------------------------------------------------------ */
/* Session capture — the immutable Inspect point.                      */
/* ------------------------------------------------------------------ */

export const sessionCaptureMessageV1Schema = z.strictObject({
  id: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant', 'activity']),
  createdAt: z.string().min(1).max(64),
  runId: z.string().max(200).nullable(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string(),
});
export type SessionCaptureMessageV1 = z.infer<typeof sessionCaptureMessageV1Schema>;

export const SESSION_CAPTURE_LIMITS = Object.freeze({
  maxMessages: 500,
  maxContentBytes: 512 * 1024,
});

/** Frozen copy of host-projected messages at a fixed cut. New events never
 * move the cut; it is not a native transcript and carries no attachment
 * bytes, so coverage gaps are listed explicitly. */
export const sessionCaptureV1Schema = z.strictObject({
  version: z.literal(1),
  captureId: z.string().min(1).max(200),
  sourceThreadId: z.string().min(1).max(200),
  owner: z.strictObject({
    threadId: z.string().min(1).max(200),
    projectId: z.string().max(200).nullable(),
    accountId: z.string().max(200).nullable(),
    kind: z.enum(['main', 'side']),
    sideParentId: z.string().max(200).nullable(),
  }),
  sourceCut: sourceCutV1Schema,
  coverage: z.enum(['COMPLETE', 'TRUNCATED']),
  truncated: z.number().int().nonnegative(),
  incompleteSource: z.array(z.enum(['TRUNCATED_HISTORY', 'NATIVE_TRANSCRIPT_UNAVAILABLE', 'ATTACHMENTS_NOT_CAPTURED'])),
  messages: z.array(sessionCaptureMessageV1Schema),
  createdAt: z.string().min(1).max(64),
});
export type SessionCaptureV1 = z.infer<typeof sessionCaptureV1Schema>;

/** Persisted branch lineage. The child thread is a normal new task; this
 * record is the only parent linkage, so ordinary read admission is intact. */
export const sessionBranchV1Schema = z.strictObject({
  version: z.literal(1),
  branchId: z.string().min(1).max(200),
  intent: branchIntentSchema,
  parentThreadId: z.string().min(1).max(200),
  childThreadId: z.string().min(1).max(200).nullable(),
  sourceCut: sourceCutV1Schema,
  quote: z.strictObject({
    messageIds: z.array(z.string().min(1).max(200)).max(8),
    excerpts: z.array(z.strictObject({
      id: z.string().min(1).max(200),
      role: z.enum(['user', 'assistant', 'activity']),
      excerpt: z.string().max(2000),
    })).max(8),
  }),
  requestedModelBinding: branchModelBindingV1Schema.nullable(),
  nativeCheckpointRef: z.string().max(512).nullable(),
  forkCapability: forkCapabilitySchema,
  createdAt: z.string().min(1).max(64),
});
export type SessionBranchV1 = z.infer<typeof sessionBranchV1Schema>;

/* ------------------------------------------------------------------ */
/* Import preview — reports, never dereferences.                       */
/* ------------------------------------------------------------------ */

export const importFieldReportV1Schema = z.strictObject({
  path: z.string().min(1).max(300),
  field: z.string().min(1).max(200),
});
export type ImportFieldReportV1 = z.infer<typeof importFieldReportV1Schema>;

export const importAccessLinkV1Schema = z.strictObject({
  path: z.string().min(1).max(300),
  kind: z.enum(['USERINFO', 'CREDENTIAL_PARAM']),
  host: z.string().max(200).nullable(),
});
export type ImportAccessLinkV1 = z.infer<typeof importAccessLinkV1Schema>;

export const IMPORT_PREVIEW_HEURISTIC_NOTE =
  'Heuristic detection reports known secret-bearing fields and access-bearing links only; it cannot prove imported content is secret-free.';

export const importPreviewV1Schema = z.strictObject({
  version: z.literal(1),
  format: z.literal('ArchiveV1'),
  importId: z.string().min(1).max(200),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.strictObject({
    sourceProduct: z.string().max(200),
    exportedAt: z.string().max(64),
  }),
  counts: z.strictObject({
    conversations: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    attachmentRefs: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string().max(1000)).max(300),
  secretFields: z.array(importFieldReportV1Schema).max(256),
  accessLinks: z.array(importAccessLinkV1Schema).max(256),
  blocked: z.boolean(),
  heuristicNote: z.string().min(1).max(500),
  destination: z.strictObject({
    threadId: z.string().min(1).max(200),
    projectId: z.string().max(200).nullable(),
  }),
});
export type ImportPreviewV1 = z.infer<typeof importPreviewV1Schema>;
