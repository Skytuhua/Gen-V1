import {afterEach, expect, it, vi} from 'vitest';
import {PersonalResearchRepository} from '../packages/research/repository.ts';
import {Store} from '../packages/storage/store.ts';
import {abcHash, command, context, researchFixture, textSource} from './research-fixture.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close();});
async function fixture() {const f = await researchFixture(); cleanups.push(f.close); return f;}
const citation = {sourceId: 'source-a', revision: 1, sha256: abcHash, start: 0, end: 3};

it('stores exact source bytes once, uses server capture time, and keeps material out of snapshots and receipts', async () => {
  const f = await fixture(), before = Date.now();
  const receipt = await f.repository.command(textSource());
  const source = f.repository.source(context, 'source-a', 1);
  expect(source).toMatchObject({revision: 1, sha256: abcHash, bytes: 3, status: 'captured', identity: {kind: 'text'}});
  expect(Date.parse(source.capturedAt!)).toBeGreaterThanOrEqual(before);
  expect(f.repository.passage(context, citation).text).toBe('abc');
  expect(receipt.result).toEqual({sourceId: 'source-a', revision: 1, sha256: abcHash});
  expect(f.store.snapshot().memory).toEqual([]);
  expect(JSON.stringify(f.store.snapshot())).not.toContain(abcHash);
  expect(f.store.db.prepare("SELECT count(*) AS n FROM entities WHERE kind='researchMaterial'").get()).toMatchObject({n: 1});
});

