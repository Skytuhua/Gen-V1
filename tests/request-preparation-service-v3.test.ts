import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, lstatSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service, type ServiceOptions } from '../packages/core/service.ts';
import { RequestContextCustody, type RequestContextBasis } from '../packages/core/request-custody.ts';
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

it.each(['projection', 'commit'] as const)('retries an explicit preparation after a synchronous %s failure rolls back admission', async boundary => {
  const f = await fixture(), preparation = await f.prepare('Retry this exact preparation'), before = f.service.thread(f.thread.id);
  const id = 'rolled-back-' + boundary, failure = new Error('fixture ' + boundary + ' failure');
  const put = f.store.put.bind(f.store), exec = f.store.db.exec.bind(f.store.db);
  const fault = boundary === 'projection'
    ? vi.spyOn(f.store, 'put').mockImplementation((kind, ...args) => {if (kind === 'message') throw failure; return put(kind, ...args);})
    : vi.spyOn(f.store.db, 'exec').mockImplementation(sql => {if (sql === 'COMMIT') throw failure; return exec(sql);});
  await expect(f.message('Retry this exact preparation', preparation.requestId, id)).rejects.toBe(failure); fault.mockRestore();
  expect(f.store.all('outbox')).toEqual([]); expect(f.store.all('message')).toEqual([]); expect(f.service.thread(f.thread.id)).toEqual(before);
  const accepted = await f.message('Retry this exact preparation', preparation.requestId, id);
  await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  expect(f.starts[0].requestContext).toMatchObject({requestId: preparation.requestId, contextGeneration: preparation.contextGeneration});
  expect(await f.message('Retry this exact preparation', preparation.requestId, id)).toEqual(accepted);
  expect(f.store.all('outbox')).toHaveLength(1);
});

it('keeps a committed preparation claimed when its acknowledgement fails after commit', async () => {
  const f = await fixture(), preparation = await f.prepare('Committed input'), id = 'committed-before-ack-failure';
  const commit = f.store.command.bind(f.store);
  const fault = vi.spyOn(f.store, 'command').mockImplementation((command, apply) => {
    const receipt = commit(command, apply);
    if (command.id === id) throw Error('fixture acknowledgement failed after commit');
    return receipt;
  });
  const accepted = await f.message('Committed input', preparation.requestId, id); fault.mockRestore();
  expect(accepted.result).toMatchObject({inputId: id}); expect(f.store.all('outbox')).toHaveLength(1);
  expect(() => f.service.getRequestPreparation(f.thread.id, preparation.requestId)).toThrow();
  await f.service.deliverOutbox(f.thread.id);
  expect(f.starts).toHaveLength(1); expect(f.starts[0].requestContext?.requestId).toBe(preparation.requestId);
  expect(await f.message('Committed input', preparation.requestId, id)).toEqual(accepted);
});

it.each(['owner', 'epoch', 'grant'] as const)('keeps the original %s fence after an uncommitted preparation claim rolls back', async change => {
  const f = await fixture();
  f.store.internal('fixture.grant', f.thread.id, () => f.store.put('resource', 'rollback-grant', f.thread.id, {id: 'rollback-grant', threadId: f.thread.id, kind: 'project', path: f.base, writable: false, createdAt: 'fixture', label: 'Fixture'}));
  const preparation = await f.prepare('Keep the original authority'), put = f.store.put.bind(f.store), failure = Error('fixture rollback before owner change');
  const fault = vi.spyOn(f.store, 'put').mockImplementation((kind, ...args) => {if (kind === 'message') throw failure; return put(kind, ...args);});
  await expect(f.message('Keep the original authority', preparation.requestId, 'owner-fenced-rollback')).rejects.toBe(failure); fault.mockRestore();
  let target = f.thread.id;
  if (change === 'owner') target = (await f.create()).id;
  if (change === 'epoch') f.store.internal('fixture.epoch', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.service.thread(f.thread.id), epoch: 1}));
  if (change === 'grant') f.store.internal('fixture.revoke', f.thread.id, () => f.store.remove('resource', 'rollback-grant'));
  await expect(f.send('message.send', {content: 'Keep the original authority', modelId: 'test/model', requestContextId: preparation.requestId}, target, 'owner-fenced-rollback')).rejects.toMatchObject({code: 'STALE_REQUEST_CONTEXT'});
  expect(f.starts).toEqual([]); expect(f.store.all('outbox')).toEqual([]);
});

