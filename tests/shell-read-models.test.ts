import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, realpathSync, lstatSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {buildServer} from '../apps/server/server.ts';
import type {RuntimeAdapter, Thread} from '../packages/contracts/index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
async function fixture() {
  const base = realpathSync(tmpdir()), dir = mkdtempSync(join(base, 'shell-metadata-')), store = new Store(dir);
  const runtime: RuntimeAdapter = {configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  store.internal('fixture', null, () => {
    const thread: Thread = {id: 'empty', title: 'Empty draft', projectName: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: 'DO_NOT_PUBLISH_SESSION'};
    for (const [id, title] of [['empty', 'Empty draft'], ['second', 'Second task'], ['archived', 'Archived task'], ['company', 'Company private task']]) store.put('thread', id, id, {...thread, id, title, ...(id === 'company' ? {projectId: 'company-project'} : {}), privateUnknown: 'NEVER_PUBLISH'});
    store.put('workspaceProject', 'company-project', null, {id: 'company-project', authority: {kind: 'plugin', pluginId: 'company'}, name: 'Private namespace'});
    store.put('archivedThread', 'archived', 'archived', true);
    store.put('settings', 'global', null, {theme: 'light', modelId: 'test/model', secret: 'NEVER_PUBLISH', selectedAccounts: {openai: null, unknownCredential: 'NEVER_PUBLISH'}, preferences: {density: 'compact', unknownCredential: 'NEVER_PUBLISH'}});
    store.put('account', 'local-account', null, {id: 'local-account', providerId: 'openai', label: 'Personal subscription', enabled: true, createdAt: '', updatedAt: '', credential: 'NEVER_PUBLISH'});
    store.put('resource', 'grant', 'empty', {id: 'grant', threadId: 'empty', kind: 'file', path: 'C:/granted/example.txt', label: 'Granted example', writable: false, createdAt: '', secret: 'NEVER_PUBLISH'});
    store.put('operation', 'uncertain', 'empty', {id: 'uncertain', status: 'unknown', args: {content: 'SOURCE_BODY_NEVER_PUBLISH'}});
    for (const kind of ['message', 'artifact', 'data', 'dataVersion', 'userState']) store.put(kind, kind + '-private', 'empty', {id: kind + '-private', threadId: 'empty', revision: 3, bindings: {}, content: 'SOURCE_BODY_NEVER_PUBLISH'.repeat(10000), values: {secret: 'SOURCE_BODY_NEVER_PUBLISH'}});
    store.put('request', 'decision', 'empty', {id: 'decision', threadId: 'empty', revision: 2, basis: [], status: 'accepted', presentation: {options: [{label: 'Private option body'}]}, responseSchema: {type: 'string'}, prompt: 'SOURCE_BODY_NEVER_PUBLISH', response: 'SOURCE_BODY_NEVER_PUBLISH'});
  });
  const service = new Service(store, runtime), app = await buildServer(service, {port: 4317, dev: false});
  cleanup.push(async () => {await app.close(); await service.dispose(); store.close(); if (realpathSync(dir) !== resolve(dir) || !dir.startsWith(base + sep) || lstatSync(dir).isSymbolicLink()) throw Error('Unsafe fixture cleanup'); rmSync(dir, {recursive: true, force: true});});
  const boot = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4317'}}), headers = {host: '127.0.0.1:4317', cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken};
  const snapshot = vi.spyOn(store, 'snapshot').mockImplementation(() => {throw Error('Full snapshot prohibited');});
  return {store, service, app, headers, snapshot};
}

it('pages real Personal navigation including empty drafts without session paths, source bodies or Company records', async () => {
  const f = await fixture();
  const page = await f.app.inject({url: '/api/shell/navigation?limit=1', headers: f.headers});
  expect(page.statusCode).toBe(200); expect(page.headers['cache-control']).toBe('no-store');
  expect(page.json()).toMatchObject({total: 2, items: [{id: 'second', title: 'Second task'}]});
  const next = await f.app.inject({url: '/api/shell/navigation?limit=1&cursor=' + encodeURIComponent(page.json().nextCursor), headers: f.headers});
  expect(next.json()).toMatchObject({items: [{id: 'empty', title: 'Empty draft'}], nextCursor: null});
  const archived = await f.app.inject({url: '/api/shell/navigation?archived=true', headers: f.headers});
  expect(archived.json()).toMatchObject({total: 1, items: [{id: 'archived'}]});
  for (const body of [page.body, next.body, archived.body]) expect(body).not.toMatch(/NEVER_PUBLISH|DO_NOT_PUBLISH_SESSION|SOURCE_BODY|Company private/);
  expect(f.snapshot).not.toHaveBeenCalled();
});

it('reads actual Settings metadata and diagnostic counts while withholding transcripts, operations, artifact state and unknown fields', async () => {
  const f = await fixture(), response = await f.app.inject({url: '/api/shell/settings', headers: f.headers});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({settings: {theme: 'light', modelId: 'test/model', preferences: {density: 'compact'}}, accounts: [{id: 'local-account', label: 'Personal subscription'}], resources: [{id: 'grant', path: 'C:/granted/example.txt'}], counts: {threads: 2, archivedThreads: 1, artifacts: 1, resources: 1, uncertainOperations: 1}});
  expect(response.body).not.toMatch(/NEVER_PUBLISH|SOURCE_BODY|DO_NOT_PUBLISH_SESSION|Private option body|Company private/);
  for (const field of ['messages', 'artifacts', 'operations', 'data', 'requests', 'userStates']) expect(response.json()).not.toHaveProperty(field);
  expect(f.snapshot).not.toHaveBeenCalled(); expect(response.headers['cache-control']).toBe('no-store');
});

it('reads only the selected draft identity/revision/schema references without losing valid transfer checks', async () => {
  const f = await fixture(), response = await f.app.inject({method: 'POST', url: '/api/shell/draft-references', headers: f.headers, payload: {keys: ['draft:empty', 'state:userState-private', 'request:decision:planning', 'draft:company']}});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({threads: [{id: 'empty'}, {id: 'second'}], userStates: [{id: 'userState-private', revision: 3}], requests: [{id: 'decision', revision: 2, presentation: true, responseSchema: {type: 'string'}}]});
  expect(response.body).not.toMatch(/SOURCE_BODY|Private option body|company/);
  expect(f.snapshot).not.toHaveBeenCalled();
});

it('keeps compact reads protected and rejects malformed cursor/scope or oversized reference queries without writes', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  expect((await f.app.inject({url: '/api/shell/settings', headers: {host: f.headers.host}})).statusCode).toBe(401);
  expect((await f.app.inject({url: '/api/shell/navigation', headers: {...f.headers, origin: 'https://foreign.invalid'}})).statusCode).toBe(403);
  for (const query of ['limit=101', 'authority=company', 'cursor=forged']) expect((await f.app.inject({url: '/api/shell/navigation?' + query, headers: f.headers})).statusCode).toBe(400);
  expect((await f.app.inject({method: 'POST', url: '/api/shell/draft-references', headers: {...f.headers, 'x-harness-csrf': ''}, payload: {keys: []}})).statusCode).toBe(403);
  expect((await f.app.inject({method: 'POST', url: '/api/shell/draft-references', headers: f.headers, payload: {keys: Array.from({length: 501}, (_, i) => 'draft:' + i)}})).statusCode).toBe(400);
  expect(f.store.sequence).toBe(sequence);
});

