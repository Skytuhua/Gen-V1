import { z } from 'zod';
import { sha256HexSchema } from './execution-profile.ts';

// M13 isolated extension lane contracts: PluginManifestV2, PluginLeaseV1 and
// WorkerFrameV1. These records carry identities, digests, declared scopes and
// lifecycle state only. A frame, manifest or lease can never carry a Store,
// shell, credential-manager or generic host-command capability, and a worker
// claim never grants a capability the operator did not approve.
// The existing trusted plug-in lane (PluginManifest apiVersion 1) is unchanged:
// trusted stays explicitly trusted or disabled and is never implicitly
// converted into untrusted-safe status.

export const WORKER_PROTOCOL_VERSION = 1;
/** 1 MiB maximum frame size; the announced length is rejected before any
 * payload allocation or parsing. */
export const WORKER_FRAME_MAX_BYTES = 1024 * 1024;
/** At most 32 in-flight requests per worker generation; request 33 is BUSY. */
export const WORKER_MAX_INFLIGHT_REQUESTS = 32;
/** Startup HELLO/READY handshake deadline. */
export const WORKER_HANDSHAKE_DEADLINE_MS = 10_000;
/** Grace after SHUTDOWN before the exact owned process tree is terminated. */
export const WORKER_SHUTDOWN_GRACE_MS = 5_000;
/** Bounded settlement window while a draining generation finishes active calls. */
export const WORKER_DRAIN_SETTLE_MS = 5_000;

const boundedText = (max: number) => z.string().min(1).max(max);
const isoTimestamp = z.string().datetime();

// Same bounded identity grammar as the trusted lane's pluginId; redeclared here
// so this contract module stays inside the contracts layer.
export const workerPluginIdSchema = z.string().min(1).max(80).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).refine(value => !['data', 'host', 'frontend', 'constructor', 'prototype'].includes(value));
export const workerPluginVersionSchema = z.string().max(100).regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
export const workerOperationNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9_.-]{0,79}$/).refine(value => !['constructor', 'prototype'].includes(value));
export const workerRequestIdSchema = z.number().int().min(0).max(0xffffffff);
export const workerGenerationSchema = z.number().int().min(0).max(0xffffffff);

/* ------------------------------------------------------------------ */
/* WorkerFrameV1 — one frame on the private host-created pipe pair.    */
/* Wire form: 4-byte unsigned little-endian byte-length prefix followed */
/* by UTF-8 JSON of this strict object. Direction of use is enforced   */
/* by the session, not by the schema.                                   */
/* ------------------------------------------------------------------ */

export const workerFrameKindSchema = z.enum(['HELLO', 'READY', 'REQUEST', 'RESPONSE', 'CANCEL', 'SHUTDOWN', 'BYE', 'ERROR']);
export type WorkerFrameKind = z.infer<typeof workerFrameKindSchema>;

export const workerFrameV1Schema = z.strictObject({
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  requestId: workerRequestIdSchema,
  generation: workerGenerationSchema,
  kind: workerFrameKindSchema,
  payload: z.unknown(),
});
export type WorkerFrameV1 = z.infer<typeof workerFrameV1Schema>;

/** Host -> worker, once per launch. The nonce is a per-launch random value the
 * worker must echo inside READY; it authenticates the private pipe pair. */
export const workerHelloPayloadSchema = z.strictObject({
  nonce: z.string().regex(/^[a-f0-9]{32}$/),
  pluginId: workerPluginIdSchema,
  packageDigest: sha256HexSchema,
  dataNamespace: boundedText(80),
});
export type WorkerHelloPayload = z.infer<typeof workerHelloPayloadSchema>;

/** Worker -> host handshake reply. Identity must match the HELLO generation,
 * plugin and package digest; anything else is a protocol violation. */
export const workerReadyPayloadSchema = z.strictObject({
  nonce: z.string().regex(/^[a-f0-9]{32}$/),
  pluginId: workerPluginIdSchema,
  version: workerPluginVersionSchema,
  packageDigest: sha256HexSchema,
  operations: z.array(workerOperationNameSchema).max(64),
});
export type WorkerReadyPayload = z.infer<typeof workerReadyPayloadSchema>;

export const workerRequestPayloadSchema = z.strictObject({
  operation: workerOperationNameSchema,
  input: z.unknown(),
});
export type WorkerRequestPayload = z.infer<typeof workerRequestPayloadSchema>;

/** Sanitized outcome only — a worker error never carries host paths, stack
 * text or secrets back into the host. */
export const workerResponsePayloadSchema = z.strictObject({
  ok: z.boolean(),
  value: z.unknown(),
  error: boundedText(300).optional(),
});
export type WorkerResponsePayload = z.infer<typeof workerResponsePayloadSchema>;

export const workerCancelPayloadSchema = z.strictObject({ requestId: workerRequestIdSchema });
export const workerErrorPayloadSchema = z.strictObject({ code: boundedText(80), message: boundedText(300) });
export const workerByePayloadSchema = z.strictObject({ reason: z.enum(['shutdown', 'error', 'exit']) });

/* ------------------------------------------------------------------ */
/* PluginManifestV2 — the declared isolated-lane manifest.               */
/* ------------------------------------------------------------------ */

/** Finite declared capability set. Generic store/shell/credential/host-command
 * capabilities do not exist and therefore cannot be declared or smuggled. */
export const PLUGIN_DECLARED_CAPABILITIES = ['tools.invoke', 'ui.contribute', 'data.read', 'data.write', 'net.allowlist'] as const;
export const pluginDeclaredCapabilitySchema = z.enum(PLUGIN_DECLARED_CAPABILITIES);
export type PluginDeclaredCapability = z.infer<typeof pluginDeclaredCapabilitySchema>;