it('rolls back a later failed claim without releasing another accepted request', async () => {
  const f = await fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  vi.mocked(f.runtime.start).mockImplementationOnce(async input => {f.starts.push(input); await gate;});
  try {
    const first = await f.prepare('Already accepted'), receipt = await f.message('Already accepted', first.requestId, 'accepted-before-rollback');
    await vi.waitFor(() => expect(f.starts).toHaveLength(1));
    const second = await f.prepare('Retry the later input'), put = f.store.put.bind(f.store), failure = Error('fixture later admission failure');
    const fault = vi.spyOn(f.store, 'put').mockImplementation((kind, ...args) => {if (kind === 'message') throw failure; return put(kind, ...args);});
    await expect(f.message('Retry the later input', second.requestId, 'later-rollback')).rejects.toBe(failure); fault.mockRestore();
    expect(await f.message('Already accepted', first.requestId, 'accepted-before-rollback')).toEqual(receipt);
    expect(() => f.service.getRequestPreparation(f.thread.id, first.requestId)).toThrow();
    await f.message('Retry the later input', second.requestId, 'later-rollback');
    release(); await f.service.deliverOutbox(f.thread.id);
    expect(f.starts).toHaveLength(1); expect(f.followUps).toHaveLength(1);
    expect(f.followUps[0].requestContext?.requestId).toBe(second.requestId); expect(f.store.all('outbox')).toHaveLength(2);
  } finally {release();}
});

it('keeps an accepted queued request dispatchable after a later input fails at COMMIT', async () => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const f = await fixture({async prepareWorkspace() {if (++calls === 2) await gate;}});
  try {
    const first = await f.prepare('Accepted before native admission'), receipt = await f.message('Accepted before native admission', first.requestId, 'queued-before-commit-failure');
    const second = await f.prepare('Uncommitted later input'), exec = f.store.db.exec.bind(f.store.db), failure = Error('fixture late queued COMMIT failure');
    expect(f.starts).toEqual([]); expect(f.store.get('outbox', 'queued-before-commit-failure')).toMatchObject({status: 'persisted', runId: null});
    const fault = vi.spyOn(f.store.db, 'exec').mockImplementation(sql => {if (sql === 'COMMIT') throw failure; return exec(sql);});
    await expect(f.message('Uncommitted later input', second.requestId, 'failed-queued-commit')).rejects.toBe(failure); fault.mockRestore();
    expect(f.store.get('outbox', 'failed-queued-commit')).toBeNull();
    expect(f.service.getRequestPreparation(f.thread.id, second.requestId)).toEqual(second);
    expect(() => f.service.getRequestPreparation(f.thread.id, first.requestId)).toThrow();
    release(); await f.service.deliverOutbox(f.thread.id);
    expect(f.starts).toHaveLength(1); expect(f.starts[0].requestContext?.requestId).toBe(first.requestId); expect(f.followUps).toEqual([]);
    expect(await f.message('Accepted before native admission', first.requestId, 'queued-before-commit-failure')).toEqual(receipt);
  } finally {release();}
});