it('reports complete navigation bounds across pages and preserves a cursor during progress-only updates', async () => {
  const f = await fixture();
  f.store.internal('navigation.fixture', 'empty', () => {
    const base = f.store.get<Thread>('thread', 'empty')!;
    for (let i = 0; i < 125; i++) {const id = 'paged-' + String(i).padStart(3, '0'); f.store.put('thread', id, id, {...base, id, title: 'Paged ' + i, presentation: {pinned: true, order: i - 62}});}
  });
  const ids: string[] = [], first = (await f.app.inject({url: '/api/shell/navigation?limit=50', headers: f.headers})).json();
  expect(first).toMatchObject({total: 127, stats: {pinned: 125, minOrder: -62, maxOrder: 62}});
  ids.push(...first.items.map((item: {id: string}) => item.id));
  f.store.internal('runtime.progress', 'empty', () => {const thread = f.store.get<Thread>('thread', 'empty')!; f.store.put('thread', thread.id, thread.id, {...thread, updatedAt: '2026-11-07T00:00:00Z'});});
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await f.app.inject({url: '/api/shell/navigation?limit=50&cursor=' + encodeURIComponent(cursor), headers: f.headers});
    expect(page.statusCode).toBe(200); ids.push(...page.json().items.map((item: {id: string}) => item.id)); cursor = page.json().nextCursor;
  }
  expect(new Set(ids).size).toBe(127); expect(ids).toContain('empty');
  const exact = await f.app.inject({url: '/api/shell/navigation/empty', headers: f.headers});
  expect(exact.json()).toMatchObject({id: 'empty', updatedAt: '2026-11-07T00:00:00Z'});
});

