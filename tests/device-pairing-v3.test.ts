import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { buildServer } from '../apps/server/server.ts';
import { DevicePairingHost } from '../apps/server/device-pairing.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import {
  deviceGrantV1Schema,
  deviceIdentityV1Schema,
  pairingRequestV1Schema,
  type PairingRequestV1,
} from '../packages/contracts/paired-device.ts';
import { HarnessError, type RuntimeAdapter, type WorkspaceEvent } from '../packages/contracts/index.ts';

const codeOf = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (error) { return error instanceof HarnessError ? error.code : 'UNEXPECTED'; }
};
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
  __setCapabilityFlagForTests('remote.readSyncV1', undefined);
  __setCapabilityFlagForTests('remote.submitInputV1', undefined);
});

const IDENTITY = { deviceId: 'phone-1', label: 'Pixel 9', fingerprint: 'fp:aa:bb:cc' };
const OTHER_IDENTITY = { deviceId: 'tablet-2', label: 'iPad', fingerprint: 'fp:dd:ee:ff' };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'm17-pair-'));
  const dir = join(root, 'data');
  const store = new Store(dir);
  const now = { value: 1_700_000_000_000 };
  const pairing = new DevicePairingHost(store, { now: () => now.value });
  cleanup.push(() => { try { store.close(); } catch { /* closed */ } rmSync(root, { recursive: true, force: true }); });
  store.internal('fixture.project', null, () => {
    store.put('workspaceProject', 'p1', null, { id: 'p1', name: 'Project One', authority: { kind: 'local' } });
    store.put('workspaceProject', 'p2', null, { id: 'p2', name: 'Project Two', authority: { kind: 'local' } });
  });
  __setCapabilityFlagForTests('remote.readSyncV1', true);
  return { root, dir, store, now, pairing };
}

function pairDevice(pairing: DevicePairingHost, identity = IDENTITY, scopes: ('VIEW_TASKS' | 'VIEW_EVIDENCE' | 'SUBMIT_INPUT')[] = ['VIEW_TASKS'], projects = ['personal']) {
  const issued = pairing.issueChallenge('session:host');
  const claimed = pairing.claimChallenge(issued.challenge, identity, { scopes, projects }, 'remote:device');
  const confirmed = pairing.confirmChallenge(claimed.pairingId, { scopes, projects, ...(scopes.includes('VIEW_EVIDENCE') ? { evidenceConsent: true } : {}) }, 'host-session-1');
  return { issued, claimed, ...confirmed };
}

