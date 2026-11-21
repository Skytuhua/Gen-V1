import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request as httpRequest} from 'node:http';
import {HarnessError, type RuntimeAdapter, type Thread} from '../packages/contracts/index.ts';
import {fileSuggestionsResponseSchema} from '../packages/contracts/file-mentions.ts';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {withPathGuard} from '../packages/core/file-access.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import {buildServer} from '../apps/server/server.ts';
import {workspaceHost} from '../apps/server/workspace-host.ts';

// The real authenticated Fastify server and host binding are used; the native
// guard edge is simulated. File suggestions never open a terminal.
vi.mock('../packages/core/file-access.ts', async original => ({
  ...await original<typeof import('../packages/core/file-access.ts')>(),
  withPathGuard: vi.fn<typeof withPathGuard>(async (_paths, signal, action) => {signal.throwIfAborted(); return action([]);}),
}));
vi.mock('node-pty', () => ({spawn: () => {throw new Error('Suggestions must not spawn a terminal.');}}));
const cleanup: (() => Promise<void>)[] = [];
beforeEach(() => {vi.mocked(withPathGuard).mockImplementation(async (_paths, signal, action) => {signal.throwIfAborted(); return action([]);});});
afterEach(async () => {
  vi.restoreAllMocks(); vi.mocked(withPathGuard).mockClear();
  try {__setCapabilityFlagForTests('ui.fileMentionsV1', undefined);} catch {/* default off */}
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gen-mentions-http-')), path = join(root, 'repo');
  await mkdir(join(path, 'src', 'deep'), {recursive: true});
  await writeFile(join(path, 'src', 'main.ts'), 'a'); await writeFile(join(path, 'src', 'deep', 'util.ts'), 'b');
  await writeFile(join(path, 'README.md'), 'c');
  const store = new Store(join(root, 'data'));
  const runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime), app = await buildServer(service, {port: 4319, dev: false});
  const projects = workspaceHost(service).projects, receipt = await projects.connect({id: 'connect', type: 'workspace.project.connect', payload: {name: 'Mention', path}});
  const projectId = (receipt.result as {projects: {id: string}[]}).projects[0]!.id;
  const thread: Thread = {id: 't1', projectId, title: 'T', projectName: null, createdAt: '', updatedAt: '', kind: 'main', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null};
  store.internal('fixture', thread.id, () => store.put('thread', thread.id, thread.id, thread));
  cleanup.push(async () => {await app.close(); await service.dispose(); store.close(); await rm(root, {recursive: true, force: true});});
  const bootstrap = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4319'}});
  const headers = {host: '127.0.0.1:4319', cookie: String(bootstrap.headers['set-cookie']).split(';')[0]!};
  const url = `/api/projects/${projectId}/file-suggestions`;
  return {root, path, store, service, projects, projectId, threadId: thread.id, app, headers, url};
}

it('returns enabled:false without walking when the flag is off and keeps no-store', async () => {
  const f = await fixture();
  const response = await f.app.inject({url: f.url + '?threadId=t1&q=main', headers: f.headers});
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(fileSuggestionsResponseSchema.parse(response.json())).toEqual({enabled: false, projectId: f.projectId, threadId: 't1', query: 'main', items: [], complete: true});
  expect(withPathGuard).not.toHaveBeenCalled();
});

it('serves ranked path-only items for the bound main thread when the flag is on', async () => {
  const f = await fixture(); __setCapabilityFlagForTests('ui.fileMentionsV1', true);
  const response = await f.app.inject({url: f.url + '?threadId=t1&q=main', headers: f.headers});
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  const data = fileSuggestionsResponseSchema.parse(response.json());
  expect(data).toMatchObject({enabled: true, projectId: f.projectId, threadId: 't1', query: 'main', complete: true});
  expect(data.items).toEqual([{path: 'src/main.ts', name: 'main.ts', directory: 'src'}]);
  const all = await f.app.inject({url: f.url + '?threadId=t1&limit=2', headers: f.headers});
  expect(all.json().items.map((i: {path: string}) => i.path)).toEqual(['README.md', 'src/main.ts']);
  expect(response.body).not.toContain(f.root);
});

it('rejects missing, malformed and duplicate query input with INVALID_INPUT', async () => {
  const f = await fixture();
  for (const query of [
    '', 'q=main', 'threadId=', 'threadId=a/b', 'threadId=t1&unknown=1', 'threadId=t1&threadId=t1',
    `threadId=t1&q=${'x'.repeat(201)}`, 'threadId=t1&limit=0', 'threadId=t1&limit=51', 'threadId=t1&limit=0x10',
    'threadId=t1&limit=1.5', 'threadId=t1&q=%FF', 'threadId=t1&q=a&q=b', 'threadId=t1&__proto__=x',
  ]) {
    const response = await f.app.inject({url: f.url + '?' + query, headers: f.headers});
    expect(response.statusCode, query).toBe(400); expect(response.json().error.code).toBe('INVALID_INPUT'); expect(response.headers['cache-control']).toBe('no-store');
  }
  const body = await f.app.inject({method: 'GET', url: f.url + '?threadId=t1', headers: {...f.headers, 'content-type': 'application/json'}, payload: {unexpected: true}});
  expect(body.statusCode).toBe(400); expect(body.json().error.code).toBe('INVALID_INPUT');
  expect(withPathGuard).not.toHaveBeenCalled();
});

it('maps unknown projects, side threads and unauthenticated requests without walking', async () => {
  const f = await fixture(); __setCapabilityFlagForTests('ui.fileMentionsV1', true);
  const side: Thread = {id: 's1', projectId: f.projectId, title: 'S', projectName: null, createdAt: '', updatedAt: '', kind: 'side', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null, sideParentId: 't1'};
  f.store.internal('fixture.side', side.id, () => f.store.put('thread', side.id, side.id, side));
  for (const [url, status, code, headers] of [
    [f.url + '?threadId=s1', 403, 'CAPABILITY_DENIED', f.headers],
    ['/api/projects/unknown/file-suggestions?threadId=t1', 404, 'NOT_FOUND', f.headers],
    [f.url + '?threadId=t1', 401, 'AUTH_REQUIRED', {host: f.headers.host}],
  ] as const) {
    const response = await f.app.inject({url, headers});
    expect(response.statusCode).toBe(status); expect(response.json().error.code).toBe(code); expect(response.headers['cache-control']).toBe('no-store');
  }
  expect(withPathGuard).not.toHaveBeenCalled();
});

it('cancels the guarded walk when the real HTTP client disconnects', async () => {
  const f = await fixture(); __setCapabilityFlagForTests('ui.fileMentionsV1', true);
  let entered!: () => void, cancelled!: () => void;
  const entry = new Promise<void>(resolve => {entered = resolve;}), cancellation = new Promise<void>(resolve => {cancelled = resolve;});
  vi.mocked(withPathGuard).mockImplementationOnce(async (_paths, signal) => new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => {cancelled(); reject(new HarnessError('CANCELLED', 'Disconnected.'));}, {once: true}); entered();
  }));
  const address = await f.app.listen({host: '127.0.0.1', port: 0});
  const client = httpRequest(address + f.url + '?threadId=t1&q=x', {headers: f.headers}); client.on('error', () => {}); client.end();
  await entry; client.destroy(); await cancellation;
  expect(withPathGuard).toHaveBeenCalledTimes(1);
  const next = await f.app.inject({url: f.url + '?threadId=t1&q=main', headers: f.headers});
  expect(next.statusCode).toBe(200); expect(next.json().items[0].path).toBe('src/main.ts');
});
