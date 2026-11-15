import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, lstatSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service, type ServiceOptions } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import type { RuntimeAdapter, RuntimeCallbacks, StartRun, Thread } from '../packages/contracts/index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0)) await close(); });
async function fixture(options: ServiceOptions = {}) {
  const base = mkdtempSync(join(tmpdir(), 'm04-custody-')), store = new Store(join(base, 'profile'));
  const starts: StartRun[] = [], followUps: StartRun[] = [];
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = {
    configure(value) { callbacks = value; },
    models: vi.fn(async () => [{ id: 'test/model', provider: 'test', name: 'Fixture' }, { id: 'test/other', provider: 'test', name: 'Other' }]),
    start: vi.fn(async input => { starts.push(input); }), followUp: vi.fn(async input => { followUps.push(input); }),
    cancel: vi.fn(async () => {}), compact: vi.fn(async () => {}), history: vi.fn(async () => []), dispose: vi.fn(async () => {}),
  };
  const service = new Service(store, runtime, { requestContextEnabled: true, ...options });
  const send = (type: string, payload: Record<string, unknown> = {}, threadId?: string, id: string = crypto.randomUUID()) => service.command({ id, type, threadId, payload });
  const create = async () => (await send('thread.create', {})).result as Thread;
  const thread = await create();
  const prepare = (content = 'Inspect the selected source') => service.prepareRequestContext(thread.id, content, { modelId: 'test/model' });
  const message = (content: string, requestContextId?: string, id?: string) => send('message.send', { content, modelId: 'test/model', ...(requestContextId ? { requestContextId } : {}) }, thread.id, id);
  let disposed = false;
  cleanups.push(async () => { if (!disposed) { disposed = true; await service.dispose(); } store.close(); rmSync(base, { recursive: true, force: true }); });
  return { base, store, runtime, service, starts, followUps, thread, prepare, message, send, create, callbacks: () => callbacks, dispose: async () => { if (!disposed) { disposed = true; await service.dispose(); } } };
}

it('retains the same immutable preparation identity through the actual admitted request', async () => {
  const supplemental = { id: 'memory:revision-1', revision: 1, category: 'MEMORY' as const, text: '{"evidence":"Retain this constraint"}' };
  const prepare = vi.fn(), finalize = vi.fn(() => ({ sources: [supplemental] }));
  const f = await fixture({ requestContextHooks: { prepare, finalize } }), before = f.service.thread(f.thread.id);
  const preparation = await f.prepare('Exact draft with λ');
  expect(f.service.thread(f.thread.id)).toEqual(before);
  expect(f.starts).toEqual([]);
  expect(Object.isFrozen(preparation)).toBe(true);
  expect(preparation).toMatchObject({ threadId: f.thread.id, modelId: 'test/model', accountId: null, contextGeneration: 1 });
  expect(prepare).toHaveBeenCalledWith(preparation, 'Exact draft with λ');
  expect(f.service.getRequestPreparation(f.thread.id, preparation.requestId)).toEqual(preparation);
  await f.message('Exact draft with λ', preparation.requestId);
  await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  const input = f.starts[0], receipt = input.requestContext!;
  expect(finalize).toHaveBeenCalledWith(preparation, expect.objectContaining({ runId: input.runId, epoch: 1, inputId: input.inputId }));
  expect(receipt).toMatchObject({ requestId: preparation.requestId, contextGeneration: preparation.contextGeneration, owner: { threadId: f.thread.id }, nativeContext: { visibility: 'OPAQUE_NATIVE_CONTEXT', totalBytes: null } });
  expect(input.prompt).toContain(supplemental.text);
  const suffix = input.prompt.slice(input.prompt.indexOf('\n\nHost-selected evidence'));
  expect(receipt.segments.filter(segment => segment.category === 'MEMORY').reduce((total, segment) => total + segment.utf8Bytes, 0)).toBe(Buffer.byteLength(suffix));
  expect(Object.isFrozen(input)).toBe(true);
  expect(Object.isFrozen(receipt)).toBe(true);
  expect(Object.isFrozen(receipt.segments)).toBe(true);
  supplemental.text = 'Late mutable replacement';
  expect(input.prompt).not.toContain(supplemental.text);
  const saved = f.store.get('requestContextReceipt', preparation.requestId);
  expect(saved).toMatchObject({ receipt: { requestId: preparation.requestId } });
  expect(JSON.stringify(saved)).not.toMatch(/Exact draft|Retain this constraint|Late mutable replacement/);
  expect(() => f.service.getRequestPreparation(f.thread.id, preparation.requestId)).toThrow();
});