it('does not admit a draft reference whose JSON owner disagrees with the canonical stored owner', async () => {
  const f = await fixture();
  f.store.internal('custody.fixture', null, () => {
    f.store.put('userState', 'foreign-state', 'company', {id: 'foreign-state', threadId: 'empty', revision: 9, values: {secret: 'Private'}});
    f.store.put('request', 'foreign-request', 'company', {id: 'foreign-request', threadId: 'empty', revision: 9, responseSchema: {const: 'FOREIGN_SCHEMA'}});
  });
  const response = await f.app.inject({method: 'POST', url: '/api/shell/draft-references', headers: f.headers, payload: {keys: ['state:foreign-state', 'request:foreign-request:9']}});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({userStates: [], requests: []});
  expect(response.body).not.toContain('FOREIGN_SCHEMA');
});

it('withholds unknown nested learning and usage fields while keeping reported review metadata', async () => {
  const f = await fixture();
  f.store.internal('learning.fixture', null, () => f.store.put('learningStatus', 'global', null, {supported: true, status: 'idle', lastReview: {sourceThreadId: 'empty', sourceRunId: 'run', modelId: 'test/model', accountId: null, status: 'completed', startedAt: '2026-11-06T00:00:00Z', toolCalls: 1, inputBytes: 4, appliedChanges: 0, rawPrompt: 'NESTED_LEARNING_PRIVATE', usage: {inputTokens: 12, rawPrompt: 'NESTED_USAGE_PRIVATE'}}}));
  const response = await f.app.inject({url: '/api/shell/settings', headers: f.headers});
  expect(response.statusCode).toBe(200);
  expect(response.json().learning.lastReview).toMatchObject({status: 'completed', toolCalls: 1, usage: {inputTokens: 12}});
  expect(response.body).not.toMatch(/NESTED_LEARNING_PRIVATE|NESTED_USAGE_PRIVATE/);
  expect(f.store.get<{lastReview: {rawPrompt: string}}>('learningStatus', 'global')!.lastReview.rawPrompt).toBe('NESTED_LEARNING_PRIVATE');
});

it('withholds unknown retained proposal actor fields without reading proposal operations', async () => {
  const f = await fixture();
  f.store.internal('proposal.fixture', null, () => f.store.put('skillProposal', 'proposal', null, {id: 'proposal', createdAt: '', status: 'pending', targets: ['read-case'], actor: {kind: 'agent', threadId: 'empty', credential: 'NESTED_ACTOR_PRIVATE'}, operations: [{content: 'PROPOSAL_BODY_PRIVATE'}]}));
  const response = await f.app.inject({url: '/api/shell/settings', headers: f.headers});
  expect(response.statusCode).toBe(200);
  expect(response.json().skillProposals).toMatchObject([{id: 'proposal', actor: {kind: 'agent', threadId: 'empty'}}]);
  expect(response.body).not.toMatch(/NESTED_ACTOR_PRIVATE|PROPOSAL_BODY_PRIVATE/);
});