it('M17-C01 DeviceGrantV1 contract: device identity, session binding, scopes, projects, generation, no attestation', () => {
  const { pairing } = fixture();
  const { grant, deviceToken } = pairDevice(pairing);
  const parsed = deviceGrantV1Schema.safeParse(grant);
  expect(parsed.success).toBe(true);
  expect(grant.deviceId).toBe('phone-1');
  expect(grant.deviceIdentity).toEqual(IDENTITY);
  expect(grant.userBinding).toBe('local-host');
  expect(grant.approverSessionDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(grant.scopes).toEqual(['VIEW_TASKS']);
  expect(grant.approvedProjects).toEqual(['personal']);
  expect(grant.grantGeneration).toBe(1);
  expect(grant.revokedAt).toBeNull();
  expect(deviceToken).toMatch(/^[a-f0-9]{64}$/);
  // The token bytes are never persisted: only its digest exists in the grant.
  expect(grant.deviceTokenDigest).not.toBe(deviceToken);
  // A claimed fingerprint is display metadata only, never an attestation field.
  expect(deviceIdentityV1Schema.parse(IDENTITY)).toEqual(IDENTITY);
});

it('M17-C03 PairingRequestV1 contract: one-time challenge, verifier only, claimed identity, timestamps', () => {
  const { store, pairing } = fixture();
  const issued = pairing.issueChallenge('session:host');
  expect(issued.challenge).toMatch(/^[a-f0-9]{64}$/);
  const stored = store.get<PairingRequestV1>('pairingRequest', issued.pairingId)!;
  expect(stored.verifier).toMatch(/^[a-f0-9]{64}$/);
  expect(stored.verifier).not.toBe(issued.challenge);
  expect(stored.state).toBe('ISSUED');
  expect(stored.consumedAt).toBeNull();
  expect(Date.parse(stored.expiresAt) - Date.parse(stored.createdAt)).toBe(600_000);
  pairing.claimChallenge(issued.challenge, IDENTITY, { scopes: ['VIEW_TASKS'], projects: ['personal'] }, 'remote:device');
  const claimed = store.get<PairingRequestV1>('pairingRequest', issued.pairingId)!;
  expect(claimed.state).toBe('PENDING_APPROVAL');
  expect(claimed.deviceIdentity).toEqual(IDENTITY);
  expect(claimed.claimedAt).not.toBeNull();
  expect(pairingRequestV1Schema.safeParse(claimed).success).toBe(true);
});

it('M17-S02 challenge lifecycle: consume once, rate-limit failed attempts, cap pending challenges', () => {
  const { store, pairing, now } = fixture();
  // Failed claims count against the caller binding; the 6th inside a minute denies.
  for (let i = 0; i < 5; i++) expect(codeOf(() => pairing.claimChallenge('f'.repeat(64), IDENTITY, { scopes: ['VIEW_TASKS'], projects: [] }, 'remote:attacker'))).toBe('PAIRING_DENIED');
  expect(codeOf(() => pairing.claimChallenge('f'.repeat(64), IDENTITY, { scopes: ['VIEW_TASKS'], projects: [] }, 'remote:attacker'))).toBe('PAIRING_RATE_LIMITED');
  // A different authenticated binding is not throttled by the attacker's failures.
  expect(pairing.issueChallenge('session:other').challenge).toMatch(/^[a-f0-9]{64}$/);
  // The failure window slides: after a minute the same binding can try again.
  now.value += 61_000;
  expect(codeOf(() => pairing.claimChallenge('f'.repeat(64), IDENTITY, { scopes: ['VIEW_TASKS'], projects: [] }, 'remote:attacker'))).toBe('PAIRING_DENIED');
  // Host-wide pending cap: 100 open challenges deny the 101st.
  for (let i = 0; i < 99; i++) pairing.issueChallenge(`session:${i}`);
  expect(codeOf(() => pairing.issueChallenge('session:overflow'))).toBe('PAIRING_RATE_LIMITED');
  void store;
});

it('M17-T01 expired/reused challenges, unapproved devices and brute-force denial expose no private data', () => {
  const { store, pairing, now } = fixture();
  const issued = pairing.issueChallenge('session:host');
  now.value += 600_001;
  expect(codeOf(() => pairing.claimChallenge(issued.challenge, IDENTITY, { scopes: ['VIEW_TASKS'], projects: [] }, 'remote:device'))).toBe('PAIRING_EXPIRED');
  const fresh = pairing.issueChallenge('session:host');
  pairing.claimChallenge(fresh.challenge, IDENTITY, { scopes: ['VIEW_TASKS'], projects: ['personal'] }, 'remote:device');
  expect(codeOf(() => pairing.claimChallenge(fresh.challenge, OTHER_IDENTITY, { scopes: ['VIEW_TASKS'], projects: [] }, 'remote:other'))).toBe('PAIRING_CONSUMED');
  // An unapproved device credential never authenticates.
  expect(codeOf(() => pairing.authenticateDevice('0'.repeat(64)))).toBe('CAPABILITY_DENIED');
  // No durable record leaks the raw challenge, session ids or token bytes into the event log.
  const { deviceToken } = pairDevice(pairing);
  const payloads = JSON.stringify(store.eventsAfter(0).map((event: WorkspaceEvent) => event.payload));
  expect(payloads).not.toContain(fresh.challenge);
  expect(payloads).not.toContain(deviceToken);
  expect(payloads).not.toContain('host-session-1');
  // The management surface exposes no credential material.
  const surface = pairing.surfaceModel();
  expect(JSON.stringify(surface)).not.toContain(deviceToken);
  expect(JSON.stringify(surface)).not.toContain('host-session-1');
});

it('M17-S03 grant binding: authenticate, revoke kills the credential and bumps the generation', () => {
  const { pairing } = fixture();
  const { grant, deviceToken } = pairDevice(pairing);
  expect(pairing.authenticateDevice(deviceToken).grantId).toBe(grant.grantId);
  // Possession of an old pairing code or URL grants nothing once consumed.
  // The mutation flips the last nibble deterministically — a token that is
  // never equal to the issued one regardless of its random tail.
  const wrongToken = deviceToken.slice(0, 63) + (deviceToken.endsWith('0') ? '1' : '0');
  expect(codeOf(() => pairing.authenticateDevice(wrongToken))).toBe('CAPABILITY_DENIED');
  const revoked = pairing.revokeGrant(grant.grantId);
  expect(revoked.grantGeneration).toBe(2);
  expect(revoked.revokedAt).not.toBeNull();
  expect(codeOf(() => pairing.authenticateDevice(deviceToken))).toBe('DEVICE_GRANT_REVOKED');
});

it('M17-S08/D05 SUBMIT_INPUT can never be approved, even when the device requests it', () => {
  const { pairing } = fixture();
  const issued = pairing.issueChallenge('session:host');
  const claimed = pairing.claimChallenge(issued.challenge, IDENTITY, { scopes: ['VIEW_TASKS', 'SUBMIT_INPUT'], projects: ['personal'] }, 'remote:device');
  expect(codeOf(() => pairing.confirmChallenge(claimed.pairingId, { scopes: ['VIEW_TASKS', 'SUBMIT_INPUT'], projects: ['personal'] }, 'host-session-1'))).toBe('REMOTE_INPUT_DISABLED');
  expect(pairing.surfaceModel().devices).toEqual([]);
});

it('M17-D03 VIEW_EVIDENCE requires separate explicit consent', () => {
  const { pairing } = fixture();
  const issued = pairing.issueChallenge('session:host');
  const claimed = pairing.claimChallenge(issued.challenge, IDENTITY, { scopes: ['VIEW_TASKS', 'VIEW_EVIDENCE'], projects: ['personal'] }, 'remote:device');
  expect(codeOf(() => pairing.confirmChallenge(claimed.pairingId, { scopes: ['VIEW_TASKS', 'VIEW_EVIDENCE'], projects: ['personal'] }, 'host-session-1'))).toBe('CAPABILITY_DENIED');
  const confirmed = pairing.confirmChallenge(claimed.pairingId, { scopes: ['VIEW_TASKS', 'VIEW_EVIDENCE'], projects: ['personal'], evidenceConsent: true }, 'host-session-1');
  expect(confirmed.grant.scopes).toEqual(['VIEW_TASKS', 'VIEW_EVIDENCE']);
});

it('M17-U01 host surface lists devices with fingerprint, scopes and last-seen; approvals name the read/control split', () => {
  const { pairing } = fixture();
  const issued = pairing.issueChallenge('session:host');
  pairing.claimChallenge(issued.challenge, IDENTITY, { scopes: ['VIEW_TASKS'], projects: ['personal', 'p1'] }, 'remote:device');
  const pending = pairing.surfaceModel().pending;
  expect(pending).toHaveLength(1);
  expect(pending[0]!.deviceIdentity).toEqual(IDENTITY);
  expect(pending[0]!.requestedProjects).toEqual(['personal', 'p1']);
  const { grant } = pairDevice(pairing, OTHER_IDENTITY, ['VIEW_TASKS'], ['personal']);
  const device = pairing.surfaceModel().devices.find(item => item.grantId === grant.grantId)!;
  expect(device.fingerprint).toBe('fp:dd:ee:ff');
  expect(device.state).toBe('active');
  expect(device.lastSeenAt).toBeNull();
  void grant;
});

it('M17-G02 remote flags are registered default-off and stay out of UI preferences', async () => {
  __setCapabilityFlagForTests('remote.readSyncV1', undefined);
  const { capabilityEnabled, registeredCapabilityFlags } = await import('../packages/core/capability-flags.ts');
  expect(registeredCapabilityFlags()).toMatchObject({ 'remote.readSyncV1': false, 'remote.submitInputV1': false });
  expect(capabilityEnabled('remote.readSyncV1')).toBe(false);
  expect(capabilityEnabled('remote.submitInputV1')).toBe(false);
  const { pairing } = fixture();
  __setCapabilityFlagForTests('remote.readSyncV1', undefined);
  expect(codeOf(() => pairing.issueChallenge('session:host'))).toBe('CAPABILITY_DENIED');
});

it('M17-G03 rollback revokes every active grant while retaining canonical state', () => {
  const { store, pairing } = fixture();
  const first = pairDevice(pairing);
  const second = pairDevice(pairing, OTHER_IDENTITY);
  const before = store.sequence;
  expect(pairing.rollbackRemoteAccess().revoked).toBe(2);
  expect(codeOf(() => pairing.authenticateDevice(first.deviceToken))).toBe('DEVICE_GRANT_REVOKED');
  expect(codeOf(() => pairing.authenticateDevice(second.deviceToken))).toBe('DEVICE_GRANT_REVOKED');
  expect(pairing.surfaceModel().devices.every(device => device.state === 'revoked')).toBe(true);
  expect(store.sequence).toBeGreaterThan(before);
  expect(store.get('deviceGrant', first.grant.grantId)).not.toBeNull();
});

it('M17-S10 pairing records and credentials survive a host restart', () => {
  const { dir, store, pairing, now } = fixture();
  const { grant, deviceToken } = pairDevice(pairing);
  store.close();
  const store2 = new Store(dir);
  cleanup.push(() => { try { store2.close(); } catch { /* closed */ } });
  const pairing2 = new DevicePairingHost(store2, { now: () => now.value });
  expect(pairing2.authenticateDevice(deviceToken).grantId).toBe(grant.grantId);
  expect(pairing2.surfaceModel().devices).toHaveLength(1);
});

it('M17 routes: session/CSRF-protected management surface on the local API only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'm17-http-'));
  const store = new Store(dir);
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime);
  const app = await buildServer(service, { port: 4317, dev: false });
  cleanup.push(async () => { await app.close(); await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const bootstrap = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } });
  const cookie = String(bootstrap.headers['set-cookie']).split(';')[0];
  const csrf = bootstrap.json().csrfToken;
  const headers = { host: '127.0.0.1:4317', cookie };
  // Unauthenticated reads fail before any pairing state is touched.
  expect((await app.inject({ url: '/api/devices', headers: { host: '127.0.0.1:4317' } })).statusCode).toBe(401);
  const devices = await app.inject({ url: '/api/devices', headers });
  expect(devices.statusCode).toBe(200);
  expect(devices.json().readOnly).toBe(true);
  expect(devices.json().submitInputAvailable).toBe(false);
  // Writes need CSRF; the pairing capability needs the host flag.
  expect((await app.inject({ method: 'POST', url: '/api/device-pairing/challenges', headers, payload: {} })).statusCode).toBe(403);
  const withCsrf = { ...headers, 'x-harness-csrf': csrf };
  expect((await app.inject({ method: 'POST', url: '/api/device-pairing/challenges', headers: withCsrf, payload: {} })).statusCode).toBe(403);
  __setCapabilityFlagForTests('remote.readSyncV1', true);
  const issued = await app.inject({ method: 'POST', url: '/api/device-pairing/challenges', headers: withCsrf, payload: {} });
  expect(issued.statusCode).toBe(200);
  expect(issued.json().challenge).toMatch(/^[a-f0-9]{64}$/);
  // Remote input stays rejected on every surface — even for a paired device.
  const submit = await app.inject({ method: 'POST', url: '/api/devices/devgrant-none/submit-input', headers: withCsrf, payload: { text: 'hi' } });
  expect(submit.statusCode).toBe(400);
  expect(submit.json().error.code).toBe('REMOTE_INPUT_DISABLED');
});