/** Bounded JSON-schema object for a declared tool; validated structurally and
 * by serialized size at admission. Hidden schemas cannot be promoted to direct
 * tool exposure by the worker. */
export const pluginToolSchemaV1Schema = z.strictObject({
  name: workerOperationNameSchema,
  title: boundedText(100).optional(),
  description: boundedText(500).optional(),
  parameters: z.record(z.string(), z.unknown()),
});
export type PluginToolSchemaV1 = z.infer<typeof pluginToolSchemaV1Schema>;

/** Lifecycle hook operation names the worker may invoke on transitions. */
export const pluginLifecycleHooksSchema = z.strictObject({
  onEnable: workerOperationNameSchema.optional(),
  onDisable: workerOperationNameSchema.optional(),
  onUpdate: workerOperationNameSchema.optional(),
});
export type PluginLifecycleHooks = z.infer<typeof pluginLifecycleHooksSchema>;

export const pluginManifestV2Schema = z.strictObject({
  manifestVersion: z.literal(2),
  pluginId: workerPluginIdSchema,
  version: workerPluginVersionSchema,
  packageDigest: sha256HexSchema,
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  declaredCapabilities: z.array(pluginDeclaredCapabilitySchema).max(8).refine(values => new Set(values).size === values.length, 'Declared capabilities must be unique.'),
  toolSchemas: z.array(pluginToolSchemaV1Schema).max(64).refine(values => new Set(values.map(value => value.name)).size === values.length, 'Tool names must be unique.'),
  dataNamespace: z.string().min(1).max(80).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'Use a bounded private namespace identity.'),
  executionProfileRef: boundedText(100),
  lifecycle: pluginLifecycleHooksSchema.optional(),
});
export type PluginManifestV2 = z.infer<typeof pluginManifestV2Schema>;

/** The package-side declaration file (isolated.json). Identity fields the host
 * owns — packageDigest and protocolVersion — are supplied by the verified
 * inventory, never by the declaration alone. */
export const isolatedDeclarationSchema = pluginManifestV2Schema.omit({ packageDigest: true, protocolVersion: true });
export type IsolatedDeclaration = z.infer<typeof isolatedDeclarationSchema>;

/* ------------------------------------------------------------------ */
/* PluginLeaseV1 — host-owned registration lease bound to a generation.  */
/* ------------------------------------------------------------------ */

export const pluginLeaseStateSchema = z.enum(['STARTING', 'ACTIVE', 'DRAINING', 'STOPPED', 'FAILED', 'UNKNOWN']);
export type PluginLeaseState = z.infer<typeof pluginLeaseStateSchema>;

export const pluginLeaseRegistrationSchema = z.strictObject({
  kind: z.enum(['tool', 'ui']),
  id: boundedText(200),
});
export type PluginLeaseRegistration = z.infer<typeof pluginLeaseRegistrationSchema>;

export const pluginActiveCallSchema = z.strictObject({
  requestId: workerRequestIdSchema,
  operation: workerOperationNameSchema,
  startedAt: isoTimestamp,
});
export type PluginActiveCall = z.infer<typeof pluginActiveCallSchema>;

export const pluginLeaseV1Schema = z.strictObject({
  pluginId: workerPluginIdSchema,
  version: workerPluginVersionSchema,
  generation: z.number().int().min(1).max(0xffffffff),
  ownerScopes: z.array(boundedText(200)).max(8),
  activeCalls: z.array(pluginActiveCallSchema).max(WORKER_MAX_INFLIGHT_REQUESTS),
  registrations: z.array(pluginLeaseRegistrationSchema).max(128),
  state: pluginLeaseStateSchema,
});
export type PluginLeaseV1 = z.infer<typeof pluginLeaseV1Schema>;

/* ------------------------------------------------------------------ */
/* PluginMigrationPlanV1 — a pre-existing approved migration contract.   */
/* Missing or incomplete plans block the update as MIGRATION_PLAN_       */
/* REQUIRED; a plan never causes migration code to run with host rights. */
/* ------------------------------------------------------------------ */

export const pluginMigrationPlanV1Schema = z.strictObject({
  planId: boundedText(100),
  inputVersion: workerPluginVersionSchema,
  outputVersion: workerPluginVersionSchema,
  /** Digest of the pre-migration backup snapshot of the private namespace. */
  backupDigest: sha256HexSchema,
  /** Exact approved migration executable digest; launched only through the
   * proven backend, never with host privileges. */
  executableSha256: sha256HexSchema,
  approvedAt: isoTimestamp,
  /** Post-validation receipt reference, required before the migrated data is
   * admitted back into the namespace. */
  validationReceipt: boundedText(500),
});
export type PluginMigrationPlanV1 = z.infer<typeof pluginMigrationPlanV1Schema>;

/* ------------------------------------------------------------------ */
/* Extension catalog view — the read model the existing manager shows.   */
/* ------------------------------------------------------------------ */

export const extensionHostKindSchema = z.enum(['trusted', 'isolated']);
export const extensionViewV1Schema = z.strictObject({
  pluginId: workerPluginIdSchema,
  name: boundedText(100),
  version: workerPluginVersionSchema,
  hostKind: extensionHostKindSchema,
  state: z.enum(['STARTING', 'ACTIVE', 'DRAINING', 'STOPPED', 'FAILED', 'UNKNOWN']),
  packageDigest: sha256HexSchema.optional(),
  generation: z.number().int().min(1).max(0xffffffff).optional(),
  declaredCapabilities: z.array(pluginDeclaredCapabilitySchema).optional(),
  dataScope: boundedText(200).optional(),
  updateBlocked: boundedText(300).optional(),
  retainedData: z.boolean().optional(),
});
export type ExtensionViewV1 = z.infer<typeof extensionViewV1Schema>;
