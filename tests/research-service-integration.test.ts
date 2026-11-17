import {afterEach, expect, it} from 'vitest';
import {buildServer} from '../apps/server/server.ts';
import {Service} from '../packages/core/service.ts';
import type {RuntimeAdapter} from '../packages/contracts/index.ts';
import {digest, Store} from '../packages/storage/store.ts';
import {abcHash, command, context, researchFixture, textSource} from './research-fixture.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close();});
const runtime: RuntimeAdapter = {configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};

it('rejects retired research commands without writing records or replaying old receipts', async () => {
  const f = await researchFixture(); const service = new Service(f.store, runtime);
  const app = await buildServer(service, {port: 4317, dev: false});
  cleanups.push(async () => {await app.close(); await service.dispose(); await f.close();});
  const c = textSource(), seq = f.store.sequence;
  await expect(service.command(c)).rejects.toMatchObject({code: 'UNKNOWN_COMMAND'});
  for (const type of ['source.bookmark', 'document.save']) {
    await expect(service.command(command('retired-' + type, type, {}))).rejects.toMatchObject({code: 'UNKNOWN_COMMAND'});
  }
  expect(f.store.sequence).toBe(seq);
  expect(f.store.all('researchSource')).toEqual([]);
  f.store.command(c, () => ({sourceId: 'old', revision: 1}));
  await expect(service.command(c)).rejects.toMatchObject({code: 'UNKNOWN_COMMAND'});
  const boot = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4317'}});
  const headers = {host: '127.0.0.1:4317', cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken};
  expect((await app.inject({method: 'POST', url: '/api/research/commands', headers, payload: c})).statusCode).toBe(404);
  expect((await app.inject({method: 'POST', url: '/api/commands', headers, payload: c})).statusCode).not.toBe(200);
});

it('reads stored source and document revisions after restart without invoking a writer', async () => {
  const f = await researchFixture(); cleanups.push(f.close);
  const prefix = digest(context) + ':', materialId = prefix + abcHash;
  const ref = {sourceId: 'source-a', revision: 1, sha256: abcHash, start: 0, end: 3};
  const source = {...context, id: 'source-a', revision: 1, title: 'Source', identity: {kind: 'text'}, status: 'captured', capturedAt: '2026-01-01T00:00:00Z', sha256: abcHash, bytes: 3, materialId};
  const document = {...context, id: 'doc-a', revision: 1, kind: 'findings', title: 'Findings', body: '\ufeffEvidence\r\n', sha256: '525a7ae5682b84c6300c86f3b629308fd5ca6914cb9e825374fd11378a2b8233', savedAt: '2026-01-01T00:00:00Z', citations: [ref]};
  const {body: _body, citations: _citations, ...head} = document;
  f.store.internal('legacy-fixture', null, () => {
    f.store.put('researchMaterial', materialId, context.threadId, {base64: 'YWJj'});
    f.store.put('researchSource', prefix + 'source-a', context.threadId, source);
    f.store.put('researchSourceVersion', prefix + 'source-a@1', context.threadId, source);
    f.store.put('researchDocument', prefix + 'doc-a', context.threadId, head);
    f.store.put('researchDocumentVersion', prefix + 'doc-a@1', context.threadId, document);
  });
  f.store.close(); const store = new Store(f.store.dataDir); cleanups.push(async () => store.close());
  const service = new Service(store, runtime); cleanups.push(async () => service.dispose());
  const sequence = store.sequence;
  expect(service.research.source(context, 'source-a', 1)).toMatchObject({sha256: abcHash, bytes: 3});
  expect(service.research.passage(context, ref)).toEqual({text: 'abc', sourceRevision: 1, status: 'current-capture'});
  expect(service.research.document(context, 'doc-a', 1)).toMatchObject({body: '\ufeffEvidence\r\n', citations: [{...ref, status: 'current-capture', liveStatus: 'unverified'}]});
  expect(service.research.list(context, {kind: 'documents'}).items).toHaveLength(1);
  expect(store.sequence).toBe(sequence);
  expect(() => service.research.source({...context, threadId: 'other'}, 'source-a')).toThrow();
  expect(() => service.research.list(context, {kind: 'sources', cursor: Buffer.from('{}').toString('base64url') + '.' + '\u00e9'.repeat(43)})).toThrow(expect.objectContaining({code: 'INVALID_CURSOR'}));
  store.internal('legacy-head-update', null, () => store.put('researchSource', prefix + 'source-a', context.threadId, {...source, revision: 2}));
  expect(service.research.passage(context, ref).status).toBe('stale');
  expect(service.research.document(context, 'doc-a').citations[0].status).toBe('stale');
  store.internal('legacy-corruption', null, () => store.put('researchMaterial', materialId, context.threadId, {base64: 'eHl6'}));
  expect(() => service.research.passage(context, ref)).toThrow(expect.objectContaining({code: 'SOURCE_CHANGED'}));
  const file = {...source, identity: {kind: 'file', resourceId: f.grant.id, grantBinding: digest(f.grant), dev: f.grant.identity!.dev, ino: f.grant.identity!.ino}};
  store.internal('legacy-file', null, () => {
    store.put('researchMaterial', materialId, context.threadId, {base64: 'YWJj'});
    store.put('researchSource', prefix + 'source-a', context.threadId, file);
    store.put('researchSourceVersion', prefix + 'source-a@1', context.threadId, file);
  });
  expect(service.research.passage(context, ref).text).toBe('abc');
  store.internal('revoke-grant', null, () => store.put('resource', f.grant.id, context.threadId, {...f.grant, path: f.grant.path + '.changed'}));
  expect(() => service.research.passage(context, ref)).toThrow(expect.objectContaining({code: 'CAPABILITY_DENIED'}));
  expect(service.research.document(context, 'doc-a').citations[0].status).toBe('unavailable');
});
