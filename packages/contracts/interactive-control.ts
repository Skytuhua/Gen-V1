import { z } from 'zod';
import { toolOwnerSchema } from './tool-effects.ts';

/** M16 consented browser and desktop actions — contract layer.
 * A grant authorizes exactly one user-selected target for at most 10 minutes.
 * Capture permission and interact permission are independent: a screenshot is
 * private task data, never authority to act. No approved driver exists yet, so
 * every live path fails closed with DRIVER_UNAVAILABLE before any OS or
 * browser call. Fixture evidence stays CORE only and can never satisfy a
 * platform proof. */

export const CONTROL_GRANT_TTL_MS = 600_000;
export const CONTROL_MIN_DISPATCH_INTERVAL_MS = 200;
export const CONTROL_QUEUE_CAP = 16;
export const CONTROL_MAX_OBSERVATION_AGE_MS = 2_000;

const nonEmpty = z.string().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/** D01/S01: three separately named modes. Only the first may reuse M06 QA
 * defaults; an existing session never inherits access from a visible
 * screenshot. */
export const controlModeSchema = z.enum(['FRESH_VERIFICATION_BROWSER', 'CONSENTED_EXISTING_TAB', 'SELECTED_DESKTOP_APPLICATION']);
export type ControlMode = z.infer<typeof controlModeSchema>;

export const controlTargetKindSchema = z.enum(['APPLICATION', 'BROWSER_TAB']);
export type ControlTargetKind = z.infer<typeof controlTargetKindSchema>;

/** Interact operations. CAPTURE is deliberately absent: observation is a
 * separate permission from input (D03). */
export const controlInteractOperationSchema = z.enum(['CLICK', 'TYPE', 'KEYPRESS', 'UPLOAD', 'DOWNLOAD', 'NAVIGATE']);
export type ControlInteractOperation = z.infer<typeof controlInteractOperationSchema>;

export const controlActionKindSchema = z.enum(['CAPTURE', 'CLICK', 'TYPE', 'KEYPRESS', 'UPLOAD', 'DOWNLOAD', 'NAVIGATE']);
export type ControlActionKind = z.infer<typeof controlActionKindSchema>;

export const controlGeometryV1Schema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  dpiScale: z.number().positive(),
});
export type ControlGeometryV1 = z.infer<typeof controlGeometryV1Schema>;

/** Exact selected target identity. `creationIdentity` is a non-reused
 * process/session creation identity issued by the approved driver (a browser
 * target/session id or an OS creation token). A title, PID or screen
 * coordinate is display metadata and can never authorize an action (C01). */
export const controlTargetIdentityV1Schema = z.strictObject({
  kind: controlTargetKindSchema,
  creationIdentity: nonEmpty,
  sessionIdentity: nonEmpty,
  origin: z.string().nullable(),
});
export type ControlTargetIdentityV1 = z.infer<typeof controlTargetIdentityV1Schema>;

/** Minimal display metadata for the approved target picker (S02). Never used
 * for authorization and never enumerates unrelated windows or profiles. */
export const controlTargetCandidateV1Schema = z.strictObject({
  target: controlTargetIdentityV1Schema,
  title: z.string().nullable(),
});
export type ControlTargetCandidateV1 = z.infer<typeof controlTargetCandidateV1Schema>;

/** C01: the consent grant. Fixed expiry is 10 minutes with no automatic
 * extension. `revocationGeneration` is bumped by user Stop and by target
 * invalidation before queued actions are cancelled (S04/D06). */
export const interactiveGrantV1Schema = z.strictObject({
  grantId: nonEmpty,
  owner: toolOwnerSchema,
  deviceIdentity: z.strictObject({ deviceId: nonEmpty, sessionId: nonEmpty }),
  mode: controlModeSchema,
  target: controlTargetIdentityV1Schema,
  permittedOperations: z.array(controlInteractOperationSchema),
  allowedOrigins: z.array(nonEmpty),
  capturePermission: z.boolean(),
  issuedAtMs: z.number().int(),
  expiresAtMs: z.number().int(),
  revocationGeneration: z.number().int().min(0),
});
export type InteractiveGrantV1 = z.infer<typeof interactiveGrantV1Schema>;

/** A fresh observation bound to the recorded target geometry and DPI. An
 * observation older than CONTROL_MAX_OBSERVATION_AGE_MS, or whose geometry,
 * DPI or target identity no longer matches, invalidates queued input — a new
 * observation is requested instead of rescaling an old click (S06/D04). */
