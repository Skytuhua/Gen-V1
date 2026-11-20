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
  const store = new Store(await mkdtemp(join(tmpdir(), 'shell-read-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  return { store, app, headers };
}

it('serves empty navigation, settings, archive and resources pages over HTTP', async () => {
  const { app, headers } = await fixture();
  for (const url of ['/api/shell/navigation', '/api/shell/settings', '/api/shell/archive', '/api/shell/resources']) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  }
});

it('rejects malformed page limits, cursors and unknown navigation ids', async () => {
  const { app, headers } = await fixture();
  for (const url of ['/api/shell/navigation?limit=0', '/api/shell/navigation?limit=101', '/api/shell/archive?limit=abc', '/api/shell/resources?cursor=' + 'x'.repeat(2049)])
    expect((await app.inject({ url, headers })).statusCode).toBe(400);
  const badCursor = await app.inject({ url: '/api/shell/archive?cursor=forged', headers });
  expect(badCursor.statusCode).toBe(400);
  expect(badCursor.json().error.code).toBe('INVALID_CURSOR');
  expect((await app.inject({ url: '/api/shell/navigation/not-a-thread', headers })).statusCode).toBe(404);
});

it('validates draft-reference keys and caps the request at 500', async () => {
  const { app, headers } = await fixture();
  const rejected = await app.inject({ method: 'POST', url: '/api/shell/draft-references', headers, payload: { keys: Array.from({ length: 501 }, (_, index) => 'k' + index) } });
  expect(rejected.statusCode).toBe(400);
  const accepted = await app.inject({ method: 'POST', url: '/api/shell/draft-references', headers, payload: { keys: ['missing-draft-key'] } });
  expect(accepted.statusCode).toBe(200);
  const missingCsrf = await app.inject({ method: 'POST', url: '/api/shell/draft-references', headers: { host: headers.host, cookie: headers.cookie }, payload: { keys: [] } });
  expect(missingCsrf.statusCode).toBe(403);
});
