import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, digest } from '../packages/storage/store.ts';
import { buildToolRegistry, ToolAuthority } from '../packages/core/tool-authority.ts';
import { ToolDisclosure, toolDefinitionDigest } from '../packages/core/tool-disclosure.ts';
import { PrivateToolResults } from '../packages/core/tool-results.ts';
import { sameToolOwner, type ToolResultLimits } from '../packages/contracts/tool-results.ts';
import type { ToolOwner } from '../packages/contracts/tool-effects.ts';
import type { ResourceGrant } from '../packages/contracts/index.ts';

const owner: ToolOwner = { threadId: 'thread-a', runId: 'run-a', epoch: 1, projectId: 'project-a', workspaceId: 'workspace-a', accountBinding: 'account-a' };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture(limits?: Partial<ToolResultLimits>) {
  const root = await mkdtemp(join(tmpdir(), 'm12-prerequisites-'));
  const store = new Store(join(root, 'data'));
  cleanups.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const current = { ...owner };
  const currentOwner = () => ({ ...current });
  const registry = buildToolRegistry();
  const authority = new ToolAuthority(registry);
  const disclosure = new ToolDisclosure(store, authority, { currentOwner });
  const results = new PrivateToolResults(store, { currentOwner }, limits);
  store.internal('fixture', owner.threadId, () => {
    store.put('thread', owner.threadId, owner.threadId, { id: owner.threadId, title: 'Fixture', status: 'working', runId: owner.runId, epoch: owner.epoch, projectId: owner.projectId, workspaceId: owner.workspaceId, accountId: owner.accountBinding });
    return null;
  });
  return { root, store, current, registry, authority, disclosure, results };
}

async function grant(f: Awaited<ReturnType<typeof fixture>>, id = 'resource-a') {
  const path = join(f.root, id + '.txt');
  await writeFile(path, 'captured source');
  const info = await stat(path, { bigint: true });
  const value: ResourceGrant = { id, threadId: owner.threadId, kind: 'file', path, label: 'Fixture source', writable: false, createdAt: '2026-11-15T00:00:00.000Z', identity: { dev: String(info.dev), ino: String(info.ino) } };
  f.store.internal('fixture.grant', owner.threadId, () => { f.store.put('resource', id, owner.threadId, value); return { id }; });
  return value;
}

