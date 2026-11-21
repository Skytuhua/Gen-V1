import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RuntimeAdapter } from '../packages/contracts/index.ts';
import { terminalShellCatalogSchema } from '../packages/contracts/terminal-shell.ts';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { buildServer } from '../apps/server/server.ts';

// Catalog reads never spawn a PTY on any platform.
vi.mock('node-pty', () => ({ spawn: () => { throw new Error('Catalog must not spawn a terminal.'); } }));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gen-shells-http-'));
  const store = new Store(join(root, 'data'));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  cleanup.push(async () => { await app.close(); await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); });
  const bootstrap = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } });
  const headers = { host: '127.0.0.1:4317', cookie: String(bootstrap.headers['set-cookie']).split(';')[0]! };
  return { app, headers };
}

it('serves a schema-valid catalog with no-store caching', async () => {
  const f = await fixture();
  const response = await f.app.inject({ url: '/api/terminal-shells', headers: f.headers });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const catalog = terminalShellCatalogSchema.parse(response.json());
  expect(catalog.platform).toBe(process.platform === 'win32' ? 'win32' : process.platform);
  expect(catalog.options[0]).toMatchObject({ kind: 'default', availability: 'available' });
});

it('accepts refresh=1 and rejects every other query shape', async () => {
  const f = await fixture();
  expect((await f.app.inject({ url: '/api/terminal-shells?refresh=1', headers: f.headers })).statusCode).toBe(200);
  for (const query of ['refresh=2', 'refresh=true', 'path=/etc', 'shell=cmd']) {
    const response = await f.app.inject({ url: `/api/terminal-shells?${query}`, headers: f.headers });
    expect(response.statusCode, query).toBe(400);
  }
});

it('requires the session cookie', async () => {
  const f = await fixture();
  const response = await f.app.inject({ url: '/api/terminal-shells', headers: { host: f.headers.host } });
  expect(response.statusCode).toBe(401);
  expect(response.json().error.code).toBe('AUTH_REQUIRED');
});