it('undoes a rolled-back lifecycle advance for every exactly touched claimed preparation', async () => {
  const f = await fixture(), custody = new RequestContextCustody(f.store), hash = 'a'.repeat(64);
  // Exercise the custody owner's transaction contract with an explicit epoch-basis
  // change. Ordinary same-model message admission may leave that basis equal.
  const before: RequestContextBasis = {profileId: hash, threadId: f.thread.id, projectId: null, workspaceId: 'thread:' + f.thread.id, modelId: 'test/model', accountId: null, thinkingLevel: null, bindingDigest: hash, grantDigest: hash, sourceCutDigest: hash, instructionDigest: hash, toolRegistryDigest: hash, admissionDigest: hash};
  const after = {...before, admissionDigest: 'b'.repeat(64)};
  try {
    const first = await custody.prepare(before, 'First accepted claim', 'First accepted claim', () => before);
    const second = await custody.prepare(before, 'Second failed claim', 'Second failed claim', () => before);
    const firstCommand = {id: 'custody-first-accepted', type: 'message.send', threadId: f.thread.id, payload: {content: 'First accepted claim'}};
    const secondCommand = {id: 'custody-second-failed', type: 'message.send', threadId: f.thread.id, payload: {content: 'Second failed claim'}};
    const accepted = f.store.command(firstCommand, () => {
      custody.claim(first.requestId, firstCommand.id, firstCommand.payload.content, before);
      f.store.put('outbox', firstCommand.id, f.thread.id, {id: firstCommand.id, threadId: f.thread.id, status: 'persisted', runId: null, requestContextId: first.requestId});
      return {inputId: firstCommand.id};
    });
    let rollbackClaim: (() => void) | undefined, rollbackAdmission: (() => void) | undefined;
    const exec = f.store.db.exec.bind(f.store.db), failure = Error('fixture shared lifecycle COMMIT failure');
    const fault = vi.spyOn(f.store.db, 'exec').mockImplementation(sql => {if (sql === 'COMMIT') throw failure; return exec(sql);});
    expect(() => f.store.command(secondCommand, () => {
      rollbackClaim = custody.claim(second.requestId, secondCommand.id, secondCommand.payload.content, before);
      f.store.put('outbox', secondCommand.id, f.thread.id, {id: secondCommand.id, threadId: f.thread.id, status: 'persisted', runId: null, requestContextId: second.requestId});
      rollbackAdmission = custody.advanceAdmission(before, after);
      return {inputId: secondCommand.id};
    })).toThrow(failure); fault.mockRestore();
    expect(f.store.receipt(secondCommand)).toBeNull(); expect(f.store.get('outbox', secondCommand.id)).toBeNull();
    rollbackAdmission?.(); rollbackClaim?.();
    expect(f.store.receipt(firstCommand)).toEqual(accepted);
    expect(custody.assertClaim(first.requestId, firstCommand.id, firstCommand.payload.content, before)).toEqual(first);
    expect(() => custody.getReady(f.thread.id, first.requestId, () => before)).toThrow();
    expect(custody.getReady(f.thread.id, second.requestId, () => before)).toEqual(second);
    const input: StartRun = {threadId: f.thread.id, runId: 'custody-run', epoch: 1, inputId: firstCommand.id, inputIds: [firstCommand.id], modelId: 'test/model', accountId: null, sessionPath: null, resources: [], prompt: firstCommand.payload.content};
    const finalized = await custody.finalize(first.requestId, input, [{id: firstCommand.id, revision: 1, category: 'USER', text: input.prompt}], () => before);
    custody.assertFinalized(first.requestId, finalized, before);
    expect(finalized.requestContext?.requestId).toBe(first.requestId);
    // Reclaiming the same preparation or advancing again must not let an older
    // rollback callback rewind the new owner, even when the input ID is equal.
    const reclaimed = custody.claim(second.requestId, secondCommand.id, secondCommand.payload.content, before);
    const olderAdvance = custody.advanceAdmission(before, after), later = {...before, admissionDigest: 'c'.repeat(64)};
    custody.advanceAdmission(after, later);
    olderAdvance(); rollbackAdmission?.(); rollbackClaim?.(); reclaimed?.();
    expect(custody.assertClaim(second.requestId, secondCommand.id, secondCommand.payload.content, later)).toEqual(second);
    expect(() => custody.getReady(f.thread.id, second.requestId, () => later)).toThrow();
    custody.assertFinalized(first.requestId, finalized, before);
  } finally {custody.dispose();}
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
