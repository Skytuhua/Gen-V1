import {afterEach, expect, it} from 'vitest';
import {writeFile, link, unlink, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {PersonalResearchRepository} from '../packages/research/repository.ts';
import type {VerifiedBrowserCaptureProvider} from '../packages/research/capture.ts';
import {abcHash, command, context, researchFixture} from './research-fixture.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close();});
async function fixture(browser?: VerifiedBrowserCaptureProvider) {const f = await researchFixture(browser); cleanups.push(f.close); return f;}
const capture = (expected: unknown, id = 'file') => command(id, 'source.capture', {sourceId: 'file-source', title: 'Granted file', expectedRevision: 0, input: {kind: 'file', resourceId: 'grant-a', expected}});

it('captures a granted file with native custody and exact expected bytes and identity', async () => {
  const f = await fixture(), expected = await f.repository.fileReference(context, 'grant-a');
  expect(expected).toMatchObject({sha256: abcHash, bytes: 3, ...f.grant.identity});
  await f.repository.command(capture(expected));
  expect(f.repository.passage(context, {sourceId: 'file-source', revision: 1, sha256: abcHash, start: 0, end: 3}).text).toBe('abc');
  expect(f.repository.source(context, 'file-source', 1).identity).toMatchObject({kind: 'file', resourceId: 'grant-a', ...f.grant.identity});
});

it('rejects same-size edits after selection without publishing a source or receipt', async () => {
  const f = await fixture(), expected = await f.repository.fileReference(context, 'grant-a');
  await writeFile(f.path, 'xyz'); const seq = f.store.sequence;
  await expect(f.repository.command(capture(expected))).rejects.toMatchObject({code: 'SOURCE_CHANGED'});
  expect(f.store.sequence).toBe(seq); expect(f.store.receipt(capture(expected))).toBeNull();
});

it('binds a selected file reference to the exact grant generation even when bytes and identity match', async () => {
  const f = await fixture(), expected = await f.repository.fileReference(context, 'grant-a');
  f.store.internal('regrant', null, () => f.store.put('resource', 'grant-a', context.threadId, {...f.grant, createdAt: '2026-02-01T00:00:00Z'}));
  const seq = f.store.sequence;
  await expect(f.repository.command(capture(expected))).rejects.toMatchObject({code: 'SOURCE_CHANGED'});
  expect(f.store.sequence).toBe(seq);
});

it('fails closed after grant revocation, rebind, identity replacement, or hardlink introduction', async () => {
  const f = await fixture(), expected = await f.repository.fileReference(context, 'grant-a');
  f.store.internal('revoke', null, () => f.store.remove('resource', 'grant-a'));
  await expect(f.repository.command(capture(expected))).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  f.store.internal('rebind', null, () => f.store.put('resource', 'grant-a', context.threadId, {...f.grant, threadId: 'other'}));
  await expect(f.repository.command(capture(expected, 'rebind'))).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  f.store.internal('restore', null, () => f.store.put('resource', 'grant-a', context.threadId, f.grant));
  const moved = f.path + '.old'; await rename(f.path, moved); await writeFile(f.path, 'abc');
  await expect(f.repository.command(capture(expected, 'replace'))).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  await unlink(f.path); await rename(moved, f.path); await link(f.path, f.path + '.link');
  await expect(f.repository.command(capture(expected, 'link'))).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('denies secret paths, traversal and over-limit files through existing grants', async () => {
  const f = await fixture();
  await expect(f.repository.fileReference(context, 'grant-a', '../data/harness.sqlite')).rejects.toBeDefined();
  const secret = join(f.root, 'sources', '.env'); await writeFile(secret, 'SYNTHETIC_SECRET=never-read');
  f.store.internal('secret', null, () => f.store.put('resource', 'grant-a', context.threadId, {...f.grant, path: secret, identity: undefined}));
  await expect(f.repository.fileReference(context, 'grant-a')).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  f.store.internal('restore', null, () => f.store.put('resource', 'grant-a', context.threadId, f.grant));
  await writeFile(f.path, 'x'.repeat(4 * 1024 * 1024 + 1));
  await expect(f.repository.fileReference(context, 'grant-a')).rejects.toMatchObject({code: 'RESOURCE_LIMIT'});
});

it('rejects a missing selected file or binary material without retaining a partial capture', async () => {
  const f = await fixture(), expected = await f.repository.fileReference(context, 'grant-a');
  await writeFile(f.path, Buffer.from([0xff, 0x00, 0x61]));
  await expect(f.repository.fileReference(context, 'grant-a')).rejects.toMatchObject({code: 'INVALID_SOURCE'});
  await unlink(f.path); const seq = f.store.sequence;
  await expect(f.repository.command(capture(expected))).rejects.toMatchObject({code: 'INVALID_RESOURCE'});
  expect(f.store.sequence).toBe(seq);
});

it('requires the verified browser provider to hold navigation and owning authorization through commit', async () => {
  let current = true, request: unknown;
  const browser: VerifiedBrowserCaptureProvider = {authority: {kind: 'personal'}, async withCapture(input, _signal, consume) {
    request = input;
    return consume({browserId: 'browser-a', navigationId: 'nav-a', authorizationId: 'explicit-capture-a', url: 'https://example.invalid/article', bytes: Buffer.from('abc'), assertCurrent() {if (!current) throw Error('Navigation revoked');}});
  }};
  const f = await fixture(browser), c = command('browser', 'source.capture', {sourceId: 'browser-source', expectedRevision: 0, title: 'Browser source', input: {kind: 'browser', browserId: 'browser-a', navigationId: 'nav-a'}});
  await f.repository.command(c); expect(request).toMatchObject({context, browserId: 'browser-a', navigationId: 'nav-a', maxBytes: 4 * 1024 * 1024});
  expect(f.repository.source(context, 'browser-source', 1)).toMatchObject({sha256: abcHash, identity: {kind: 'browser', authorizationId: 'explicit-capture-a'}});
  current = false;
  await expect(f.repository.command({...c, id: 'revoked', payload: {...c.payload, expectedRevision: 1}})).rejects.toBeDefined();
  const company = new PersonalResearchRepository(f.store, {browser: {...browser, authority: {kind: 'company', companyId: 'private'}}});
  await expect(company.command({...c, id: 'company', payload: {...c.payload, expectedRevision: 1}})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('rechecks thread authority inside a browser lease and keeps revoked historical file material inaccessible', async () => {
  const f = await fixture(), expected = await f.repository.fileReference(context, 'grant-a'); await f.repository.command(capture(expected));
  f.store.internal('revoke', null, () => f.store.remove('resource', 'grant-a'));
  expect(() => f.repository.passage(context, {sourceId: 'file-source', revision: 1, sha256: abcHash, start: 0, end: 3})).toThrow();
  const browser: VerifiedBrowserCaptureProvider = {authority: {kind: 'personal'}, async withCapture(_input, _signal, consume) {
    f.store.internal('project.changed', null, () => f.store.put('thread', context.threadId, context.threadId, {...f.thread, projectId: 'elsewhere'}));
    return consume({browserId: 'browser-a', navigationId: 'nav-a', authorizationId: 'capture', url: 'https://example.invalid', bytes: Buffer.from('abc'), assertCurrent() {}});
  }};
  const repo = new PersonalResearchRepository(f.store, {browser});
  await expect(repo.command(command('changed', 'source.capture', {sourceId: 'browser-source', expectedRevision: 0, title: 'Browser', input: {kind: 'browser', browserId: 'browser-a', navigationId: 'nav-a'}}))).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('rejects an asynchronous authorization check instead of committing before it settles', async () => {
  const browser: VerifiedBrowserCaptureProvider = {authority: {kind: 'personal'}, async withCapture(_input, _signal, consume) {
    return consume({browserId: 'browser-a', navigationId: 'nav-a', authorizationId: 'capture', url: 'https://example.invalid', bytes: Buffer.from('abc'), async assertCurrent() {await Promise.resolve();}});
  }};
  const f = await fixture(browser), seq = f.store.sequence;
  await expect(f.repository.command(command('async-check', 'source.capture', {sourceId: 'browser-source', expectedRevision: 0, title: 'Browser', input: {kind: 'browser', browserId: 'browser-a', navigationId: 'nav-a'}}))).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.sequence).toBe(seq);
});
