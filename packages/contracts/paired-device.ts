import { z } from 'zod';

/** M17 paired clients and bounded read synchronization — contract layer.
 * A device grant authorizes read-only synchronization of the host's public
 * task/evidence projections for approved projects. The host stays the only
 * Store writer and permission authority; pairing metadata, a presented code
 * or an old URL never authorizes access. The first deployment exposes
 * VIEW_TASKS only: VIEW_EVIDENCE needs separate explicit consent and
 * SUBMIT_INPUT is reserved, denied and default-off until its independent
 * M09/M02 integration tests pass. Remote transport requires explicit
 * configured TLS plus client authentication — absent that configuration no
 * listener exists and there is no insecure fallback. */

const nonEmpty = z.string().min(1);
const isoDate = z.string().datetime();

export const PAIRING_CHALLENGE_BYTES = 32;
export const PAIRING_CHALLENGE_TTL_MS = 600_000;
export const PAIRING_MAX_FAILED_ATTEMPTS = 5;
export const PAIRING_FAILED_ATTEMPT_WINDOW_MS = 60_000;
export const PAIRING_MAX_PENDING = 100;
export const DEVICE_TOKEN_BYTES = 32;
export const DEVICE_GRANT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const SYNC_PAGE_MAX_EVENTS = 1_000;
export const SYNC_PAGE_MAX_BYTES = 1024 * 1024;
export const SYNC_CURSOR_SCHEMA_VERSION = 1;

/** The pseudo project scope for tasks that belong to no workspace project.
 * An approvedProjects entry may name it explicitly; it is never implied. */
export const PERSONAL_PROJECT_SCOPE = 'personal';

/** C01/D03: allowed device scope names. SUBMIT_INPUT is reserved and denied
 * in this phase; it is listed so a recorded request is honest, never so it
 * can be exercised. */
export const deviceScopeSchema = z.enum(['VIEW_TASKS', 'VIEW_EVIDENCE', 'SUBMIT_INPUT']);
export type DeviceScope = z.infer<typeof deviceScopeSchema>;

/** Claimed device identity. Display metadata only: a fingerprint is shown to
 * the approving user, never treated as hardware attestation (C01). */
export const deviceIdentityV1Schema = z.strictObject({
  deviceId: nonEmpty.max(200),
  label: z.string().max(160).nullable(),
  fingerprint: z.string().max(200).nullable(),
});
export type DeviceIdentityV1 = z.infer<typeof deviceIdentityV1Schema>;

/** C03: the host-protected pairing request. `verifier` is SHA-256 over the
 * one-time challenge — the challenge bytes themselves are returned once to
 * the issuer and never persisted. A presented code is not sufficient without
 * authenticated approval on the controlling host. */
const pairingRequestStateSchema = z.enum(['ISSUED', 'PENDING_APPROVAL', 'CONSUMED', 'DENIED', 'EXPIRED']);

export const pairingRequestV1Schema = z.strictObject({
  pairingId: nonEmpty,
  verifier: z.string().regex(/^[a-f0-9]{64}$/),
  deviceIdentity: deviceIdentityV1Schema.nullable(),
  requestedScopes: z.array(deviceScopeSchema),
  requestedProjects: z.array(nonEmpty),
  state: pairingRequestStateSchema,
  createdAt: isoDate,
  expiresAt: isoDate,
  claimedAt: isoDate.nullable(),
  consumedAt: isoDate.nullable(),
});
export type PairingRequestV1 = z.infer<typeof pairingRequestV1Schema>;

/** C01: the device grant. `userBinding` records the authenticated host
 * session identity that approved pairing; `approverSessionDigest` binds the
 * grant to the approving session without retaining the session token.
 * `grantGeneration` is bumped on revocation so previously issued cursors and
 * sessions die with the old generation. `deviceTokenDigest` is SHA-256 over
 * the bearer credential; the token bytes leave the host only in the single
 * confirmation response. */
export const deviceGrantV1Schema = z.strictObject({
  grantId: nonEmpty,
  deviceId: nonEmpty,
  deviceIdentity: deviceIdentityV1Schema,
  userBinding: nonEmpty,
  approverSessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  scopes: z.array(deviceScopeSchema).min(1),
  approvedProjects: z.array(nonEmpty),
  issuedAt: isoDate,
  expiresAt: isoDate.nullable(),
  revokedAt: isoDate.nullable(),
  grantGeneration: z.number().int().positive(),
  deviceTokenDigest: z.string().regex(/^[a-f0-9]{64}$/),
  lastSeenAt: isoDate.nullable(),
});
export type DeviceGrantV1 = z.infer<typeof deviceGrantV1Schema>;

