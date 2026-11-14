import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { HarnessError, type RuntimeAdapter, type Thread } from '../packages/contracts/index.ts';
import { searchResponseSchema } from '../packages/contracts/project-search.ts';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { withPathGuard } from '../packages/core/file-access.ts';
import { buildServer } from '../apps/server/server.ts';
import { workspaceHost } from '../apps/server/workspace-host.ts';
import { registerProjectSearchRoutes } from '../apps/server/project-search-routes.ts';

// The real authenticated Fastify server, host binding and filesystem reads are used.
// The native guard edge is simulated here; platform behavior is tested in the host suite.
vi.mock('../packages/core/file-access.ts', async original => ({
  ...await original<typeof import('../packages/core/file-access.ts')>(),
  withPathGuard: vi.fn<typeof withPathGuard>(async (_paths, signal, action) => { signal.throwIfAborted(); return action([]); }),
}));
// Search never opens a terminal. Do not require a platform PTY binary just to import
// the existing server; fail immediately if this unrelated edge is ever exercised.
vi.mock('node-pty', () => ({ spawn: () => { throw new Error('Search must not spawn a terminal.'); } }));
const cleanup: (() => Promise<void>)[] = [];
beforeEach(() => { vi.mocked(withPathGuard).mockImplementation(async (_paths, signal, action) => { signal.throwIfAborted(); return action([]); }); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); vi.mocked(withPathGuard).mockClear(); for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gen-search-http-')), path = join(root, 'repo'); await mkdir(path);
  const store = new Store(join(root, 'data'));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  registerProjectSearchRoutes(app, service);
  const projects = workspaceHost(service).projects, receipt = await projects.connect({ id: 'connect', type: 'workspace.project.connect', payload: { name: 'Search', path } });
  const projectId = (receipt.result as { projects: { id: string }[] }).projects[0]!.id;
  cleanup.push(async () => { await app.close(); await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); });
  const bootstrap = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } });
  const headers = { host: '127.0.0.1:4317', cookie: String(bootstrap.headers['set-cookie']).split(';')[0]! };
  const url = `/api/projects/${projectId}/search`;
  await writeFile(join(path, 'needle.txt'), '😀 Needle twice needle\nsecond needle\n');
  return { root, path, store, service, projects, projectId, app, headers, url };
}

it('exports isolated registration and serves the frozen private response through app.inject', async () => {
  const f = await fixture(), before = f.store.sequence;
  const response = await f.app.inject({ url: f.url + '?q=needle', headers: f.headers });
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  const data = searchResponseSchema.parse(response.json());
  expect(data).toMatchObject({ complete: true, nextCursor: null, issues: [], issuesTruncated: false, owner: { projectId: f.projectId, threadId: null, workingCopyId: null } });
  expect(data.matches.map(match => [match.kind, match.line, match.column])).toEqual([['path', null, null], ['text', 1, 3], ['text', 2, 8]]);
  expect(response.body).not.toContain(f.root); expect(response.body).not.toContain('dev'); expect(f.store.sequence).toBe(before);
  expect((await f.app.inject({ url: f.url + '?q=missing', headers: f.headers })).json()).toMatchObject({ complete: true, matches: [] });
});

it('uses existing host/origin/session gates and sets no-store on every denied GET', async () => {
  const f = await fixture();
  for (const [headers, status, code] of [
    [{ host: f.headers.host }, 401, 'AUTH_REQUIRED'],
    [{ ...f.headers, cookie: 'harness_session=deadbeef' }, 401, 'AUTH_REQUIRED'],
    [{ ...f.headers, host: 'foreign.example:4317' }, 403, 'INVALID_HOST'],
    [{ ...f.headers, origin: 'https://foreign.example' }, 403, 'INVALID_ORIGIN'],
  ] as const) {
    const response = await f.app.inject({ url: f.url + '?q=needle', headers });
    expect(response.statusCode).toBe(status); expect(response.json().error.code).toBe(code); expect(response.headers['cache-control']).toBe('no-store');
  }
  expect(withPathGuard).not.toHaveBeenCalled();
  // GET needs the session but no CSRF token; mutations retain the existing CSRF gate.
  const post = await f.app.inject({ method: 'POST', url: f.url, headers: f.headers, payload: {} });
  expect(post.statusCode).toBe(403); expect(post.json().error.code).toBe('CSRF_REQUIRED');
});

