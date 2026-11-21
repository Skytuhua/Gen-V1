import { z } from 'zod';
import { toolOwnerSchema } from './tool-effects.ts';

const id = z.string().min(1).max(200);
export const operationExecutionTargetSchema = z.strictObject({
  threadId: id, operationId: id, operationRevision: z.number().int().positive(),
});
export type OperationExecutionTarget = z.infer<typeof operationExecutionTargetSchema>;
const operationAdvisorySchema = z.strictObject({
  label: z.literal('Advisory'), classifier: z.literal('execution-policy-advisory'),
  model: z.literal('deterministic-v1'), version: z.literal('1.0.0'),
  uncertainty: z.enum(['low', 'medium', 'high']), rationale: z.enum([
    'The launch matches the approved executable allowlist.',
    'The executable or argument vector is not an approved exact match.',
    'Arbitrary shell syntax is effectful and cannot be classified as read-only.',
  ]),
  cannotAuthorize: z.literal(true),
});
export const recordedOperationAdvisorySchema = z.strictObject({
  recordedAt: z.string().datetime(), decisionAtPreparation: z.literal('REQUIRE_APPROVAL'), advisory: operationAdvisorySchema,
});
const recordedAdvice = z.strictObject({
  state: z.literal('RECORDED'), validation: z.literal('NOT_REVALIDATED'), recorded: recordedOperationAdvisorySchema,
});
const staleAdvice = recordedAdvice.extend({ state: z.literal('STALE'),
  reason: z.enum(['OWNER_CHANGED', 'ACTION_CHANGED', 'STATE_CHANGED', 'TRUST_CHANGED', 'SOURCE_UNAVAILABLE']),
});
export const operationExecutionReviewSchema = operationExecutionTargetSchema.extend({
  version: z.literal(1),
  current: z.strictObject({
    owner: toolOwnerSchema, operationStatus: z.enum(['prepared', 'running', 'succeeded', 'failed', 'cancelled', 'unknown']),
    approved: z.boolean(), threadStatus: z.string().min(1).max(64), threadMode: z.enum(['plan', 'build']),
    archived: z.boolean(), authority: z.literal('NOT_EVALUATED'),
  }),
  execution: z.strictObject({
    mode: z.literal('TRUSTED_HOST'), backendId: z.literal('TRUSTED_HOST'), runner: z.enum(['repository-test', 'context7-stdio']),
    policy: z.strictObject({ filesystem: z.literal('unrestricted'), network: z.literal('unrestricted'), processes: z.literal('unrestricted') }),
    isolated: z.strictObject({ status: z.literal('BLOCKED'), stage: z.literal('ISOLATED_EXECUTION'),
      code: z.literal('UNSUPPORTED_BACKEND'), reason: z.string().min(1).max(500), approvedBackendId: z.null(), platformProofRef: z.null() }),
  }),
  advice: z.discriminatedUnion('state', [recordedAdvice, staleAdvice, z.strictObject({
    state: z.literal('UNAVAILABLE'), reason: z.enum(['NOT_RECORDED', 'INVALID_RECORD', 'COMPUTATION_FAILED']),
  })]),
}).refine(view => view.current.owner.threadId === view.threadId, 'The current owner must match the requested thread.');
export type OperationExecutionReview = z.infer<typeof operationExecutionReviewSchema>;
