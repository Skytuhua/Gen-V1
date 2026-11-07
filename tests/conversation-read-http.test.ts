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
async function fixture() {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'gen-context-http-'));
  const store = new Store(root), runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime); await service.recover();
  const thread: Thread = {id: 'personal', title: 'Actual conversation', projectName: null, createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z', epoch: 9, runId: null, status: 'ready', modelId: null, sessionPath: 'PRIVATE_SESSION', accountId: 'PRIVATE_ACCOUNT'};
  store.internal('fixture', thread.id, () => {
    store.put('thread', thread.id, thread.id, thread);
    store.put('workspaceProject', 'company-project', null, {id: 'company-project', authority: {kind: 'plugin', pluginId: 'company'}});
    store.put('thread', 'company', 'company', {...thread, id: 'company', projectId: 'company-project'});
    store.put('message', 'message', thread.id, {id: 'message', threadId: thread.id, role: 'assistant', content: 'x'.repeat(5000), createdAt: thread.createdAt, runId: null});
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
const path = '/api/conversations/personal';
it('registers compact conversation reads behind existing session, host and origin gates with no-store on failures', async () => {
  const f = await fixture();
  for (const [headers, status] of [[f.host, 401], [{...f.headers, host: 'untrusted.invalid'}, 403], [{...f.headers, origin: 'https://untrusted.invalid'}, 403]] as const) {
    const response = await f.app.inject({url: path + '?authority=personal', headers});
    expect(response.statusCode).toBe(status); expect(response.headers['cache-control']).toBe('no-store');
  }
  const response = await f.app.inject({url: path + '?authority=personal', headers: f.headers});
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json().owner).toMatchObject({threadId: 'personal', epoch: 9});
  expect(response.body).not.toMatch(/PRIVATE_|sessionPath|accountId/);
});
it('reads exact paginated transcript, content and sequenced updates without global snapshot or writes', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  const snapshot = f.store.snapshot; f.store.snapshot = () => {throw Error('Global snapshot forbidden');};
  try {
    const context = (await f.app.inject({url: path + '?authority=personal', headers: f.headers})).json();
    const query = '?authority=personal&scopeKey=' + context.scopeKey;
    const history = await f.app.inject({url: path + '/transcript' + query + '&limit=1', headers: f.headers});
    expect(history.statusCode).toBe(200); expect(history.headers['cache-control']).toBe('no-store');
    const first = history.json().messages[0]; expect(first.content).toHaveLength(4096);
    const continuation = await f.app.inject({url: path + '/content' + query + '&cursor=' + encodeURIComponent(first.nextContentCursor), headers: f.headers});
    expect(continuation.statusCode).toBe(200); expect(continuation.json().message).toMatchObject({contentOffset: 4096, content: 'x'.repeat(904), nextContentCursor: null});
    const updates = await f.app.inject({url: path + '/updates' + query + '&checkpoint=' + encodeURIComponent(context.checkpoint), headers: f.headers});
    expect(updates.statusCode).toBe(200); expect(updates.json()).toMatchObject({transcriptChanged: false, fromSequence: sequence});
    expect(f.store.sequence).toBe(sequence);
  } finally {f.store.snapshot = snapshot;}
});
it('rejects authority escalation, unknown fields, invalid pagination and duplicate query values', async () => {
  const f = await fixture();
  for (const query of ['?authority=company', '?authority=personal&root=C:/', '?authority=personal&includeArchived=1', '?authority=personal&authority=personal']) {
    const response = await f.app.inject({url: path + query, headers: f.headers});
    expect(response.statusCode, query).toBe(400); expect(response.headers['cache-control']).toBe('no-store');
  }
  const context = (await f.app.inject({url: path + '?authority=personal', headers: f.headers})).json();
  for (const extra of ['limit=0', 'limit=51', 'limit=1&limit=2', 'cursor=invalid', 'scope=company']) {
    expect((await f.app.inject({url: path + '/transcript?authority=personal&scopeKey=' + context.scopeKey + '&' + extra, headers: f.headers})).statusCode, extra).toBe(400);
  }
  expect((await f.app.inject({url: '/api/conversations/company?authority=personal', headers: f.headers})).statusCode).toBe(403);
});
it('revokes a captured scope when its canonical owner epoch changes', async () => {
  const f = await fixture();
  const context = (await f.app.inject({url: path + '?authority=personal', headers: f.headers})).json();
  f.store.internal('thread.changed', 'personal', () => f.store.put('thread', 'personal', 'personal', {...f.store.get<Thread>('thread', 'personal')!, epoch: 10}));
  const response = await f.app.inject({url: path + '/transcript?authority=personal&scopeKey=' + context.scopeKey, headers: f.headers});
  expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('RESYNC_REQUIRED');
  expect(response.headers['cache-control']).toBe('no-store');
});
