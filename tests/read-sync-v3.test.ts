import { deferred } from './fixtures/deferred.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Store } from '../packages/storage/store.ts';
import { ReadSyncHost, ReadSyncClient, type ReadSyncTransport } from '../packages/core/read-sync.ts';
import { DevicePairingHost, remoteTransportDecision, buildRemoteReadSyncServer } from '../apps/server/device-pairing.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import {
  syncPageV1Schema,
  deviceGrantV1Schema,
  type DeviceGrantV1,
  type SyncCursorV1,
} from '../packages/contracts/paired-device.ts';
import { HarnessError } from '../packages/contracts/index.ts';

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
  const root = mkdtempSync(join(tmpdir(), 'm17-sync-'));
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
  return { root, dir, store, now, pairing, sync };
}

let grantSeq = 0;
function seedGrant(store: Store, overrides: Partial<DeviceGrantV1> = {}): DeviceGrantV1 {
  const n = ++grantSeq;
  const grant = deviceGrantV1Schema.parse({
    grantId: `devgrant-${n}`,
    deviceId: `device-${n}`,
    deviceIdentity: { deviceId: `device-${n}`, label: `Device ${n}`, fingerprint: `fp:${n}` },
    userBinding: 'local-host',
    approverSessionDigest: sha256(`session-${n}`),
    scopes: ['VIEW_TASKS'],
    approvedProjects: ['p1'],
    issuedAt: ISO,
    expiresAt: null,
    revokedAt: null,
    grantGeneration: 1,
    deviceTokenDigest: sha256(`token-${n}`),
    lastSeenAt: null,
    ...overrides,
  });
  store.internal('fixture.grant', null, () => store.put('deviceGrant', grant.grantId, null, grant));
  return grant;
}

function seedThread(store: Store, id: string, projectId: string | null, epoch = 1) {
  store.internal('fixture.thread', id, () => store.put('thread', id, id, {
    id, title: `Task ${id}`, status: 'open', epoch,
    projectId, projectName: projectId === 'p1' ? 'Project One' : projectId === 'p2' ? 'Project Two' : null,
    kind: 'main', updatedAt: ISO,
  }));
}

const signAs = (sync: ReadSyncHost, cursor: SyncCursorV1) => (sync as unknown as { sign(c: SyncCursorV1): string }).sign(cursor);

it('M17-C02/S04 snapshot emits an ordered public task projection over the authorized scope only', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  seedThread(store, 't2', 'p1');
  seedThread(store, 't3', 'p2');       // foreign project — a normal filtered gap
  seedThread(store, 't4', null);       // personal — not in approvedProjects
  const page = sync.snapshot(grant);
  expect(syncPageV1Schema.safeParse(page).success).toBe(true);
  expect(page.deltas.map(d => d.threadId)).toEqual(['t1', 't2']);
  expect(page.deltas.every(d => d.kind === 'task' && d.task)).toBe(true);
  expect(page.deltas.map(d => d.seq)).toEqual([...page.deltas.map(d => d.seq)].sort((a, b) => a - b));
  const projection = page.deltas[0]!.task!;
  expect(Object.keys(projection).sort()).toEqual(['epoch', 'kind', 'projectId', 'projectName', 'status', 'threadId', 'title', 'updatedAt']);
  expect(JSON.stringify(page)).not.toContain('sessionPath');
  expect(page.complete).toBe(true);
  expect(page.snapshotUpperSeq).toBe(store.sequence);
  expect(page.nextCursor).toBeTruthy();
});

