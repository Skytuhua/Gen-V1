import { afterEach, expect, it, vi } from 'vitest';
import { linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Service } from '../packages/core/service';
import { Store } from '../packages/storage/store';
import { configureHostCapabilityFlags } from '../packages/core/capability-flags';
import type { DataRecord, ResourceGrant, RuntimeAdapter, RuntimeCallbacks, RuntimeUsage, Thread } from '../packages/contracts';

const hooks = vi.hoisted(() => ({ afterPut: undefined as (() => void) | undefined, afterGet: undefined as (() => void) | undefined }));
// Portable host orchestration proof. Only the native guard is substituted;
// actual grants, resolver, file reads, domain dispatch, Store and vault remain real.
vi.mock('../packages/core/file-access.ts', async original => {
  const module = await original<typeof import('../packages/core/file-access.ts')>();
  return { ...module, withResourceGrant: async <T>(grant: ResourceGrant, dataDir: string, path: string | undefined, write: boolean, signal: AbortSignal, action: (path: string) => Promise<T>) => {
    if (signal.aborted) throw Error('Cancelled');
    const { resolveGrant } = await import('../packages/core/security.ts');
    return action(await resolveGrant(grant, path, write, dataDir));
  } };
});
vi.mock('../packages/core/context-result-custody.ts', async original => {
  const module = await original<typeof import('../packages/core/context-result-custody.ts')>();
  return { ...module, openContextResultCustody: async (path: string) => {
    const storage = await module.openContextResultCustody(path);
    return { ...storage,
      put: async (...args: Parameters<typeof storage.put>) => { await storage.put(...args); hooks.afterPut?.(); },
      get: async (key: string) => { const bytes = await storage.get(key); hooks.afterGet?.(); return bytes; },
    };
  } };
});

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { hooks.afterPut = undefined; hooks.afterGet = undefined; for (const close of cleanup.splice(0)) await close(); });
function fixture(options: { enabled?: boolean; additionalTool?: () => Promise<unknown> } = {}) {
  const release = configureHostCapabilityFlags(options.enabled === false ? {} : { 'context.compilerV1': true, 'tools.deferredV1': true });
  const folder = mkdtempSync(join(tmpdir(), 'm04-result-host-')), project = join(folder, 'project');
  mkdirSync(project);
  const store = new Store(join(folder, 'profile'));
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = { configure(value) { callbacks = value; }, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { additionalTool: options.additionalTool, toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true } });
  const ctx = { threadId: 'thread', runId: 'run', epoch: 1 }, info = statSync(project, { bigint: true });
  const grant: ResourceGrant = { id: 'project', threadId: ctx.threadId, kind: 'project', path: project, label: 'Granted source', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
  store.internal('fixture', ctx.threadId, () => {
    store.put('thread', ctx.threadId, ctx.threadId, { id: ctx.threadId, title: 'Fixture', status: 'working', modelId: 'test/model', accountId: null, ...ctx });
    store.put('resource', grant.id, ctx.threadId, grant);
  });
  cleanup.push(async () => { try { await service.dispose(); store.close(); rmSync(folder, { recursive: true, force: true, maxRetries: 5 }); } finally { release(); } });
  const read = async (text = 'BEGIN\n' + 'source café 😀\n'.repeat(4000) + 'END') => {
    writeFileSync(join(project, 'source.txt'), text);
    return await service.tool({ name: 'repository_read', args: { resourceId: grant.id, path: 'source.txt' } }, ctx) as { status: string; handle: string | null; preview: string; totalBytes: number; omittedBytes: number };
  };
  const range = (handle: string, offset: number, length: number) => service.tool({ name: 'context_result_read', args: { handle, offset, length } }, ctx);
  const owner = (patch: Partial<Thread>) => store.internal('fixture.owner', ctx.threadId, () => store.put('thread', ctx.threadId, ctx.threadId, { ...service.thread(ctx.threadId), ...patch }));
  const emit = (sequence: number) => callbacks.onEvent({ ...ctx, type: 'context.request', provider: 'hermes', sequence, promptBytes: 42, knownInputs: 1 });
  return { service, store, ctx, grant, folder, project, read, range, owner, emit };
}

