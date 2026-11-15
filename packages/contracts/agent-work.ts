import { z } from 'zod';

// M09 typed multi-agent work: the durable contracts for admitted child work,
// ordered agent input, the bounded task message board and the versioned plan
// sidecar. The persisted PlanRecord v1 stays byte-identical; every record
// here is a new, separately versioned contract. Bounded text keeps durable
// records inside the existing storage budget; larger content lives behind an
// artifact reference, never inline.

const id = z.string().min(1).max(160).regex(/^[\w:.-]+$/);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const sha1Hex = z.string().regex(/^[a-f0-9]{40}$/);
const iso = z.string().datetime();
const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const units = z.number().int().positive().max(1_000_000);
const ref = z.strictObject({ id: z.string().min(1).max(200), revision });
const utf8 = (value: string) => new TextEncoder().encode(value).byteLength;

export const AGENT_WORK_LIMITS = Object.freeze({
  /** Shared with the read-only planner: at most 3 concurrent child slots. */
  concurrent: 3,
  grants: 16,
  schemaBytes: 8192,
  promptBytes: 8192,
  summaryBytes: 1024,
  evidenceRefs: 8,
  sourceRefs: 8,
  inputTextBytes: 8192,
  queuedInputsPerTarget: 8,
  rawOutputBytes: 16 * 1024,
  messageTextBytes: 4096,
  activeMessagesPerTask: 100,
  worksPerTask: 24,
  reportEvents: 500,
} as const);

/** Durable thread custody plus the run epoch that owned a live dispatch. */
export const AgentWorkOwnerSchema = z.strictObject({
  threadId: id,
  runId: id.nullable(),
  epoch: seq,
});
export type AgentWorkOwner = z.infer<typeof AgentWorkOwnerSchema>;

