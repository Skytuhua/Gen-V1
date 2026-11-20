import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import type { RuntimeAdapter } from '../packages/contracts/index.ts';
import { buildServer } from '../apps/server/server.ts';

const close: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of close.splice(0)) await action(); });
async function fixture() {
  const store = new Store(await mkdtemp(join(tmpdir(), 'session-branch-read-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  const seed = () => store.internal('test.session-branch.seeded', 'thread-1', () => {
    store.put('thread', 'thread-1', 'thread-1', { id: 'thread-1', kind: 'main', projectId: null, accountId: null, sideParentId: null });
    store.put('sessionCapture', 'capture-1', 'thread-1', {
      version: 1, captureId: 'capture-1', sourceThreadId: 'thread-1',
      owner: { threadId: 'thread-1', projectId: null, accountId: null, kind: 'main', sideParentId: null },
      sourceCut: { sequence: 1, messageCount: 3, revisionDigest: 'a'.repeat(64) },
      coverage: 'COMPLETE', truncated: 0, incompleteSource: [],
      messages: ['m1', 'm2', 'm3'].map(id => ({ id, role: 'user', createdAt: '2026-11-20T00:00:00Z', runId: null, revision: 'b'.repeat(64), content: `content-${id}` })),
      createdAt: '2026-11-20T00:00:00Z',
    });
  });
  return { app, headers, seed };
}

it('serves a no-store overview for an owned thread and denies unknown owners', async () => {
  const { app, headers, seed } = await fixture();
  const denied = await app.inject({ url: '/api/session-branches/no-such-thread', headers });
  expect(denied.statusCode).toBe(403);
  expect(denied.json().error.code).toBe('CAPABILITY_DENIED');
  seed();
  const overview = await app.inject({ url: '/api/session-branches/thread-1', headers });
  expect(overview.statusCode).toBe(200);
  expect(overview.headers['cache-control']).toBe('no-store');
  const body = overview.json();
  expect(body.enabled).toMatchObject({ branch: expect.any(Boolean), import: expect.any(Boolean) });
  expect(body.captures).toHaveLength(1);
  expect(body.captures[0]).not.toHaveProperty('messages');
});

it('pages capture messages newest-first with a signed cursor and rejects forged input', async () => {
  const { app, headers, seed } = await fixture();
  seed();
  const missing = await app.inject({ url: '/api/session-branches/captures/no-such-capture/messages', headers });
  expect(missing.statusCode).toBe(403);
  for (const url of [
    '/api/session-branches/captures/capture-1/messages?limit=0',
    '/api/session-branches/captures/capture-1/messages?limit=101',
    '/api/session-branches/captures/capture-1/messages?limit=abc',
    '/api/session-branches/captures/capture-1/messages?cursor=forged',
  ]) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
  }
  const forged = await app.inject({ url: '/api/session-branches/captures/capture-1/messages?cursor=forged', headers });
  expect(forged.json().error.code).toBe('INVALID_CURSOR');
  const page1 = (await app.inject({ url: '/api/session-branches/captures/capture-1/messages?limit=1', headers })).json();
  expect(page1.messages.map((m: { id: string }) => m.id)).toEqual(['m3']);
  expect(page1.nextCursor).toBeTruthy();
  const page2 = (await app.inject({ url: `/api/session-branches/captures/capture-1/messages?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`, headers })).json();
  expect(page2.messages.map((m: { id: string }) => m.id)).toEqual(['m2']);
  const page3 = (await app.inject({ url: `/api/session-branches/captures/capture-1/messages?limit=1&cursor=${encodeURIComponent(page2.nextCursor)}`, headers })).json();
  expect(page3.messages.map((m: { id: string }) => m.id)).toEqual(['m1']);
  expect(page3.nextCursor).toBeNull();
});

it('denies imported-message reads for unknown or cross-owner conversations', async () => {
  const { app, headers } = await fixture();
  const response = await app.inject({ url: '/api/session-branches/imports/no-such-import/messages', headers });
  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe('CAPABILITY_DENIED');
});