it('M17-S05/D02 cursor replay returns the same slice; tampering, another grant and bad bounds reject', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store);
  const foreign = seedGrant(store, { approvedProjects: ['p2'] });
  seedThread(store, 't1', 'p1');
  seedThread(store, 't2', 'p2');
  const snap = sync.snapshot(grant);
  const replay = sync.page(grant, snap.nextCursor!);
  expect(replay.deltas).toEqual([]);
  expect(replay.complete).toBe(true);
  // Mutating the signed payload invalidates the tag.
  const [payload, signature] = snap.nextCursor!.split('.');
  const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as SyncCursorV1;
  const mutated = Buffer.from(JSON.stringify({ ...decoded, owner: foreign.grantId })).toString('base64url');
  expect(codeOf(() => sync.page(grant, `${mutated}.${signature}`))).toBe('INVALID_CURSOR');
  expect(codeOf(() => sync.page(grant, `${payload}.${'a'.repeat(43)}`))).toBe('INVALID_CURSOR');
  // A genuinely signed cursor under another owner's binding rejects too.
  expect(codeOf(() => sync.page(grant, signAs(sync, { ...decoded, owner: foreign.grantId })))).toBe('INVALID_CURSOR');
  expect(codeOf(() => sync.page(grant, signAs(sync, { ...decoded, filterDigest: '0'.repeat(64) })))).toBe('INVALID_CURSOR');
  expect(codeOf(() => sync.page(grant, signAs(sync, { ...decoded, deviceGrantGeneration: 7 })))).toBe('INVALID_CURSOR');
  // afterSeq beyond the immutable upper bound is invalid input, not a gap.
  expect(codeOf(() => sync.page(grant, signAs(sync, { ...decoded, afterSeq: decoded.snapshotUpperSeq + 1 })))).toBe('INVALID_CURSOR');
  // Another grant may not reuse this cursor at all.
  expect(codeOf(() => sync.page(foreign, snap.nextCursor!))).toBe('INVALID_CURSOR');
});

it('M17-S06/D03 a stale schema resyncs; a verified retention gap returns RESYNC_REQUIRED, never a silent skip', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  const snap = sync.snapshot(grant);
  const decoded = JSON.parse(Buffer.from(snap.nextCursor!.split('.')[0]!, 'base64url').toString()) as SyncCursorV1;
  expect(codeOf(() => sync.page(grant, signAs(sync, { ...decoded, schemaVersion: 99 })))).toBe('RESYNC_REQUIRED');
  // Delete retained source history below the cursor position: the gap is real.
  // The newest event stays so the floor sits above the cursor's position.
  store.db.prepare('DELETE FROM events WHERE seq < ?').run(decoded.afterSeq);
  expect(codeOf(() => sync.page(grant, signAs(sync, { ...decoded, afterSeq: 1 })))).toBe('RESYNC_REQUIRED');
});

it('M17-S05 page bounds: 1,000 authorized deltas per page over a fixed cut; paging resumes exactly at the cut', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store);
  const THREADS = 1100;
  store.internal('fixture.threads', null, () => {
    for (let i = 0; i < THREADS; i++) store.put('thread', `t${i}`, `t${i}`, { id: `t${i}`, title: `Task ${i}`, status: 'open', epoch: 1, projectId: 'p1', projectName: 'Project One', kind: 'main', updatedAt: ISO });
  });
  const insert = store.db.prepare('INSERT INTO events(id,type,thread_id,payload,occurred_at) VALUES(?,?,?,?,?)');
  store.db.exec('BEGIN');
  for (let i = 0; i < THREADS; i++) insert.run(`bound-ev-${i}`, 'task.updated', `t${i}`, '{}', ISO);
  store.db.exec('COMMIT');
  const first = sync.snapshot(grant);
  expect(first.deltas.length).toBe(1000);
  expect(first.complete).toBe(false);
  expect(first.afterSeq).toBeLessThan(first.snapshotUpperSeq);
  const second = sync.page(grant, first.nextCursor!);
  expect(second.deltas.length).toBe(100);
  expect(second.complete).toBe(true);
  const seen = new Set([...first.deltas, ...second.deltas].map(d => d.threadId));
  expect(seen.size).toBe(THREADS);
  // A single delta larger than the byte bound is dropped, never a stuck cursor.
  store.internal('fixture.huge', 'th', () => store.put('thread', 'th', 'th', { id: 'th', title: 'x'.repeat(1024 * 1024 + 100), status: 'open', epoch: 1, projectId: 'p1', projectName: 'Project One', kind: 'main', updatedAt: ISO }));
  const next = sync.advance(grant, second.nextCursor!);
  expect(next.deltas.every(d => d.threadId !== 'th')).toBe(true);
  expect(next.complete).toBe(true);
});