export const AgentWorkRoleSchema = z.enum(['PLAN_READ', 'CODE_WORKTREE', 'QA', 'RESEARCH_READ']);
export type AgentWorkRole = z.infer<typeof AgentWorkRoleSchema>;
export const AgentWorkStateSchema = z.enum(['QUEUED', 'RUNNING', 'WAITING_HUMAN', 'COMPLETED_REPORTED', 'VERIFIED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
export type AgentWorkState = z.infer<typeof AgentWorkStateSchema>;
export const AgentWorkFailureSchema = z.enum(['OUTPUT_SCHEMA_INVALID', 'BUDGET_EXHAUSTED', 'PERMISSION_REVOKED', 'RUNTIME_FAILURE', 'UNKNOWN']);
export type AgentWorkFailure = z.infer<typeof AgentWorkFailureSchema>;

export const AGENT_WORK_TERMINAL_STATES: ReadonlySet<AgentWorkState> = new Set(['COMPLETED_REPORTED', 'VERIFIED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);

/** A child reservation against the parent's global budget. At least one
 * dimension must be bounded; the coordinator tracks failed and cancelled
 * work against the same ledger. */
export const AgentWorkBudgetSchema = z.strictObject({
  tokens: units.nullable(),
  ms: units.nullable(),
}).refine(value => value.tokens !== null || value.ms !== null, 'Reserve a token and/or wall-time bound');
export type AgentWorkBudget = z.infer<typeof AgentWorkBudgetSchema>;

const jsonSchema = z.record(z.string(), z.unknown()).refine(
  value => utf8(JSON.stringify(value)) <= AGENT_WORK_LIMITS.schemaBytes,
  `Output schema must fit within ${AGENT_WORK_LIMITS.schemaBytes} UTF-8 bytes`,
);
export type JsonSchemaObject = z.infer<typeof jsonSchema>;

export const AgentWorkV1Schema = z.strictObject({
  version: z.literal(1),
  workId: id,
  parentOwner: AgentWorkOwnerSchema,
  childOwner: AgentWorkOwnerSchema,
  role: AgentWorkRoleSchema,
  /** sha-256 of the admission payload the work was accepted under. */
  inputContractDigest: sha256Hex,
  expectedOutputSchema: jsonSchema,
  grantSubset: z.array(id).max(AGENT_WORK_LIMITS.grants).refine(items => new Set(items).size === items.length, 'Grant IDs must be unique'),
  budget: AgentWorkBudgetSchema,
  state: AgentWorkStateSchema,
  outputRef: ref.nullable(),
  failureReason: AgentWorkFailureSchema.optional(),
  /** At most one schema repair is offered per work run. */
  repairAttempts: z.number().int().min(0).max(1),
  createdSeq: seq,
  createdAt: iso,
  updatedAt: iso,
  revision,
});
export type AgentWorkV1 = z.infer<typeof AgentWorkV1Schema>;

/** The host admission payload; its digest is work.inputContractDigest. */
export const AgentWorkAdmissionV1Schema = z.strictObject({
  commandId: id,
  workId: id,
  role: AgentWorkRoleSchema,
  childThreadId: id,
  prompt: z.string().trim().min(1).max(AGENT_WORK_LIMITS.promptBytes).refine(value => utf8(value) <= AGENT_WORK_LIMITS.promptBytes, `Prompt must fit within ${AGENT_WORK_LIMITS.promptBytes} UTF-8 bytes`),
  expectedOutputSchema: jsonSchema,
  grantSubset: z.array(id).max(AGENT_WORK_LIMITS.grants).refine(items => new Set(items).size === items.length, 'Grant IDs must be unique'),
  budget: AgentWorkBudgetSchema,
});
export type AgentWorkAdmissionV1 = z.infer<typeof AgentWorkAdmissionV1Schema>;

export const AgentInputKindSchema = z.enum(['STEER', 'FOLLOW_UP', 'MESSAGE']);
export type AgentInputKind = z.infer<typeof AgentInputKindSchema>;
/** ACCEPTED is a durable queue position only — never a delivery claim. Entry
 * and handling exist solely through an adapter acknowledgment. */
export const AgentInputDeliverySchema = z.enum(['ACCEPTED', 'ENTERED_RUNTIME', 'HANDLED', 'REJECTED', 'UNKNOWN']);
export type AgentInputDelivery = z.infer<typeof AgentInputDeliverySchema>;

export const AgentInputV1Schema = z.strictObject({
  version: z.literal(1),
  inputId: id,
  taskId: id,
  targetOwner: AgentWorkOwnerSchema,
  kind: AgentInputKindSchema,
  textRef: ref,
  sourceRefs: z.array(ref).max(AGENT_WORK_LIMITS.sourceRefs),
  createdSeq: seq,
  /** Explicit durable order; reordering applies only before ENTERED_RUNTIME. */
  order: seq,
  delivery: AgentInputDeliverySchema,
  dedupeKey: z.string().min(1).max(200),
  revision,
  createdAt: iso,
  updatedAt: iso,
  error: z.string().max(1024).optional(),
});
export type AgentInputV1 = z.infer<typeof AgentInputV1Schema>;

export const AgentMessageReceiptSchema = z.strictObject({
  status: z.enum(['POSTED', 'DELIVERED', 'EXPIRED', 'REJECTED']),
  at: iso,
});
export const AgentMessageV1Schema = z.strictObject({
  version: z.literal(1),
  messageId: id,
  taskId: id,
  senderOwner: AgentWorkOwnerSchema,
  recipientOwner: AgentWorkOwnerSchema,
  topic: z.string().trim().min(1).max(160),
  text: z.string().min(1).max(AGENT_WORK_LIMITS.messageTextBytes).refine(value => utf8(value) <= AGENT_WORK_LIMITS.messageTextBytes, `A message fits within ${AGENT_WORK_LIMITS.messageTextBytes} UTF-8 bytes`).nullable(),
  artifactRef: ref.nullable(),
  replyTo: id.nullable(),
  expiresAt: iso,
  receipt: AgentMessageReceiptSchema,
  createdSeq: seq,
  createdAt: iso,
}).refine(message => (message.text === null) !== (message.artifactRef === null), 'A message carries bounded text or an artifact reference, never both');
export type AgentMessageV1 = z.infer<typeof AgentMessageV1Schema>;

/** The plan sidecar: parent relationships and weight units over the canonical
 * plan's existing step/job nodes. planId and canonicalRevision pin it to an
 * exact base plan; a changed base rejects the sidecar instead of migrating
 * hidden fields into v1 records. */
export const PlanParentRelationSchema = z.strictObject({ childId: id, parentId: id });
export const PlanWeightSchema = z.strictObject({ nodeId: id, units });
export const PlanExtensionV1Schema = z.strictObject({
  version: z.literal(1),
  planId: id,
  canonicalRevision: revision,
  extensionRevision: revision,
  parentRelationships: z.array(PlanParentRelationSchema).max(96).refine(items => new Set(items.map(item => item.childId)).size === items.length, 'A node has at most one declared parent'),
  weights: z.array(PlanWeightSchema).max(96).refine(items => new Set(items.map(item => item.nodeId)).size === items.length, 'Weight node IDs must be unique'),
  estimateUnits: z.string().trim().min(1).max(40),
  reportWatermark: seq,
});
export type PlanExtensionV1 = z.infer<typeof PlanExtensionV1Schema>;

/* ------------------------------------------------------------------ */
/* Role result contracts — strict per role; bounded strings, evidence   */
/* references and explicit incomplete/blocked outcomes.                 */
/* ------------------------------------------------------------------ */

export const AgentResultOutcomeSchema = z.enum(['COMPLETED', 'INCOMPLETE', 'BLOCKED']);
export type AgentResultOutcome = z.infer<typeof AgentResultOutcomeSchema>;

const boundedSummary = z.string().trim().min(1).max(AGENT_WORK_LIMITS.summaryBytes).refine(value => utf8(value) <= AGENT_WORK_LIMITS.summaryBytes, `Summary must fit within ${AGENT_WORK_LIMITS.summaryBytes} UTF-8 bytes`);
const evidenceRefs = z.array(ref).max(AGENT_WORK_LIMITS.evidenceRefs);
const requirementIds = z.array(id).max(16).refine(items => new Set(items).size === items.length, 'Requirement IDs must be unique');
const resultBase = {
  outcome: AgentResultOutcomeSchema,
  summary: boundedSummary,
  evidenceRefs,
  requirementIds,
};

export const PlanReadResultV1Schema = z.strictObject({ ...resultBase });
export const ResearchReadResultV1Schema = z.strictObject({
  ...resultBase,
  citationRefs: z.array(ref).max(AGENT_WORK_LIMITS.evidenceRefs),
});
export const CodeWorktreeResultV1Schema = z.strictObject({
  ...resultBase,
  worktreeId: id,
  commits: z.array(sha1Hex).max(8),
});
export const QaObservationSchema = z.strictObject({
  checkId: id,
  outcome: z.enum(['PASS', 'FAIL', 'BLOCKED']),
  evidenceRef: ref.nullable(),
});
export const QaResultV1Schema = z.strictObject({
  ...resultBase,
  observations: z.array(QaObservationSchema).max(16),
});
export type QaResultV1 = z.infer<typeof QaResultV1Schema>;

export function agentResultSchemaFor(role: AgentWorkRole): z.ZodType<unknown> {
  switch (role) {
    case 'PLAN_READ': return PlanReadResultV1Schema;
    case 'RESEARCH_READ': return ResearchReadResultV1Schema;
    case 'CODE_WORKTREE': return CodeWorktreeResultV1Schema;
    case 'QA': return QaResultV1Schema;
  }
}