it.each(['prompt', 'model', 'owner'] as const)('rejects a preview token used with a changed %s before accepting the draft', async change => {
  const f = await fixture(), preparation = await f.prepare('Bound draft'), other = await f.create();
  await expect(f.send('message.send', { content: change === 'prompt' ? 'Changed draft' : 'Bound draft', modelId: change === 'model' ? 'test/other' : 'test/model', requestContextId: preparation.requestId }, change === 'owner' ? other.id : f.thread.id)).rejects.toThrow();
  expect(f.starts).toEqual([]);
  expect(f.store.all('outbox')).toEqual([]);
});

it('rejects a removed grant and changed task note before accepting a prepared draft', async () => {
  const f = await fixture();
  f.store.internal('fixture.grant', f.thread.id, () => f.store.put('resource', 'grant', f.thread.id, { id: 'grant', threadId: f.thread.id, kind: 'project', path: f.base, writable: false, createdAt: 'fixture', label: 'Fixture' }));
  const first = await f.prepare('Bound resources');
  f.store.internal('fixture.revoke', f.thread.id, () => f.store.remove('resource', 'grant'));
  await expect(f.message('Bound resources', first.requestId)).rejects.toThrow();
  const second = await f.prepare('Bound notes');
  f.store.internal('fixture.note', f.thread.id, () => f.store.put('taskMemory', 'note', f.thread.id, { id: 'note', threadId: f.thread.id, key: 'constraint', revision: 1, content: 'A new constraint', author: 'user', updatedAt: 'fixture' }));
  await expect(f.message('Bound notes', second.requestId)).rejects.toThrow();
  expect(f.store.all('outbox')).toEqual([]);
});

it('checks physical project identity again after preview', async () => {
  const f = await fixture(), projectPath = join(f.base, 'project'); mkdirSync(projectPath);
  const info = lstatSync(projectPath, { bigint: true });
  f.store.internal('fixture.project', f.thread.id, () => {
    f.store.put('workspaceProject', 'project', null, { id: 'project', name: 'Project', authority: { kind: 'local' } });
    f.store.put('workspaceProjectRoot', 'project', null, { path: projectPath, identity: { dev: String(info.dev), ino: String(info.ino) } });
    f.store.put('thread', f.thread.id, f.thread.id, { ...f.service.thread(f.thread.id), projectId: 'project' });
  });
  const preparation = await f.prepare('Project bound');
  renameSync(projectPath, projectPath + '-old'); mkdirSync(projectPath);
  await expect(f.message('Project bound', preparation.requestId)).rejects.toThrow();
  expect(f.starts).toEqual([]);
});

it('checks current account selection and model binding again after preview', async () => {
  const f = await fixture(), preparation = await f.prepare();
  f.store.internal('fixture.binding', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, { ...f.service.thread(f.thread.id), modelId: 'test/model', accountId: 'changed-account' }));
  await expect(f.message('Inspect the selected source', preparation.requestId)).rejects.toThrow();
  expect(f.starts).toEqual([]);
});

it('prevents token reuse while preserving a retry of the accepted command', async () => {
  const f = await fixture(), preparation = await f.prepare('One input'), id = crypto.randomUUID();
  const accepted = await f.message('One input', preparation.requestId, id);
  expect(await f.message('One input', preparation.requestId, id)).toEqual(accepted);
  await expect(f.message('One input', preparation.requestId)).rejects.toThrow();
  await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  expect(f.store.all('outbox')).toHaveLength(1);
});