it('M17-T02/D04 revocation between pages or before emission stops authorized delivery', () => {
  const { store, sync, pairing } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  seedThread(store, 't2', 'p1');
  const snap = sync.snapshot(grant);
  // Revocation before emission: the post-scan recheck refuses the payload.
  const live = (sync as unknown as { liveGrant(id: string): DeviceGrantV1 }).liveGrant.bind(sync);
  let calls = 0;
  vi.spyOn(sync as unknown as { liveGrant(id: string): DeviceGrantV1 }, 'liveGrant').mockImplementation((id: string) => {
    if (++calls > 1) throw new HarnessError('DEVICE_GRANT_REVOKED', 'revoked mid-build');
    return live(id);
  });
  expect(codeOf(() => sync.snapshot(grant))).toBe('DEVICE_GRANT_REVOKED');
  vi.restoreAllMocks();
  // Revocation between pages: the old generation is dead.
  pairing.revokeGrant(grant.grantId);
  expect(codeOf(() => sync.page(grant, snap.nextCursor!))).toBe('DEVICE_GRANT_REVOKED');
  expect(codeOf(() => sync.snapshot(grant))).toBe('DEVICE_GRANT_REVOKED');
});

it('M17-D03/S04 VIEW_EVIDENCE emits evidence deltas only for evidence-class events under explicit scope', () => {
  const { store, sync } = fixture();
  const reader = seedGrant(store, { scopes: ['VIEW_TASKS'] });
  const evidenceReader = seedGrant(store, { scopes: ['VIEW_TASKS', 'VIEW_EVIDENCE'] });
  seedThread(store, 't1', 'p1');
  store.internal('artifact.published', 't1', () => store.put('artifact', 'a1', 't1', { id: 'a1', threadId: 't1', title: 'Report', kind: 'file', revision: 1, lifecycle: 'active', updatedAt: ISO }));
  const taskOnly = sync.snapshot(reader);
  expect(taskOnly.deltas.filter(d => d.kind === 'evidence')).toHaveLength(0);
  const withEvidence = sync.snapshot(evidenceReader);
  const evidence = withEvidence.deltas.filter(d => d.kind === 'evidence');
  expect(evidence).toHaveLength(1);
  expect(evidence[0]!.evidence![0]!.artifactId).toBe('a1');
  expect(Object.keys(evidence[0]!.evidence![0]!).sort()).toEqual(['artifactId', 'kind', 'lifecycle', 'revision', 'threadId', 'title', 'updatedAt']);
});

it('M17-S08/D05 submit-input and operation-approve reject before durable input admission', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store);
  expect(codeOf(() => sync.submitInput(grant, { text: 'do it', inputId: 'in-1' }))).toBe('REMOTE_INPUT_DISABLED');
  expect(codeOf(() => sync.approveOperation(grant, { operationId: 'op-1' }))).toBe('REMOTE_INPUT_DISABLED');
  // The flag stays off even when read sync is proven — gates are separate (G01/G02).
  expect(codeOf(() => { __setCapabilityFlagForTests('remote.submitInputV1', true); sync.submitInput(grant, {}); })).toBe('REMOTE_INPUT_DISABLED');
});

it('M17-S05/D05 advance is explicit: incomplete cursors reject, completed cuts move to new history', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  const snap = sync.snapshot(grant);
  expect(snap.complete).toBe(true);
  seedThread(store, 't2', 'p1');
  const moved = sync.advance(grant, snap.nextCursor!);
  expect(moved.deltas.map(d => d.threadId)).toEqual(['t2']);
  expect(moved.snapshotUpperSeq).toBeGreaterThan(snap.snapshotUpperSeq);
  // The replayed old cursor is still valid and unchanged (S05).
  const replay = sync.page(grant, snap.nextCursor!);
  expect(replay.afterSeq).toBe(snap.afterSeq);
});

it('M17-S10 multiple devices scope independently; revocation of one leaves the other', () => {
  const { store, sync, pairing } = fixture();
  const first = seedGrant(store, { approvedProjects: ['p1'] });
  const second = seedGrant(store, { approvedProjects: ['p2'] });
  seedThread(store, 't1', 'p1');
  seedThread(store, 't2', 'p2');
  expect(sync.snapshot(first).deltas.map(d => d.threadId)).toEqual(['t1']);
  expect(sync.snapshot(second).deltas.map(d => d.threadId)).toEqual(['t2']);
  pairing.revokeGrant(first.grantId);
  expect(codeOf(() => sync.snapshot(first))).toBe('DEVICE_GRANT_REVOKED');
  expect(sync.snapshot(second).deltas.map(d => d.threadId)).toEqual(['t2']);
});

