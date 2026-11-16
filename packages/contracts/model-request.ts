import { z } from 'zod';

/** M11 model transport contracts: per-request observation, adapter capability
 * discovery, new-task execution profiles and warm-transport identity. These
 * records carry measurement and binding identities only — never prompts,
 * message content, credentials or secret material. */

const boundedText = (max: number) => z.string().min(1).max(max);
const tokenCount = z.number().int().nonnegative().nullable();
const elapsedMs = z.number().nonnegative().nullable();

export const MODEL_REQUEST_OBSERVATION_LIMIT = 64;

/* ------------------------------------------------------------------ */
/* ModelRequestObservationV1 — one owned model request, measured from   */
/* scheduler admission through confirmed native teardown. `queued` is  */
/* the epoch-millisecond admission point; every other field is an      */
/* elapsed millisecond offset measured on a monotonic clock. Null      */
/* means the stage never completed — it never means zero.              */
/* ------------------------------------------------------------------ */

export const modelRequestPhaseV1Schema = z.enum(['foreground', 'background']);
export type ModelRequestPhaseV1 = z.infer<typeof modelRequestPhaseV1Schema>;

export const modelRequestOutcomeV1Schema = z.enum(['completed', 'cancelled', 'failed']);
export type ModelRequestOutcomeV1 = z.infer<typeof modelRequestOutcomeV1Schema>;

export const modelRequestTimingsV1Schema = z.strictObject({
  queued: z.number().nonnegative(),
  acquired: elapsedMs,
  runtimeReady: elapsedMs,
  requestSent: elapsedMs,
  firstProviderDelta: elapsedMs,
  firstPublicDelta: elapsedMs,
  settled: elapsedMs,
  teardownConfirmed: elapsedMs,
});
export type ModelRequestTimingsV1 = z.infer<typeof modelRequestTimingsV1Schema>;

export const modelRequestUsageV1Schema = z.strictObject({
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheReadTokens: tokenCount,
  cacheWriteTokens: tokenCount,
  cost: z.number().nonnegative().nullable(),
});
export type ModelRequestUsageV1 = z.infer<typeof modelRequestUsageV1Schema>;

export const modelRequestObservationV1Schema = z.strictObject({
  version: z.literal(1),
  requestId: boundedText(200),
  owner: z.strictObject({
    threadId: boundedText(200),
    runId: boundedText(200),
    epoch: z.number().int().nonnegative(),
    sequence: z.number().int().positive(),
    inputIds: z.array(boundedText(200)).max(64),
    phase: modelRequestPhaseV1Schema,
  }),
  binding: z.strictObject({
    providerId: boundedText(200),
    modelId: boundedText(300),
    accountId: boundedText(200).nullable(),
  }),
  timings: modelRequestTimingsV1Schema,
  usage: modelRequestUsageV1Schema,
  /** How the numeric fields were obtained; provider-reported keeps each
   * provider's own input-token meaning so cache is not double-counted. */
  usageConvention: z.enum(['provider-reported', 'unreported']),
  measurementSource: boundedText(200),
  outcome: modelRequestOutcomeV1Schema,
  error: boundedText(500).optional(),
});
export type ModelRequestObservationV1 = z.infer<typeof modelRequestObservationV1Schema>;

/* ------------------------------------------------------------------ */
/* RequestCapabilitiesV1 — asserted by the tested adapter, never        */
/* inferred from a model name. Every false carries a reason so a        */
/* missing capability is a truthful report, not silent support.         */
/* ------------------------------------------------------------------ */

export const REQUEST_CAPABILITY_KEYS = [
  'supportsPublicStreaming',
  'supportsStatelessReuse',
  'supportsUsageCacheBreakdown',
  'supportsNativeCompaction',
  'supportsSteering',
] as const;
export type RequestCapabilityKey = (typeof REQUEST_CAPABILITY_KEYS)[number];

export const requestCapabilitiesV1Schema = z.strictObject({
  version: z.literal(1),
  supportsPublicStreaming: z.boolean(),
  supportsStatelessReuse: z.boolean(),
  supportsUsageCacheBreakdown: z.boolean(),
  supportsNativeCompaction: z.boolean(),
  supportsSteering: z.boolean(),
  reasons: z.partialRecord(z.enum(REQUEST_CAPABILITY_KEYS), boundedText(500)),
  /** Test evidence that proves every true claim (e.g. a suite path). */
  proofRef: boundedText(500),
});
export type RequestCapabilitiesV1 = z.infer<typeof requestCapabilitiesV1Schema>;

/* ------------------------------------------------------------------ */
/* ModelExecutionProfileV1 — an operator-approved routing choice made  */
/* only at the creation of a new task or an explicit new child. Named   */
/* ModelExecutionProfileV1 so it cannot be confused with the M03        */
/* confinement ExecutionProfileV1 in execution-profile.ts.              */
/* ------------------------------------------------------------------ */

export const modelRequestBudgetV1Schema = z.strictObject({
  maxCalls: z.number().int().positive().optional(),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});
export type ModelRequestBudgetV1 = z.infer<typeof modelRequestBudgetV1Schema>;

export const modelExecutionProfileV1Schema = z.strictObject({
  version: z.literal(1),
  profileId: boundedText(100),
  allowedProviderAccount: z.strictObject({
    providerId: boundedText(200),
    accountId: boundedText(200).nullable(),
  }),
  modelId: boundedText(300),
  reasoningConfig: z.strictObject({ thinkingLevel: boundedText(100).nullable() }).optional(),
  toolPolicyRef: boundedText(200).optional(),
  environmentRef: boundedText(200).optional(),
  budget: modelRequestBudgetV1Schema.optional(),
});
export type ModelExecutionProfileV1 = z.infer<typeof modelExecutionProfileV1Schema>;

/* ------------------------------------------------------------------ */
/* WarmTransportKey — identity of a candidate idle stateless transport. */
/* Reuse is allowed only when every component matches and the adapter  */
/* demonstrably retains no conversation state or outstanding owner     */
/* work; an ordinary native chat session is not a stateless transport.  */
/* ------------------------------------------------------------------ */

export const warmTransportKeySchema = z.strictObject({
  providerId: boundedText(200),
  accountId: boundedText(200).nullable(),
  configDigest: z.string().regex(/^[a-f0-9]{16,64}$/),
  toolFree: z.boolean(),
  endpointId: boundedText(300),
  profileGeneration: z.number().int().nonnegative(),
});
export type WarmTransportKey = z.infer<typeof warmTransportKeySchema>;
export const warmTransportKeyId = (key: WarmTransportKey): string =>
  JSON.stringify([key.providerId, key.accountId, key.configDigest, key.toolFree, key.endpointId, key.profileGeneration]);