it('fails preparation before message admission when the trusted preparation hook fails', async () => {
  const f = await fixture({ requestContextHooks: { prepare() { throw Error('Preparation could not attest its sources'); }, finalize() { return { sources: [] }; } } });
  await expect(f.message('Retained draft')).rejects.toThrow('Preparation could not attest its sources');
  expect(f.store.all('outbox')).toEqual([]);
  expect(f.starts).toEqual([]);
});

it('fails dispatch when the trusted finalization hook fails and retains the accepted input', async () => {
  const f = await fixture({ requestContextHooks: { prepare() {}, finalize() { throw Error('Final source check failed'); } } });
  await f.message('Accepted but not dispatched');
  await vi.waitFor(() => expect(f.service.thread(f.thread.id)).toMatchObject({ status: 'interrupted', error: 'Final source check failed' }));
  expect(f.starts).toEqual([]);
  expect(f.store.all('outbox', f.thread.id)).toEqual([expect.objectContaining({ content: 'Accepted but not dispatched' })]);
});

it.each(['stop', 'note', 'grant', 'hook assertion'] as const)('revalidates after asynchronous finalization when %s changes', async change => {
  let entered = false, release!: () => void;
  const enter = () => { entered = true; }, gate = new Promise<void>(done => { release = done; });
  const f = await fixture({ requestContextHooks: { prepare() {}, async finalize() { enter(); await gate; return { sources: [], assertCurrent() { if (change === 'hook assertion') throw Error('Supplemental source was revoked'); } }; } } });
  try {
    await f.message('Bound final cut'); await vi.waitFor(() => expect(entered).toBe(true));
    if (change === 'stop') await f.send('run.stop', {}, f.thread.id);
    if (change === 'note') f.store.internal('fixture.note', f.thread.id, () => f.store.put('taskMemory', 'note', f.thread.id, { id: 'note', threadId: f.thread.id, key: 'changed', revision: 1, content: 'Changed during preparation', author: 'user', updatedAt: 'fixture' }));
    if (change === 'grant') f.store.internal('fixture.grant', f.thread.id, () => f.store.put('resource', 'new-grant', f.thread.id, { id: 'new-grant', threadId: f.thread.id, kind: 'project', path: f.base, writable: true, label: 'Changed', createdAt: 'fixture' }));
    release(); await f.service.deliverOutbox(f.thread.id);
    expect(f.starts).toEqual([]);
    expect(f.service.thread(f.thread.id).status).toBe(change === 'stop' ? 'stopped' : 'interrupted');
  } finally { release(); }
});

it('dispatches queued token-bound follow-ups separately without losing later outbox inputs', async () => {
  const f = await fixture(); let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  vi.mocked(f.runtime.start).mockImplementation(async input => { f.starts.push(input); await gate; });
  try {
    const first = await f.prepare('First assignment'); await f.message('First assignment', first.requestId);
    await vi.waitFor(() => expect(f.starts).toHaveLength(1));
    const second = await f.prepare('Second assignment'); await f.message('Second assignment', second.requestId);
    const third = await f.prepare('Third assignment'); await f.message('Third assignment', third.requestId);
    expect(f.followUps).toEqual([]); release(); await f.service.deliverOutbox(f.thread.id);
    expect(f.followUps).toHaveLength(2);
    expect([f.starts[0], ...f.followUps].map(input => input.requestContext?.requestId)).toEqual([first.requestId, second.requestId, third.requestId]);
    expect([f.starts[0], ...f.followUps].map(input => input.inputIds?.length)).toEqual([1, 1, 1]);
    expect(f.followUps[0].prompt).toContain('Second assignment'); expect(f.followUps[0].prompt).not.toContain('Third assignment');
    expect(f.followUps[1].prompt).toContain('Third assignment');
    expect(f.store.all<{ status: string }>('outbox', f.thread.id).filter(input => input.status === 'persisted')).toEqual([]);
  } finally { release(); }
});