/** C02: the signed sync cursor payload. `owner` is the grant identity the
 * cursor was issued under; `filterDigest` commits the exact scope/project
 * filter; `snapshotUpperSeq` is the immutable upper source sequence of this
 * snapshot cut and `afterSeq` the last scanned source sequence inside it. */
const syncCursorV1Schema = z.strictObject({
  owner: nonEmpty,
  deviceGrantGeneration: z.number().int().positive(),
  filterDigest: z.string().regex(/^[a-f0-9]{64}$/),
  schemaVersion: z.number().int().positive(),
  snapshotUpperSeq: z.number().int().nonnegative(),
  afterSeq: z.number().int().nonnegative(),
  keyId: nonEmpty,
});
export type SyncCursorV1 = z.infer<typeof syncCursorV1Schema>;

/** Public task projection delta. Public fields of the canonical thread only —
 * never transcript bodies, credentials or native session data (S04/S09). */
const syncTaskDeltaV1Schema = z.strictObject({
  threadId: nonEmpty,
  title: z.string(),
  status: z.string(),
  epoch: z.number().int(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  kind: z.string().nullable(),
  updatedAt: z.string(),
});
export type SyncTaskDeltaV1 = z.infer<typeof syncTaskDeltaV1Schema>;

/** Public evidence projection delta: artifact summaries for a thread, never
 * artifact bytes or private logs. */
const syncEvidenceDeltaV1Schema = z.strictObject({
  artifactId: nonEmpty,
  threadId: nonEmpty,
  title: z.string(),
  kind: z.string(),
  revision: z.number().int(),
  lifecycle: z.string(),
  updatedAt: z.string(),
});
export type SyncEvidenceDeltaV1 = z.infer<typeof syncEvidenceDeltaV1Schema>;

/** One ordered public projection delta inside a bounded page. `seq` is the
 * source sequence that caused the emission; gaps mean excluded records, not
 * missing ones. */
const syncDeltaV1Schema = z.strictObject({
  seq: z.number().int().nonnegative(),
  threadId: nonEmpty,
  kind: z.enum(['task', 'evidence']),
  task: syncTaskDeltaV1Schema.nullable(),
  evidence: z.array(syncEvidenceDeltaV1Schema).nullable(),
});
export type SyncDeltaV1 = z.infer<typeof syncDeltaV1Schema>;

/** A bounded read page. `complete` means afterSeq reached snapshotUpperSeq;
 * `sourceTimestamp` is the host time of the snapshot cut for the remote
 * view's source display (U02). */
export const syncPageV1Schema = z.strictObject({
  authority: z.literal('personal'),
  deltas: z.array(syncDeltaV1Schema),
  nextCursor: z.string().nullable(),
  complete: z.boolean(),
  snapshotUpperSeq: z.number().int().nonnegative(),
  afterSeq: z.number().int().nonnegative(),
  sourceTimestamp: isoDate,
});
export type SyncPageV1 = z.infer<typeof syncPageV1Schema>;

/** S01/D07: explicit remote transport configuration. Every field is supplied
 * by deployment configuration; nothing is invented and no default listener
 * exists. `clientAuth` requires a presented device credential. */
export const remoteTransportConfigV1Schema = z.strictObject({
  host: nonEmpty,
  port: z.number().int().min(1).max(65535),
  tls: z.strictObject({ certPath: nonEmpty, keyPath: nonEmpty }),
  clientAuth: z.literal(true),
});

/** U02/S07: remote view status. OFFLINE means the host is unavailable or the
 * transport is unauthenticated; RESYNCING means a verified gap is being
 * repaired — never an apparently current dashboard (U03). STALE means the
 * last accepted cut is older than the freshness bound. */
const remoteViewStatusSchema = z.enum(['OFFLINE', 'RESYNCING', 'SYNCED', 'STALE']);
export type RemoteViewStatus = z.infer<typeof remoteViewStatusSchema>;

/** Typed pairing/sync failure codes surfaced to callers (D02 denies without
 * disclosing pending records). */
export const PAIRING_DENIED = 'PAIRING_DENIED';
export const PAIRING_EXPIRED = 'PAIRING_EXPIRED';
export const PAIRING_CONSUMED = 'PAIRING_CONSUMED';
export const PAIRING_SCOPE_CHANGED = 'PAIRING_SCOPE_CHANGED';
export const PAIRING_RATE_LIMITED = 'PAIRING_RATE_LIMITED';
export const DEVICE_GRANT_REVOKED = 'DEVICE_GRANT_REVOKED';
export const REMOTE_INPUT_DISABLED = 'REMOTE_INPUT_DISABLED';
export const REMOTE_TRANSPORT_DISABLED = 'REMOTE_TRANSPORT_DISABLED';
export const CURSOR_KEY_UNAVAILABLE = 'CURSOR_KEY_UNAVAILABLE';
