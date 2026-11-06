import {afterEach, expect, it} from 'vitest';
import {buildServer} from '../apps/server/server.ts';
import {registerResearchRoutes} from '../apps/server/research-routes.ts';
import {Service} from '../packages/core/service.ts';
import type {RuntimeAdapter} from '../packages/contracts/index.ts';
import {abcHash, command, researchFixture, textSource} from './research-fixture.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close();});
async function fixture() {
  const f = await researchFixture();
  const runtime: RuntimeAdapter = {configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(f.store, runtime), app = await buildServer(service, {port: 4317, dev: false});
  registerResearchRoutes(app, {research: f.repository, command: c => f.repository.command(c)});
  cleanups.push(async () => {await app.close(); await service.dispose(); await f.close();});
  const host = {host: '127.0.0.1:4317'}, boot = await app.inject({url: '/api/bootstrap', headers: host});
  const headers = {...host, cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken};
  return {...f, app, host, headers};
}
const query = '?authority=personal&threadId=thread-a&projectId=project-a';

it('uses the real host/session/origin/CSRF gates for research reads and command receipts', async () => {
  const f = await fixture(), url = '/api/research' + query + '&kind=sources';
  expect((await f.app.inject({url, headers: f.host})).statusCode).toBe(401);
  expect((await f.app.inject({url, headers: {...f.headers, host: 'evil.invalid'}})).statusCode).toBe(403);
  expect((await f.app.inject({url, headers: {...f.headers, origin: 'https://evil.invalid'}})).statusCode).toBe(403);
  expect((await f.app.inject({method: 'POST', url: '/api/research/commands', headers: {...f.headers, 'x-harness-csrf': ''}, payload: textSource()})).statusCode).toBe(403);
  const result = await f.app.inject({method: 'POST', url: '/api/research/commands', headers: f.headers, payload: textSource()});
  expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); expect(result.json().result).toEqual({sourceId: 'source-a', revision: 1, sha256: abcHash});
  const passage = await f.app.inject({url: '/api/research/sources/source-a/passage' + query + '&revision=1&sha256=' + abcHash + '&start=0&end=3', headers: f.headers});
  expect(passage.statusCode).toBe(200); expect(passage.json()).toMatchObject({text: 'abc', sourceRevision: 1});
  expect(passage.headers['cache-control']).toBe('no-store');
});

it('rejects namespace escalation, arbitrary capture inputs, oversized bodies, and invalid ranges', async () => {
  const f = await fixture(), before = f.store.sequence;
  for (const suffix of [query.replace('personal', 'company') + '&kind=sources', query.replace('thread-a', 'unknown') + '&kind=sources', query + '&kind=sources&path=C:/secrets', query + '&kind=sources&limit=101', query + '&kind=sources&cursor=forged']) {
    expect((await f.app.inject({url: '/api/research' + suffix, headers: f.headers})).statusCode).toBeGreaterThanOrEqual(400);
  }
  const forged = command('forged', 'source.capture', {sourceId: 'url', title: 'No fetch', expectedRevision: 0, input: {kind: 'browser', url: 'http://127.0.0.1/private', bytes: 'not verified'}});
  expect((await f.app.inject({method: 'POST', url: '/api/research/commands', headers: f.headers, payload: forged})).statusCode).toBe(400);
  expect((await f.app.inject({method: 'POST', url: '/api/research/commands', headers: f.headers, payload: textSource('oversize', 'x'.repeat(5 * 1024 * 1024))})).statusCode).toBe(413);
  expect(f.store.sequence).toBe(before);
  await f.repository.command(textSource());
  const badRange = await f.app.inject({url: '/api/research/sources/source-a/passage' + query + '&revision=1&sha256=' + abcHash + '&start=0&end=65537', headers: f.headers});
  expect(badRange.statusCode).toBe(400); expect(badRange.body).not.toContain(f.root);
});

it('returns complete durable documents and metadata-only pages without raw source duplication', async () => {
  const f = await fixture(); await f.repository.command(textSource());
  const body = 'Full answer\r\n'.repeat(14000);
  await f.repository.command(command('doc', 'document.save', {documentId: 'doc-a', expectedRevision: 0, title: 'Findings', kind: 'findings', body, citations: [{sourceId: 'source-a', revision: 1, sha256: abcHash, start: 0, end: 3}]}));
  const document = await f.app.inject({url: '/api/research/documents/doc-a' + query + '&revision=1', headers: f.headers});
  expect(document.statusCode).toBe(200); expect(document.json().body).toBe(body);
  expect(document.json().citations[0]).toMatchObject({status: 'current-capture', liveStatus: 'unverified'});
  const page = await f.app.inject({url: '/api/research' + query + '&kind=documents&limit=1', headers: f.headers});
  expect(page.json().items).toHaveLength(1); expect(page.body).not.toContain('Full answer'); expect(page.body).not.toContain(f.root);
  const source = await f.app.inject({url: '/api/research/sources/source-a' + query + '&revision=1', headers: f.headers});
  expect(source.json()).toMatchObject({sha256: abcHash, status: 'captured'});
  expect(f.store.snapshot().memory).toEqual([]);
});

it('captures only an explicitly selected granted file and denies material reads after revocation', async () => {
  const f = await fixture();
  const selected = await f.app.inject({url: '/api/research/file-reference' + query + '&resourceId=grant-a', headers: f.headers});
  expect(selected.statusCode).toBe(200); expect(selected.json()).toMatchObject({sha256: abcHash, bytes: 3});
  const saved = await f.app.inject({method: 'POST', url: '/api/research/commands', headers: f.headers, payload: command('file', 'source.capture', {sourceId: 'file-source', title: 'Selected file', expectedRevision: 0, input: {kind: 'file', resourceId: 'grant-a', expected: selected.json()}})});
  expect(saved.statusCode).toBe(200);
  f.store.internal('revoke', null, () => f.store.remove('resource', 'grant-a'));
  const passage = await f.app.inject({url: '/api/research/sources/file-source/passage' + query + '&revision=1&sha256=' + abcHash + '&start=0&end=3', headers: f.headers});
  expect(passage.statusCode).toBe(403); expect(passage.body).not.toContain(f.path);
});