it.each([
  '', 'q=', 'q=+++', `q=${'x'.repeat(201)}`, `q=${encodeURIComponent('😀'.repeat(201))}`,
  'q=x&limit=0', 'q=x&limit=101', 'q=x&limit=-1', 'q=x&limit=1.5', 'q=x&limit=NaN', 'q=x&limit=Infinity', 'q=x&limit=', 'q=x&limit=0x10',
  'q=x&q=y', 'q=x&%71=y', 'q=x&threadId=t&threadId=t', 'q=x&limit=1&limit=1', 'q=x&cursor=a&cursor=b',
  'q=x&path=../../secret', 'q=x&unknown=1', 'q=x&__proto__=secret', 'q=x&threadId=../t', 'q=x&threadId=',
  'q=%C0%AF', 'q=%ED%A0%80', 'q=%F0%9F', 'q=%FF', 'q=%ZZ', '%FF=x&q=x', 'cursor=invented',
])('rejects invalid/unsupported, duplicate and malformed UTF-8 query input with no-store: %s', async query => {
  const f = await fixture(), response = await f.app.inject({ url: f.url + '?' + query, headers: f.headers });
  expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INVALID_INPUT'); expect(response.headers['cache-control']).toBe('no-store');
  expect(withPathGuard).not.toHaveBeenCalled();
});

it('accepts the exact code-point limit and literal traversal/shell strings without using them as paths', async () => {
  const f = await fixture();
  for (const q of ['😀'.repeat(200), '../../secret', '$(echo private).*', 'needle?with?marks']) {
    const response = await f.app.inject({ url: f.url + '?q=' + encodeURIComponent(q), headers: f.headers });
    expect(response.statusCode).toBe(200); expect(response.json().matches).toEqual([]); expect(response.json().complete).toBe(true);
  }
  const traversal = await f.app.inject({ url: '/api/projects/a%2Fb/search?q=x', headers: f.headers });
  expect(traversal.statusCode).toBe(400); expect(traversal.json().error.code).toBe('INVALID_INPUT');
});

it('rejects a GET request body through the no-body endpoint', async () => {
  const f = await fixture(), response = await f.app.inject({ method: 'GET', url: f.url + '?q=needle', headers: { ...f.headers, 'content-type': 'application/json' }, payload: { unexpected: true } });
  expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INVALID_INPUT'); expect(response.headers['cache-control']).toBe('no-store');
});

it('returns stable cursor pages and rejects mismatched, forged, expired and rebound cursors', async () => {
  const f = await fixture(), first = await f.app.inject({ url: f.url + '?q=needle&limit=1', headers: f.headers }), data = first.json();
  expect(data.nextCursor).toBeTypeOf('string'); expect(data.complete).toBe(true);
  const pageUrl = (cursor: string, extra = 'q=needle&limit=1') => f.url + '?' + extra + '&cursor=' + encodeURIComponent(cursor);
  await writeFile(join(f.path, 'needle.txt'), 'changed');
  const next = await f.app.inject({ url: pageUrl(data.nextCursor), headers: f.headers });
  expect(next.statusCode).toBe(200); expect(next.json().matches[0]).toMatchObject({ kind: 'text', preview: '😀 Needle twice needle', sha256: data.matches[0].sha256 });
  for (const url of [pageUrl('invented'), pageUrl(''), pageUrl(data.nextCursor, 'q=different&limit=1'), pageUrl(data.nextCursor, 'q=needle&limit=2'), pageUrl(data.nextCursor.replace('.1.', '.01.'))]) {
    const response = await f.app.inject({ url, headers: f.headers }); expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INVALID_CURSOR'); expect(response.headers['cache-control']).toBe('no-store');
  }
  const originalNow = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(originalNow + 300_001);
  expect((await f.app.inject({ url: pageUrl(data.nextCursor), headers: f.headers })).json().error.code).toBe('INVALID_CURSOR');
  vi.restoreAllMocks();
  await writeFile(join(f.path, 'needle.txt'), 'needle\nneedle');
  const fresh = (await f.app.inject({ url: f.url + '?q=needle&limit=1', headers: f.headers })).json();
  const other = join(f.root, 'other'); await mkdir(other); const info = await lstat(other, { bigint: true });
  f.store.internal('fixture', null, () => f.store.put('workspaceProjectRoot', f.projectId, null, { path: other, identity: { dev: String(info.dev), ino: String(info.ino) } }));
  const rebound = await f.app.inject({ url: pageUrl(fresh.nextCursor), headers: f.headers });
  expect(rebound.statusCode).toBe(400); expect(rebound.json().error.code).toBe('INVALID_CURSOR'); expect(rebound.headers['cache-control']).toBe('no-store');
});

