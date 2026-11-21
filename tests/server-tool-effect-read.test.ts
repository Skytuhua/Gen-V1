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
  const store = new Store(await mkdtemp(join(tmpdir(), 'tool-effect-read-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  const seedThread = (id: string) => store.internal('test.thread.seeded', id, () => store.put('thread', id, id, { id }));
  return { store, app, headers, seedThread };
}

it('opens a no-store ledger context for an owned thread and 404s an unknown one', async () => {
  const { app, headers, seedThread } = await fixture();
  const missing = await app.inject({ url: '/api/tool-effects/no-such-thread', headers });
  expect(missing.statusCode).toBe(404);
  expect(missing.json().error.code).toBe('NOT_FOUND');
  seedThread('thread-1');
  const context = await app.inject({ url: '/api/tool-effects/thread-1', headers });
  expect(context.statusCode).toBe(200);
  expect(context.headers['cache-control']).toBe('no-store');
  expect(context.json()).toMatchObject({ authority: 'personal', threadId: 'thread-1', freshness: 'CURRENT' });
  expect(context.json().scopeKey).toMatch(/^[a-f0-9]{64}$/);
});

it('validates the invocation page query and rejects forged scope keys and cursors', async () => {
  const { app, headers, seedThread } = await fixture();
  seedThread('thread-1');
  const context = (await app.inject({ url: '/api/tool-effects/thread-1', headers })).json() as { scopeKey: string };
  for (const url of [
    '/api/tool-effects/thread-1/invocations',
    '/api/tool-effects/thread-1/invocations?scopeKey=abc',
    `/api/tool-effects/thread-1/invocations?scopeKey=${'f'.repeat(64)}`,
    `/api/tool-effects/thread-1/invocations?scopeKey=${context.scopeKey}&limit=0`,
    `/api/tool-effects/thread-1/invocations?scopeKey=${context.scopeKey}&limit=51`,
    `/api/tool-effects/thread-1/invocations?scopeKey=${context.scopeKey}&limit=abc`,
    `/api/tool-effects/thread-1/invocations?scopeKey=${context.scopeKey}&cursor=forged`,
  ]) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
  }
  const forged = await app.inject({ url: `/api/tool-effects/thread-1/invocations?scopeKey=${'f'.repeat(64)}`, headers });
  expect(forged.json().error.code).toBe('RESYNC_REQUIRED');
  const page = await app.inject({ url: `/api/tool-effects/thread-1/invocations?scopeKey=${context.scopeKey}&limit=50`, headers });
  expect(page.statusCode).toBe(200);
  expect(page.headers['cache-control']).toBe('no-store');
  expect(page.json()).toMatchObject({ effects: [], nextCursor: null });
});

it('serves observations only for captured invocations of the same scope', async () => {
  const { app, headers, seedThread } = await fixture();
  seedThread('thread-1');
  const context = (await app.inject({ url: '/api/tool-effects/thread-1', headers })).json() as { scopeKey: string };
  const missingId = await app.inject({ url: `/api/tool-effects/thread-1/observations?scopeKey=${context.scopeKey}`, headers });
  expect(missingId.statusCode).toBe(400);
  const unknown = await app.inject({ url: `/api/tool-effects/thread-1/observations?scopeKey=${context.scopeKey}&invocationId=never-dispatched`, headers });
  expect(unknown.statusCode).toBe(404);
  expect(unknown.json().error.code).toBe('NOT_FOUND');
  const revokedScope = await app.inject({ url: `/api/tool-effects/thread-1/observations?scopeKey=${'0'.repeat(64)}&invocationId=x`, headers });
  expect(revokedScope.statusCode).toBe(400);
  expect(revokedScope.json().error.code).toBe('RESYNC_REQUIRED');
});