it.each([
  ['threadId', 'thread-b'], ['runId', 'run-b'], ['epoch', 2], ['projectId', 'project-b'],
  ['workspaceId', 'workspace-b'], ['accountBinding', 'account-b'],
] as const)('requires exact ToolOwner equality for %s and denies stale disclosure/results', async (field, value) => {
  const f = await fixture();
  const ref = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', value: { answer: 1 }, grants: [] });
  f.disclosure.disclose(owner, ['repository_read']);
  const changed = { ...owner, [field]: value };
  expect(sameToolOwner(owner, changed)).toBe(false);
  Object.assign(f.current, changed);
  expect(() => f.disclosure.require(owner, 'repository_read')).toThrow();
  await expect(f.results.read(owner, ref, { programId: 'program-a' })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
});

it('rejects missing and extra owner fields instead of treating them as null', () => {
  expect(sameToolOwner(owner, { ...owner })).toBe(true);
  expect(sameToolOwner({ ...owner, projectId: null }, { ...owner, projectId: undefined } as never)).toBe(false);
  expect(sameToolOwner(owner, { ...owner, extra: true } as never)).toBe(false);
});

it('discloses only requested eligible schemas and requires disclosure before program use', async () => {
  const f = await fixture();
  const index = f.disclosure.index(owner);
  expect(index.map(entry => entry.name)).toContain('repository_read');
  expect(index.map(entry => entry.name)).not.toContain('file_replace_prepare');
  expect(JSON.stringify(index)).not.toContain('parameters');
  expect(() => f.disclosure.require(owner, 'repository_read')).toThrow();
  const details = f.disclosure.disclose(owner, ['repository_read']);
  expect(details).toHaveLength(1);
  expect(details[0]).toMatchObject({ name: 'repository_read', parameters: { type: 'object' } });
  expect(f.disclosure.require(owner, 'repository_read').id).toBe('repository_read');
  expect(() => f.disclosure.require(owner, 'repository_log')).toThrow();
  expect(() => f.disclosure.disclose(owner, ['file_replace_prepare'])).toThrow();
  expect(() => f.disclosure.disclose(owner, ['operation_execute'])).toThrow();
  expect(() => f.disclosure.disclose(owner, ['skill_view'])).toThrow();
  expect(() => f.disclosure.disclose(owner, ['invented_read'])).toThrow();
});

it('cannot turn writes or hidden adapters into eligible reads using a host allowlist', async () => {
  const f = await fixture();
  const narrowed = new ToolDisclosure(f.store, f.authority, { currentOwner: () => ({ ...owner }), eligibleTools: ['repository_read', 'file_replace_prepare', 'skill_view'] });
  expect(narrowed.index(owner).map(entry => entry.name)).toEqual(['repository_read']);
  expect(() => narrowed.disclose(owner, ['file_replace_prepare'])).toThrow();
  expect(() => narrowed.disclose(owner, ['skill_view'])).toThrow();
});

it('pins full authority definitions and rejects changed classifications before reuse', async () => {
  const f = await fixture();
  const definition = f.authority.require('repository_read');
  expect(toolDefinitionDigest(definition)).toBe(digest(definition));
  for (const patch of [{ approval: 'explicit' }, { risk: 'WORKSPACE_WRITE' }, { replayClass: 'NONREPLAYABLE' }, { allowedRoles: ['learning'] }, { executorBinding: 'network' }, { version: 2 }, { schemaDigest: '0'.repeat(64) }]) {
    expect(toolDefinitionDigest({ ...definition, ...patch } as never)).not.toBe(toolDefinitionDigest(definition));
  }
  f.disclosure.disclose(owner, ['repository_read']);
  const expected = toolDefinitionDigest(definition);
  definition.version++;
  expect(() => f.disclosure.require(owner, 'repository_read', expected)).toThrow();
});

it('persists exact-owner disclosure and produces deterministic subset snapshots', async () => {
  const f = await fixture();
  f.disclosure.disclose(owner, ['repository_read', 'repository_log']);
  const restored = new ToolDisclosure(f.store, f.authority, { currentOwner: () => ({ ...owner }) });
  const first = restored.snapshot(owner, ['repository_read', 'repository_log']);
  const second = restored.snapshot(owner, ['repository_log', 'repository_read']);
  expect(first).toEqual(second);
  expect(first.registryDigest).toBe(digest(first.definitions));
  expect(() => restored.snapshot(owner, ['repository_read', 'repository_read'])).toThrow();
  expect(() => restored.snapshot(owner, ['pdf_inspect'])).toThrow();
});

it('keeps raw result bytes and private errors outside snapshots, events and public data records', async () => {
  const f = await fixture();
  const sentinel = 'PRIVATE_RESULT_SENTINEL';
  const success = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', value: { source: sentinel }, grants: [] });
  const failure = await f.results.save({ owner, programId: 'program-a', status: 'FAILED', error: { code: 'SOURCE_FAILED', message: sentinel, details: { private: sentinel } }, grants: [] });
  expect(typeof success).toBe('string');
  expect(JSON.stringify(f.store.snapshot())).not.toContain(sentinel);
  expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain(sentinel);
  expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain(Buffer.from(JSON.stringify({ source: sentinel })).toString('base64'));
  expect(f.store.all('data')).toEqual([]);
  expect(f.store.all('dataVersion')).toEqual([]);
  expect(await f.results.read(owner, success, { programId: 'program-a' })).toMatchObject({ status: 'SUCCEEDED', value: { source: sentinel }, revision: 1 });
  const failed = await f.results.read(owner, failure, { programId: 'program-a' });
  expect(failed).toMatchObject({ status: 'FAILED', error: { code: 'SOURCE_FAILED', message: sentinel } });
  expect(failed).not.toHaveProperty('value');
  expect(await f.results.range(owner, failure, { offset: 0, limit: 65536, programId: 'program-a' })).toMatchObject({ status: 'FAILED' });
});

it('commits result bytes and the referencing receipt atomically before delivery', async () => {
  const f = await fixture();
  const prepared = f.results.prepare({ owner, programId: 'program-a', status: 'SUCCEEDED', value: { answer: 42 }, grants: [] });
  expect(() => f.results.put(prepared)).toThrow(/transaction/i);
  let reference = '';
  expect(() => f.store.internal('fixture.rollback', owner.threadId, () => {
    reference = f.results.put(prepared);
    f.store.put('fixtureReceipt', 'call-a', owner.threadId, { resultRef: reference });
    throw Error('crash before commit');
  })).toThrow('crash before commit');
  expect(f.store.get('fixtureReceipt', 'call-a')).toBeNull();
  await expect(f.results.read(owner, reference, { programId: 'program-a' })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  f.store.internal('fixture.commit', owner.threadId, () => {
    reference = f.results.put(prepared);
    f.store.put('fixtureReceipt', 'call-a', owner.threadId, { resultRef: reference });
    return { resultRef: reference };
  });
  expect(await f.results.read(owner, reference, { programId: 'program-a' })).toMatchObject({ value: { answer: 42 } });
  expect(f.store.get('fixtureReceipt', 'call-a')).toEqual({ resultRef: reference });
  expect(() => f.results.put(prepared)).toThrow(/transaction/i);
  expect(() => f.store.internal('fixture.forged-prepared', owner.threadId, () => f.results.put({ resultRef: reference }))).toThrow();
});

it('makes immutable references idempotent and refuses conflicting content', async () => {
  const f = await fixture();
  const resultRef = 'result_' + 'a'.repeat(32);
  const input = { owner, programId: 'program-a', status: 'SUCCEEDED' as const, value: { answer: 1 }, grants: [], resultRef };
  expect(await f.results.save(input)).toBe(resultRef);
  expect(await f.results.save(input)).toBe(resultRef);
  await expect(f.results.save({ ...input, value: { answer: 2 } })).rejects.toMatchObject({ code: 'RESULT_CONFLICT' });
  expect(await f.results.read(owner, resultRef, { programId: 'program-a' })).toMatchObject({ value: { answer: 1 } });
});

it('rejects corrupted private material instead of returning changed bytes', async () => {
  const f = await fixture();
  const ref = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', value: { answer: 1 }, grants: [] });
  const record = f.store.get<Record<string, unknown>>('privateToolResult', ref)!;
  f.store.internal('fixture.corrupt', owner.threadId, () => { f.store.put('privateToolResult', ref, owner.threadId, { ...record, base64: Buffer.from('{"answer":2}').toString('base64') }); return null; });
  await expect(f.results.read(owner, ref, { programId: 'program-a' })).rejects.toMatchObject({ code: 'RESULT_INTEGRITY' });
});

it('uses bounded UTF-8 byte pages without splitting code points', async () => {
  const f = await fixture();
  const ref = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', contentType: 'text/plain', value: 'A😀Bé中', grants: [] });
  expect(await f.results.range(owner, ref, { offset: 1, limit: 4, programId: 'program-a' })).toMatchObject({ text: '😀', offset: 1, end: 5, nextOffset: 5, totalBytes: 11 });
  expect(await f.results.range(owner, ref, { offset: 0, limit: 3, programId: 'program-a' })).toMatchObject({ text: 'A', end: 1, nextOffset: 1 });
  expect(await f.results.range(owner, ref, { offset: 11, limit: 1, programId: 'program-a' })).toMatchObject({ text: '', nextOffset: null });
  for (const range of [{ offset: 2, limit: 4 }, { offset: 1, limit: 2 }, { offset: -1, limit: 1 }, { offset: 12, limit: 1 }, { offset: 0, limit: 0 }, { offset: 0, limit: 65537 }, { offset: 0.5, limit: 1 }]) {
    await expect(f.results.range(owner, ref, { ...range, programId: 'program-a' })).rejects.toMatchObject({ code: 'INVALID_RESULT_RANGE' });
  }
});

it('preserves BOM bytes and rejects lossy text or JSON serialization', async () => {
  const f = await fixture();
  const ref = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', contentType: 'text/plain', value: '\uFEFFabc', grants: [] });
  expect(await f.results.range(owner, ref, { offset: 0, limit: 6, programId: 'program-a' })).toMatchObject({ text: '\uFEFFabc', totalBytes: 6 });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  let toJsonCalled = false;
  const hiddenToJson = Object.defineProperty({}, 'toJSON', { value: () => { toJsonCalled = true; return 'hidden mutation'; } });
  for (const value of [undefined, NaN, Infinity, () => {}, new Date(), cycle, { value: undefined }, Object.defineProperty({}, 'value', { enumerable: true, get: () => 'do not call' }), hiddenToJson]) {
    await expect(f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', value, grants: [] })).rejects.toMatchObject({ code: 'INVALID_RESULT' });
  }
  expect(toJsonCalled).toBe(false);
  await expect(f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', contentType: 'text/plain', value: '\uD800', grants: [] })).rejects.toMatchObject({ code: 'INVALID_RESULT' });
});

it('enforces per-result, per-program and retained-thread byte bounds atomically', async () => {
  const f = await fixture({ maxResultBytes: 64, maxProgramBytes: 96, maxThreadBytes: 128 });
  const value = 'x'.repeat(48);
  await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', contentType: 'text/plain', value, grants: [] });
  await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', contentType: 'text/plain', value, grants: [] });
  await expect(f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', value: 1, grants: [] })).rejects.toMatchObject({ code: 'RESULT_STORE_LIMIT' });
  await expect(f.results.save({ owner, programId: 'program-b', status: 'SUCCEEDED', contentType: 'text/plain', value: 'x'.repeat(65), grants: [] })).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
  await expect(f.results.save({ owner, programId: 'program-b', status: 'SUCCEEDED', contentType: 'text/plain', value, grants: [] })).rejects.toMatchObject({ code: 'RESULT_STORE_LIMIT' });
  expect(f.store.all('privateToolResult')).toHaveLength(2);
});

it('revalidates grants before each read and refuses revoked or changed source grants', async () => {
  const f = await fixture();
  const source = await grant(f);
  const witnesses = await f.results.captureGrants(owner, [{ resourceId: source.id }]);
  const ref = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', value: 'private source', grants: witnesses });
  expect(await f.results.read(owner, ref, { programId: 'program-a' })).toMatchObject({ value: 'private source', grants: witnesses });
  f.store.internal('fixture.revoke', owner.threadId, () => { f.store.remove('resource', source.id); return { resourceId: source.id }; });
  await expect(f.results.range(owner, ref, { offset: 0, limit: 100, programId: 'program-a' })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  f.store.internal('fixture.replace-grant', owner.threadId, () => { f.store.put('resource', source.id, owner.threadId, { ...source, writable: true }); return { resourceId: source.id }; });
  await expect(f.results.read(owner, ref, { programId: 'program-a' })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
});

it('rejects foreign resources and source replacement while retaining captured bytes privately', async () => {
  const f = await fixture();
  const source = await grant(f);
  f.store.internal('fixture.foreign', owner.threadId, () => { f.store.put('resource', 'foreign', 'other', { ...source, id: 'foreign', threadId: 'other' }); return null; });
  await expect(f.results.captureGrants(owner, [{ resourceId: 'foreign' }])).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  const witnesses = await f.results.captureGrants(owner, [{ resourceId: source.id }]);
  const ref = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', value: 'history', grants: witnesses });
  await writeFile(source.path + '.replacement', 'new inode');
  await rename(source.path + '.replacement', source.path);
  await expect(f.results.read(owner, ref, { programId: 'program-a' })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  expect(f.store.get('privateToolResult', ref)).not.toBeNull();
});

it('requires explicit host input authorization for a second program', async () => {
  const f = await fixture();
  const ref = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', value: 7, grants: [] });
  await expect(f.results.read(owner, ref, { programId: 'program-b' })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  expect(await f.results.authorizeInput(owner, ref, 'program-b')).toBe(ref);
  expect(await f.results.read(owner, ref, { programId: 'program-b' })).toMatchObject({ value: 7 });
  await expect(f.results.read({ ...owner, accountBinding: 'other' }, ref, { programId: 'program-b' })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
});

it('honors pre-aborted access and rejects owner changes during awaited grant validation', async () => {
  const f = await fixture();
  const source = await grant(f);
  const witnesses = await f.results.captureGrants(owner, [{ resourceId: source.id }]);
  const ref = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', value: 1, grants: witnesses });
  const signal = AbortSignal.abort();
  await expect(f.results.read(owner, ref, { programId: 'program-a', signal })).rejects.toMatchObject({ code: 'RESULT_CANCELLED' });
  await expect(f.results.captureGrants(owner, [{ resourceId: source.id }], signal)).rejects.toMatchObject({ code: 'RESULT_CANCELLED' });
  const pending = f.results.read(owner, ref, { programId: 'program-a' });
  f.current.epoch++;
  await expect(pending).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
});

it('requires separate authenticated historical inspection without renewing program authority', async () => {
  const f = await fixture();
  const source = await grant(f), witnesses = await f.results.captureGrants(owner, [{ resourceId: source.id }]);
  const ref = await f.results.save({ owner, programId: 'program-a', status: 'SUCCEEDED', contentType: 'text/plain', value: 'history', grants: witnesses });
  f.current.epoch++;
  await expect(f.results.read(owner, ref, { programId: 'program-a' })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  await expect(f.results.range(owner, ref, { offset: 0, limit: 10 })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  await expect(f.results.rangeRetained(owner, ref, { offset: 0, limit: 10 })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  const inspected: ToolOwner[] = [];
  const retained = new PrivateToolResults(f.store, {
    currentOwner: () => ({ ...f.current }),
    authorizeRetainedOwner: captured => {
      inspected.push({ ...captured });
      if (captured.threadId !== f.current.threadId || captured.accountBinding !== f.current.accountBinding || captured.projectId !== f.current.projectId || captured.workspaceId !== f.current.workspaceId)
        throw Error('Authenticated user no longer has this retained scope');
    },
  });
  expect(await retained.rangeRetained(owner, ref, { offset: 0, limit: 4 })).toMatchObject({ text: 'hist', status: 'SUCCEEDED', nextOffset: 4 });
  expect(inspected.length).toBeGreaterThanOrEqual(2);
  expect(inspected.every(captured => sameToolOwner(captured, owner))).toBe(true);
  expect(f.store.all('privateToolResultAccess')).toEqual([]);
  await expect(retained.authorizeInput(owner, ref, 'program-b')).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  await expect(retained.rangeRetained({ ...owner, epoch: f.current.epoch }, ref, { offset: 0, limit: 4 })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  f.current.accountBinding = 'changed-account';
  await expect(retained.rangeRetained(owner, ref, { offset: 0, limit: 4 })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  f.current.accountBinding = owner.accountBinding;
  f.current.workspaceId = 'changed-workspace';
  await expect(retained.rangeRetained(owner, ref, { offset: 0, limit: 4 })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  f.current.workspaceId = owner.workspaceId;
  f.store.internal('fixture.retained-revoke', owner.threadId, () => { f.store.remove('resource', source.id); return null; });
  await expect(retained.rangeRetained(owner, ref, { offset: 0, limit: 4 })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
});
