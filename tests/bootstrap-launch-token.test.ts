import {afterEach, expect, it} from 'vitest';
import {mkdtemp, realpath, lstat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {buildServer} from '../apps/server/server.ts';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import type {RuntimeAdapter} from '../packages/contracts/index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
async function fixture(launchToken?: string) {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'gen-launch-token-'));
  const store = new Store(root), runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime); await service.recover();
  const app = await buildServer(service, {port: 4317, dev: false, launchToken});
  cleanup.push(async () => {
    await app.close(); await service.dispose(); store.close();
    if (await realpath(root) !== resolve(root) || !root.startsWith(base + sep) || (await lstat(root)).isSymbolicLink()) throw Error('Unsafe fixture cleanup');
    await rm(root, {recursive: true, force: true, maxRetries: 5});
  });
  return app;
}
const host = {host: '127.0.0.1:4317'};

it('issues sessions without a launch token when the host was not desktop-launched', async () => {
  const app = await fixture();
  const response = await app.inject({url: '/api/bootstrap', headers: host});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({csrfToken: expect.any(String)});
  expect(response.headers['set-cookie']).toContain('harness_session=');
});

it('requires the desktop launch token before minting a session', async () => {
  const app = await fixture('a'.repeat(64));
  for (const headers of [host, {...host, 'x-harness-launch': 'b'.repeat(64)}, {...host, 'x-harness-launch': 'short'}]) {
    const response = await app.inject({url: '/api/bootstrap', headers});
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('LAUNCH_TOKEN_REQUIRED');
    expect(response.headers['set-cookie']).toBeUndefined();
  }
  const response = await app.inject({url: '/api/bootstrap', headers: {...host, 'x-harness-launch': 'a'.repeat(64)}});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({csrfToken: expect.any(String)});
  expect(response.headers['set-cookie']).toContain('harness_session=');
});
