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
  const store = new Store(await mkdtemp(join(tmpdir(), 'project-memory-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  return { app, headers };
}

const scope = { projectId: 'project-1', projectIdentity: 'a'.repeat(64), threadId: 'thread-1', accountId: null, bindingDigest: 'b'.repeat(64) };

it('validates the owner query and reports unknown projects', async () => {
  const { app, headers } = await fixture();
  for (const url of [
    '/api/projects/project-1/memory',
    '/api/projects/project-1/memory?threadId=',
    '/api/projects/project-1/memory/usage?threadId=bad%20id',
  ]) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
  }
  const missing = await app.inject({ url: '/api/projects/project-1/memory?threadId=thread-1', headers });
  expect(missing.statusCode).toBe(404);
  expect(missing.json().error.code).toBe('NOT_FOUND');
});

it('validates revision, source and forget queries', async () => {
  const { app, headers } = await fixture();
  for (const url of [
    '/api/projects/project-1/memory/forget?threadId=thread-1&itemId=item-1&revision=0',
    '/api/projects/project-1/memory/forget?threadId=thread-1&itemId=item-1&revision=abc',
    '/api/projects/project-1/memory/source?threadId=thread-1&itemId=item-1&revision=1&sourceDigest=nothash',
    '/api/projects/project-1/memory/source?threadId=thread-1&itemId=item-1&revision=1&sourceDigest=' + 'c'.repeat(64) + '&sourceRef=not-json',
  ]) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
  }
});

it('validates action envelopes and requires CSRF for mutations', async () => {
  const { app, headers } = await fixture();
  for (const payload of [
    {},
    { commandId: 'c1', scope, operation: { action: 'unknown' } },
    { commandId: 'c1', scope: { ...scope, projectIdentity: 'short' }, operation: { action: 'reject', itemId: 'item-1', baseRevision: 1 } },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/projects/project-1/memory/actions', headers, payload });
    expect(response.statusCode).toBe(400);
  }
  const noCsrf = { host: headers.host, cookie: headers.cookie };
  const unauthenticated = await app.inject({ method: 'POST', url: '/api/projects/project-1/memory/actions', headers: noCsrf, payload: { commandId: 'c1', scope, operation: { action: 'reject', itemId: 'item-1', baseRevision: 1 } } });
  expect(unauthenticated.statusCode).toBe(403);
  const missingProject = await app.inject({ method: 'POST', url: '/api/projects/project-1/memory/actions', headers, payload: { commandId: 'c1', scope, operation: { action: 'reject', itemId: 'item-1', baseRevision: 1 } } });
  expect(missingProject.statusCode).toBe(404);
});