it('spills a real domain result and returns its exact captured JSON through a bounded range', async () => {
  const f = fixture(), result = await f.read();
  const captured = f.store.all<DataRecord>('data', f.ctx.threadId)[0]!, bytes = Buffer.from(JSON.stringify(captured));
  expect(result).toMatchObject({ status: 'AVAILABLE', totalBytes: bytes.length });
  expect(result.handle).toEqual(expect.any(String)); expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(16384);
  expect(result.preview).toContain('BEGIN'); expect(result.preview).toContain('END'); expect(result.omittedBytes).toBeGreaterThan(0);
  const full = await f.range(result.handle!, 0, bytes.length);
  expect(full).toEqual({ status: 'OK', offset: 0, totalBytes: bytes.length, omittedBytes: 0, text: bytes.toString() });
  expect(f.store.all('toolEffect', f.ctx.threadId)).toContainEqual(expect.objectContaining({ toolId: 'repository_read', state: 'SUCCEEDED' }));
});

it('retains original captured bytes when an authorized file is edited in place', async () => {
  const f = fixture(), result = await f.read(), captured = JSON.stringify(f.store.all<DataRecord>('data', f.ctx.threadId)[0]);
  writeFileSync(join(f.project, 'source.txt'), 'Later content is not substituted into captured evidence.');
  expect(await f.range(result.handle!, 0, Buffer.byteLength(captured))).toMatchObject({ status: 'OK', text: captured });
});

it('observes only the delivered preview envelope when compiler and retention are both enabled', async () => {
  const f = fixture(); f.emit(1);
  const delivered = await f.read(); expect(delivered.status).toBe('AVAILABLE');
  f.emit(4);
  const relevance = f.store.get<{ value: RuntimeUsage }>('usage', f.ctx.threadId)?.value.lastRequest?.relevance;
  expect(relevance).toMatchObject({ source: 'HOST_READ_RESULTS', measurement: 'BYTE_ONLY', observedAtSequence: 4,
    inspectedResults: 1, estimatedSavingsBytes: Buffer.byteLength(JSON.stringify(delivered)) });
  expect(relevance?.estimatedSavingsBytes).not.toBe(delivered.totalBytes);
  const persisted = JSON.stringify(relevance);
  expect(persisted).not.toContain('source café'); expect(persisted).not.toContain(delivered.preview);
  expect(persisted).not.toContain(delivered.handle!);
});

it.each(['removed', 'changed', 'foreign'] as const)('denies retained bytes after the original grant is %s', async change => {
  const f = fixture(), result = await f.read();
  f.store.internal('fixture.revoke', f.ctx.threadId, () => {
    if (change === 'removed') f.store.remove('resource', f.grant.id);
    else f.store.put('resource', f.grant.id, f.ctx.threadId, { ...f.grant, ...(change === 'foreign' ? { threadId: 'foreign' } : { writable: true }) });
  });
  expect(await f.range(result.handle!, 0, 16)).toEqual({ status: 'UNAVAILABLE' });
});

it('denies a physically replaced source even when its grant envelope is unchanged', async () => {
  const f = fixture(), result = await f.read();
  renameSync(join(f.project, 'source.txt'), join(f.project, 'original.txt')); writeFileSync(join(f.project, 'source.txt'), 'Replacement source');
  expect(await f.range(result.handle!, 0, 16)).toEqual({ status: 'UNAVAILABLE' });
});

it.each(['model', 'account', 'workspace', 'project', 'thinking', 'mode'] as const)('denies a retained result after the current %s binding changes', async binding => {
  const f = fixture(), result = await f.read();
  const changes: Record<typeof binding, Partial<Thread>> = { model: { modelId: 'test/other' }, account: { accountId: 'other' }, workspace: { workspaceId: 'other' }, project: { projectId: 'other' }, thinking: { thinkingLevel: 'high' }, mode: { mode: 'plan' } };
  f.owner(changes[binding]);
  expect(await f.range(result.handle!, 0, 16)).toEqual({ status: 'UNAVAILABLE' });
});

it('rejects replaced grant roots and new hard links to captured sources', async () => {
  const f = fixture(), result = await f.read();
  linkSync(join(f.project, 'source.txt'), join(f.project, 'alias.txt'));
  expect(await f.range(result.handle!, 0, 16)).toEqual({ status: 'UNAVAILABLE' });
  rmSync(join(f.project, 'alias.txt'));
  renameSync(f.project, join(f.folder, 'original-project')); mkdirSync(f.project); writeFileSync(join(f.project, 'source.txt'), 'replacement');
  expect(await f.range(result.handle!, 0, 16)).toEqual({ status: 'UNAVAILABLE' });
});

it('suppresses a preview when the captured physical source is replaced during persistence', async () => {
  const f = fixture(); hooks.afterPut = () => { renameSync(join(f.project, 'source.txt'), join(f.project, 'original.txt')); writeFileSync(join(f.project, 'source.txt'), 'replacement'); };
  expect(await f.read()).toMatchObject({ status: 'FULL_RESULT_UNAVAILABLE', handle: null, preview: '' });
});

