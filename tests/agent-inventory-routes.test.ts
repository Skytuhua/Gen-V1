import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { buildServer } from '../apps/server/server.ts';
import type { RuntimeAdapter, Thread } from '../packages/contracts/index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-http-')), store = new Store(dir);
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  store.internal('fixture.thread', 'parent', () => store.put('thread', 'parent', 'parent', {
    id: 'parent', title: 'Personal agent', createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z',
    kind: 'main', projectName: null, status: 'working', epoch: 1, runId: 'r', modelId: null, sessionPath: null,
  } satisfies Thread));
  const bootstrap = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } });
  const headers = { host: '127.0.0.1:4317', cookie: String(bootstrap.headers['set-cookie']).split(';')[0] };
  cleanups.push(async () => { await app.close(); await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, service, app, headers };
}

it('registers bounded Personal reads beneath existing host/origin/session gates with no snapshot bootstrap', async () => {
  const { app, headers, store, service } = await setup(), snapshot = vi.spyOn(store, 'snapshot').mockImplementation(() => { throw Error('No full snapshot'); }), command = vi.spyOn(service, 'command');
  const page = await app.inject({ url: '/api/agents?limit=1', headers });
  expect(page.statusCode).toBe(200); expect(page.headers['cache-control']).toBe('no-store');
  expect(page.json().items[0]).toMatchObject({ agentId: 'thread:parent', readOnly: false });
  const history = await app.inject({ url: '/api/agents/history?agentId=thread%3Aparent', headers });
  expect(history.statusCode).toBe(200); expect(history.json().messages).toEqual([]);
  const updates = await app.inject({ url: `/api/agents/updates?after=${page.json().sequence}&scopeKey=${page.json().scopeKey}`, headers });
  expect(updates.statusCode).toBe(200); expect(updates.json().resync).toBe(false);
  for (const url of ['/api/agents', '/api/agents/history?agentId=thread%3Aparent', '/api/agents/updates?after=0&scopeKey=bad', '/api/agents/events?after=0&scopeKey=bad']) {
    expect((await app.inject({ url, headers: { host: headers.host } })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { ...headers, origin: 'https://foreign.example' } })).statusCode).toBe(403);
    expect((await app.inject({ url, headers: { ...headers, host: 'foreign.example:4317' } })).statusCode).toBe(403);
  }
  expect(snapshot).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
});

it('rejects malformed scopes, oversized pages and invented write/Company authority without mutating the host', async () => {
  const { app, headers, store } = await setup(), before = store.sequence;
  for (const query of ['limit=101', 'limit=-1', 'includeArchived=maybe', 'authority=company', 'projectId=a&projectId=b', 'status=accepted', `cursor=${'x'.repeat(3000)}`]) {
    expect((await app.inject({ url: '/api/agents?' + query, headers })).statusCode).toBe(400);
  }
  expect((await app.inject({ url: '/api/agents/history?agentId=thread%3Aparent&parentId=other', headers })).statusCode).toBe(400);
  const write = await app.inject({ method: 'POST', url: '/api/agents', headers, payload: { type: 'message.send' } });
  expect(write.statusCode).toBe(403); expect(store.sequence).toBe(before);
  expect((await app.inject({ url: '/api/agents/history?agentId=job%3Amissing', headers })).statusCode).toBe(404);
});

it('streams scoped checkpoints and visible transcript invalidations through the actual authenticated HTTP route', async () => {
  const { app, headers, store } = await setup();
  const page = (await app.inject({ url: '/api/agents', headers })).json();
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    get(`${address}/api/agents/events?after=${page.sequence}&scopeKey=${page.scopeKey}&visible=thread%3Aparent`, { headers, signal: controller.signal }, resolve).once('error', reject);
  });
  response.setEncoding('utf8');
  const reader = response[Symbol.asyncIterator]();
  try {
    expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toBe('text/event-stream');
    expect((await reader.next()).value).toContain(': connected');
    store.internal('runtime.assistant.delta', 'parent', () => store.put('message', 'answer', 'parent', { id: 'answer', threadId: 'parent', role: 'assistant', content: 'Visible', createdAt: '', runId: 'r' }));
    let chunk = '';
    while (!chunk.includes('\n\n')) chunk += (await reader.next()).value;
    const event = JSON.parse(chunk.split('data: ')[1].split('\n')[0]);
    expect(event).toMatchObject({ fromSequence: page.sequence, sequence: store.sequence, resync: false, transcripts: [{ agentId: 'thread:parent', sequence: store.sequence }] });
    expect(event.upserts).toEqual([]); expect(chunk).not.toContain('Visible');
  } finally { clearTimeout(timer); response.destroy(); controller.abort(); }
});

it('keeps delegated transcript reads read-only through the existing command and resource authority', async () => {
  const { app, headers, store } = await setup();
  store.internal('agent.updated', 'parent', () => {
    const parent = store.get<Thread>('thread', 'parent')!;
    store.put('thread', 'child', 'child', { ...parent, id: 'child', kind: 'delegate', parentThreadId: 'parent', jobId: 'reader' });
    store.put('data', 'plan:parent', 'parent', { id: 'plan:parent', threadId: 'parent', provenance: 'harness:plan', revision: 1,
      value: { version: 1, title: 'Plan', steps: [], agents: [{ id: 'reader', name: 'Reader', status: 'working', childThreadId: 'child', createdAt: parent.createdAt, updatedAt: parent.updatedAt, reportedPercent: 100 }] } });
    store.put('resource', 'grant', 'parent', { id: 'grant', threadId: 'parent', kind: 'project', path: '/host-only', label: 'Project', writable: true, createdAt: '' });
  });
  const page = (await app.inject({ url: '/api/agents', headers })).json(), child = page.items.find((a: { jobId: string }) => a.jobId);
  expect(child).toMatchObject({ threadId: 'child', readOnly: true }); expect(JSON.stringify(page)).not.toContain('/host-only');
  expect((await app.inject({ url: `/api/agents/history?agentId=${encodeURIComponent(child.agentId)}`, headers })).statusCode).toBe(200);
  const bootstrap = (await app.inject({ url: '/api/bootstrap', headers })).json();
  const before = store.sequence, grants = store.all('resource');
  const denied = await app.inject({ method: 'POST', url: '/api/commands', headers: { ...headers, 'x-harness-csrf': bootstrap.csrfToken }, payload: { id: 'no-child-send', type: 'message.send', threadId: 'child', payload: { content: 'Try to send' } } });
  expect(denied.json().error.code).toBe('DELEGATE_READ_ONLY'); expect(store.sequence).toBe(before); expect(store.all('resource')).toEqual(grants);
});
