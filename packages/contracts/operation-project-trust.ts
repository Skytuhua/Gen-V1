import { z } from 'zod';
import { toolOwnerSchema } from './tool-effects.ts';
import { approvedDigestV1Schema, projectTrustScopeV1Schema, projectTrustV1Schema, sha256HexSchema } from './execution-profile.ts';

const id = z.string().min(1).max(200);
const owner = toolOwnerSchema.extend({ threadId: id, runId: id.nullable(), epoch: z.number().int().nonnegative(),
  projectId: id.nullable(), workspaceId: id.nullable(), accountBinding: id.nullable() });
export const operationProjectTrustTargetSchema = z.strictObject({
  threadId: id, operationId: id, operationRevision: z.number().int().positive(),
});
export type OperationProjectTrustTarget = z.infer<typeof operationProjectTrustTargetSchema>;
export const operationProjectTrustDecisionSchema = operationProjectTrustTargetSchema.extend({
  reviewId: id, expectedTrustRevision: z.number().int().nonnegative(),
  decision: z.enum(['trusted', 'declined']), executionMode: z.literal('TRUSTED_HOST').optional(),
}).refine(input => input.decision === 'declined' || input.executionMode === 'TRUSTED_HOST',
  'Trusting this host operation requires an explicit Unrestricted host selection.');
export type OperationProjectTrustDecision = z.infer<typeof operationProjectTrustDecisionSchema>;
export const operationProjectTrustRevokeSchema = operationProjectTrustTargetSchema.extend({
  trustId: id, expectedTrustRevision: z.number().int().positive(),
});
export type OperationProjectTrustRevoke = z.infer<typeof operationProjectTrustRevokeSchema>;

const operationProjectTrustStateSchema = z.strictObject({
  trustId: z.string().min(1).max(100), revision: z.number().int().nonnegative(),
  decision: z.enum(['required', 'trusted', 'declined', 'revoked', 'invalidated']),
}).refine(state => state.decision === 'required' ? state.revision === 0 : state.revision > 0,
  'A recorded trust decision requires its positive revision.');
export type OperationProjectTrustState = z.infer<typeof operationProjectTrustStateSchema>;
/** Requested project scope is consent metadata, not an operating-system policy.
 * The existing runner is explicitly unrestricted; no isolated backend is selected. */
const repositoryHostExecutionDisclosureSchema = z.strictObject({
  mode: z.literal('TRUSTED_HOST'), label: z.literal('Unrestricted host'),
  executable: z.strictObject({ path: z.string().min(1).max(32767), sha256: sha256HexSchema }),
  argv: z.union([z.tuple([z.literal('--test'), z.literal('--'), z.string().min(1).max(1024)]),
    z.array(z.string().min(1).max(4096)).min(3).max(32)]), // v2 test-results bindings carry longer argv incl. the {GEN_REPORT_DIR} token
  cwd: z.string().min(1).max(4096), filesystem: z.literal('unrestricted'),
  network: z.literal('unrestricted'), processes: z.literal('unrestricted'), platformProofRef: z.null(),
});
export const operationProjectTrustReviewSchema = z.discriminatedUnion('enabled', [
  operationProjectTrustTargetSchema.extend({ version: z.literal(1), enabled: z.literal(false), reason: z.literal('PROJECT_TRUST_DISABLED') }),
  operationProjectTrustTargetSchema.extend({ version: z.literal(1), enabled: z.literal(true), reviewId: id,
    expiresAt: z.string().datetime(), owner,
    root: projectTrustV1Schema.shape.root, approvedDigests: z.array(approvedDigestV1Schema).length(1),
    requestedScope: projectTrustScopeV1Schema, execution: repositoryHostExecutionDisclosureSchema,
    current: operationProjectTrustStateSchema }),
]).refine(review => !review.enabled || review.owner.threadId === review.threadId, 'The trust review owner must match its requested thread.');
export type OperationProjectTrustReview = z.infer<typeof operationProjectTrustReviewSchema>;
/** Recorded state for revocation. This is neither a fresh byte review nor
 * authority to make a trust decision or approve an operation. */
export const operationProjectTrustStatusSchema = z.discriminatedUnion('enabled', [
  operationProjectTrustTargetSchema.extend({ version: z.literal(1), enabled: z.literal(false), reason: z.literal('PROJECT_TRUST_DISABLED') }),
  operationProjectTrustTargetSchema.extend({ version: z.literal(1), enabled: z.literal(true), owner, current: operationProjectTrustStateSchema }),
]).refine(status => !status.enabled || status.owner.threadId === status.threadId, 'The trust status owner must match its requested thread.');
export type OperationProjectTrustStatus = z.infer<typeof operationProjectTrustStatusSchema>;
export const operationProjectTrustReceiptSchema = operationProjectTrustTargetSchema.extend({
  version: z.literal(1), current: operationProjectTrustStateSchema,
});
export type OperationProjectTrustReceipt = z.infer<typeof operationProjectTrustReceiptSchema>;
