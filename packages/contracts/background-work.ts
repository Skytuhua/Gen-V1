import { z } from "zod";
import { toolOwnerSchema } from "./tool-effects.ts";

/** M10 durable background work contracts. The host Store is the only writer;
 * timestamps, event payloads and external content never supply execution
 * authority. Timezone is display metadata only in this version. */

export const BACKGROUND_SCHEDULER_LIMITS = {
  tickMs: 1_000,
  dueBatchLimit: 50,
  leaseMs: 30_000,
  heartbeatMs: 10_000,
  idleMinIntervalMs: 60_000,
  intakePollMs: 60_000,
  intakePageSize: 100,
  intakePollPages: 3,
  retryDelaysMs: [1_000, 2_000] as readonly number[],
  retryAttempts: 3,
  reviewForkDeadlineMs: 60_000,
  reviewForkMaxModelCalls: 4,
  outputWindowBytes: 512 * 1024,
  shutdownDrainMs: 5_000,
} as const;

/** Allowlisted host events only. A correlation key matches an exact durable
 * identity; the event payload itself is never an authority grant. */
export const BACKGROUND_HOST_EVENTS = ["runtime.settled", "humanStep.answered"] as const;
export type BackgroundHostEventKind = (typeof BACKGROUND_HOST_EVENTS)[number];

export const backgroundWorkKindSchema = z.enum(["COMMAND", "REVIEW", "MAINTENANCE", "EXTERNAL_TASK"]);
export type BackgroundWorkKind = z.infer<typeof backgroundWorkKindSchema>;
export const backgroundLifetimeSchema = z.enum(["RUN", "APPROVED_SERVICE"]);
export type BackgroundLifetime = z.infer<typeof backgroundLifetimeSchema>;
export const backgroundWorkStateSchema = z.enum(["QUEUED", "RUNNING", "WAITING_HUMAN", "WAITING_EVENT", "BLOCKED", "SETTLED", "UNKNOWN"]);
export type BackgroundWorkState = z.infer<typeof backgroundWorkStateSchema>;
export const backgroundOutcomeSchema = z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]);
export type BackgroundOutcome = z.infer<typeof backgroundOutcomeSchema>;

/** Exact owned-process identity: PID alone is never sufficient. The creation
 * token binds the observed process instance (Linux /proc starttime); a null
 * token means identity is unproven and reads/stops must return UNKNOWN. */
export const processIdentityV1Schema = z.strictObject({
  pid: z.number().int().positive(),
  creationToken: z.string().min(1).max(200).nullable(),
  platform: z.string().min(1).max(40),
  capturedAt: z.string().min(1),
});
export type ProcessIdentityV1 = z.infer<typeof processIdentityV1Schema>;

export const backgroundWorkV1Schema = z.strictObject({
  workId: z.string().min(1).max(200),
  owner: toolOwnerSchema,
  kind: backgroundWorkKindSchema,
  effectId: z.string().min(1).max(200).nullable(),
  processIdentity: processIdentityV1Schema.nullable(),
  lifetime: backgroundLifetimeSchema.default("RUN"),
  state: backgroundWorkStateSchema,
  outcome: backgroundOutcomeSchema.nullable(),
  blockedReason: z.string().min(1).max(200).nullable(),
  leaseGeneration: z.number().int().min(0),
  leaseExpiresAtMs: z.number().int().nullable(),
  deadlineMs: z.number().int(),
  outputRef: z.string().min(1).max(300).nullable(),
}).refine(value => value.state !== "SETTLED" || value.outcome !== null, "SETTLED requires an observed terminal outcome")
  .refine(value => value.state !== "UNKNOWN" || value.outcome === null, "UNKNOWN must not claim an outcome");
export type BackgroundWorkV1 = z.infer<typeof backgroundWorkV1Schema>;

export const wakeupTriggerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("AT_UTC"), dueAtMs: z.number().int() }),
  z.strictObject({ kind: z.literal("INTERVAL_UTC"), anchorMs: z.number().int(), intervalMs: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("HOST_EVENT"), eventKind: z.enum(BACKGROUND_HOST_EVENTS), correlationKey: z.string().min(1).max(300) }),
]);
export type WakeupTriggerV1 = z.infer<typeof wakeupTriggerSchema>;

export const wakeupStateSchema = z.enum(["PENDING", "CLAIMED", "DELIVERED", "CANCELLED", "BLOCKED"]);
export type WakeupState = z.infer<typeof wakeupStateSchema>;

