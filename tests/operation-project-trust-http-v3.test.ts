import { afterEach, expect, it, vi } from 'vitest';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { buildServer } from '../apps/server/server.ts';
import type { Operation, RuntimeAdapter } from '../packages/contracts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });
async function fixture() {
  vi.stubEnv('HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1', '0');
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'gen-trust-http-'));
  const store = new Store(root);
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {},
    cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  cleanup.push(async () => {
    await app.close(); await service.dispose(); store.close();
    if (await realpath(root) !== resolve(root) || !root.startsWith(base + sep) || (await lstat(root)).isSymbolicLink()) throw Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const created = await service.command({ id: 'trust-thread', type: 'thread.create', payload: { title: 'Project trust route' } });
  const threadId = (created.result as { id: string }).id;
  const operation: Operation = { id: 'route-operation', threadId, revision: 2, kind: 'repository.test',
    description: 'Legacy prepared test', args: { resourceId: 'project', testFile: 'probe.test.cjs', recipe: 'node-test' },
    resourceIds: ['project'], preconditions: {}, status: 'prepared', approved: false, createdAt: new Date().toISOString() };
  store.internal('fixture.operation', threadId, () => store.put('operation', operation.id, threadId, operation));
  const boot = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } });
  const headers = { host: '127.0.0.1:4317', cookie: String(boot.headers['set-cookie']).split(';')[0]!, 'x-harness-csrf': boot.json().csrfToken };
  const target = { threadId, operationId: operation.id, operationRevision: operation.revision };
  const query = new URLSearchParams({ threadId, operationId: operation.id, operationRevision: '2' });
  return { app, store, service, headers, target, url: '/api/operation-project-trust?' + query };
}

it('returns an authenticated disabled review without writing trust or approving the operation', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  const response = await f.app.inject({ url: f.url, headers: f.headers });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toEqual({ version: 1, enabled: false, reason: 'PROJECT_TRUST_DISABLED', ...f.target });
  expect(f.store.sequence).toBe(sequence);
  expect(f.store.get<Operation>('operation', f.target.operationId)?.approved).toBe(false);
});

it('rejects malformed and caller-supplied trust metadata in review queries', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  for (const suffix of ['&rootPath=C%3A%2Felsewhere', '&threadId=other', '&operationRevision=3', '&version=2']) {
    const response = await f.app.inject({ url: f.url + suffix, headers: f.headers });
    expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INVALID_INPUT');
  }
  expect(f.store.sequence).toBe(sequence);
});

it('keeps the new routes under the real session, origin and CSRF boundary', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  expect((await f.app.inject({ url: f.url, headers: { host: f.headers.host } })).statusCode).toBe(401);
  const payload = { ...f.target, reviewId: 'review', expectedTrustRevision: 0, decision: 'trusted', executionMode: 'TRUSTED_HOST' };
  for (const route of ['decisions', 'revocations']) {
    const url = '/api/operation-project-trust/' + route;
    expect((await f.app.inject({ method: 'POST', url, headers: { host: f.headers.host, cookie: f.headers.cookie }, payload })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'POST', url, headers: { ...f.headers, origin: 'https://foreign.invalid' }, payload })).statusCode).toBe(403);
  }
  expect(f.store.sequence).toBe(sequence);
});

it('cannot write a trust decision or revocation while the host capability is disabled', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  const decisions = await f.app.inject({ method: 'POST', url: '/api/operation-project-trust/decisions', headers: f.headers,
    payload: { ...f.target, reviewId: 'review', expectedTrustRevision: 0, decision: 'trusted', executionMode: 'TRUSTED_HOST' } });
  expect(decisions.statusCode).toBe(400); expect(decisions.json().error.code).toBe('PROJECT_TRUST_DISABLED');
  const revoked = await f.app.inject({ method: 'POST', url: '/api/operation-project-trust/revocations', headers: f.headers,
    payload: { ...f.target, trustId: 'trust', expectedTrustRevision: 1 } });
  expect(revoked.statusCode).toBe(400); expect(revoked.json().error.code).toBe('PROJECT_TRUST_DISABLED');
  expect(f.store.sequence).toBe(sequence);
});

it('rejects injected paths, digests and implicit host selection before a trust mutation', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  const base = { ...f.target, reviewId: 'review', expectedTrustRevision: 0, decision: 'trusted' };
  for (const payload of [base, { ...base, executionMode: 'TRUSTED_HOST', rootPath: '/other' },
    { ...base, executionMode: 'TRUSTED_HOST', approvedDigests: [] }, { ...base, executionMode: 'TRUSTED_HOST', scope: { write: true } }]) {
    const response = await f.app.inject({ method: 'POST', url: '/api/operation-project-trust/decisions', headers: f.headers, payload });
    expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INVALID_INPUT');
  }
  expect(f.store.sequence).toBe(sequence);
});

it('does not expose a review through a foreign thread or stale operation revision', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  const foreign = await f.app.inject({ url: f.url.replace(f.target.threadId, 'foreign-thread'), headers: f.headers });
  expect(foreign.statusCode).toBe(404); expect(foreign.json().error.code).toBe('NOT_FOUND');
  const stale = await f.app.inject({ url: f.url.replace('operationRevision=2', 'operationRevision=1'), headers: f.headers });
  expect(stale.statusCode).toBe(400); expect(stale.json().error.code).toBe('PROJECT_TRUST_REVIEW_STALE');
  expect(f.store.sequence).toBe(sequence);
});
