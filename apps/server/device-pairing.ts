import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { HarnessError } from '../../packages/contracts/index.ts';
import { sendError } from './errors.ts';
import {
  DEVICE_GRANT_TTL_MS,
  DEVICE_TOKEN_BYTES,
  PAIRING_CHALLENGE_BYTES,
  PAIRING_CHALLENGE_TTL_MS,
  PAIRING_CONSUMED,
  PAIRING_DENIED,
  PAIRING_EXPIRED,
  PAIRING_MAX_FAILED_ATTEMPTS,
  PAIRING_MAX_PENDING,
  PAIRING_FAILED_ATTEMPT_WINDOW_MS,
  PAIRING_RATE_LIMITED,
  PAIRING_SCOPE_CHANGED,
  PERSONAL_PROJECT_SCOPE,
  REMOTE_INPUT_DISABLED,
  REMOTE_TRANSPORT_DISABLED,
  deviceGrantV1Schema,
  deviceIdentityV1Schema,
  deviceScopeSchema,
  pairingRequestV1Schema,
  remoteTransportConfigV1Schema,
  type DeviceGrantV1,
  type DeviceIdentityV1,
  type DeviceScope,
  type PairingRequestV1,
} from '../../packages/contracts/paired-device.ts';
import { capabilityEnabled } from '../../packages/core/capability-flags.ts';
import type { Store } from '../../packages/storage/store.ts';
import type { ReadSyncHost } from '../../packages/core/read-sync.ts';

/** M17 device pairing host (S02/D01/D02). The host owns pairing records and
 * grants in the canonical Store; a presented code is never sufficient without
 * authenticated approval on the controlling host (C03). The verifier stored
 * here is SHA-256 over the one-time challenge — challenge and device-token
 * bytes leave the host only inside the single issuing/confirming response,
 * never in the durable event log, receipts or snapshots (T01). */

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (ms: number) => new Date(ms).toISOString();
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('') === [...b].sort().join('');

interface RateDeps { now?: () => number }

