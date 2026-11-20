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
  const store = new Store(await mkdtemp(join(tmpdir(), 'background-routes-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  const seed = () => store.internal('test.background.seeded', 'thread-1', () => {
    store.put('thread', 'thread-1', 'thread-1', { id: 'thread-1', kind: 'main', projectId: null, accountId: null, sideParentId: null });
    store.put('backgroundWork', 'work-1', 'thread-1', { id: 'work-1', state: 'RUNNING', owner: { threadId: 'thread-1' } });
    store.put('backgroundOutput', 'work-1', 'thread-1', { output: 'line-one\nline-two\n', start: 0 });
  });
  return { app, headers, seed };
}

it('serves the background drawer without caching and validates the thread filter', async () => {
  const { app, headers } = await fixture();
  const drawer = await app.inject({ url: '/api/background', headers });
  expect(drawer.statusCode).toBe(200);
  expect(drawer.headers['cache-control']).toBe('no-store');
  for (const key of ['works', 'schedules', 'humanSteps', 'idleOptIns', 'intake', 'closeSummary', 'sequence'])
    expect(drawer.json()).toHaveProperty(key);
  const oversized = await app.inject({ url: `/api/background?threadId=${'x'.repeat(201)}`, headers });
  expect(oversized.statusCode).toBe(400);
});

it('reads owned work output with cursor paging and fences other owners', async () => {
  const { app, headers, seed } = await fixture();
  for (const url of [
    '/api/background/work/work-1/output',
    '/api/background/work/work-1/output?threadId=thread-1&cursor=abc',
    '/api/background/work/work-1/output?threadId=thread-1&cursor=-1',
  ]) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
  }
  const missing = await app.inject({ url: '/api/background/work/no-such-work/output?threadId=thread-1', headers });
  expect(missing.statusCode).toBe(404);
  seed();
  const denied = await app.inject({ url: '/api/background/work/work-1/output?threadId=other-thread', headers });
  expect(denied.statusCode).toBe(403);
  expect(denied.json().error.code).toBe('CAPABILITY_DENIED');
  const page = await app.inject({ url: '/api/background/work/work-1/output?threadId=thread-1', headers });
  expect(page.statusCode).toBe(200);
  expect(page.headers['cache-control']).toBe('no-store');
  expect(page.json()).toMatchObject({ workId: 'work-1', output: 'line-one\nline-two\n', start: 0 });
  const tail = await app.inject({ url: `/api/background/work/work-1/output?threadId=thread-1&cursor=${page.json().cursor}`, headers });
  expect(tail.json()).toMatchObject({ output: '', truncated: false });
});