it('M17-S10 cursor key persists across host restart; unknown or malformed custody blocks', () => {
  const { dir, store, sync } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  const snap = sync.snapshot(grant);
  store.close();
  const store2 = new Store(dir);
  cleanup.push(() => { try { store2.close(); } catch { /* closed */ } });
  const sync2 = new ReadSyncHost(store2);
  const replay = sync2.page(grant, snap.nextCursor!);
  expect(replay.complete).toBe(true);
  // Malformed custody: the key record exists but cannot be bound.
  store2.internal('fixture.badkey', null, () => store2.put('hostSecret', 'readSyncCursorKey', null, { version: 1, current: { keyId: 'k', material: 'short' }, previous: null }));
  expect(codeOf(() => sync2.snapshot(grant))).toBe('CURSOR_KEY_UNAVAILABLE');
});

it('M17-G02 the read-sync gate stays off without the host flag', () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store);
  __setCapabilityFlagForTests('remote.readSyncV1', false);
  expect(codeOf(() => sync.snapshot(grant))).toBe('CAPABILITY_DENIED');
  __setCapabilityFlagForTests('remote.readSyncV1', true);
  const snap = sync.snapshot(grant);
  __setCapabilityFlagForTests('remote.readSyncV1', false);
  expect(codeOf(() => sync.page(grant, snap.nextCursor!))).toBe('CAPABILITY_DENIED');
});

it('M17-S01/T05 remote transport is disabled without configured TLS+auth; there is no HTTP fallback', async () => {
  const { pairing, sync } = fixture();
  expect(remoteTransportDecision(undefined)).toEqual({ state: 'DISABLED', reason: 'REMOTE_TRANSPORT_DISABLED' });
  expect(remoteTransportDecision({ host: '0.0.0.0', port: 443 })).toEqual({ state: 'DISABLED', reason: 'REMOTE_TRANSPORT_DISABLED' });
  expect(remoteTransportDecision({ host: '0.0.0.0', port: 443, tls: { certPath: '/c', keyPath: '/k' }, clientAuth: true }).state).toBe('ENABLED');
  await expect(buildRemoteReadSyncServer(pairing, sync, {})).rejects.toMatchObject({ code: 'REMOTE_TRANSPORT_DISABLED' });
  // TLS identity configured but unreadable: still disabled, never plain HTTP.
  await expect(buildRemoteReadSyncServer(pairing, sync, { host: '127.0.0.1', port: 9443, tls: { certPath: '/nonexistent/cert.pem', keyPath: '/nonexistent/key.pem' }, clientAuth: true })).rejects.toMatchObject({ code: 'REMOTE_TRANSPORT_DISABLED' });
});

it('M17-C4 client: snapshot paging, Offline/Stale display, resync and explicit refresh', async () => {
  const { store, sync, now } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  const transport: ReadSyncTransport = {
    snapshot: async () => sync.snapshot(grant),
    page: async cursor => sync.page(grant, cursor),
    advance: async cursor => sync.advance(grant, cursor),
  };
  const client = new ReadSyncClient();
  expect(await client.sync(transport)).toBe('SYNCED');
  expect(client.tasks.has('t1')).toBe(true);
  expect(client.sourceTimestamp).toBe(new Date(now.value).toISOString());
  expect(client.freshness(now.value + 5_000)).toBe('SYNCED');
  expect(client.freshness(now.value + 31_000)).toBe('STALE');
  // Incremental refresh picks up new history at the same fixed-cut discipline.
  seedThread(store, 't2', 'p1');
  expect(await client.refresh(transport)).toBe('SYNCED');
  expect(client.tasks.has('t2')).toBe(true);
  // A dead transport reads OFFLINE, never an apparently current dashboard (U03).
  const dead: ReadSyncTransport = { snapshot: async () => { throw new Error('connection refused'); }, page: async () => { throw new Error('connection refused'); }, advance: async () => { throw new Error('connection refused'); } };
  expect(await client.sync(dead)).toBe('OFFLINE');
});

it('M17-T03/T04 duplicate and out-of-order pages stay consistent; drafts never execute offline', async () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  const transport: ReadSyncTransport = {
    snapshot: async () => sync.snapshot(grant),
    page: async cursor => sync.page(grant, cursor),
    advance: async cursor => sync.advance(grant, cursor),
  };
  const client = new ReadSyncClient();
  const gen = client.nextGeneration();
  const page = sync.snapshot(grant);
  expect(client.acceptPage(gen, page)).toBe('applied');
  expect(client.acceptPage(gen, page)).toBe('applied');          // duplicate is idempotent
  expect(client.acceptPage(gen - 1, page)).toBe('stale');         // an older request's response
  expect(client.acceptPage(gen, { ...page, afterSeq: 0 })).toBe('stale');
  expect(client.acceptPage(gen, { deltas: 'nope' })).toBe('invalid');
  // S07/T04: offline drafts stay editable and are never delivered instructions.
  client.saveDraft('t1', 'remember the milk');
  expect(client.submitDraft('t1')).toEqual({ submitted: false, reason: 'REMOTE_INPUT_DISABLED' });
  await client.sync(transport);
  expect(client.drafts.get('t1')).toBe('remember the milk');
  expect(client.tasks.has('t1')).toBe(true);
  client.clearCache();
  expect(client.tasks.size).toBe(0);
  expect(client.status).toBe('OFFLINE');
  expect(client.drafts.get('t1')).toBe('remember the milk');       // local drafts retained on cache clear
});