it('allocates default-send identity but leaves the default-off path unchanged', async () => {
  const enabled = await fixture(); await enabled.message('Automatic preparation');
  await vi.waitFor(() => expect(enabled.starts).toHaveLength(1));
  expect(enabled.starts[0].requestContext?.contextGeneration).toBe(1);
  const hooks = { prepare: vi.fn(), finalize: vi.fn(() => ({ sources: [] })) };
  const disabled = await fixture({ requestContextEnabled: false, requestContextHooks: hooks });
  await disabled.message('Existing request path');
  await vi.waitFor(() => expect(disabled.starts).toHaveLength(1));
  expect(disabled.starts[0].requestContext).toBeUndefined(); expect(hooks.prepare).not.toHaveBeenCalled();
  await expect(disabled.prepare()).rejects.toMatchObject({ code: 'REQUEST_CONTEXT_DISABLED' });
});

it('rejects attached skills in preview exactly as the existing send path does', async () => {
  const f = await fixture();
  await expect(f.service.prepareRequestContext(f.thread.id, 'Selected skill', { modelId: 'test/model', skills: [] })).rejects.toMatchObject({ code: 'SKILL_ADMISSION_UNAVAILABLE' });
  await expect(f.send('message.send', { content: 'Selected skill', modelId: 'test/model', skills: [] }, f.thread.id)).rejects.toMatchObject({ code: 'SKILL_ADMISSION_UNAVAILABLE' });
  expect(f.starts).toEqual([]);
});

it('increments the durable owner generation after Service replacement and rejects the old token', async () => {
  const f = await fixture(), first = await f.prepare(); await f.dispose();
  const replacement = new Service(f.store, f.runtime, { requestContextEnabled: true });
  try {
    const second = await replacement.prepareRequestContext(f.thread.id, 'After replacement', { modelId: 'test/model' });
    expect(second.contextGeneration).toBeGreaterThan(first.contextGeneration);
    expect(second.requestId).not.toBe(first.requestId);
    expect(() => replacement.getRequestPreparation(f.thread.id, first.requestId)).toThrow();
  } finally { await replacement.dispose(); }
});

it('expires abandoned previews, calls cleanup, and never resurrects the same identity', async () => {
  const released = vi.fn(), f = await fixture({ requestContextHooks: { prepare() {}, finalize() { return { sources: [] }; }, released } });
  const first = await f.prepare(), time = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(time + 6 * 60_000);
  expect(() => f.service.getRequestPreparation(f.thread.id, first.requestId)).toThrow();
  expect(released).toHaveBeenCalledWith(first, 'expired');
  const second = await f.prepare(); expect(second.contextGeneration).toBe(first.contextGeneration + 1);
});

it.each(['session', 'settled'] as const)('preserves an accepted queued token across the prior native %s lifecycle event', async change => {
  const f = await fixture(); let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  vi.mocked(f.runtime.start).mockImplementationOnce(async input => { f.starts.push(input); await gate; });
  try {
    await f.message('First native turn'); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
    const next = await f.prepare('Queued after the native turn'); await f.message('Queued after the native turn', next.requestId);
    const input = f.starts[0];
    f.callbacks().onEvent({ ...input, type: 'session', sessionPath: join(f.store.dataDir, 'owned-session.json') });
    if (change === 'settled') {
      f.callbacks().onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds });
      f.callbacks().onEvent({ ...input, type: 'assistant.message', content: 'Completed first input', inputIds: input.inputIds });
      f.callbacks().onEvent({ ...input, type: 'settled' });
    }
    release(); await f.service.deliverOutbox(f.thread.id);
    const delivered = [...f.starts, ...f.followUps].find(item => item.requestContext?.requestId === next.requestId);
    expect(delivered).toBeDefined();
    expect(delivered?.sessionPath).toBe(join(f.store.dataDir, 'owned-session.json'));
    expect(delivered?.prompt).toContain('Queued after the native turn');
    expect(f.store.all<{ status: string }>('outbox', f.thread.id).filter(item => item.status === 'persisted')).toEqual([]);
  } finally { release(); }
});

