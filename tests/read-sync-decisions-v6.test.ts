import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Store } from '../packages/storage/store.ts';
import { ReadSyncHost, ReadSyncClient, type ReadSyncTransport } from '../packages/core/read-sync.ts';
import { DevicePairingHost, buildRemoteReadSyncServer } from '../apps/server/device-pairing.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { deviceGrantV1Schema, type DeviceGrantV1, type SyncCursorV1 } from '../packages/contracts/paired-device.ts';
import { HarnessError } from '../packages/contracts/index.ts';

/** M17 fixed decision cases (D01–D06). Each case binds the exact stated
 * outcome — no placeholder passes. */

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const ISO = new Date(1_700_000_000_000).toISOString();
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

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'm17-d-'));
  const dir = join(root, 'data');
  const store = new Store(dir);
  const now = { value: 1_700_000_000_000 };
  const pairing = new DevicePairingHost(store, { now: () => now.value });
  const sync = new ReadSyncHost(store, { now: () => now.value });
  cleanup.push(() => { try { store.close(); } catch { /* closed */ } rmSync(root, { recursive: true, force: true }); });
  store.internal('fixture.projects', null, () => {
    store.put('workspaceProject', 'p1', null, { id: 'p1', name: 'Project One', authority: { kind: 'local' } });
    store.put('workspaceProject', 'p2', null, { id: 'p2', name: 'Project Two', authority: { kind: 'local' } });
  });
  __setCapabilityFlagForTests('remote.readSyncV1', true);
  return { store, now, pairing, sync };
}

const IDENTITY = { deviceId: 'phone-1', label: 'Pixel', fingerprint: 'fp:aa' };

function seedGrant(store: Store, overrides: Partial<DeviceGrantV1> = {}): DeviceGrantV1 {
  const grant = deviceGrantV1Schema.parse({
    grantId: `devgrant-${Math.random().toString(16).slice(2)}`,
    deviceId: 'phone-1',
    deviceIdentity: IDENTITY,
    userBinding: 'local-host',
    approverSessionDigest: sha256('session'),
    scopes: ['VIEW_TASKS'],
    approvedProjects: ['p1'],
    issuedAt: ISO,
    expiresAt: null,
    revokedAt: null,
    grantGeneration: 1,
    deviceTokenDigest: sha256(`token-${Math.random()}`),
    lastSeenAt: null,
    ...overrides,
  });
  store.internal('fixture.grant', null, () => store.put('deviceGrant', grant.grantId, null, grant));
  return grant;
}

function seedThread(store: Store, id: string, projectId: string | null) {
  store.internal('fixture.thread', id, () => store.put('thread', id, id, {
    id, title: `Task ${id}`, status: 'open', epoch: 1, projectId, projectName: projectId, kind: 'main', updatedAt: ISO,
  }));
}

const signAs = (sync: ReadSyncHost, cursor: SyncCursorV1) => (sync as unknown as { sign(c: SyncCursorV1): string }).sign(cursor);

