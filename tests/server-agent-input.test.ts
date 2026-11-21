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
  const store = new Store(await mkdtemp(join(tmpdir(), 'agent-input-')));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], invalidateModels: vi.fn(async () => {}), start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, dispose: async () => {}, history: async () => [] };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  close.push(async () => { await app.close(); await service.dispose(); store.close(); });
  const response = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), bootstrap = response.json();
  const headers = { host: '127.0.0.1:4317', cookie: String(response.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.csrfToken };
  const seed = () => store.internal('test.agent-input.seeded', 'thread-1', () => {
    store.put('thread', 'thread-1', 'thread-1', { id: 'thread-1', kind: 'main', projectId: null, accountId: null, sideParentId: null });
    store.put('agentInput', 'ticket-1', 'thread-1', { id: 'ticket-1', messageId: 'msg-1', parentThreadId: 'thread-1', jobId: 'job-1', parentRun: { runId: 'r1', epoch: 1 }, childRun: { threadId: 'child-1', runId: 'r2', epoch: 1 }, status: 'queued', createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z' });
  });
  return { app, headers, seed };
}

it('rejects malformed ids and reports inactive agents as stale', async () => {
  const { app, headers } = await fixture();
  for (const url of [
    '/api/agents/follow-up-target',
    '/api/agents/follow-up-target?parentThreadId=thread-1',
    '/api/agents/follow-up-target?parentThreadId=bad%20id&jobId=job-1',
    '/api/agents/follow-up-target?parentThreadId=thread-1&jobId=job-1',
  ]) {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
  }
  const stale = await app.inject({ url: '/api/agents/follow-up-target?parentThreadId=thread-1&jobId=job-1', headers });
  expect(stale.json().error.code).toBe('STALE_AGENT_RUN');
});

it('serves an owned input ticket without caching and 404s unknown tickets', async () => {
  const { app, headers, seed } = await fixture();
  const missing = await app.inject({ url: '/api/agents/inputs/ticket-1?parentThreadId=thread-1', headers });
  expect(missing.statusCode).toBe(404);
  expect(missing.json().error.code).toBe('NOT_FOUND');
  seed();
  const ticket = await app.inject({ url: '/api/agents/inputs/ticket-1?parentThreadId=thread-1', headers });
  expect(ticket.statusCode).toBe(200);
  expect(ticket.headers['cache-control']).toBe('no-store');
  expect(ticket.json()).toMatchObject({ id: 'ticket-1', parentThreadId: 'thread-1', status: 'queued' });
  const crossOwner = await app.inject({ url: '/api/agents/inputs/ticket-1?parentThreadId=other-thread', headers });
  expect(crossOwner.statusCode).toBe(404);
});