it('M17-S06/U03 a verified gap on refresh marks RESYNCING then repairs from a fresh snapshot', async () => {
  const { store, sync } = fixture();
  const grant = seedGrant(store);
  seedThread(store, 't1', 'p1');
  const client = new ReadSyncClient();
  const online: ReadSyncTransport = {
    snapshot: async () => sync.snapshot(grant),
    page: async cursor => sync.page(grant, cursor),
    advance: async cursor => sync.advance(grant, cursor),
  };
  expect(await client.sync(online)).toBe('SYNCED');
  let snapshotCalls = 0;
  const gappy: ReadSyncTransport = {
    snapshot: async () => { snapshotCalls++; return sync.snapshot(grant); },
    page: async cursor => sync.page(grant, cursor),
    advance: async () => { throw new HarnessError('RESYNC_REQUIRED', 'retained history is missing'); },
  };
  expect(await client.refresh(gappy)).toBe('SYNCED');
  expect(snapshotCalls).toBe(1);
  expect(client.tasks.has('t1')).toBe(true);
});

it('M17 pairing → sync end-to-end: only an approved device reads, and only its projects', () => {
  const { store, pairing, sync } = fixture();
  seedThread(store, 't1', 'p1');
  seedThread(store, 'tp', null);
  const issued = pairing.issueChallenge('session:host');
  const claimed = pairing.claimChallenge(issued.challenge, { deviceId: 'phone-9', label: 'Phone', fingerprint: 'fp:9' }, { scopes: ['VIEW_TASKS'], projects: ['p1', 'personal'] }, 'remote:phone');
  const { grant } = pairing.confirmChallenge(claimed.pairingId, { scopes: ['VIEW_TASKS'], projects: ['p1', 'personal'] }, 'host-session-1');
  const page = sync.snapshot(grant);
  expect(page.deltas.map(d => d.threadId).sort()).toEqual(['t1', 'tp']);
});

it('keeps a device cache cleared when an earlier snapshot completes later', async () => {
  const {store, sync} = fixture();
  const grant = seedGrant(store);
  seedThread(store, 'before-clear', 'p1');
  const pending = deferred<ReturnType<ReadSyncHost['snapshot']>>();
  const client = new ReadSyncClient();
  const inFlight = client.sync({
    snapshot: () => pending.promise,
    page: async cursor => sync.page(grant, cursor),
    advance: async cursor => sync.advance(grant, cursor),
  });
  client.saveDraft('local', 'unsent note');
  client.clearCache();
  pending.resolve(sync.snapshot(grant));
  await expect(inFlight).resolves.toBe('OFFLINE');
  expect(client.tasks.size).toBe(0);
  expect(client.sourceTimestamp).toBeNull();
  expect(client.drafts.get('local')).toBe('unsent note');
});

it('keeps successful read sync status when an older refresh fails later', async () => {
  const {store, sync} = fixture();
  const grant = seedGrant(store);
  seedThread(store, 'initial', 'p1');
  const client = new ReadSyncClient();
  const online = {
    snapshot: async () => sync.snapshot(grant),
    page: async (cursor: string) => sync.page(grant, cursor),
    advance: async (cursor: string) => sync.advance(grant, cursor),
  };
  await client.sync(online);
  const earlier = deferred<ReturnType<ReadSyncHost['advance']>>();
  const inFlight = client.refresh({...online, advance: () => earlier.promise});
  seedThread(store, 'later', 'p1');
  await expect(client.refresh(online)).resolves.toBe('SYNCED');
  earlier.reject(new Error('Earlier request disconnected'));
  await expect(inFlight).resolves.toBe('SYNCED');
  expect(client.tasks.has('later')).toBe(true);
  expect(client.lastError).toBeNull();
});