it('does not turn a stale selected archived ID into an active navigation row', async () => {
  const f = await fixture();
  expect((await f.app.inject({url: '/api/shell/navigation/archived', headers: f.headers})).statusCode).toBe(404);
  const archive = await f.app.inject({url: '/api/shell/navigation?archived=true', headers: f.headers});
  expect(archive.json()).toMatchObject({items: [{id: 'archived'}]});
});

it('pages a separate complete Personal archive including side conversations without changing navigation', async () => {
  const f = await fixture();
  f.store.internal('archive.fixture', null, () => {
    const base = f.store.get<Thread>('thread', 'empty')!;
    for (const [id, sideParentId] of [['side-archive', 'empty'], ['private-side', 'company']] as const) {
      f.store.put('thread', id, id, {...base, id, title: id, kind: 'side', sideParentId});
      f.store.put('archivedThread', id, id, true);
    }
  });
  const first = await f.app.inject({url: '/api/shell/archive?limit=1', headers: f.headers});
  expect(first.statusCode).toBe(200);
  expect(first.json()).toMatchObject({total: 2, items: [{id: 'side-archive'}]});
  const next = await f.app.inject({url: '/api/shell/archive?limit=1&cursor=' + encodeURIComponent(first.json().nextCursor), headers: f.headers});
  expect(next.json()).toMatchObject({total: 2, items: [{id: 'archived'}], nextCursor: null});
  const navigation = await f.app.inject({url: '/api/shell/navigation?archived=true', headers: f.headers});
  expect(navigation.json()).toMatchObject({total: 1, items: [{id: 'archived'}]});
  expect((await f.app.inject({url: '/api/shell/settings', headers: f.headers})).json().counts.archivedThreads).toBe(2);
  expect(first.body + next.body).not.toMatch(/private-side|NEVER_PUBLISH|DO_NOT_PUBLISH_SESSION|SOURCE_BODY/);
  expect((await f.app.inject({url: '/api/shell/archive', headers: {host: f.headers.host}})).statusCode).toBe(401);
  expect((await f.app.inject({url: '/api/shell/archive?authority=company', headers: f.headers})).statusCode).toBe(400);
  expect((await f.app.inject({url: '/api/shell/navigation?archived=true&cursor=' + encodeURIComponent(first.json().nextCursor), headers: f.headers})).statusCode).toBe(400);
  expect(f.snapshot).not.toHaveBeenCalled();
});

it('projects exact hover metadata and changes its revision when a copy is assigned without a timestamp change',async()=>{
 const f=await fixture(),thread=f.store.get<Thread>('thread','empty')!;
 f.store.internal('fixture',null,()=>{f.store.put('workspaceProject','local-project',null,{id:'local-project',authority:{kind:'local'},name:'Local'});f.store.put('thread',thread.id,thread.id,{...thread,projectId:'local-project',workspaceId:'copy-one',modelId:'exact/model',thinkingLevel:'high'});});
 const first=await f.app.inject({url:'/api/shell/navigation/empty',headers:f.headers});
 expect(first.statusCode).toBe(200);expect(first.json()).toMatchObject({workspaceId:'copy-one',modelId:'exact/model',thinkingLevel:'high'});expect(first.json().threadRevision).toEqual(expect.any(String));
 f.store.internal('fixture',null,()=>{f.store.put('thread',thread.id,thread.id,{...f.store.get<Thread>('thread',thread.id)!,workspaceId:'copy-two'});});
 const second=await f.app.inject({url:'/api/shell/navigation/empty',headers:f.headers});expect(second.json().updatedAt).toBe(first.json().updatedAt);expect(second.json().threadRevision).not.toBe(first.json().threadRevision);
 expect(second.body).not.toMatch(/DO_NOT_PUBLISH_SESSION|NEVER_PUBLISH/);expect(f.snapshot).not.toHaveBeenCalled();
});
