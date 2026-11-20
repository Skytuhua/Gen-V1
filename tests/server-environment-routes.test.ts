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
  const store = new Store(await mkdtemp(join(tmpdir(), 'environment-routes-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  return { app, headers };
}

it('serves empty environment metadata without caching', async () => {
  const { app, headers } = await fixture();
  const response = await app.inject({ url: '/api/environment', headers });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toMatchObject({ revision: 0, appliesTo: 'new-project-terminals', entries: [] });
});

it('saves and removes a device-scoped value with revision fencing', async () => {
  const { app, headers } = await fixture();
  const saved = await app.inject({ method: 'PUT', url: '/api/environment', headers, payload: { scope: 'device', name: 'EXAMPLE_SWEEP_VALUE', value: 'one', secret: false, baseRevision: 0 } });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({ revision: 1 });
  const entry = saved.json().entries[0];
  expect(entry).toMatchObject({ scope: 'device', name: 'EXAMPLE_SWEEP_VALUE', configured: true });
  expect(entry).not.toHaveProperty('stored');
  const stale = await app.inject({ method: 'PUT', url: '/api/environment', headers, payload: { scope: 'device', name: 'EXAMPLE_SWEEP_VALUE', value: 'two', secret: false, baseRevision: 0 } });
  expect(stale.statusCode).toBe(400);
  expect(stale.json().error.code).toBe('ENVIRONMENT_CHANGED');
  const removed = await app.inject({ method: 'DELETE', url: '/api/environment', headers, payload: { scope: 'device', name: 'EXAMPLE_SWEEP_VALUE', baseRevision: 1 } });
  expect(removed.statusCode).toBe(200);
  expect(removed.json().entries).toHaveLength(0);
});

it('rejects invalid scopes, reserved names and unauthenticated writes', async () => {
  const { app, headers } = await fixture();
  const base = { name: 'EXAMPLE_SWEEP_VALUE', value: 'x', secret: false, baseRevision: 0 };
  for (const payload of [
    { ...base, scope: 'bogus' },
    { ...base, scope: 'project:no-such-project' },
    { ...base, scope: 'device', name: 'PATH' },
    { ...base, scope: 'device', name: 'lowercase' },
    { ...base, scope: 'device', value: '' },
  ]) {
    const response = await app.inject({ method: 'PUT', url: '/api/environment', headers, payload });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  }
  const projectScope = await app.inject({ method: 'PUT', url: '/api/environment', headers, payload: { ...base, scope: 'project:no-such-project' } });
  expect(projectScope.json().error.code).toBe('CAPABILITY_DENIED');
  const noCsrf = { host: headers.host, cookie: headers.cookie };
  const unauthenticated = await app.inject({ method: 'PUT', url: '/api/environment', headers: noCsrf, payload: { ...base, scope: 'device' } });
  expect(unauthenticated.statusCode).toBe(403);
});