export const wakeupV1Schema = z.strictObject({
  wakeupId: z.string().min(1).max(200),
  taskId: z.string().min(1).max(200),
  scheduleRevision: z.number().int().positive(),
  trigger: wakeupTriggerSchema,
  /** Display metadata only; never used to compute due instants in v6. */
  scheduleTimezone: z.string().min(1).max(100).nullable(),
  occurrenceKey: z.string().min(1).max(600).nullable(),
  state: wakeupStateSchema,
  claimGeneration: z.number().int().min(0),
  leaseExpiresAtMs: z.number().int().nullable(),
  deadlineMs: z.number().int(),
});
export type WakeupV1 = z.infer<typeof wakeupV1Schema>;

export const occurrenceKeyForTime = (wakeupId: string, scheduleRevision: number, scheduledDueAtMs: number): string =>
  JSON.stringify([wakeupId, scheduleRevision, scheduledDueAtMs]);
export const occurrenceKeyForEvent = (wakeupId: string, scheduleRevision: number, hostEventId: string): string =>
  JSON.stringify([wakeupId, scheduleRevision, hostEventId]);

export const occurrenceStateSchema = z.enum(["PENDING", "CLAIMED", "DELIVERED", "SKIPPED", "CANCELLED", "UNKNOWN"]);
export type OccurrenceState = z.infer<typeof occurrenceStateSchema>;
export const occurrenceDispatchSchema = z.enum(["NOT_DISPATCHED", "DISPATCHED_UNCONFIRMED", "RECEIPT_CONFIRMED"]);
export type OccurrenceDispatch = z.infer<typeof occurrenceDispatchSchema>;

/** Durable per-occurrence receipt. One successful admission per key; a skipped
 * occurrence is persisted, never burst-replayed. */
export const backgroundOccurrenceV1Schema = z.strictObject({
  occurrenceKey: z.string().min(1).max(600),
  wakeupId: z.string().min(1).max(200),
  scheduleRevision: z.number().int().positive(),
  scheduledDueAtMs: z.number().int().nullable(),
  hostEventId: z.string().min(1).max(300).nullable(),
  state: occurrenceStateSchema,
  dispatch: occurrenceDispatchSchema,
  claimGeneration: z.number().int().min(0),
  admissionId: z.string().min(1).max(200).nullable(),
  leaseExpiresAtMs: z.number().int().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type BackgroundOccurrenceV1 = z.infer<typeof backgroundOccurrenceV1Schema>;

export const humanStepDeliverySchema = z.enum(["PENDING", "ANSWERED", "DECLINED", "SUPERSEDED", "UNKNOWN"]);
export type HumanStepDelivery = z.infer<typeof humanStepDeliverySchema>;
export const humanRequiredActionSchema = z.enum(["answer", "approval", "credential"]);
export type HumanRequiredAction = z.infer<typeof humanRequiredActionSchema>;

export const humanStepV1Schema = z.strictObject({
  requestId: z.string().min(1).max(200),
  owner: toolOwnerSchema,
  questionRevision: z.number().int().positive(),
  responseSchema: z.record(z.string(), z.unknown()),
  requiredAction: humanRequiredActionSchema,
  deliveryState: humanStepDeliverySchema,
  resumeBinding: z.strictObject({ workId: z.string().min(1).max(200), threadId: z.string().min(1).max(200) }),
});
export type HumanStepV1 = z.infer<typeof humanStepV1Schema>;

export const intakeDispositionSchema = z.enum(["REJECTED", "PROPOSED", "APPROVED"]);
export type IntakeDisposition = z.infer<typeof intakeDispositionSchema>;

export const intakeV1Schema = z.strictObject({
  intakeId: z.string().min(1).max(200),
  sourceInstallation: z.string().min(1).max(200),
  repositoryId: z.number().int().positive(),
  eventId: z.string().min(1).max(200),
  deliveryId: z.string().min(1).max(300),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  receivedAt: z.string().min(1),
  proposedTask: z.strictObject({
    title: z.string().min(1).max(300),
    sourceUrl: z.string().min(1).max(2048),
    issueNumber: z.number().int().positive(),
  }),
  disposition: intakeDispositionSchema,
});
export type IntakeV1 = z.infer<typeof intakeV1Schema>;

/** Host-owned hold reasons. These are blockedReason strings, never values of
 * the strict ImplementationEvidenceV3 status enumerations. */
export const BACKGROUND_HOLD_REASONS = {
  executionProfile: "HOLD_EXECUTION_PROFILE",
  supervisor: "HOLD_SUPERVISOR",
  forkApi: "HOLD_FORK_API",
  sourceDrift: "HOLD_SOURCE_DRIFT",
  worktreeOwner: "HOLD_WORKTREE_OWNER",
  toolchain: "HOLD_TOOLCHAIN",
} as const;

export const M10_FLAG_KEYS = ["jobs.backgroundV1", "jobs.serviceLifetimeV1", "jobs.idleReviewV1", "integrations.intakeV1"] as const;
export type M10FlagKey = (typeof M10_FLAG_KEYS)[number];