it('does not reconstruct live invocation authority from persisted result metadata after Service reopen', async () => {
  const f = fixture(), result = await f.read(); await f.service.dispose();
  const reopened = new Service(f.store, f.service.runtime, { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true } });
  try { expect(await reopened.tool({ name: 'context_result_read', args: { handle: result.handle!, offset: 0, length: 16 } }, f.ctx)).toEqual({ status: 'UNAVAILABLE' }); }
  finally { await reopened.dispose(); }
});

it('suppresses both preview and handle when grant authority disappears during spill persistence', async () => {
  const f = fixture(); hooks.afterPut = () => f.store.internal('fixture.revoke', f.ctx.threadId, () => f.store.remove('resource', f.grant.id));
  const result = await f.read();
  expect(result).toMatchObject({ status: 'FULL_RESULT_UNAVAILABLE', handle: null, preview: '' });
});

it('rechecks the original grant after retained bytes are read', async () => {
  const f = fixture(), result = await f.read();
  hooks.afterGet = () => f.store.internal('fixture.revoke', f.ctx.threadId, () => f.store.remove('resource', f.grant.id));
  expect(await f.range(result.handle!, 0, 16)).toEqual({ status: 'UNAVAILABLE' });
});

it('does not derive authority for an integration result from caller supplied resourceId', async () => {
  const output = { status: 'failed', stdout: 'BEGIN\n' + 'x'.repeat(40000), stderr: '\nLAST_FAILURE: exact diagnostic' };
  const f = fixture({ additionalTool: async () => output });
  const result = await f.service.tool({ name: 'integration_list', args: { resourceId: f.grant.id } }, f.ctx) as { status: string; handle: null; preview: string };
  expect(result).toMatchObject({ status: 'FULL_RESULT_UNAVAILABLE', handle: null });
  expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(16384); expect(result.preview).toContain('BEGIN'); expect(result.preview).toContain('LAST_FAILURE: exact diagnostic');
});

it('freezes catalog authority before an integration callback can mutate the call object', async () => {
  const call = { name: 'integration_list', args: {} };
  const f = fixture({ additionalTool: async () => { call.name = 'ui_discover'; return 'untrusted integration output '.repeat(2000); } });
  const result = await f.service.tool(call, f.ctx);
  expect(result).toMatchObject({ status: 'FULL_RESULT_UNAVAILABLE', handle: null });
});

it('does not let a mutated original call bypass the grant required by its retained handle', async () => {
  const f = fixture(), call = { name: 'repository_read', args: { resourceId: f.grant.id, path: 'source.txt' } };
  writeFileSync(join(f.project, 'source.txt'), 'captured private source '.repeat(2000));
  const result = await f.service.tool(call, f.ctx) as { handle: string };
  expect(result.handle).toEqual(expect.any(String));
  call.name = 'ui_discover';
  f.store.internal('fixture.revoke', f.ctx.threadId, () => f.store.remove('resource', f.grant.id));
  expect(await f.range(result.handle, 0, 16)).toEqual({ status: 'UNAVAILABLE' });
});

it.each([32, 48000])('suppresses a cached %s-byte effect result when replay skips the original resource guard', async length => {
  const f = fixture(), call = { name: 'repository_read', args: { resourceId: f.grant.id, path: 'source.txt' } };
  writeFileSync(join(f.project, 'source.txt'), 'private source'.padEnd(length, '.'));
  await f.service.tool(call, f.ctx);
  const effect = f.store.all<{ invocationId: string }>('toolEffect', f.ctx.threadId)[0]!;
  f.store.internal('fixture.revoke', f.ctx.threadId, () => f.store.remove('resource', f.grant.id));
  expect(await f.service.tool({ ...call, args: { ...call.args, invocationId: effect.invocationId } }, f.ctx)).toMatchObject({ status: 'FULL_RESULT_UNAVAILABLE', handle: null, preview: '' });
});


it('leaves small authorized domain results unchanged and keeps the default-off path unchanged', async () => {
  const f = fixture({ enabled: false }), result = await f.read();
  expect(result).toEqual(f.store.all<DataRecord>('data', f.ctx.threadId)[0]);
});

it('does not wrap a small result merely because retained retrieval is enabled', async () => {
  const f = fixture(), result = await f.read('small source');
  expect(result).toEqual(f.store.all<DataRecord>('data', f.ctx.threadId)[0]);
});
