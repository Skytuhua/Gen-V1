import {afterEach, expect, it} from 'vitest';
import {mkdtemp, realpath, lstat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {buildServer} from '../apps/server/server.ts';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import type {RuntimeAdapter, Thread} from '../packages/contracts/index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
async function fixture(messageCount = 8) {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'gen-export-http-'));
  const store = new Store(root), runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime); await service.recover();
  const thread: Thread = {id: 'personal', title: 'Export Target', projectName: 'Demo', createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T01:00:00Z', epoch: 1, runId: null, status: 'completed', modelId: 'model-x', mode: 'build', sessionPath: 'PRIVATE_SESSION', accountId: 'PRIVATE_ACCOUNT'};
  store.internal('fixture', thread.id, () => {
    store.put('thread', thread.id, thread.id, thread);
    for (let index = 0; index < messageCount; index++) {
      store.put('message', `m-${index}`, thread.id, {id: `m-${index}`, threadId: thread.id, role: index % 2 ? 'assistant' : 'user', content: `Message ${index + 1} body`, createdAt: `2026-11-06T00:00:${String(index % 60).padStart(2, '0')}.000Z`, runId: null});
    }
    store.put('dataVersion', 'plan:personal@1', thread.id, {id: 'plan:personal', threadId: thread.id, revision: 1, value: {version: 1, title: 'Ship', run: {runId: 'r1', epoch: 0}, authority: 'approved', steps: [{id: 's1', title: 'Do it', status: 'completed', requirements: []}], agents: []}, provenance: 'test', createdAt: '2026-11-06T00:00:00Z'});
    store.put('dataVersion', 'plan:personal@2', thread.id, {id: 'plan:personal', threadId: thread.id, revision: 2, value: {broken: true}, provenance: 'test', createdAt: '2026-11-06T00:01:00Z'});
    store.put('taskMemory', 'mem-1', thread.id, {id: 'mem-1', threadId: thread.id, key: 'note', content: 'remember this', revision: 1, author: 'user', updatedAt: '2026-11-06T00:00:00Z'});
    store.put('archivedThread', 'archived', 'archived', {id: 'archived', title: 'Old'});
    store.put('thread', 'archived', 'archived', {...thread, id: 'archived', title: 'Old'});
    store.put('thread', 'running', 'running', {...thread, id: 'running', title: 'Live', runId: 'run-live'});
    store.put('message', 'rm-0', 'running', {id: 'rm-0', threadId: 'running', role: 'user', content: 'running body', createdAt: '2026-11-06T00:00:00Z', runId: 'run-live'});
  });
  const app = await buildServer(service, {port: 4317, dev: false});
  cleanup.push(async () => {
    await app.close(); await service.dispose(); store.close();
    if (await realpath(root) !== resolve(root) || !root.startsWith(base + sep) || (await lstat(root)).isSymbolicLink()) throw Error('Unsafe fixture cleanup');
    await rm(root, {recursive: true, force: true, maxRetries: 5});
  });
  const host = {host: '127.0.0.1:4317'}, boot = await app.inject({url: '/api/bootstrap', headers: host});
  const headers = {...host, cookie: String(boot.headers['set-cookie']).split(';')[0]};
  return {app, store, headers, host};
}
const path = (id: string) => `/api/threads/${id}/export.md`;

it('exports a full thread as a Markdown document with a filename header', async () => {
  const f = await fixture(350), sequence = f.store.sequence;
  const response = await f.app.inject({url: path('personal'), headers: f.headers});
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('text/markdown; charset=utf-8');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['x-gen-export-filename']).toMatch(/^export-target-\d{4}-\d{2}-\d{2}\.md$/);
  const doc = response.body;
  expect(doc.startsWith('<!-- gen-v1-thread-export v1 -->')).toBe(true);
  expect(doc).toContain('Message 1 body');
  expect(doc).toContain('Message 350 body');
  expect(doc).toContain('### Plan · revision 1');
  expect(doc).toContain('_Plan revision 2 could not be read._');
  expect(doc).toContain('## Task memory');
  expect(doc).not.toMatch(/PRIVATE_SESSION|PRIVATE_ACCOUNT/);
  expect(doc.endsWith('\n')).toBe(true);
  // Read-only: a GET export never advances the store sequence.
  expect(f.store.sequence).toBe(sequence);
});

it('marks an in-progress run', async () => {
  const f = await fixture();
  const response = await f.app.inject({url: path('running'), headers: f.headers});
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('Run in progress');
});

it.each(['unknown', 'archived'])('rejects an unavailable thread with 404: %s', async id => {
  const f = await fixture();
  const response = await f.app.inject({url: path(id), headers: f.headers});
  expect(response.statusCode).toBe(404);
  expect(response.json().error.code).toBe('NOT_FOUND');
});

it('rejects an unauthenticated request', async () => {
  const f = await fixture();
  const response = await f.app.inject({url: path('personal'), headers: f.host});
  expect(response.statusCode).toBe(401);
  expect(response.json().error.code).toBe('AUTH_REQUIRED');
});

it('maps the 32 MiB document cap to 413 EXPORT_TOO_LARGE', {timeout: 60000}, async () => {
  const f = await fixture();
  f.store.internal('fixture', 'personal', () => {
    const body = 'x'.repeat(64 * 1024);
    for (let index = 0; index < 520; index++) {
      f.store.put('message', `big-${index}`, 'personal', {id: `big-${index}`, threadId: 'personal', role: 'assistant', content: body, createdAt: '2026-11-06T00:00:00Z', runId: null});
    }
  });
  const response = await f.app.inject({url: path('personal'), headers: f.headers});
  expect(response.statusCode).toBe(413);
  expect(response.json().error.code).toBe('EXPORT_TOO_LARGE');
});