export class DevicePairingHost {
  private readonly failures = new Map<string, number[]>();
  constructor(private readonly store: Store, private readonly deps: RateDeps = {}) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }
  private write<T>(type: string, apply: () => T): T {
    return this.store.inTransaction ? apply() : this.store.internal(type, null, apply) as T;
  }

  private requests(): PairingRequestV1[] { return this.store.all<PairingRequestV1>('pairingRequest'); }
  private grants(): DeviceGrantV1[] { return this.store.all<DeviceGrantV1>('deviceGrant'); }

  /** D02: failed attempts are bounded per authenticated session/client
   * binding. The caller supplies the binding from its authenticated context —
   * never from a forwarded header. Exceeding a cap denies without disclosing
   * pending records. */
  private rateLimit(binding: string) {
    const cutoff = this.now() - PAIRING_FAILED_ATTEMPT_WINDOW_MS;
    const kept = (this.failures.get(binding) ?? []).filter(at => at > cutoff);
    if (kept.length >= PAIRING_MAX_FAILED_ATTEMPTS) throw new HarnessError(PAIRING_RATE_LIMITED, 'Too many failed pairing attempts. Try again later.');
    this.failures.set(binding, kept);
  }
  private fail(binding: string) {
    const kept = (this.failures.get(binding) ?? []).filter(at => at > this.now() - PAIRING_FAILED_ATTEMPT_WINDOW_MS);
    kept.push(this.now());
    this.failures.set(binding, kept);
  }

  private requestByChallenge(challenge: string): PairingRequestV1 | null {
    if (!/^[a-f0-9]{64}$/.test(challenge)) return null;
    const verifier = Buffer.from(sha256(challenge), 'utf8');
    for (const request of this.requests()) {
      const expected = Buffer.from(request.verifier, 'utf8');
      if (expected.length === verifier.length && timingSafeEqual(expected, verifier)) return request;
    }
    return null;
  }

  /** S02: issue a one-time 32-byte challenge for the controlling host to
   * display. Pending challenges are capped host-wide; only the verifier is
   * persisted. The raw challenge returns to this caller once — out of the
   * recorded event result. */
  issueChallenge(clientBinding: string): { pairingId: string; challenge: string; expiresAt: string } {
    if (!capabilityEnabled('remote.readSyncV1')) throw new HarnessError('CAPABILITY_DENIED', 'Remote read synchronization is disabled on this host.');
    this.rateLimit(clientBinding);
    const cutoff = this.now();
    const pending = this.requests().filter(item => (item.state === 'ISSUED' || item.state === 'PENDING_APPROVAL') && Date.parse(item.expiresAt) > cutoff);
    if (pending.length >= PAIRING_MAX_PENDING) throw new HarnessError(PAIRING_RATE_LIMITED, 'Too many pending pairing requests. Approve or deny existing requests first.');
    const challenge = randomBytes(PAIRING_CHALLENGE_BYTES).toString('hex');
    const request: PairingRequestV1 = pairingRequestV1Schema.parse({
      pairingId: `pair-${randomUUID()}`,
      verifier: sha256(challenge),
      deviceIdentity: null,
      requestedScopes: [],
      requestedProjects: [],
      state: 'ISSUED',
      createdAt: iso(cutoff),
      expiresAt: iso(cutoff + PAIRING_CHALLENGE_TTL_MS),
      claimedAt: null,
      consumedAt: null,
    });
    const issued = this.write('device.pairing.issued', () => {
      this.store.put('pairingRequest', request.pairingId, null, request);
      return { pairingId: request.pairingId, expiresAt: request.expiresAt };
    });
    return { ...issued, challenge };
  }

  /** Device-facing seam (mounted only under the configured remote transport):
   * the device presents the displayed code plus its claimed identity and the
   * projects/scopes it wants. A code alone grants nothing — the request waits
   * for authenticated host approval (C03). */
  claimChallenge(challenge: string, identity: DeviceIdentityV1, requested: { scopes: DeviceScope[]; projects: string[] }, clientBinding: string): PairingRequestV1 {
    if (!capabilityEnabled('remote.readSyncV1')) throw new HarnessError('CAPABILITY_DENIED', 'Remote read synchronization is disabled on this host.');
    this.rateLimit(clientBinding);
    const deviceIdentity = deviceIdentityV1Schema.parse(identity);
    const scopes = z.array(deviceScopeSchema).parse(requested.scopes);
    const projects = z.array(z.string().min(1)).parse(requested.projects);
    const request = this.requestByChallenge(challenge);
    if (!request) { this.fail(clientBinding); throw new HarnessError(PAIRING_DENIED, 'The pairing code was not accepted.'); }
    const expired = Date.parse(request.expiresAt) <= this.now();
    if (expired || request.state !== 'ISSUED') {
      this.fail(clientBinding);
      if (expired && request.state === 'ISSUED') this.write('device.pairing.expired', () => this.store.put('pairingRequest', request.pairingId, null, { ...request, state: 'EXPIRED' as const }));
      throw new HarnessError(expired ? PAIRING_EXPIRED : PAIRING_CONSUMED, expired ? 'The pairing code expired.' : 'The pairing code was already used.');
    }
    return this.write('device.pairing.claimed', () => {
      const claimed: PairingRequestV1 = { ...request, state: 'PENDING_APPROVAL', deviceIdentity, requestedScopes: scopes, requestedProjects: projects, claimedAt: iso(this.now()) };
      this.store.put('pairingRequest', request.pairingId, null, claimed);
      return claimed;
    });
  }

  private projectsExist(projects: readonly string[]) {
    for (const projectId of projects) {
      if (projectId === PERSONAL_PROJECT_SCOPE) continue;
      const project = this.store.get<{ authority?: { kind?: string } }>('workspaceProject', projectId);
      if (!project || project.authority?.kind !== 'local') throw new HarnessError('CAPABILITY_DENIED', 'A requested project is not a connected personal project.');
    }
  }

  /** Authenticated local approval on the controlling host (S02/S03). The
   * approval must name exactly the projects/scopes the device requested — a
   * changed confirmation creates no grant (D01). Consumption, denial state
   * and grant creation commit in one transaction. */
  confirmChallenge(pairingId: string, approval: { scopes: DeviceScope[]; projects: string[]; evidenceConsent?: boolean }, sessionId: string): { grant: DeviceGrantV1; deviceToken: string } {
    const binding = `session:${sessionId}`;
    this.rateLimit(binding);
    const request = this.store.get<PairingRequestV1>('pairingRequest', pairingId);
    if (!request || request.state !== 'PENDING_APPROVAL' || !request.deviceIdentity) { this.fail(binding); throw new HarnessError(PAIRING_DENIED, 'No device is waiting for approval on this request.'); }
    if (Date.parse(request.expiresAt) <= this.now()) {
      this.fail(binding);
      this.write('device.pairing.expired', () => this.store.put('pairingRequest', pairingId, null, { ...request, state: 'EXPIRED' as const }));
      throw new HarnessError(PAIRING_EXPIRED, 'The pairing code expired.');
    }
    if (!sameSet(approval.scopes, request.requestedScopes) || !sameSet(approval.projects, request.requestedProjects)) {
      this.fail(binding);
      throw new HarnessError(PAIRING_SCOPE_CHANGED, 'Approval must match the requested projects and capabilities. Deny or let the device request again.');
    }
    if (approval.scopes.includes('SUBMIT_INPUT')) throw new HarnessError(REMOTE_INPUT_DISABLED, 'Remote input submission is not available in this release.');
    if (approval.scopes.includes('VIEW_EVIDENCE') && approval.evidenceConsent !== true) throw new HarnessError('CAPABILITY_DENIED', 'Evidence read access requires a separate explicit approval.');
    this.projectsExist(approval.projects);
    const token = randomBytes(DEVICE_TOKEN_BYTES).toString('hex');
    const grant: DeviceGrantV1 = deviceGrantV1Schema.parse({
      grantId: `devgrant-${randomUUID()}`,
      deviceId: request.deviceIdentity.deviceId,
      deviceIdentity: request.deviceIdentity,
      userBinding: 'local-host',
      approverSessionDigest: sha256(sessionId),
      scopes: [...new Set(approval.scopes)],
      approvedProjects: [...new Set(approval.projects)],
      issuedAt: iso(this.now()),
      expiresAt: iso(this.now() + DEVICE_GRANT_TTL_MS),
      revokedAt: null,
      grantGeneration: 1,
      deviceTokenDigest: sha256(token),
      lastSeenAt: null,
    });
    const outcome = this.write('device.pairing.approved', () => {
      const live = this.store.get<PairingRequestV1>('pairingRequest', pairingId);
      if (!live || live.state !== 'PENDING_APPROVAL') throw new HarnessError(PAIRING_CONSUMED, 'The pairing code was already used.');
      this.store.put('pairingRequest', pairingId, null, { ...live, state: 'CONSUMED' as const, consumedAt: iso(this.now()) });
      this.store.put('deviceGrant', grant.grantId, null, grant);
      return grant;
    });
    return { grant: outcome, deviceToken: token };
  }

  denyChallenge(pairingId: string): PairingRequestV1 {
    const request = this.store.get<PairingRequestV1>('pairingRequest', pairingId);
    if (!request || request.state !== 'PENDING_APPROVAL') throw new HarnessError(PAIRING_DENIED, 'No device is waiting for approval on this request.');
    return this.write('device.pairing.denied', () => {
      const denied: PairingRequestV1 = { ...request, state: 'DENIED', consumedAt: iso(this.now()) };
      this.store.put('pairingRequest', pairingId, null, denied);
      return denied;
    });
  }

  /** S03/T02: revocation bumps the generation so every cursor and session
   * issued under the old generation dies immediately. Always available —
   * revocation is the rollback surface, never a gated capability. */
  revokeGrant(grantId: string): DeviceGrantV1 {
    const grant = this.store.get<DeviceGrantV1>('deviceGrant', grantId);
    if (!grant) throw new HarnessError('NOT_FOUND', 'Unknown device grant.');
    if (grant.revokedAt) return grant;
    return this.write('device.grant.revoked', () => {
      const live = this.store.get<DeviceGrantV1>('deviceGrant', grantId)!;
      const revoked: DeviceGrantV1 = { ...live, revokedAt: iso(this.now()), grantGeneration: live.grantGeneration + 1 };
      this.store.put('deviceGrant', grantId, null, revoked);
      return revoked;
    });
  }

  /** G03 rollback: disable remote access by revoking every active grant.
   * Local canonical state and unsent local drafts are retained; remote caches
   * on devices already holding data cannot be guaranteed deleted (S09). */
  rollbackRemoteAccess(): { revoked: number } {
    let revoked = 0;
    for (const grant of this.grants()) if (!grant.revokedAt) { this.revokeGrant(grant.grantId); revoked++; }
    return { revoked };
  }

  /** Bearer-credential resolution for the remote read surface. The token maps
   * to one grant; expiry and revocation deny before any sync work. lastSeenAt
   * is the UI's last-seen display (U01) and is written at most once a minute. */
  authenticateDevice(token: string): DeviceGrantV1 {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HarnessError('CAPABILITY_DENIED', 'A device credential is required.');
    const digest = Buffer.from(sha256(token), 'utf8');
    let found: DeviceGrantV1 | null = null;
    for (const grant of this.grants()) {
      const expected = Buffer.from(grant.deviceTokenDigest, 'utf8');
      if (expected.length === digest.length && timingSafeEqual(expected, digest)) { found = grant; break; }
    }
    if (!found) throw new HarnessError('CAPABILITY_DENIED', 'The device credential was not recognized.');
    if (found.revokedAt) throw new HarnessError('DEVICE_GRANT_REVOKED', 'This device grant was revoked.');
    if (found.expiresAt && Date.parse(found.expiresAt) <= this.now()) throw new HarnessError('CAPABILITY_DENIED', 'This device grant expired.');
    if (!found.lastSeenAt || Date.parse(found.lastSeenAt) < this.now() - 60_000) {
      const seen = this.write('device.grant.seen', () => {
        const live = this.store.get<DeviceGrantV1>('deviceGrant', found!.grantId);
        if (!live || live.revokedAt) return live!;
        const updated = { ...live, lastSeenAt: iso(this.now()) };
        this.store.put('deviceGrant', live.grantId, null, updated);
        return updated;
      });
      if (seen.revokedAt) throw new HarnessError('DEVICE_GRANT_REVOKED', 'This device grant was revoked.');
      return seen;
    }
    return found;
  }

  liveGrant(grantId: string): DeviceGrantV1 {
    const grant = this.store.get<DeviceGrantV1>('deviceGrant', grantId);
    if (!grant) throw new HarnessError('NOT_FOUND', 'Unknown device grant.');
    if (grant.revokedAt) throw new HarnessError('DEVICE_GRANT_REVOKED', 'This device grant was revoked.');
    return grant;
  }

  /** U01: host management surface — grants plus pending approvals, without
   * credential material. Device fingerprints and scopes are display data. */
  surfaceModel() {
    const now = this.now();
    return {
      devices: this.grants().map(grant => ({
        grantId: grant.grantId, deviceId: grant.deviceId, label: grant.deviceIdentity.label, fingerprint: grant.deviceIdentity.fingerprint,
        scopes: grant.scopes, approvedProjects: grant.approvedProjects, issuedAt: grant.issuedAt, expiresAt: grant.expiresAt,
        revokedAt: grant.revokedAt, lastSeenAt: grant.lastSeenAt, grantGeneration: grant.grantGeneration,
        state: grant.revokedAt ? 'revoked' : grant.expiresAt && Date.parse(grant.expiresAt) <= now ? 'expired' : 'active',
      })),
      pending: this.requests().filter(item => item.state === 'PENDING_APPROVAL').map(item => ({
        pairingId: item.pairingId, deviceIdentity: item.deviceIdentity, requestedScopes: item.requestedScopes,
        requestedProjects: item.requestedProjects, claimedAt: item.claimedAt, expiresAt: item.expiresAt,
      })),
      readOnly: true,
      submitInputAvailable: false,
    };
  }
}

