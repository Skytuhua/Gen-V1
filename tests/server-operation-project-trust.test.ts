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
  const store = new Store(await mkdtemp(join(tmpdir(), 'operation-project-trust-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  return { app, headers };
}

const target = 'threadId=thread-1&operationId=op-1&operationRevision=1';

it('validates the trust target query on read endpoints', async () => {
  const { app, headers } = await fixture();
  for (const url of [
    '/api/operation-project-trust',
    '/api/operation-project-trust?threadId=thread-1&operationId=op-1&operationRevision=0',
    '/api/operation-project-trust?threadId=thread-1&operationId=op-1&operationRevision=abc',
    '/api/operation-project-trust?threadId=thread-1&operationId=op-1&operationRevision=1&extra=1',
    '/api/operation-project-trust/status',
    '/api/operation-project-trust/status?threadId=thread-1&operationId=op-1&operationRevision=-1',
  ]) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
  }
});

it('reports unknown prepared operations without caching', async () => {
  const { app, headers } = await fixture();
  for (const path of ['/api/operation-project-trust', '/api/operation-project-trust/status']) {
    const response = await app.inject({ url: `${path}?${target}`, headers });
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().error.code).toBe('NOT_FOUND');
  }
});

it('validates decision and revocation bodies and requires CSRF', async () => {
  const { app, headers } = await fixture();
  for (const [path, payload] of [
    ['/api/operation-project-trust/decisions', {}],
    ['/api/operation-project-trust/decisions', { threadId: 'thread-1', operationId: 'op-1', operationRevision: 1, reviewId: 'r1', expectedTrustRevision: 0, decision: 'bogus' }],
    ['/api/operation-project-trust/decisions', { threadId: 'thread-1', operationId: 'op-1', operationRevision: 1, reviewId: 'r1', expectedTrustRevision: 0, decision: 'trusted' }],
    ['/api/operation-project-trust/revocations', {}],
    ['/api/operation-project-trust/revocations', { threadId: 'thread-1', operationId: 'op-1', operationRevision: 1, trustId: 't1', expectedTrustRevision: 0 }],
  ] as const) {
    const response = await app.inject({ method: 'POST', url: path, headers, payload });
    expect(response.statusCode).toBe(400);
  }
  const noCsrf = { host: headers.host, cookie: headers.cookie };
  const unauthenticated = await app.inject({ method: 'POST', url: '/api/operation-project-trust/decisions', headers: noCsrf, payload: {} });
  expect(unauthenticated.statusCode).toBe(403);
  const declined = await app.inject({ method: 'POST', url: '/api/operation-project-trust/decisions', headers, payload: { threadId: 'thread-1', operationId: 'op-1', operationRevision: 1, reviewId: 'r1', expectedTrustRevision: 0, decision: 'declined' } });
  expect(declined.statusCode).toBe(400);
  expect(['PROJECT_TRUST_DISABLED', 'PROJECT_TRUST_REVIEW_STALE']).toContain(declined.json().error.code);
});
