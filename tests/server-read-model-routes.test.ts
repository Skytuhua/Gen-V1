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
  const store = new Store(await mkdtemp(join(tmpdir(), 'read-model-routes-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  return { app, headers };
}

it('validates the operation execution review target and 404s unknown operations', async () => {
  const { app, headers } = await fixture();
  for (const url of [
    '/api/operation-execution-review',
    '/api/operation-execution-review?threadId=thread-1&operationId=op-1&operationRevision=0',
    '/api/operation-execution-review?threadId=thread-1&operationId=op-1&operationRevision=abc',
    '/api/operation-execution-review?threadId=thread-1&operationId=op-1&operationRevision=1&extra=1',
  ]) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
  }
  const missing = await app.inject({ url: '/api/operation-execution-review?threadId=thread-1&operationId=op-1&operationRevision=1', headers });
  expect(missing.statusCode).toBe(404);
  expect(missing.headers['cache-control']).toBe('no-store');
  expect(missing.json().error.code).toBe('NOT_FOUND');
});

it('serves integration secret reference status without caching and rejects query keys', async () => {
  const { app, headers } = await fixture();
  const response = await app.inject({ url: '/api/integrations/secret-references', headers });
  expect([200, 400]).toContain(response.statusCode);
  expect(response.headers['cache-control']).toBe('no-store');
  if (response.statusCode === 400) expect(response.json().error.code).toBe('INTEGRATION_UNAVAILABLE');
  const extra = await app.inject({ url: '/api/integrations/secret-references?x=1', headers });
  expect(extra.statusCode).toBe(400);
});