/** Host management routes on the existing session/CSRF-protected local API.
 * These are the controlling-host approval surface; the device-facing remote
 * surface exists only under buildRemoteReadSyncServer and its explicit
 * TLS/auth configuration (S01). */
export function registerDevicePairingRoutes(app: FastifyInstance, pairing: DevicePairingHost, sync: ReadSyncHost) {
  const sessionOf = (request: FastifyRequest) =>
    /(?:^|;\s*)harness_session=([a-f0-9]+)/.exec(request.headers.cookie ?? '')?.[1] ?? 'unknown';
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/devices') || request.url.startsWith('/api/device-pairing')) reply.header('Cache-Control', 'no-store');
  });
  app.get('/api/devices', async () => pairing.surfaceModel());
  app.post('/api/device-pairing/challenges', { bodyLimit: 1024 }, async request => pairing.issueChallenge(sessionOf(request)));
  const confirmSchema = z.strictObject({
    scopes: z.array(deviceScopeSchema).min(1),
    projects: z.array(z.string().min(1)),
    evidenceConsent: z.boolean().optional(),
  });
  app.post<{ Params: { pairingId: string } }>('/api/device-pairing/:pairingId/confirm', { bodyLimit: 8192 }, async request =>
    pairing.confirmChallenge(request.params.pairingId, confirmSchema.parse(request.body), sessionOf(request)));
  app.post<{ Params: { pairingId: string } }>('/api/device-pairing/:pairingId/deny', { bodyLimit: 1024 }, async request => pairing.denyChallenge(request.params.pairingId));
  app.post<{ Params: { grantId: string } }>('/api/devices/:grantId/revoke', { bodyLimit: 1024 }, async request => pairing.revokeGrant(request.params.grantId));
  // Remote submission stays rejected on the local surface as well — the
  // operation-approve path is not a remote-input admission (D05).
  app.post('/api/devices/:grantId/submit-input', { bodyLimit: 2048 }, async () => {
    throw new HarnessError(REMOTE_INPUT_DISABLED, 'Remote input submission is disabled until its M09 durable-input and M02 authority contracts are bound and tested.');
  });
  app.post('/api/devices/:grantId/operation-approve', { bodyLimit: 2048 }, async () => {
    throw new HarnessError(REMOTE_INPUT_DISABLED, 'Remote operation approval is disabled until its M09 durable-input and M02 authority contracts are bound and tested.');
  });
  void sync;
}

