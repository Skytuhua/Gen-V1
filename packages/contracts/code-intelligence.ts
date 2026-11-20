import { z } from "zod";

/** M07 code-intelligence contracts: revision-aware diagnostics, bounded
 * semantic navigation, exact edit previews, safe rename and a restricted
 * debugger workflow. A diagnostic observation is never task completion by
 * itself; a preview frame never authorizes a write. */

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nonEmpty = z.string().min(1).max(4096);

const rangeEncodingSchema = z.enum(["UTF8", "UTF16", "UTF32"]);
export type RangeEncoding = z.infer<typeof rangeEncodingSchema>;

/** Positions are line/character pairs in `rangeEncoding` units. The negotiated
 * encoding is recorded so consumers never assume byte offsets equal UTF-16
 * positions. */
const codePositionSchema = z.strictObject({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});
export type CodePosition = z.infer<typeof codePositionSchema>;

const codeRangeSchema = z.strictObject({
  start: codePositionSchema,
  end: codePositionSchema,
});
export type CodeRange = z.infer<typeof codeRangeSchema>;

const diagnosticSeveritySchema = z.enum(["error", "warning", "information", "hint"]);
export type DiagnosticSeverity = z.infer<typeof diagnosticSeveritySchema>;

const codeDiagnosticSchema = z.strictObject({
  path: nonEmpty,
  range: codeRangeSchema,
  severity: diagnosticSeveritySchema,
  code: z.string().max(256).optional(),
  message: z.string().max(16384),
  source: z.string().max(256).optional(),
});
export type CodeDiagnostic = z.infer<typeof codeDiagnosticSchema>;

const baselineStatusSchema = z.enum(["AVAILABLE", "UNAVAILABLE"]);


const observationStateSchema = z.enum(["CURRENT", "STALE", "UNAVAILABLE"]);


export const diagnosticObservationV1Schema = z.strictObject({
  version: z.literal(1),
  workspaceIdentity: nonEmpty,
  language: nonEmpty,
  serverIdentity: nonEmpty,
  editInvocationId: z.string().max(256).nullable(),
  documentVersion: z.number().int().nonnegative(),
  beforeDigest: sha256.nullable(),
  afterDigest: sha256,
  rangeEncoding: rangeEncodingSchema,
  baselineStatus: baselineStatusSchema,
  diagnostics: z.array(codeDiagnosticSchema).max(1000),
  state: observationStateSchema,
  observedAt: z.string().max(64),
});
export type DiagnosticObservationV1 = z.infer<typeof diagnosticObservationV1Schema>;

const editPreviewFileSchema = z.strictObject({
  path: nonEmpty,
  identity: z.string().max(512).nullable(),
  beforeDigest: sha256.nullable(),
  proposedDigest: sha256,
});
export type EditPreviewFile = z.infer<typeof editPreviewFileSchema>;

const editPreviewStateSchema = z.enum([
  "STREAMING_UNAPPLIED",
  "READY_UNAPPLIED",
  "INVALID",
  "APPLIED",
  "CONFLICT",
]);


export const editPreviewV1Schema = z.strictObject({
  version: z.literal(1),
  previewId: nonEmpty,
  owner: nonEmpty,
  schemaDigest: sha256,
  finalArgumentsDigest: sha256.nullable(),
  targetFiles: z.array(editPreviewFileSchema).max(256),
  state: editPreviewStateSchema,
});
export type EditPreviewV1 = z.infer<typeof editPreviewV1Schema>;

const textEditSchema = z.strictObject({
  range: codeRangeSchema,
  newText: z.string().max(4 * 1024 * 1024),
});
export type TextEdit = z.infer<typeof textEditSchema>;

/** First version supports text edits to existing files only. create/delete/
 * move/resource operations and ungranted roots are rejected. */
export const renamePlanV1Schema = z.strictObject({
  version: z.literal(1),
  planId: nonEmpty,
  workspaceIdentity: nonEmpty,
  serverVersion: z.string().max(512),
  sourceVersions: z.array(z.strictObject({
    path: nonEmpty,
    documentVersion: z.number().int().nonnegative(),
    digest: sha256,
  })).max(256),
  textEdits: z.array(z.strictObject({
    path: nonEmpty,
    edits: z.array(textEditSchema).min(1).max(4096),
  })).max(256),
  expectedBeforeDigests: z.array(z.strictObject({ path: nonEmpty, digest: sha256 })).max(256),
  exactApprovalId: nonEmpty,
});
export type RenamePlanV1 = z.infer<typeof renamePlanV1Schema>;

const renameDispositionSchema = z.enum(["Applied", "Restored", "Unchanged", "Conflict"]);
export type RenameDisposition = z.infer<typeof renameDispositionSchema>;

const renameRecoveryEntrySchema = z.strictObject({
  path: nonEmpty,
  disposition: renameDispositionSchema,
  detail: z.string().max(1024).optional(),
});
export type RenameRecoveryEntry = z.infer<typeof renameRecoveryEntrySchema>;

export const renameRecoveryResultSchema = z.strictObject({
  planId: nonEmpty,
  state: z.enum(["APPLIED", "RECOVERED", "PARTIAL_RECOVERY_REQUIRED"]),
  entries: z.array(renameRecoveryEntrySchema).max(256),
});
export type RenameRecoveryResult = z.infer<typeof renameRecoveryResultSchema>;

const debugSessionStateSchema = z.enum(["STARTING", "PAUSED", "RUNNING", "STOPPED", "UNKNOWN"]);


export const debugSessionV1Schema = z.strictObject({
  version: z.literal(1),
  sessionId: nonEmpty,
  owner: nonEmpty,
  executableIdentity: nonEmpty,
  approvedRecipe: nonEmpty,
  confinementProfile: nonEmpty,
  processIdentity: z.string().max(512).nullable(),
  state: debugSessionStateSchema,
});
export type DebugSessionV1 = z.infer<typeof debugSessionV1Schema>;

/** Inspect commands are bounded reads of a paused process. Launch, continue,
 * step and evaluate can execute code and require authorized effect handling. */
export const DEBUG_INSPECT_COMMANDS = ["threads", "stackTrace", "scopes", "variables"] as const;
export const DEBUG_EFFECT_COMMANDS = ["launch", "continue", "next", "stepIn", "stepOut", "pause", "evaluate", "setBreakpoints", "terminate"] as const;



export const CODE_INTELLIGENCE_LIMITS = Object.freeze({
  navigationResults: 100,
  diagnostics: 1000,
  openPreviewsPerRun: 8,
  previewAggregateBytes: 256 * 1024,
  debounceMs: 100,
  inlineDiagnosticMs: 250,
  delayedDiagnosticMs: 5000,
  idleServerShutdownMs: 5 * 60 * 1000,
  previewBufferBytes: 4 * 1024 * 1024,
  renameFiles: 256,
  debugStackFrames: 100,
  debugVariables: 100,
});
