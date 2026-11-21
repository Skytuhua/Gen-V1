import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, realpath, lstat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {buildServer} from '../apps/server/server.ts';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import type {RuntimeAdapter, Thread} from '../packages/contracts/index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
async function fixture(messages = 4) {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'gen-thread-export-'));
  const store = new Store(root), runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime); await service.recover();
  const thread: Thread = {id: 'export-me', title: 'Export Demo!', projectName: 'Demo project', createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z', epoch: 1, runId: null, status: 'ready', modelId: null, sessionPath: null};
  store.internal('fixture', thread.id, () => {
    store.put('thread', thread.id, thread.id, thread);
    store.put('thread', 'archived', 'archived', {...thread, id: 'archived'});
    store.put('archivedThread', 'archived', 'archived', true);
    for (let i = 0; i < messages; i++) store.put('message', `m-${i}`, thread.id, {id: `m-${i}`, threadId: thread.id, role: i % 3 === 2 ? 'assistant' : 'user', content: `Stored body ${i}`, createdAt: '2026-11-06T00:00:0' + (i % 10) + 'Z', runId: null});
    store.put('dataVersion', `plan:${thread.id}@1`, thread.id, {id: `plan:${thread.id}`, revision: 1, value: {version: 1, title: 'The plan', steps: [{id: 's1', title: 'Step one', status: 'completed', requirements: []}], agents: []}, provenance: 'harness:plan', createdAt: '2026-11-06T00:00:00Z'});
    store.put('operation', 'op-1', thread.id, {id: 'op-1', threadId: thread.id, revision: 1, kind: 'bash', description: 'Ran tests', args: {}, resourceIds: [], preconditions: {}, status: 'succeeded', approved: true, createdAt: '2026-11-06T00:00:00Z'});
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
const path = '/api/threads/export-me/export.md';

describe('thread markdown export route', () => {
  it('serves the whole stored thread as Markdown with the required headers', async () => {
    const f = await fixture(350), sequence = f.store.sequence;
    const response = await f.app.inject({url: path, headers: f.headers});
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(String(response.headers['x-gen-export-filename'])).toMatch(/^export-demo-\d{4}-\d{2}-\d{2}\.md$/);
    const body = response.body;
    expect(body.startsWith('<!-- gen-v1-thread-export v1 -->\n# Export Demo!')).toBe(true);
    expect(body).toContain('Stored body 0');
    expect(body).toContain('Stored body 349');
    expect(body.indexOf('Stored body 0')).toBeLessThan(body.indexOf('Stored body 349'));
    expect(body).toContain('### Plan · revision 1 — The plan');
    expect(body).toContain('| Messages | 350 |');
    expect(f.store.sequence).toBe(sequence);
  });

  it('keeps auth, host and origin gates and marks failures no-store', async () => {
    const f = await fixture();
    for (const [headers, status] of [[f.host, 401], [{...f.headers, host: 'untrusted.invalid'}, 403], [{...f.headers, origin: 'https://untrusted.invalid'}, 403]] as const) {
      const response = await f.app.inject({url: path, headers});
      expect(response.statusCode).toBe(status);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('rejects missing, archived and invalid thread ids as NOT_FOUND', async () => {
    const f = await fixture();
    for (const id of ['missing', 'archived', 'not..real', '..%2Fetc']) {
      const response = await f.app.inject({url: `/api/threads/${id}/export.md`, headers: f.headers});
      expect(response.statusCode, id).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('fails exports over the byte bound as EXPORT_TOO_LARGE', async () => {
    const f = await fixture();
    f.store.internal('big', 'export-me', () => f.store.put('message', 'huge', 'export-me', {id: 'huge', threadId: 'export-me', role: 'user', content: 'x'.repeat(33 * 1024 * 1024), createdAt: '2026-11-06T00:00:00Z', runId: null}));
    const response = await f.app.inject({url: path, headers: f.headers});
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('EXPORT_TOO_LARGE');
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