/** S01/D07: the remote transport exists only when an explicit authenticated
 * TLS configuration is supplied. Missing or malformed configuration is a
 * typed DISABLED decision — never a fallback listener. */
export function remoteTransportDecision(config: unknown): { state: 'ENABLED' | 'DISABLED'; reason: string | null } {
  const parsed = remoteTransportConfigV1Schema.safeParse(config);
  if (!parsed.success) return { state: 'DISABLED', reason: REMOTE_TRANSPORT_DISABLED };
  return { state: 'ENABLED', reason: null };
}

/** Builds — but does not listen — the device-facing remote surface. Requires
 * the configured TLS identity and client authentication; the certificate and
 * key are read from the supplied deployment paths and no other origin is
 * trusted. Submission/approval routes fail closed with REMOTE_INPUT_DISABLED
 * until their M09/M02 bindings are proven (S08). */
export async function buildRemoteReadSyncServer(pairing: DevicePairingHost, sync: ReadSyncHost, config: unknown): Promise<FastifyInstance> {
  const decision = remoteTransportDecision(config);
  if (decision.state !== 'ENABLED') throw new HarnessError(REMOTE_TRANSPORT_DISABLED, 'A remote listener requires the configured TLS identity and client authentication; it is not available.');
  const parsed = remoteTransportConfigV1Schema.parse(config);
  let cert: Buffer, key: Buffer;
  try {
    [cert, key] = await Promise.all([readFile(parsed.tls.certPath), readFile(parsed.tls.keyPath)]);
  } catch {
    throw new HarnessError(REMOTE_TRANSPORT_DISABLED, 'The configured TLS certificate or key is unreadable; remote access stays disabled.');
  }
  const app = Fastify({ https: { cert, key }, logger: false, bodyLimit: 64 * 1024 });
  // Typed denials only: a HarnessError surfaces its code without any internal
  // detail; everything else collapses to a generic failure.
  app.setErrorHandler((error, _request, reply) => {
    const known = error instanceof HarnessError, malformed = error instanceof z.ZodError;
    const code = known ? error.code : malformed ? 'INVALID_INPUT' : 'HOST_ERROR';
    const status = code === 'NOT_FOUND' ? 404
      : code === 'REMOTE_INPUT_DISABLED' || code === 'CAPABILITY_DENIED' || code === 'DEVICE_GRANT_REVOKED' ? 403
      : known || malformed ? 400 : 500;
    sendError(reply, code, known || malformed ? error.message : 'The remote host could not complete this request', { status });
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/remote/pair/claim') return;
    reply.header('Cache-Control', 'no-store');
    const token = /^Bearer ([a-f0-9]{64})$/.exec(String(request.headers.authorization ?? ''))?.[1];
    if (!token) return sendError(reply, 'AUTH_REQUIRED', 'A device credential is required.');
    try { (request as FastifyRequest & { deviceGrant?: DeviceGrantV1 }).deviceGrant = pairing.authenticateDevice(token); }
    catch (error) {
      const code = error instanceof HarnessError ? error.code : 'CAPABILITY_DENIED';
      return sendError(reply, code, error instanceof Error ? error.message : 'The device credential was rejected.', { status: code === 'DEVICE_GRANT_REVOKED' ? 403 : 401 });
    }
  });
  const grantOf = (request: FastifyRequest) => (request as FastifyRequest & { deviceGrant?: DeviceGrantV1 }).deviceGrant!;
  const claimSchema = z.strictObject({
    challenge: z.string().min(1).max(200),
    deviceIdentity: deviceIdentityV1Schema,
    scopes: z.array(deviceScopeSchema),
    projects: z.array(z.string().min(1)),
  });
  app.post('/remote/pair/claim', { bodyLimit: 8192 }, async request => {
    const body = claimSchema.parse(request.body ?? {});
    return pairing.claimChallenge(body.challenge, body.deviceIdentity, { scopes: body.scopes, projects: body.projects }, `remote:${request.ip}`);
  });
  app.get('/remote/sync/snapshot', async request => sync.snapshot(grantOf(request)));
  app.get<{ Querystring: { cursor?: string; advance?: string } }>('/remote/sync/page', async request => {
    const cursor = String(request.query.cursor ?? '');
    const advance = request.query.advance === '1';
    return advance ? sync.advance(grantOf(request), cursor) : sync.page(grantOf(request), cursor);
  });
  app.post('/remote/input/submit', { bodyLimit: 2048 }, async () => {
    throw new HarnessError(REMOTE_INPUT_DISABLED, 'Remote input submission is disabled until its M09 durable-input and M02 authority contracts are bound and tested.');
  });
  app.post('/remote/operations/approve', { bodyLimit: 2048 }, async () => {
    throw new HarnessError(REMOTE_INPUT_DISABLED, 'Remote operation approval is disabled until its M09 durable-input and M02 authority contracts are bound and tested.');
  });
  return app;
}
