import { z } from "zod";

/** M02 execution-ledger contracts: one authority, a recoverable ToolEffect
 * ledger and single-use approvals. Append-only transitions are retained on the
 * record; the store's own event log is the durability boundary. */
const toolRiskSchema = z.enum(["READ", "WORKSPACE_WRITE", "HOST_EXECUTE", "NETWORK_WRITE"]);
export type ToolRisk = z.infer<typeof toolRiskSchema>;
const replayClassSchema = z.enum(["READ_RETRYABLE", "PROVIDER_IDEMPOTENT", "PROCESS_BOUND", "NONREPLAYABLE"]);
export type ReplayClass = z.infer<typeof replayClassSchema>;
const effectStateSchema = z.enum(["PREPARED", "DISPATCHED", "SUCCEEDED", "FAILED", "CANCELLED", "DENIED", "UNKNOWN_EXTERNAL_OUTCOME"]);
export type EffectState = z.infer<typeof effectStateSchema>;
export const actorRoleSchema = z.enum(["user", "run", "planning_child", "learning", "side"]);
export type ActorRole = z.infer<typeof actorRoleSchema>;
export const observationFreshnessSchema = z.enum(["CURRENT", "STALE", "INDETERMINATE"]);
export type ObservationFreshness = z.infer<typeof observationFreshnessSchema>;

export const toolOwnerSchema = z.strictObject({
  threadId: z.string(),
  runId: z.string().nullable(),
  epoch: z.number().int(),
  projectId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  accountBinding: z.string().nullable(),
});
export type ToolOwner = z.infer<typeof toolOwnerSchema>;

export const toolDefinitionSchema = z.strictObject({
  id: z.string().min(1),
  version: z.literal(1),
  schemaDigest: z.string().min(1),
  risk: toolRiskSchema,
  replayClass: replayClassSchema,
  allowedRoles: z.array(actorRoleSchema).min(1),
  executorBinding: z.string().min(1),
});
export type ToolDefinitionV1 = z.infer<typeof toolDefinitionSchema>;

export const toolEffectSchema = z.strictObject({
  effectId: z.string(),
  invocationId: z.string(),
  attemptId: z.number().int().positive(),
  parentInvocationId: z.string().nullable(),
  owner: toolOwnerSchema,
  toolId: z.string(),
  definitionDigest: z.string(),
  privateArgumentCommitment: z.string(),
  publicRedactedSummary: z.string(),
  targetPreconditions: z.array(z.string()),
  approvalId: z.string().nullable(),
  state: effectStateSchema,
  providerReceiptRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type ToolEffectV1 = z.infer<typeof toolEffectSchema>;

const hostApprovalAuthenticatorSchema = z.strictObject({
  version: z.literal(1),
  keyId: z.string().uuid(),
  tag: z.string().regex(/^v1:[a-f0-9-]{36}:[a-f0-9]{64}$/),
});

export const approvalSchema = z.strictObject({
  approvalId: z.string(),
  operationId: z.string(),
  actionCommitment: z.string(),
  owner: toolOwnerSchema,
  targetPreconditions: z.array(z.string()),
  issuedAt: z.string(),
  expiresAt: z.string(),
  remainingUses: z.number().int().min(0),
  issuer: z.string(),
  hostAuthenticator: hostApprovalAuthenticatorSchema.optional(),
});
export type ApprovalV1 = z.infer<typeof approvalSchema>;

/** Legacy rows remain readable; enabled-mode dispatch requires this strict form. */
export const authenticatedApprovalSchema = approvalSchema.extend({
  issuer: z.literal("authenticated_user"),
  remainingUses: z.union([z.literal(0), z.literal(1)]),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  hostAuthenticator: hostApprovalAuthenticatorSchema,
});

export interface EffectTransition { from: EffectState | null; to: EffectState; at: string; note?: string }

/** Store entity (kind "toolEffect"): current state plus the retained
 * transition history and the settled outcome needed for dedupe replay. */
export interface ToolEffectRecord extends ToolEffectV1 {
  threadId: string;
  transitions: EffectTransition[];
  outcome?: { value?: unknown; error?: string };
}
