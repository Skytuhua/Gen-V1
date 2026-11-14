import {afterEach, beforeEach, expect, it, vi} from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const bootstrap = {csrfToken: 'token', widgetOrigin: 'http://localhost:4318'};
const route = (pathname: string, body: unknown) => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/bootstrap') return Response.json(bootstrap);
    const path = new URL(url, 'http://local').pathname;
    const hit = path === pathname || path.startsWith(pathname + '/') || path.includes(pathname);
    return Response.json(hit ? body : {});
  }));
};

it('accepts well-formed responses for the guarded endpoints', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/bootstrap') return Response.json(bootstrap);
    const path = new URL(url, 'http://local').pathname;
    if (path === '/api/snapshot') return Response.json({seq: 1, threads: [], messages: [], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: {theme: 'dark'}, activeThreadId: null});
    if (path === '/api/shell-settings') return Response.json({theme: 'dark', preferences: {chatWidth: 'full'}});
    if (path === '/api/commands') return Response.json({commandId: 'c1', eventSeq: 2, result: {ok: true}});
    if (path.endsWith('/mount')) return Response.json({url: 'http://localhost:4318/widget/a/1?ticket=t#token=tok&mountId=m', token: 'tok', mountId: 'm', revision: 1});
    if (path.includes('/credentials/')) return Response.json({present: true, version: 3, expiresAt: null});
    if (path === '/api/composer-prediction') return Response.json({suggestion: 'hi', replyId: 'r', modelId: 'm'});
    if (path === '/api/models') return Response.json({models: [{id: 'm', provider: 'p', name: 'Model'}]});
    if (path.endsWith('/tree')) return Response.json({path: '', entries: [{name: 'a', path: 'a', kind: 'file', bytes: 1}], truncated: false});
    if (path.endsWith('/messages')) return Response.json({messages: [{id: 'x', threadId: 't', role: 'assistant', content: 'c', createdAt: 'now', runId: null}], truncated: 0});
    if (path === '/api/threads/search') return Response.json({threadIds: ['t']});
    return Response.json({});
  }));
  const api = await import('../apps/web/src/api.ts');
  await expect(api.getSnapshot()).resolves.toMatchObject({seq: 1});
  await expect(api.getShellSettings()).resolves.toMatchObject({theme: 'dark'});
  await expect(api.command('noop')).resolves.toMatchObject({commandId: 'c1'});
  await expect(api.getWidgetMount('a')).resolves.toMatchObject({mountId: 'm'});
  await expect(api.getCredentialSlot({artifactId: 'a', threadId: 't', revision: 1}, 'key')).resolves.toMatchObject({present: true});
  await expect(api.getComposerPrediction({threadId: 't', replyId: 'r', modelId: 'm'}, new AbortController().signal)).resolves.toMatchObject({replyId: 'r'});
  await expect(api.getModels()).resolves.toMatchObject({models: [{id: 'm'}]});
  await expect(api.getResourceTree('r')).resolves.toMatchObject({truncated: false});
  await expect(api.getThreadMessages('t')).resolves.toMatchObject({truncated: 0});
  await expect(api.searchThreadMessages('q', ['t'])).resolves.toEqual({threadIds: ['t']});
});

const snapshotBody = {seq: 1, threads: [], messages: [], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: {}, activeThreadId: null};

it.each([
  ['snapshot missing collections', '/api/snapshot', {seq: 1}, (api: typeof import('../apps/web/src/api.ts')) => api.getSnapshot()],
  ['snapshot non-numeric seq', '/api/snapshot', {...snapshotBody, seq: 'x'}, (api: typeof import('../apps/web/src/api.ts')) => api.getSnapshot()],
  ['shell settings bad theme', '/api/shell-settings', {theme: 'sepia'}, (api: typeof import('../apps/web/src/api.ts')) => api.getShellSettings()],
  ['command receipt missing id', '/api/commands', {eventSeq: 1}, (api: typeof import('../apps/web/src/api.ts')) => api.command('noop')],
  ['command receipt fractional seq', '/api/commands', {commandId: 'c', eventSeq: 1.5, result: null}, (api: typeof import('../apps/web/src/api.ts')) => api.command('noop')],
  ['widget mount non-http url', '/mount', {url: 'javascript:alert(1)', token: 't', mountId: 'm', revision: 1}, (api: typeof import('../apps/web/src/api.ts')) => api.getWidgetMount('a')],
  ['widget mount foreign origin', '/mount', {url: 'https://evil.example/widget/a/1#token=t&mountId=m', token: 't', mountId: 'm', revision: 1}, (api: typeof import('../apps/web/src/api.ts')) => api.getWidgetMount('a')],
  ['widget mount missing token', '/mount', {url: 'http://localhost:4318/widget/a/1', mountId: 'm', revision: 1}, (api: typeof import('../apps/web/src/api.ts')) => api.getWidgetMount('a')],
  ['credential metadata bad version', '/credentials/key', {present: true, version: -1, expiresAt: null}, (api: typeof import('../apps/web/src/api.ts')) => api.getCredentialSlot({artifactId: 'a', threadId: 't', revision: 1}, 'key')],
  ['prediction missing model', '/api/composer-prediction', {suggestion: null, replyId: 'r'}, (api: typeof import('../apps/web/src/api.ts')) => api.getComposerPrediction({threadId: 't', replyId: 'r', modelId: 'm'}, new AbortController().signal)],
  ['models entry missing name', '/api/models', {models: [{id: 'm', provider: 'p'}]}, (api: typeof import('../apps/web/src/api.ts')) => api.getModels()],
  ['resource entry bad kind', '/tree', {path: '', entries: [{name: 'a', path: 'a', kind: 'symlink', bytes: 1}], truncated: false}, (api: typeof import('../apps/web/src/api.ts')) => api.getResourceTree('r')],
  ['message bad role', '/messages', {messages: [{id: 'x', threadId: 't', role: 'system', content: 'c', createdAt: 'n', runId: null}], truncated: 0}, (api: typeof import('../apps/web/src/api.ts')) => api.getThreadMessages('t')],
  ['search non-array', '/api/threads/search', {threadIds: 't'}, (api: typeof import('../apps/web/src/api.ts')) => api.searchThreadMessages('q', ['t'])],
] as const)('rejects malformed %s', async (_name, endpoint, body, call) => {
  route(endpoint, body);
  const api = await import('../apps/web/src/api.ts');
  await expect(call(api)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('rejects a bootstrap response without a CSRF token', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/bootstrap' ? Response.json({widgetOrigin: 'http://localhost:4318'}) : Response.json({})));
  const api = await import('../apps/web/src/api.ts');
  await expect(api.getSnapshot()).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});