it('M17-D01 pair consumption: approving one challenge twice creates one grant; expired or changed-scope confirmation creates none', () => {
  const { store, pairing, now } = fixture();
  const issued = pairing.issueChallenge('session:host');
  const claimed = pairing.claimChallenge(issued.challenge, IDENTITY, { scopes: ['VIEW_TASKS'], projects: ['p1'] }, 'remote:device');
  const first = pairing.confirmChallenge(claimed.pairingId, { scopes: ['VIEW_TASKS'], projects: ['p1'] }, 'host-session-1');
  expect(first.grant.grantId).toMatch(/^devgrant-/);
  expect(codeOf(() => pairing.confirmChallenge(claimed.pairingId, { scopes: ['VIEW_TASKS'], projects: ['p1'] }, 'host-session-1'))).toBe('PAIRING_DENIED');
  expect(store.all<DeviceGrantV1>('deviceGrant')).toHaveLength(1);

  const expiredIssue = pairing.issueChallenge('session:host');
  now.value += 600_001;
  const expiredClaim = { pairingId: expiredIssue.pairingId };
  expect(codeOf(() => pairing.confirmChallenge(expiredClaim.pairingId, { scopes: ['VIEW_TASKS'], projects: ['p1'] }, 'host-session-1'))).toBe('PAIRING_DENIED');
  now.value -= 600_001;
  const issued2 = pairing.issueChallenge('session:host');
  const claimed2 = pairing.claimChallenge(issued2.challenge, IDENTITY, { scopes: ['VIEW_TASKS'], projects: ['p1'] }, 'remote:device');
  expect(codeOf(() => pairing.confirmChallenge(claimed2.pairingId, { scopes: ['VIEW_TASKS', 'VIEW_EVIDENCE'], projects: ['p1'], evidenceConsent: true }, 'host-session-1'))).toBe('PAIRING_SCOPE_CHANGED');
  expect(codeOf(() => pairing.confirmChallenge(claimed2.pairingId, { scopes: ['VIEW_TASKS'], projects: ['p2'] }, 'host-session-1'))).toBe('PAIRING_SCOPE_CHANGED');
  expect(store.all<DeviceGrantV1>('deviceGrant')).toHaveLength(1);
});

it('M17-D02 cursor binding: changing owner, filters, generation or signature rejects without leaking another project\'s rows', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store, { approvedProjects: ['p1'] });
  seedThread(store, 'mine', 'p1');
  seedThread(store, 'foreign', 'p2');
  const snap = sync.snapshot(grant);
  expect(snap.deltas.map(d => d.threadId)).toEqual(['mine']);
  const decoded = JSON.parse(Buffer.from(snap.nextCursor!.split('.')[0]!, 'base64url').toString()) as SyncCursorV1;
  const bound = (patch: Partial<SyncCursorV1>) => signAs(sync, { ...decoded, ...patch });
  expect(codeOf(() => sync.page(grant, bound({ owner: 'devgrant-other' })))).toBe('INVALID_CURSOR');
  expect(codeOf(() => sync.page(grant, bound({ filterDigest: 'f'.repeat(64) })))).toBe('INVALID_CURSOR');
  expect(codeOf(() => sync.page(grant, bound({ deviceGrantGeneration: 99 })))).toBe('INVALID_CURSOR');
  expect(codeOf(() => sync.page(grant, `${snap.nextCursor!.slice(0, -4)}AAAA`))).toBe('INVALID_CURSOR');
  // Widening the grant's scope does not retro-widen an issued cursor's filter.
  store.internal('fixture.widen', null, () => store.put('deviceGrant', grant.grantId, null, { ...grant, approvedProjects: ['p1', 'p2'] }));
  expect(codeOf(() => sync.page(grant, snap.nextCursor!))).toBe('INVALID_CURSOR');
  // Every rejection emitted no foreign rows — only 'mine' was ever delivered.
  expect(JSON.stringify(snap.deltas)).not.toContain('foreign');
});

it('M17-D03 filtered versus missing: skipped foreign-owner sequences still page; deleted retained history requires resync', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store, { approvedProjects: ['p1'] });
  seedThread(store, 'a1', 'p1');
  seedThread(store, 'x1', 'p2');
  seedThread(store, 'x2', 'p2');
  seedThread(store, 'a2', 'p1');
  const page = sync.snapshot(grant);
  expect(page.complete).toBe(true);
  expect(page.deltas.map(d => d.threadId)).toEqual(['a1', 'a2']);
  // The filtered events sit inside the seq range as gaps — valid, never filled.
  const seqs = page.deltas.map(d => d.seq);
  expect(seqs[1]! - seqs[0]!).toBeGreaterThan(1);
  const decoded = JSON.parse(Buffer.from(page.nextCursor!.split('.')[0]!, 'base64url').toString()) as SyncCursorV1;
  // Now delete retained history under the cursor: the gap is missing, not filtered.
  store.db.prepare('DELETE FROM events WHERE seq <= ?').run(seqs[0]);
  expect(codeOf(() => sync.page(grant, signAs(sync, { ...decoded, afterSeq: 1 })))).toBe('RESYNC_REQUIRED');
});