it('maps disconnected/unknown/denied projects and unexpected host failures without disclosing host paths', async () => {
  const f = await fixture();
  const thread: Thread = { id: 'other', projectId: 'elsewhere', title: 'Other', projectName: null, createdAt: '', updatedAt: '', kind: 'main', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null };
  f.store.internal('fixture', null, () => f.store.put('thread', thread.id, thread.id, thread));
  for (const [url, status, code] of [
    [f.url + '?q=x&threadId=other', 403, 'CAPABILITY_DENIED'],
    ['/api/projects/unknown/search?q=x', 404, 'NOT_FOUND'],
  ] as const) {
    const response = await f.app.inject({ url, headers: f.headers }); expect(response.statusCode).toBe(status); expect(response.json().error.code).toBe(code); expect(response.headers['cache-control']).toBe('no-store');
  }
  f.store.internal('fixture', null, () => f.store.remove('workspaceProjectRoot', f.projectId));
  const disconnected = await f.app.inject({ url: f.url + '?q=x', headers: f.headers });
  expect(disconnected.statusCode).toBe(400); expect(disconnected.json().error.code).toBe('PROJECT_NOT_CONNECTED'); expect(disconnected.headers['cache-control']).toBe('no-store');
  vi.spyOn(f.projects, 'binding').mockRejectedValue(new Error('/private/accounts/token permission denied'));
  const failed = await f.app.inject({ url: f.url + '?q=x', headers: f.headers });
  expect(failed.statusCode).toBe(500); expect(failed.json().error.code).toBe('HOST_ERROR'); expect(failed.headers['cache-control']).toBe('no-store'); expect(failed.body).not.toContain('/private');
});

it('returns typed partial 200 data for guard denial and the actual two-second deadline', async () => {
  const f = await fixture(); vi.mocked(withPathGuard).mockRejectedValueOnce(new HarnessError('CAPABILITY_DENIED', 'Synthetic guard denial.'));
  const denied = await f.app.inject({ url: f.url + '?q=needle', headers: f.headers });
  expect(denied.statusCode).toBe(200); expect(denied.json()).toMatchObject({ complete: false, issues: [{ path: null, reason: 'changed' }] });
  vi.mocked(withPathGuard).mockImplementationOnce(async (_paths, signal) => new Promise<never>((_resolve, reject) => { signal.addEventListener('abort', () => reject(new HarnessError('CANCELLED', 'Stopped.')), { once: true }); }));
  const timeout = await f.app.inject({ url: f.url + '?q=needle', headers: f.headers });
  expect(timeout.statusCode).toBe(200); expect(timeout.headers['cache-control']).toBe('no-store');
  expect(timeout.json()).toMatchObject({ complete: false, matches: [], issues: [{ path: null, reason: 'timeout' }] });
});

it('cancels the guarded scan when the real HTTP client disconnects', async () => {
  const f = await fixture(); let entered!: () => void, cancelled!: () => void;
  const entry = new Promise<void>(resolve => { entered = resolve; }), cancellation = new Promise<void>(resolve => { cancelled = resolve; });
  vi.mocked(withPathGuard).mockImplementationOnce(async (_paths, signal) => new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => { cancelled(); reject(new HarnessError('CANCELLED', 'Disconnected.')); }, { once: true }); entered();
  }));
  const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const client = httpRequest(address + f.url + '?q=needle', { headers: f.headers }); client.on('error', () => {}); client.end();
  await entry; client.destroy(); await cancellation;
  expect(withPathGuard).toHaveBeenCalledTimes(1);
  const next = await f.app.inject({ url: f.url + '?q=needle', headers: f.headers }); expect(next.statusCode).toBe(200); expect(next.json().complete).toBe(true);
});
