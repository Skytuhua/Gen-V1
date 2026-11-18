import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Socket } from 'node:net';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store.ts';
import { ReadSyncHost } from '../packages/core/read-sync.ts';
import { DevicePairingHost, buildRemoteReadSyncServer } from '../apps/server/device-pairing.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { syncPageV1Schema } from '../packages/contracts/paired-device.ts';

/** M17 owned-test transport proof (manager-approved scope): a disposable
 * loopback-only TLS endpoint with ephemeral CA/server certificates exercises
 * the real buildRemoteReadSyncServer lifecycle — TLS identity enforcement,
 * unauthenticated rejection, pairing claim, authenticated bounded read,
 * resnapshot, input-gate denial, revocation and teardown. Private keys are
 * written only to a tmpdir removed in afterEach — never committed. This
 * proves owned-test transport only; deployment and remote-input holds stand. */

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  __setCapabilityFlagForTests('remote.readSyncV1', undefined);
  __setCapabilityFlagForTests('remote.submitInputV1', undefined);
});

const ISO = new Date(1_700_000_000_000).toISOString();
const openssl = (...args: string[]) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

function makeCertificateAuthority(dir: string, name: string) {
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '1',
    '-subj', `/CN=${name}`, '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.crt`));
}
function makeServerCertificate(dir: string, caName: string) {
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-subj', '/CN=localhost', '-keyout', join(dir, 'server.key'), '-out', join(dir, 'server.csr'));
  writeFileSync(join(dir, 'server.ext'), 'subjectAltName=IP:127.0.0.1,DNS:localhost\n');
  openssl('x509', '-req', '-in', join(dir, 'server.csr'),
    '-CA', join(dir, `${caName}.crt`), '-CAkey', join(dir, `${caName}.key`), '-CAcreateserial',
    '-days', '1', '-extfile', join(dir, 'server.ext'), '-out', join(dir, 'server.crt'));
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

interface RemoteReply { status: number; authorized: boolean; body: string }
function remote(port: number, caPath: string, path: string, options: { method?: string; token?: string; body?: unknown; ca?: string } = {}): Promise<RemoteReply> {
  const opts: RequestOptions = {
    host: '127.0.0.1', port, path, method: options.method ?? 'GET',
    ca: readFileSync(options.ca ?? caPath, 'utf8'), rejectUnauthorized: true,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
  };
  return new Promise((resolve, reject) => {
    const req = httpsRequest(opts, res => {
      const authorized = (res.socket as { authorized?: boolean } | null)?.authorized === true;
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, authorized, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    if (options.body !== undefined) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'm17-transport-'));
  const store = new Store(join(root, 'data'));
  const now = { value: 1_700_000_000_000 };
  const pairing = new DevicePairingHost(store, { now: () => now.value });
  const sync = new ReadSyncHost(store, { now: () => now.value });
  cleanup.push(() => { try { store.close(); } catch { /* closed */ } rmSync(root, { recursive: true, force: true }); });
  store.internal('fixture.projects', null, () => {
    store.put('workspaceProject', 'p1', null, { id: 'p1', name: 'Project One', authority: { kind: 'local' } });
    store.put('workspaceProject', 'p2', null, { id: 'p2', name: 'Project Two', authority: { kind: 'local' } });
  });
  for (const [id, projectId] of [['t1', 'p1'], ['t2', 'p1'], ['t3', 'p2'], ['t4', null]] as const) {
    store.internal('fixture.thread', id, () => store.put('thread', id, id, {
      id, title: `Task ${id}`, status: 'open', epoch: 1,
      projectId, projectName: projectId === 'p1' ? 'Project One' : projectId === 'p2' ? 'Project Two' : null,
      kind: 'main', updatedAt: ISO,
    }));
  }
  __setCapabilityFlagForTests('remote.readSyncV1', true);
  return { store, pairing, sync };
}

it('M17-S01 owned-test TLS transport: identity enforcement, auth gate, bounded read, revocation and teardown', async () => {
  const { store, pairing, sync } = fixture();
  const certs = mkdtempSync(join(tmpdir(), 'm17-certs-'));
  cleanup.push(() => rmSync(certs, { recursive: true, force: true }));
  makeCertificateAuthority(certs, 'm17-test-ca');
  makeCertificateAuthority(certs, 'm17-wrong-ca');
  makeServerCertificate(certs, 'm17-test-ca');

  const port = await freeLoopbackPort();
  const config = { host: '127.0.0.1', port, tls: { certPath: join(certs, 'server.crt'), keyPath: join(certs, 'server.key') }, clientAuth: true as const };
  const app = await buildRemoteReadSyncServer(pairing, sync, config);
  await app.listen({ host: config.host, port });
  cleanup.push(() => app.close());
  const caPath = join(certs, 'm17-test-ca.crt');

  // 1. TLS identity: a client trusting a different CA never reaches HTTP.
  await expect(remote(port, caPath, '/remote/sync/snapshot', { ca: join(certs, 'm17-wrong-ca.crt') })).rejects.toThrow();

  // 2. No insecure fallback: raw HTTP bytes on the TLS port get no HTTP reply.
  const plain = await new Promise<string>(resolve => {
    const s = new Socket();
    let data = '';
    s.setTimeout(3000);
    s.connect(port, '127.0.0.1', () => s.write('GET /remote/sync/snapshot HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n'));
    s.on('data', chunk => { data += chunk.toString('utf8'); });
    s.on('timeout', () => { s.destroy(); resolve(data); });
    s.on('error', () => resolve(data));
    s.on('close', () => resolve(data));
  });
  expect(plain).not.toContain('HTTP/');

  // 3. Bearer credential required before any route work.
  expect((await remote(port, caPath, '/remote/sync/snapshot')).status).toBe(401);
  expect((await remote(port, caPath, '/remote/sync/snapshot', { token: 'not-hex' })).status).toBe(401);
  expect((await remote(port, caPath, '/remote/sync/snapshot', { token: '0'.repeat(64) })).status).toBe(401);

  // 4. The only unauthenticated remote route is the pairing claim.
  const issued = pairing.issueChallenge('transport-test');
  const claim = await remote(port, caPath, '/remote/pair/claim', {
    method: 'POST',
    body: { challenge: issued.challenge, deviceIdentity: { deviceId: 'test-device', label: 'Test Phone', fingerprint: 'fp:test' }, scopes: ['VIEW_TASKS'], projects: ['p1'] },
  });
  expect(claim.status).toBe(200);
  const claimed = JSON.parse(claim.body) as { state: string; deviceIdentity: { deviceId: string } | null };
  expect(claimed.state).toBe('PENDING_APPROVAL');
  expect(claimed.deviceIdentity?.deviceId).toBe('test-device');

  // 5. Host-side authenticated approval produces the bearer credential.
  const { grant, deviceToken } = pairing.confirmChallenge(issued.pairingId, { scopes: ['VIEW_TASKS'], projects: ['p1'] }, 'session-transport-test');
  expect(grant.deviceId).toBe('test-device');

  // 6. Authenticated bounded read: TLS verified, public projection only.
  const snapshot = await remote(port, caPath, '/remote/sync/snapshot', { token: deviceToken });
  expect(snapshot.status).toBe(200);
  expect(snapshot.authorized).toBe(true);
  const page = syncPageV1Schema.parse(JSON.parse(snapshot.body));
  expect(page.authority).toBe('personal');
  expect(page.deltas.map(d => d.threadId)).toEqual(['t1', 't2']);
  expect(page.deltas.every(d => d.kind === 'task' && d.task !== null)).toBe(true);
  expect(page.deltas.length).toBeLessThanOrEqual(1000);
  expect(page.nextCursor).not.toBeNull();
  expect(page.complete).toBe(true);

  // 7. Reconnect/resnapshot is idempotent; completed cursor replays the same cut.
  const again = await remote(port, caPath, '/remote/sync/snapshot', { token: deviceToken });
  expect(again.status).toBe(200);
  const replay = await remote(port, caPath, `/remote/sync/page?cursor=${encodeURIComponent(page.nextCursor!)}`, { token: deviceToken });
  expect(replay.status).toBe(200);
  const remainder = syncPageV1Schema.parse(JSON.parse(replay.body));
  expect(remainder.complete).toBe(true);
  expect(remainder.deltas).toEqual([]);
  const advanced = await remote(port, caPath, `/remote/sync/page?cursor=${encodeURIComponent(page.nextCursor!)}&advance=1`, { token: deviceToken });
  expect(advanced.status).toBe(200);

  // 8. Remote input and operation approval stay denied over a live transport.
  const submit = await remote(port, caPath, '/remote/input/submit', { method: 'POST', token: deviceToken, body: { text: 'do not run' } });
  expect(submit.status).toBe(403);
  expect(submit.body).toContain('REMOTE_INPUT_DISABLED');
  const approve = await remote(port, caPath, '/remote/operations/approve', { method: 'POST', token: deviceToken, body: { operationId: 'op-1' } });
  expect(approve.status).toBe(403);
  expect(approve.body).toContain('REMOTE_INPUT_DISABLED');

  // 9. Revocation kills the credential immediately.
  pairing.revokeGrant(grant.grantId);
  const revoked = await remote(port, caPath, '/remote/sync/snapshot', { token: deviceToken });
  expect(revoked.status).toBe(403);
  expect(revoked.body).toContain('DEVICE_GRANT_REVOKED');

  // 10. Teardown: the listener closes; nothing else was bound.
  await app.close();
  await expect(new Promise<void>((resolve, reject) => {
    const s = new Socket();
    s.setTimeout(2000);
    s.once('error', () => resolve());
    s.once('timeout', () => { s.destroy(); resolve(); });
    s.connect(port, '127.0.0.1', () => { s.destroy(); reject(new Error('listener still open')); });
  })).resolves.toBeUndefined();
  void store;
});