it('M17-D04 revocation: revoking while building a page emits no authorized payload under the old generation', () => {
  const { store, sync, pairing } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  seedThread(store, 't2', 'p1');
  // Revoke during the scan — the pre-emission grant recheck kills the page.
  const live = (sync as unknown as { liveGrant(id: string): DeviceGrantV1 }).liveGrant.bind(sync);
  let calls = 0;
  vi.spyOn(sync as unknown as { liveGrant(id: string): DeviceGrantV1 }, 'liveGrant').mockImplementation((id: string) => {
    if (++calls > 1) throw new HarnessError('DEVICE_GRANT_REVOKED', 'revoked while building');
    return live(id);
  });
  expect(codeOf(() => sync.snapshot(grant))).toBe('DEVICE_GRANT_REVOKED');
  vi.restoreAllMocks();
  const snap = sync.snapshot(grant);
  pairing.revokeGrant(grant.grantId);
  expect(codeOf(() => sync.page(grant, snap.nextCursor!))).toBe('DEVICE_GRANT_REVOKED');
  expect(codeOf(() => sync.advance(grant, snap.nextCursor!))).toBe('DEVICE_GRANT_REVOKED');
});

it('M17-D05 read-only scope: a VIEW_TASKS device calling submit-input or operation-approve rejects before durable input admission', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store, { scopes: ['VIEW_TASKS'] });
  const before = store.sequence;
  expect(codeOf(() => sync.submitInput(grant, { text: 'run it', inputId: 'in-1' }))).toBe('REMOTE_INPUT_DISABLED');
  expect(codeOf(() => sync.approveOperation(grant, { operationId: 'op-1' }))).toBe('REMOTE_INPUT_DISABLED');
  // Rejected before admission: the durable log did not move.
  expect(store.sequence).toBe(before);
  // Even a SUBMIT_INPUT scope on paper cannot exercise the reserved path.
  const hypothetical = seedGrant(store, { scopes: ['VIEW_TASKS', 'SUBMIT_INPUT'] });
  expect(codeOf(() => sync.submitInput(hypothetical, { text: 'x' }))).toBe('REMOTE_INPUT_DISABLED');
});

it('M17-D06 offline replay: saved unsent text never executes; TLS failure has no plain-HTTP fallback', async () => {
  const { store, sync, pairing } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  const client = new ReadSyncClient();
  // Offline: save a draft, then reconnect — the draft is still unsent state.
  client.saveDraft('t1', 'ship it now');
  const offline: ReadSyncTransport = { snapshot: async () => { throw new Error('host unreachable'); }, page: async () => { throw new Error('host unreachable'); }, advance: async () => { throw new Error('host unreachable'); } };
  expect(await client.sync(offline)).toBe('OFFLINE');
  expect(client.drafts.get('t1')).toBe('ship it now');
  const online: ReadSyncTransport = {
    snapshot: async () => sync.snapshot(grant),
    page: async cursor => sync.page(grant, cursor),
    advance: async cursor => sync.advance(grant, cursor),
  };
  expect(await client.sync(online)).toBe('SYNCED');   // first sync also issues the host cursor key
  const before = store.sequence;
  expect(await client.sync(online)).toBe('SYNCED');   // reconnect with the saved draft
  expect(client.drafts.get('t1')).toBe('ship it now');
  expect(client.submitDraft('t1').submitted).toBe(false);
  // Nothing durable was admitted by reconnect or by the draft itself.
  expect(store.sequence).toBe(before);
  // A transport that cannot prove TLS+client-auth is never built as plain HTTP.
  await expect(buildRemoteReadSyncServer(pairing, sync, { host: '0.0.0.0', port: 80 })).rejects.toMatchObject({ code: 'REMOTE_TRANSPORT_DISABLED' });
  await expect(buildRemoteReadSyncServer(pairing, sync, null)).rejects.toMatchObject({ code: 'REMOTE_TRANSPORT_DISABLED' });
});