it('preserves separately accepted previews queued before the first epoch is admitted', async () => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const f = await fixture({ async prepareWorkspace() { if (++calls === 2) await gate; } });
  try {
    const first = await f.prepare('First pre-run draft'); await f.message('First pre-run draft', first.requestId);
    const second = await f.prepare('Second pre-run draft'); await f.message('Second pre-run draft', second.requestId);
    expect(f.starts).toEqual([]); release(); await f.service.deliverOutbox(f.thread.id);
    expect(f.starts).toHaveLength(1); expect(f.followUps).toHaveLength(1);
    expect(f.starts[0].requestContext?.requestId).toBe(first.requestId);
    expect(f.followUps[0].requestContext?.requestId).toBe(second.requestId);
  } finally { release(); }
});

it('bounds abandoned preparations and retains only the newest 128 metadata receipts', async () => {
  const f = await fixture();
  const previews: Awaited<ReturnType<typeof f.prepare>>[] = [];
  for (let index = 0; index < 128; index++) previews.push(await f.prepare('Abandoned ' + index));
  await expect(f.prepare('One too many')).rejects.toMatchObject({ code: 'REQUEST_CONTEXT_BUSY' });
  const original = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(original + 6 * 60_000);
  expect(() => f.service.getRequestPreparation(f.thread.id, previews[0].requestId)).toThrow();
  for (let index = 0; index < 130; index++) { await f.message('Bounded receipt ' + index); await f.service.deliverOutbox(f.thread.id); }
  expect(f.store.all('requestContextReceipt')).toHaveLength(128);
  const serialized = JSON.stringify(f.store.all('requestContextReceipt'));
  expect(serialized).not.toContain('Bounded receipt'); expect(serialized).not.toContain('Abandoned');
  expect(f.followUps).toHaveLength(129);
});

it('keeps expired, hung preparation jobs in the admission bound until they actually settle', async () => {
  let entered = 0, release!: () => void; const gate = new Promise<void>(done => { release = done; });
  const f = await fixture({ requestContextHooks: { async prepare() { entered++; await gate; } } });
  const pending = Array.from({ length: 128 }, (_, index) => f.prepare('Pending ' + index).then(value => ({ value }), error => ({ error })));
  try {
    await vi.waitFor(() => expect(entered).toBe(128));
    const original = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(original + 6 * 60_000);
    await expect(f.prepare('Cannot bypass with expiry')).rejects.toMatchObject({ code: 'REQUEST_CONTEXT_BUSY' });
    release(); const results = await Promise.all(pending); expect(results.every(result => 'error' in result)).toBe(true);
    expect((await f.prepare('Fresh after settlement')).contextGeneration).toBe(129);
  } finally { release(); await Promise.all(pending); }
});

it('resolves the source learn expansion once and dispatches the same captured text', async () => {
  const calls = vi.fn(async () => ({ prompt: 'Captured original learn expansion' }));
  const f = await fixture({ source: {
    runtime: { sourceBusy: false, reviewBusy: false, async cancelBackground() {}, sourceRequest<T>() { return calls() as Promise<T>; } },
    library: { async initialize() { return { migrated: 0 }; }, async refresh() {}, async command() { throw Error('Unused fixture'); }, async view() { throw Error('Unused fixture'); }, async proposal() { throw Error('Unused fixture'); } },
  } });
  const preparation = await f.prepare('/learn the selected workflow');
  calls.mockResolvedValue({ prompt: 'Late source replacement' });
  await f.message('/learn the selected workflow', preparation.requestId); await f.service.deliverOutbox(f.thread.id);
  expect(calls).toHaveBeenCalledOnce();
  expect(f.starts[0].prompt).toContain('Captured original learn expansion'); expect(f.starts[0].prompt).not.toContain('Late source replacement');
  expect(f.starts[0].requestContext?.requestId).toBe(preparation.requestId);
});
