import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import type { RuntimeAdapter } from '../packages/contracts/index.ts';
import { buildServer } from '../apps/server/server.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';

const close: (() => Promise<void>)[] = [];
afterEach(async () => { __setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined); for (const action of close.splice(0)) await action(); });
async function fixture() {
  const store = new Store(await mkdtemp(join(tmpdir(), 'source-workbench-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  const seed = () => store.internal('test.workbench.seeded', 'thread-1', () => {
    store.put('thread', 'thread-1', 'thread-1', { id: 'thread-1', kind: 'main', projectId: null, accountId: null, sideParentId: null });
  });
  return { app, headers, seed };
}

it('serves no-store read models for an owned thread and denies unknown owners', async () => {
  const { app, headers, seed } = await fixture();
  const denied = await app.inject({ url: '/api/workbench/threads/no-such-thread', headers });
  expect(denied.statusCode).toBe(403);
  expect(denied.json().error.code).toBe('CAPABILITY_DENIED');
  seed();
  const list = await app.inject({ url: '/api/workbench/threads/thread-1', headers });
  expect(list.statusCode).toBe(200);
  expect(list.headers['cache-control']).toBe('no-store');
  expect(list.json()).toMatchObject({ logicalOwner: { threadId: 'thread-1' }, enabled: false, sources: [] });
  for (const path of ['evidence', 'context', 'inputs']) {
    const response = await app.inject({ url: `/api/workbench/threads/thread-1/${path}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  }
});

it('rejects malformed thread ids and unexpected query parameters', async () => {
  const { app, headers, seed } = await fixture();
  seed();
  for (const url of [
    '/api/workbench/threads/bad%20id',
    '/api/workbench/threads/thread-1?extra=1',
    '/api/workbench/threads/thread-1/context?x=y',
  ]) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
  }
});

it('gates mutations on the workbench flag and CSRF, then validates bodies', async () => {
  const { app, headers, seed } = await fixture();
  seed();
  const validRead = { logicalOwner: { threadId: 'thread-1', projectId: null, workspaceId: null }, messageIds: ['m1'], sourceRevision: 'a'.repeat(64) };
  const malformed = await app.inject({ method: 'POST', url: '/api/workbench/output/read', headers, payload: {} });
  expect(malformed.statusCode).toBe(400);
  const disabled = await app.inject({ method: 'POST', url: '/api/workbench/output/read', headers, payload: validRead });
  expect(disabled.statusCode).toBe(403);
  expect(disabled.json().error.code).toBe('CAPABILITY_DENIED');
  const noCsrf = { host: headers.host, cookie: headers.cookie };
  const unauthenticated = await app.inject({ method: 'POST', url: '/api/workbench/output/read', headers: noCsrf, payload: {} });
  expect(unauthenticated.statusCode).toBe(403);
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  const missingMessage = await app.inject({ method: 'POST', url: '/api/workbench/output/read', headers, payload: validRead });
  expect(missingMessage.statusCode).toBe(403);
});
