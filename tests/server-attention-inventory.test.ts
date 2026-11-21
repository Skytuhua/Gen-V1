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
  const store = new Store(await mkdtemp(join(tmpdir(), 'attention-inventory-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  return { store, app, headers };
}

it('serves the attention inbox without caching and rejects malformed commands', async () => {
  const { app, headers } = await fixture();
  const inbox = await app.inject({ url: '/api/attention', headers });
  expect(inbox.statusCode).toBe(200);
  expect(inbox.headers['cache-control']).toBe('no-store');
  expect(await app.inject({ method: 'POST', url: '/api/attention/event-1/commands', headers, payload: { id: 'c1', type: 'explode' } })).toMatchObject({ statusCode: 400 });
});

it('returns 404 for commands on unknown attention items', async () => {
  const { app, headers } = await fixture();
  const response = await app.inject({ method: 'POST', url: '/api/attention/no-such-event/commands', headers, payload: { id: 'c1', type: 'read' } });
  expect(response.statusCode).toBe(404);
  expect(response.json().error.code).toBe('NOT_FOUND');
});

it('serves the personal agent inventory and validates paging and scope', async () => {
  const { app, headers } = await fixture();
  const inventory = await app.inject({ url: '/api/agents', headers });
  expect(inventory.statusCode).toBe(200);
  expect(inventory.headers['cache-control']).toBe('no-store');
  for (const url of ['/api/agents?limit=0', '/api/agents?limit=101', '/api/agents?status=not-a-status', '/api/agents/history', '/api/agents/updates?scopeKey=all'])
    expect((await app.inject({ url, headers })).statusCode).toBe(400);
});

it('accepts the issued scope key and rejects a forged one on updates', async () => {
  const { app, headers } = await fixture();
  const page = (await app.inject({ url: '/api/agents', headers })).json() as { scopeKey: string; sequence: number };
  const updates = await app.inject({ url: `/api/agents/updates?scopeKey=${encodeURIComponent(page.scopeKey)}&after=${page.sequence}`, headers });
  expect(updates.statusCode).toBe(200);
  expect(updates.json()).toMatchObject({ authority: 'personal', scopeKey: page.scopeKey });
  const forged = await app.inject({ url: '/api/agents/updates?scopeKey=forged&after=0', headers });
  expect(forged.statusCode).toBe(400);
  expect(forged.json().error.code).toBe('INVALID_SCOPE');
});
