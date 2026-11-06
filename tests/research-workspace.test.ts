import {afterEach, expect, it, vi} from 'vitest';
import {buildServer} from '../apps/server/server.ts';
import {Service} from '../packages/core/service.ts';
import type {RuntimeAdapter} from '../packages/contracts/index.ts';
import {abcHash, context, researchFixture} from './research-fixture.ts';
import {researchClient, researchError, type ResearchSelection} from '../apps/web/src/research-workspace/client.ts';
import {ApiError} from '../apps/web/src/api.ts';
import {ResearchDrafts} from '../apps/web/src/research-workspace/drafts.ts';

const selection: ResearchSelection = {...context, epoch: 0, resource: null};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {vi.unstubAllGlobals(); for (const close of cleanups.splice(0).reverse()) await close();});
async function api() {
  const f = await researchFixture();
  const runtime: RuntimeAdapter = {configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(f.store, runtime), app = await buildServer(service, {port: 4317, dev: false});
  cleanups.push(async () => {await app.close(); await service.dispose(); await f.close();});
  let cookie = '';
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const response = await app.inject({method: (init.method ?? 'GET') as 'GET' | 'POST', url,
      headers: {host: '127.0.0.1:4317', cookie, ...Object.fromEntries(new Headers(init.headers))}, payload: init.body as string | undefined});
    if (response.headers['set-cookie']) cookie = String(response.headers['set-cookie']).split(';')[0];
    return new Response(response.body, {status: response.statusCode, headers: {'content-type': 'application/json'}});
  });
  return {...f, service};
}

it('imports text through authenticated host commands and reloads full durable findings with an exact citation', async () => {
  const f = await api();
  await researchClient.capture(selection, {sourceId: 'source-a', title: 'Evidence', expectedRevision: 0, input: {kind: 'text', text: 'abc'}});
  const source = await researchClient.source(selection, 'source-a');
  expect(source).toMatchObject({sha256: abcHash, bytes: 3, status: 'captured', revision: 1});
  const citation = {sourceId: source.id, revision: 1, sha256: abcHash, start: 0, end: 3};
  const body = 'Complete findings\n'.repeat(14000);
  await researchClient.save(selection, {documentId: 'doc-a', expectedRevision: 0, title: 'Findings', kind: 'findings', body, citations: [citation]});
  expect((await researchClient.document(selection, 'doc-a')).body).toBe(body);
  expect(await researchClient.passage(selection, citation)).toEqual({text: 'abc', sourceRevision: 1, status: 'current-capture'});
  expect(f.store.snapshot().memory).toEqual([]);
  await researchClient.bookmark(selection, {sourceId: 'bookmark', title: 'Saved address', expectedRevision: 0, url: 'https://example.com/'});
  const first = await researchClient.list(selection, 'sources', undefined, undefined, 1);
  expect(first.items).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
  const second = await researchClient.list(selection, 'sources', first.nextCursor!, undefined, 1);
  expect(second.items).toHaveLength(1); expect(second.items[0].id).not.toBe(first.items[0].id);
  expect(await researchClient.source(selection, 'bookmark')).toMatchObject({status: 'unconfirmed', sha256: null});
  const reference = await researchClient.fileReference(selection, 'grant-a');
  await researchClient.capture(selection, {sourceId: 'file-a', title: 'Granted file', expectedRevision: 0, input: {kind: 'file', resourceId: 'grant-a', expected: reference}});
  f.store.internal('revoke', null, () => f.store.remove('resource', 'grant-a'));
  await expect(researchClient.passage(selection, {...citation, sourceId: 'file-a'})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('keeps a conflicting draft and the saved version separate and never advances its CAS silently', () => {
  const drafts = new ResearchDrafts();
  const document = {...context, id: 'doc', revision: 1, title: 'Findings', kind: 'findings' as const, body: 'Saved one', sha256: abcHash, savedAt: '2026-01-01', citations: []};
  drafts.open(selection, document);
  drafts.edit(selection, 'doc', {body: 'My unsaved version'});
  drafts.open(selection, {...document, revision: 2, body: 'Saved by someone else'});
  expect(drafts.get(selection, 'doc')).toMatchObject({body: 'My unsaved version', expectedRevision: 1, dirty: true, conflict: {revision: 2, body: 'Saved by someone else'}});
  expect(drafts.get({...selection, epoch: 1}, 'doc')).toBeUndefined();
  expect(drafts.get({...selection, threadId: 'different'}, 'doc')).toBeUndefined();
});

it('retains typing that arrives while an earlier document save completes', () => {
  const drafts = new ResearchDrafts();
  const original = drafts.create(selection, 'findings');
  const sent = drafts.edit(selection, original.id, {body: 'Sent text'});
  drafts.edit(selection, original.id, {body: 'Newer typing'});
  drafts.saved(selection, sent, {revision: 1, sha256: abcHash});
  expect(drafts.get(selection, original.id)).toMatchObject({body: 'Newer typing', expectedRevision: 1, dirty: true});
});

it('refuses Company selection before any personal read or command and sanitizes denied paths', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const company = {...selection, authority: {kind: 'company' as const, companyId: 'co'}};
  expect(() => researchClient.list(company, 'sources')).toThrow('Personal research only');
  expect(() => researchClient.save(company, {documentId: 'doc', expectedRevision: 0, title: 'Findings', kind: 'findings', body: '', citations: []})).toThrow('Personal research only');
  expect(fetch).not.toHaveBeenCalled();
  expect(researchError(new ApiError('CAPABILITY_DENIED', 'C:\\private\\secret.txt'))).not.toContain('private');
});
