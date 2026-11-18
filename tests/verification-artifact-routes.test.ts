import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {crc32, deflateSync} from 'node:zlib';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {VerificationArtifactStore} from '../packages/core/verification-artifacts.ts';
import {buildServer} from '../apps/server/server.ts';
import type {RuntimeAdapter, Thread} from '../packages/contracts/index.ts';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {for (const cleanup of cleanups.splice(0).reverse()) await cleanup();});
function png() {
  const chunk = (type: string, data: Buffer) => {const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;};
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(5))), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'verification-artifact-http-')), store = new Store(join(root, 'host'));
  const runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime, {}), stamp = new Date().toISOString();
  const thread: Thread = {id: 'artifact-owner', title: 'Verification', projectName: null, createdAt: stamp, updatedAt: stamp, status: 'working', epoch: 1, runId: 'r1', modelId: null, sessionPath: null};
  const owner = {threadId: thread.id, projectId: null, workspaceId: null, accountBinding: null, runId: 'r1', epoch: 1};
  store.internal('fixture.owners', thread.id, () => {store.put('thread', thread.id, thread.id, thread); store.put('thread', 'other-thread', 'other-thread', {...thread, id: 'other-thread'});});
  const artifacts = new VerificationArtifactStore(store), logText = 'Observed output\n<script>must remain text</script>\n';
  const log = artifacts.write({owner, executionId: 'execution', kind: 'LOG', bytes: Buffer.from(logText), truncated: true});
  const imageBytes = png(), image = artifacts.write({owner, executionId: 'execution', kind: 'SCREENSHOT', bytes: imageBytes, viewport: {width: 1, height: 1}});
  const app = await buildServer(service, {port: 4317, dev: false});
  cleanups.push(async () => {await app.close(); await service.dispose(); store.close(); rmSync(root, {recursive: true, force: true});});
  const bootstrap = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4317'}});
  const cookie = String(bootstrap.headers['set-cookie']).split(';')[0], headers = {host: '127.0.0.1:4317', cookie};
  const url = (ref: string, threadId = thread.id) => `/api/threads/${threadId}/verification/artifacts/${encodeURIComponent(ref.slice('verification-artifact:'.length))}`;
  return {root, store, thread, app, log, image, imageBytes, logText, headers, url};
}

it('serves exact retained log and PNG bytes through authenticated fixed-media routes', async () => {
  const f = await fixture(), log = await f.app.inject({url: f.url(f.log.ref), headers: f.headers});
  expect(log.statusCode).toBe(200); expect(log.body).toBe(f.logText);
  expect(log.headers).toMatchObject({'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'x-verification-artifact-truncated': 'true'});
  const image = await f.app.inject({url: f.url(f.image.ref), headers: f.headers});
  expect(image.statusCode).toBe(200); expect(image.headers['content-type']).toBe('image/png');
  expect(image.rawPayload.equals(f.imageBytes)).toBe(true);
  expect(image.headers).toMatchObject({'x-verification-viewport-width': '1', 'x-verification-viewport-height': '1', 'x-verification-artifact-sha256': f.image.sha256});
});

it('requires the existing host session and current durable owner for retained evidence', async () => {
  const f = await fixture();
  expect((await f.app.inject({url: f.url(f.log.ref), headers: {host: f.headers.host}})).statusCode).toBe(401);
  expect((await f.app.inject({url: f.url(f.log.ref, 'other-thread'), headers: f.headers})).statusCode).toBe(404);
  f.store.internal('fixture.new-run', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, runId: 'next-run', epoch: 2}));
  expect((await f.app.inject({url: f.url(f.log.ref), headers: f.headers})).statusCode).toBe(200);
  f.store.internal('fixture.new-account', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, accountId: 'another-account'}));
  const denied = await f.app.inject({url: f.url(f.log.ref), headers: f.headers});
  expect(denied.statusCode).toBe(404); expect(denied.body).not.toContain(f.logText);
});

it.each(['deleted', 'tampered', 'archived'] as const)('does not serve %s artifact bytes or leak internal paths', async mutation => {
  const f = await fixture(), path = join(f.store.dataDir, 'artifacts', 'verification-v1', f.image.ref.slice('verification-artifact:'.length) + '.bin');
  if (mutation === 'deleted') rmSync(path);
  else if (mutation === 'tampered') writeFileSync(path, 'tampered');
  else f.store.internal('fixture.archived', f.thread.id, () => f.store.put('archivedThread', f.thread.id, null, true));
  const response = await f.app.inject({url: f.url(f.image.ref), headers: f.headers});
  expect(response.statusCode).toBe(404); expect(response.body).not.toContain(f.root);
});

it('never resolves a raw path or unknown UUID as an artifact location', async () => {
  const f = await fixture(), outside = join(f.root, 'outside.txt'); writeFileSync(outside, 'outside private data');
  for (const id of [outside, '../outside.txt', '00000000-0000-4000-8000-000000000000']) {
    const response = await f.app.inject({url: `/api/threads/${f.thread.id}/verification/artifacts/${encodeURIComponent(id)}`, headers: f.headers});
    expect(response.statusCode).toBe(404); expect(response.body).not.toContain('outside private data');
  }
});