export const targetObservationV1Schema = z.strictObject({
  observationId: nonEmpty,
  target: controlTargetIdentityV1Schema,
  geometry: controlGeometryV1Schema,
  observedAtMs: z.number().int(),
});
export type TargetObservationV1 = z.infer<typeof targetObservationV1Schema>;

/** C02: a queued control action. Coordinates may be redacted; the parameters
 * stored here are never the authority — dispatch revalidates the current
 * grant, generation and observation. */
export const controlActionV1Schema = z.strictObject({
  actionId: nonEmpty,
  grantId: nonEmpty,
  target: controlTargetIdentityV1Schema,
  action: controlActionKindSchema,
  redactedParameters: z.record(z.string(), z.unknown()),
  preObservationRef: z.string().nullable(),
  postObservationRef: z.string().nullable(),
  effectReceipt: z.string().nullable(),
});
export type ControlActionV1 = z.infer<typeof controlActionV1Schema>;

/** C03: a user-scoped capture artifact. No automatic password detection or
 * complete redaction is guaranteed in this version; visible content may
 * include private data (S05). */
export const captureScopeV1Schema = z.strictObject({
  kind: z.enum(['WINDOW', 'TAB', 'REGION']),
  region: controlGeometryV1Schema.nullable(),
});
export type CaptureScopeV1 = z.infer<typeof captureScopeV1Schema>;

export const captureV1Schema = z.strictObject({
  artifactId: nonEmpty,
  target: controlTargetIdentityV1Schema,
  timestampMs: z.number().int(),
  frameDimensions: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
  sourceOwner: nonEmpty,
  captureScope: captureScopeV1Schema,
});
export type CaptureV1 = z.infer<typeof captureV1Schema>;

/** D02: approved driver registration. A driver must name one immutable
 * executable/package digest, its API protocol, backend/profile proof, the
 * physical target identity format, capture bounds, an input-cancellation
 * operation and a tested stop route. Zero or ambiguous registrations produce
 * DRIVER_UNAVAILABLE — never an implementer's choice. */
export const controlDriverRegistrationV1Schema = z.strictObject({
  driverId: nonEmpty,
  packageDigest: sha256,
  apiProtocol: nonEmpty,
  backendProofRef: nonEmpty,
  targetIdentityFormat: nonEmpty,
  captureBounds: z.strictObject({ maxWidth: z.number().positive(), maxHeight: z.number().positive(), maxBytes: z.number().positive() }),
  supportsInputCancellation: z.literal(true),
  stopRoute: z.enum(['DRIVER_STOP', 'KEYBOARD', 'HOST_CANCEL']),
});
export type ControlDriverRegistrationV1 = z.infer<typeof controlDriverRegistrationV1Schema>;

/** Consent request record (store kind 'controlConsent'). A pending request is
 * what makes the disabled capability presentation visible; it grants nothing
 * by itself. */
export const consentRequestStateSchema = z.enum(['PENDING', 'GRANTED', 'DENIED', 'UNAVAILABLE', 'EXPIRED']);
export type ConsentRequestState = z.infer<typeof consentRequestStateSchema>;

export const consentRequestV1Schema = z.strictObject({
  consentId: nonEmpty,
  owner: toolOwnerSchema,
  mode: controlModeSchema,
  requestedObserve: z.boolean(),
  requestedOperations: z.array(controlInteractOperationSchema),
  allowedOrigins: z.array(nonEmpty),
  state: consentRequestStateSchema,
  reason: z.string().nullable(),
  createdAtMs: z.number().int(),
  resolvedAtMs: z.number().int().nullable(),
});
export type ConsentRequestV1 = z.infer<typeof consentRequestV1Schema>;

/** G: the capability surface the UI binds to. `state` keeps disabled,
 * consent-pending and active presentations distinct; 'unavailable' means no
 * live control is active and names the current capability reason. */
export const controlSurfaceModelV1Schema = z.strictObject({
  state: z.enum(['unavailable', 'consent', 'active']),
  liveControlActive: z.boolean(),
  modes: z.array(z.strictObject({ mode: controlModeSchema, available: z.boolean(), reason: z.string().nullable() })),
  permissions: z.strictObject({ observe: z.boolean(), interact: z.boolean() }),
  expiryMs: z.number().int().nullable(),
  activeGrant: interactiveGrantV1Schema.nullable(),
  pendingConsent: consentRequestV1Schema.nullable(),
  stopAvailable: z.boolean(),
  reason: z.string().nullable(),
});
export type ControlSurfaceModelV1 = z.infer<typeof controlSurfaceModelV1Schema>;