it('enforces CAS and idempotent receipts without overwriting old revisions or duplicating events', async () => {
  const f = await fixture(), c = textSource(), first = await f.repository.command(c), sequence = f.store.sequence;
  expect(await f.repository.command(c)).toEqual(first); expect(f.store.sequence).toBe(sequence);
  await expect(f.repository.command(textSource('capture', 'xyz'))).rejects.toMatchObject({code: 'DUPLICATE_COMMAND'});
  const results = await Promise.allSettled([f.repository.command(textSource('edit-a', 'xyz', 1)), f.repository.command(textSource('edit-b', 'def', 1))]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected')).toMatchObject({reason: {code: 'PRECONDITION_FAILED'}});
  expect(f.repository.passage(context, citation)).toMatchObject({text: 'abc', sourceRevision: 1, status: 'stale'});
  expect(f.repository.source(context, 'source-a', 1).sha256).toBe(abcHash);
});

it('persists full revisioned findings separately and marks old citations stale after source changes and restart', async () => {
  const f = await fixture(); await f.repository.command(textSource());
  const body = 'A complete finding.\r\n'.repeat(12000), save = command('finding', 'document.save', {documentId: 'doc-a', expectedRevision: 0, kind: 'findings', title: 'Findings', body, citations: [citation]});
  const receipt = await f.repository.command(save);
  expect(JSON.stringify(receipt).length).toBeLessThan(1000);
  await f.repository.command(command('note', 'document.save', {documentId: 'note-a', expectedRevision: 0, kind: 'working-notes', title: 'Notes', body: 'Keep separately', citations: []}));
  await f.repository.command(textSource('source-update', 'xyz', 1));
  f.store.close();
  const restartedStore = new Store(f.store.dataDir); cleanups.push(async () => restartedStore.close());
  const reopened = new PersonalResearchRepository(restartedStore);
  const doc = reopened.document(context, 'doc-a', 1);
  expect(doc.body).toBe(body); expect(doc.citations).toEqual([{...citation, status: 'stale', liveStatus: 'unverified'}]);
  await expect(reopened.command({...save, id: 'stale-edit'})).rejects.toMatchObject({code: 'PRECONDITION_FAILED'});
  expect(reopened.list(context, {kind: 'documents', limit: 1}).items).toHaveLength(1);
  expect(JSON.stringify(reopened.list(context, {kind: 'documents', limit: 1}))).not.toContain(body.slice(0, 80));
  expect(restartedStore.all('taskMemory')).toEqual([]);
});

it('keeps host command receipts byte-faithful when source titles include whitespace', async () => {
  const f = await fixture(), c = textSource(); c.payload.title = '  Source title  ';
  const result = await f.repository.command(c);
  expect(f.store.receipt(c)).toEqual(result);
  expect(await f.repository.command(c)).toEqual(result);
});

it('annotates many citations from metadata without repeatedly reading raw materials', async () => {
  const f = await fixture(); await f.repository.command(textSource());
  await f.repository.command(command('many-citations', 'document.save', {documentId: 'many', expectedRevision: 0, kind: 'findings', title: 'Many citations', body: 'Read findings without reloading whole sources', citations: Array.from({length: 500}, () => citation)}));
  const get = vi.spyOn(f.store, 'get');
  const doc = f.repository.document(context, 'many');
  const materialReads = get.mock.calls.filter(([kind]) => kind === 'researchMaterial').length;
  get.mockRestore();
  expect(doc.citations).toHaveLength(500); expect(doc.citations[0].status).toBe('current-capture');
  expect(materialReads).toBe(0);
});

it('preserves BOM, line endings, Unicode, and document revisions without normalizing content', async () => {
  const f = await fixture(), text = '\ufeffA\r\n😀\n'; await f.repository.command(textSource('exact', text));
  const source = f.repository.source(context, 'source-a'), ref = {sourceId: source.id, revision: source.revision, sha256: source.sha256!, start: 0, end: Buffer.byteLength(text)};
  expect(f.repository.passage(context, ref).text).toBe(text);
  const save = (id: string, body: string, expectedRevision: number) => command(id, 'document.save', {documentId: 'revisioned', expectedRevision, kind: 'working-notes', title: 'Notes', body, citations: [ref]});
  await f.repository.command(save('one', text, 0)); await f.repository.command(save('two', 'Revised synthesis', 1));
  expect(f.repository.document(context, 'revisioned', 1).body).toBe(text);
  expect(f.repository.document(context, 'revisioned').body).toBe('Revised synthesis');
  const seq = f.store.sequence, aborted = new AbortController(); aborted.abort();
  await expect(f.repository.command(save('cancelled', 'Do not save', 2), aborted.signal)).rejects.toMatchObject({code: 'CANCELLED'});
  expect(f.store.sequence).toBe(seq);
});

it('validates citations against exact captured hashes, byte ranges, and UTF-8 boundaries', async () => {
  const f = await fixture(); await f.repository.command(textSource());
  for (const ref of [{...citation, sourceId: 'missing'}, {...citation, revision: 2}, {...citation, sha256: '0'.repeat(64)}, {...citation, start: -1}, {...citation, end: 4}, {...citation, end: 0}]) {
    await expect(f.repository.command(command('bad-' + JSON.stringify(ref).replace(/[^a-z0-9]/gi, '').slice(-100), 'document.save', {documentId: 'bad-doc', expectedRevision: 0, kind: 'findings', title: 'Invalid', body: 'No forged quote', citations: [ref]}))).rejects.toBeDefined();
  }
  await f.repository.command(textSource('unicode', 'A😀B', 1));
  const source = f.repository.source(context, 'source-a', 2), ref = {...citation, revision: 2, sha256: source.sha256!, start: 1, end: 5};
  expect(f.repository.passage(context, ref).text).toBe('😀');
  expect(() => f.repository.passage(context, {...ref, start: 2})).toThrow();
  expect(() => f.repository.passage(context, {...ref, end: 70000})).toThrow();
});

it('keeps a URL unconfirmed and rejects capture without an explicit owning provider', async () => {
  const f = await fixture();
  await f.repository.command(command('bookmark', 'source.bookmark', {sourceId: 'link', expectedRevision: 0, title: 'Reference', url: 'https://example.invalid/article'}));
  expect(f.repository.source(context, 'link', 1)).toMatchObject({status: 'unconfirmed', capturedAt: null, sha256: null});
  expect(() => f.repository.passage(context, {...citation, sourceId: 'link'})).toThrow();
  await expect(f.repository.command(command('browser', 'source.capture', {sourceId: 'link', expectedRevision: 1, title: 'Reference', input: {kind: 'browser', browserId: 'browser-a', navigationId: 'nav-a'}}))).rejects.toMatchObject({code: 'CAPABILITY_UNAVAILABLE'});
  await expect(f.repository.command(command('fake', 'source.capture', {sourceId: 'link', expectedRevision: 1, title: 'Reference', input: {kind: 'browser', url: 'http://127.0.0.1/secrets', text: 'Fake evidence'}}))).rejects.toBeDefined();
});

it('denies Company, wrong-thread, rebound projects, archived and read-only child namespaces', async () => {
  const f = await fixture(); await f.repository.command(textSource());
  expect(() => f.repository.source({...context, authority: {kind: 'company', companyId: 'company-a'}}, 'source-a', 1)).toThrow();
  expect(() => f.repository.source({...context, threadId: 'missing'}, 'source-a', 1)).toThrow();
  for (const change of [{projectId: 'elsewhere'}, {kind: 'delegate' as const}, {sideParentId: 'parent'}]) {
    f.store.internal('rebind', null, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, ...change}));
    await expect(f.repository.command(textSource('denied-' + Object.keys(change)[0], 'xyz', 1))).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  }
  f.store.internal('archive', null, () => {f.store.put('thread', f.thread.id, f.thread.id, f.thread); f.store.put('archivedThread', f.thread.id, null, true);});
  expect(() => f.repository.document(context, 'unknown', 1)).toThrow();
});

it('bounds reads and rejects oversize inputs without truncating or leaving partial artifacts', async () => {
  const f = await fixture();
  for (const [id, text] of [['a', 'abc'], ['b', 'def'], ['c', 'ghi']]) await f.repository.command({...textSource('capture-' + id, text), payload: {...textSource().payload, sourceId: id, input: {kind: 'text', text}}});
  const page = f.repository.list(context, {kind: 'sources', limit: 2});
  expect(page.items).toHaveLength(2); expect(page.nextCursor).toBeTruthy();
  expect(f.repository.list(context, {kind: 'sources', limit: 2, cursor: page.nextCursor!}).items).toHaveLength(1);
  expect(() => f.repository.list(context, {kind: 'sources', limit: 101})).toThrow();
  expect(() => f.repository.list(context, {kind: 'sources', cursor: 'forged'})).toThrow();
  const seq = f.store.sequence;
  await expect(f.repository.command(textSource('too-large', 'x'.repeat(4 * 1024 * 1024 + 1)))).rejects.toBeDefined();
  expect(f.store.sequence).toBe(seq);
});
