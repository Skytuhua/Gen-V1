import { afterEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Service, type ServiceOptions } from '../packages/core/service.ts';
import { ProjectMemory } from '../packages/core/project-memory.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { SUPPLEMENTAL_EVIDENCE_HEADER } from '../packages/core/request-custody.ts';
import { type MemoryAction, type MemoryPreparedRequest } from '../packages/contracts/project-memory.ts';
import type { MemoryExtractionJob } from '../packages/core/memory-extraction.ts';
import type { AgentWorkChild } from '../packages/core/agent-work.ts';
import type { RuntimeAdapter, RuntimeCallbacks, StartRun, Thread } from '../packages/contracts/index.ts';
import { memoryFixture } from './project-memory-fixture.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  __setCapabilityFlagForTests('memory.projectV1', undefined);
  __setCapabilityFlagForTests('agents.workV1', undefined);
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', undefined);
});
async function fixture(options: ServiceOptions = {}) {
  __setCapabilityFlagForTests('memory.projectV1', true);
  const f = await memoryFixture(store => store.internal('fixture-service-owner', null, () => {
    for (const id of ['thread', 'other']) store.put('thread', id, id, { ...store.get<Thread>('thread', id)!, accountId: null, modelId: 'test/model' });
  }));
  let callbacks!: RuntimeCallbacks;
  const starts: StartRun[] = [], followUps: StartRun[] = [];
  const runtime: RuntimeAdapter = {
    configure(value) { callbacks = value; },
    models: vi.fn(async () => [{ id: 'test/model', provider: 'test', name: 'Fixture model' }]),
    start: vi.fn(async input => { starts.push(input); }), followUp: vi.fn(async input => { followUps.push(input); }),
    compact: vi.fn(async () => {}), cancel: vi.fn(async () => {}), history: vi.fn(async () => []), dispose: vi.fn(async () => {}),
  };
  const service = new Service(f.store, runtime, { requestContextEnabled: true, ...options });
  const command = (type: string, payload: Record<string, unknown> = {}, threadId = 'thread') => service.command({ id: randomUUID(), type, threadId, payload });
  const prepare = (prompt = 'SQLite project persistence') => service.prepareProjectMemory('project', 'thread', prompt, { modelId: 'test/model' });
  const send = (prompt = 'SQLite project persistence', prepared?: MemoryPreparedRequest | null, threadId = 'thread') => command('message.send', { content: prompt, modelId: 'test/model', ...(prepared ? { requestContextId: prepared.requestId } : {}) }, threadId);
  const currentAccess = () => service.projectMemory.access('project', 'thread');
  const review = async (operation: MemoryAction) => {
    const access = await currentAccess();
    const result = service.projectMemory.review(access, { id: randomUUID(), type: 'project.memory.review', threadId: 'thread', payload: { operation } }, 'local-user');
    await service.projectMemoryReviewed(access, operation); return result;
  };
  const settle = (input: StartRun, content = 'SQLite remains the project persistence decision.') => {
    callbacks.onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds });
    callbacks.onEvent({ ...input, type: 'assistant.message', messageId: 'reply:' + input.inputId, content, inputIds: input.inputIds });
    callbacks.onEvent({ ...input, type: 'settled' });
  };
  cleanups.push(async () => { await service.dispose(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); });
  return { ...f, service, runtime, starts, followUps, command, prepare, send, currentAccess, review, settle, callbacks: () => callbacks };
}

it('uses one shared host ProjectMemory authority for routes and Service lifecycle', async () => {
  const f = await fixture();
  expect(f.service.projectMemory).toBeInstanceOf(ProjectMemory);
  expect(f.service.projectMemory).toBe(f.service.projectMemory);
  expect(f.service.projectMemory.read(await f.currentAccess())).toMatchObject({ enabled: true, available: true });
});

it('purges elapsed forgotten revisions at host recovery even when memory has been disabled', async () => {
  const f = await fixture(), text = 'Expired retained deletion from an earlier session', item = f.accept('Expired retained deletion from an earlier session');
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  expect(JSON.stringify(f.store.all('projectMemoryRevision'))).toContain(text);
  __setCapabilityFlagForTests('memory.projectV1', false);
  const expiredNow = Date.now() + 8 * 24 * 60 * 60 * 1000;
  vi.spyOn(Date, 'now').mockReturnValue(expiredNow);
  await f.service.recover();
  expect(JSON.stringify(f.store.all('projectMemoryRevision'))).not.toContain(text);
  const access = await f.currentAccess();
  expect(f.service.projectMemory.tombstones(access)).toEqual([
    expect.objectContaining({ itemId: item.id, purgeStatus: 'COMPLETE' }),
  ]);
  expect(f.store.get<{content:string}>('message','source')?.content).toBe('Use SQLite for project persistence.');
});

it('purges elapsed forgotten copies on the regular host tick without enabling memory', async () => {
  let maintenance: (() => void) | undefined;
  const original = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, timeout, ...args) => {
    if (timeout === 60_000 && typeof handler === 'function' && String(handler).includes('purgeMemoryRetention')) {
      maintenance = () => handler(...args);
    }
    return original(handler, timeout, ...args);
  });
  const f = await fixture(), text = 'Elapsed retention must not await an explicit user request', item = f.accept(text);
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  expect(JSON.stringify(f.store.all('projectMemoryRevision'))).toContain(text);
  __setCapabilityFlagForTests('memory.projectV1', false);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 60 * 60 * 1000);
  expect(maintenance).toBeDefined();
  maintenance!();
  expect(JSON.stringify(f.store.all('projectMemoryRevision'))).not.toContain(text);
  const access = await f.currentAccess();
  expect(f.service.projectMemory.tombstones(access)).toEqual([
    expect.objectContaining({ itemId: item.id, purgeStatus: 'COMPLETE' }),
  ]);
});

it('carries the same prepared memory request identity through actual Service send and final dispatch', async () => {
  const f = await fixture(), item = f.accept();
  const prepared = await f.prepare();
  expect(prepared).toMatchObject({ phase: 'PREPARING', items: [{ id: item.id, revision: item.revision }] });
  expect(prepared!.requestId).toBe(prepared!.recall.requestId);
  expect(f.service.getRequestPreparation('thread', prepared!.requestId).contextGeneration).toBe(prepared!.contextGeneration);
  await f.send('SQLite project persistence', prepared); await f.service.deliverOutbox('thread');
  expect(f.starts).toHaveLength(1);
  const input = f.starts[0];
  expect(input.requestContext).toMatchObject({ requestId: prepared!.requestId, contextGeneration: prepared!.contextGeneration });
  expect(input.prompt).toContain(SUPPLEMENTAL_EVIDENCE_HEADER); expect(input.prompt).toContain(item.text);
  expect(await f.service.latestProjectMemory('project', 'thread')).toBeNull();
  f.callbacks().onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds });
  expect(await f.service.latestProjectMemory('project', 'thread')).toMatchObject({ requestId: prepared!.requestId, contextGeneration: prepared!.contextGeneration, phase: 'CAPTURED' });
  expect(input.memoryCheckpoint).toEqual({ apiVersion: 2, required: true });
});

it('excludes an exact revision only from the same preparing token and never mutates captured prompt bytes', async () => {
  const f = await fixture(), excluded = f.accept('SQLite persistence must retain the exclusion fixture.'), kept = f.accept('SQLite persistence must retain the included fixture.');
  const prepared = (await f.prepare())!;
  expect(prepared.items.map(item => item.id)).toEqual(expect.arrayContaining([excluded.id, kept.id]));
  const selected = await f.service.excludeProjectMemory(prepared.requestId, { scope: prepared.scope, contextGeneration: prepared.contextGeneration, itemId: excluded.id, revision: excluded.revision });
  expect(selected).toMatchObject({ requestId: prepared.requestId, contextGeneration: prepared.contextGeneration, phase: 'PREPARING' });
  expect(selected.items.map(item => item.id)).not.toContain(excluded.id);
  await f.send('SQLite project persistence', selected); await f.service.deliverOutbox('thread');
  const prompt = f.starts[0].prompt;
  expect(prompt).not.toContain(excluded.text); expect(prompt).toContain(kept.text);
  await expect(Promise.resolve().then(() => f.service.excludeProjectMemory(prepared.requestId, { scope: prepared.scope, contextGeneration: prepared.contextGeneration, itemId: kept.id, revision: kept.revision }))).rejects.toThrow();
  expect(f.starts[0].prompt).toBe(prompt);
  const next = (await f.prepare('SQLite persistence in the next request'))!;
  expect(next.items.map(item => item.id)).toContain(excluded.id); expect(next.contextGeneration).toBeGreaterThan(prepared.contextGeneration);
});

it('includes M04 framing within the real 4 KiB MEMORY segment and eight-item limit', async () => {
  const f = await fixture();
  for (let index = 0; index < 8; index++) f.accept('SQLite persistence constraint ' + index + ': ' + 'evidence '.repeat(180));
  const prepared = (await f.prepare())!;
  expect(prepared.items.length).toBeGreaterThan(0); expect(prepared.items.length).toBeLessThanOrEqual(8);
  expect(prepared.injectedBytes).toBeLessThanOrEqual(4096);
  await f.send('SQLite project persistence', prepared); await f.service.deliverOutbox('thread');
  const input = f.starts[0], bytes = input.requestContext!.segments.filter(segment => segment.category === 'MEMORY').reduce((total, segment) => total + segment.utf8Bytes, 0);
  expect(bytes).toBe(prepared.injectedBytes); expect(bytes).toBeLessThanOrEqual(4096);
  expect(Buffer.byteLength(input.prompt.slice(input.prompt.indexOf(SUPPLEMENTAL_EVIDENCE_HEADER)))).toBe(bytes);
});

it.each(['generation', 'revision', 'account', 'project'] as const)('rejects a request exclusion with changed %s and preserves the prepared selection', async kind => {
  const f = await fixture(), item = f.accept(), prepared = (await f.prepare())!;
  const request = { scope: { ...prepared.scope }, contextGeneration: prepared.contextGeneration, itemId: item.id, revision: item.revision };
  if (kind === 'generation') request.contextGeneration++;
  if (kind === 'revision') request.revision++;
  if (kind === 'account') request.scope.accountId = 'wrong-account';
  if (kind === 'project') request.scope.projectId = 'other-project';
  await expect(Promise.resolve().then(() => f.service.excludeProjectMemory(prepared.requestId, request))).rejects.toThrow();
  await f.send('SQLite project persistence', prepared); await f.service.deliverOutbox('thread');
  expect(f.starts[0].prompt).toContain(item.text);
});

it('records use only after the actual native input.processing event and ignores replayed or unrelated input IDs', async () => {
  const f = await fixture(), item = f.accept(), prepared = (await f.prepare())!;
  expect(f.store.get('projectMemoryUsage', item.id)).toBeNull(); expect(f.store.all('projectMemoryRequestUsage')).toEqual([]);
  await f.send('SQLite project persistence', prepared); await f.service.deliverOutbox('thread');
  const input = f.starts[0];
  expect(f.store.get('projectMemoryUsage', item.id)).toBeNull(); expect(f.store.all('projectMemoryRequestUsage')).toEqual([]);
  f.callbacks().onEvent({ ...input, type: 'input.processing', inputIds: ['not-an-owned-input'] });
  expect(f.store.get('projectMemoryUsage', item.id)).toBeNull();
  f.callbacks().onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds });
  expect(f.store.get('projectMemoryUsage', item.id)).toMatchObject({ requestId: prepared.requestId, contextGeneration: prepared.contextGeneration, revision: item.revision });
  expect(f.store.get('projectMemoryRequestUsage', prepared.requestId)).toMatchObject({ requestId: prepared.requestId, contextGeneration: prepared.contextGeneration, injectedBytes: prepared.injectedBytes });
  f.callbacks().onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds });
  expect(f.store.all('projectMemoryRequestUsage')).toHaveLength(1);
  expect(f.service.projectMemory.usage(await f.currentAccess()).retrieval).toMatchObject({ requests: 1, injectedBytes: prepared.injectedBytes });
});

it.each(['edit', 'forget'] as const)('denies stale final memory bytes when an authenticated %s wins during awaited finalization', async action => {
  let entered = false, release!: () => void; const gate = new Promise<void>(done => { release = done; });
  const f = await fixture({ requestContextHooks: { async finalize() { entered = true; await gate; return { sources: [] }; } } }), item = f.accept();
  try {
    const prepared = (await f.prepare())!; await f.send('SQLite project persistence', prepared);
    await vi.waitFor(() => expect(entered).toBe(true));
    await f.review(action === 'edit' ? { action, itemId: item.id, baseRevision: item.revision, text: 'Use PostgreSQL after the correction.' } : { action, itemId: item.id, baseRevision: item.revision });
    release(); await f.service.deliverOutbox('thread');
    expect(f.starts).toEqual([]); expect(f.followUps).toEqual([]);
    expect(f.service.thread('thread').status).toBe('interrupted');
    expect(f.store.all('projectMemoryRequestUsage')).toEqual([]);
    expect(f.store.all('outbox', 'thread')).toEqual([expect.objectContaining({ content: 'SQLite project persistence' })]);
  } finally { release(); }
});

it('automatically recalls into the first send of a new unbound thread without borrowing an older request identity', async () => {
  const f = await fixture(), item = f.accept();
  const created = (await f.command('thread.create', { projectId: 'project', title: 'New owning conversation' })).result as Thread;
  expect(created.modelId).toBeNull(); expect(created.accountId).toBeUndefined();
  await f.send('SQLite project persistence', undefined, created.id); await f.service.deliverOutbox(created.id);
  const input = f.starts.find(input => input.threadId === created.id)!;
  expect(input).toBeDefined(); expect(input.accountId).toBeNull(); expect(input.modelId).toBe('test/model');
  expect(input.prompt).toContain(item.text);
  expect(input.requestContext).toMatchObject({ owner: { threadId: created.id }, modelBinding: { modelId: 'test/model', accountId: null }, contextGeneration: 1 });
  expect(await f.service.latestProjectMemory('project', created.id)).toBeNull();
  f.callbacks().onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds });
  expect(await f.service.latestProjectMemory('project', created.id)).toMatchObject({ requestId: input.requestContext!.requestId, contextGeneration: 1, phase: 'CAPTURED', scope: { threadId: created.id, accountId: null } });
});

function extractionAdapter(run: (input: StartRun, callbacks: RuntimeCallbacks) => void | Promise<void>, options: { cancel?: RuntimeAdapter['cancel']; dispose?: RuntimeAdapter['dispose'] } = {}) {
  let callbacks!: RuntimeCallbacks; const starts: StartRun[] = [];
  const runtime: RuntimeAdapter = {
    configure(value) { callbacks = value; }, models: async () => [],
    start: vi.fn(async input => { starts.push(input); await run(input, callbacks); }),
    followUp: vi.fn(async () => { throw Error('Extraction cannot continue a saved native conversation'); }),
    cancel: vi.fn(options.cancel ?? (async () => {})), compact: vi.fn(async () => { throw Error('Extraction cannot compact native history'); }),
    history: vi.fn(async () => { throw Error('Extraction cannot read native history'); }), dispose: vi.fn(options.dispose ?? (async () => {})),
  };
  return { runtime, starts, callbacks: () => callbacks };
}
const extractionCut = (input: StartRun) => JSON.parse(input.prompt.slice(input.prompt.indexOf('\n{') + 1)) as { sourceRunId: string; access: { threadId: string; accountId: string | null }; sources: { ref: import('../packages/contracts/project-memory.ts').MemorySourceRefV1; content: string }[] };

it('extracts only the actual settled run through a fresh pinned tool-free auxiliary factory and publishes proposals', async () => {
  const auxiliary = extractionAdapter((input, callbacks) => {
    const cut = extractionCut(input), source = cut.sources.find(source => source.content.includes('SQLite'))!;
    callbacks.onEvent({ ...input, type: 'assistant.message', messageId: 'proposal', content: JSON.stringify([{ kind: 'DECISION', text: 'SQLite is the selected project persistence mechanism.', sourceRefs: [source.ref] }]) });
    callbacks.onEvent({ ...input, type: 'usage', usage: { inputTokens: 40, outputTokens: 12, cost: 0.002 } });
    callbacks.onEvent({ ...input, type: 'settled' });
  });
  const factory = vi.fn((_job: MemoryExtractionJob) => auxiliary.runtime), f = await fixture({ memoryExtractionRuntimeFactory: factory });
  f.store.internal('fixture-unrelated-history', 'thread', () => f.store.put('message', 'unrelated-retained', 'thread', { id: 'unrelated-retained', threadId: 'thread', role: 'assistant', content: 'Unrelated previous task must not enter this extraction.', runId: 'older-run', createdAt: new Date().toISOString() }));
  await f.send('Use SQLite for project persistence.'); await f.service.deliverOutbox('thread');
  const foreground = f.starts[0];
  expect(factory).not.toHaveBeenCalled();
  f.callbacks().onEvent({ ...foreground, type: 'assistant.message', content: 'SQLite remains selected.', inputIds: foreground.inputIds });
  expect(factory).not.toHaveBeenCalled();
  f.settle(foreground);
  await vi.waitFor(() => expect(auxiliary.runtime.dispose).toHaveBeenCalledOnce());
  expect(factory).toHaveBeenCalledOnce();
  expect(factory.mock.calls[0][0]).toMatchObject({ modelId: foreground.modelId, access: { projectId: 'project', threadId: 'thread', accountId: null }, source: { threadId: 'thread', runId: foreground.runId, epoch: foreground.epoch } });
  const input = auxiliary.starts[0], cut = extractionCut(input);
  expect(input).toMatchObject({ modelId: foreground.modelId, accountId: null, sessionPath: null, resources: [] });
  expect(input.threadId).not.toBe('thread'); expect(input.runId).not.toBe(foreground.runId); expect(input.memory).toBeUndefined(); expect(input.memoryCheckpoint).toBeUndefined();
  expect(cut.sourceRunId).toBe(foreground.runId); expect(cut.sources.length).toBeGreaterThan(0);
  expect(input.prompt).not.toContain('Unrelated previous task');
  const current = await f.currentAccess(), view = f.service.projectMemory.read(current);
  expect(view.items).toHaveLength(1); expect(view.items[0].item).toMatchObject({ state: 'PROPOSED', assertedBy: { kind: 'AGENT' }, text: 'SQLite is the selected project persistence mechanism.' });
  expect(f.service.projectMemory.accepted(current)).toEqual([]);
  expect(f.service.projectMemory.usage(current).extraction).toMatchObject({ modelCalls: 1, inputTokens: 40, outputTokens: 12, cost: 0.002, pending: 0 });
  f.callbacks().onEvent({ ...foreground, type: 'settled' });
  await f.service.deliverOutbox('thread'); expect(factory).toHaveBeenCalledOnce();
});

it('defers optional extraction while an admitted M09 child is awaiting its runtime factory', async () => {
  __setCapabilityFlagForTests('agents.workV1', true);
  let release!: (child: AgentWorkChild) => void; const gate = new Promise<AgentWorkChild>(done => { release = done; });
  const child: AgentWorkChild = { supportsLiveSteer: false, send: vi.fn(async () => {}), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
  const childFactory = vi.fn(() => gate), auxiliary = extractionAdapter((input, callbacks) => { callbacks.onEvent({ ...input, type: 'assistant.message', content: '[]' }); callbacks.onEvent({ ...input, type: 'settled' }); });
  const factory = vi.fn((_job: MemoryExtractionJob) => auxiliary.runtime), f = await fixture({ agentWorkRuntimeFactory: childFactory, memoryExtractionRuntimeFactory: factory });
  let admission: ReturnType<typeof f.service.agentWork.admit> | undefined;
  try {
    await f.send('SQLite source with admitted child work.'); await f.service.deliverOutbox('thread');
    const foreground = f.starts[0];
    admission = f.service.agentWork.admit(foreground, { commandId: randomUUID(), workId: 'queued-memory-child', role: 'PLAN_READ', childThreadId: 'queued-memory-child-thread', prompt: 'Read and report.', expectedOutputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }, grantSubset: [], budget: { tokens: 100, ms: 5000 } }, new AbortController().signal);
    await vi.waitFor(() => expect(childFactory).toHaveBeenCalledOnce());
    expect(f.store.get('thread', 'queued-memory-child-thread')).toMatchObject({ kind: 'delegate', status: 'working', runId: null });
    f.settle(foreground);
    await vi.waitFor(async () => expect(f.service.projectMemory.usage(await f.currentAccess()).extraction.pending).toBe(0));
    expect(factory).not.toHaveBeenCalled();
    expect(f.service.projectMemory.usage(await f.currentAccess()).extraction.modelCalls).toBe(0);
  } finally { release(child); if (admission) await admission.catch(() => {}); }
});

it('makes pending extraction spend visible synchronously at settled while its factory is unresolved', async () => {
  let release!: (runtime: RuntimeAdapter) => void;
  const gate = new Promise<RuntimeAdapter>(done => { release = done; });
  const auxiliary = extractionAdapter((input, callbacks) => { callbacks.onEvent({ ...input, type: 'assistant.message', content: '[]' }); callbacks.onEvent({ ...input, type: 'settled' }); });
  const factory = vi.fn((_job: MemoryExtractionJob) => gate), f = await fixture({ memoryExtractionRuntimeFactory: factory });
  try {
    await f.send('SQLite settled source with a pending auxiliary job.'); await f.service.deliverOutbox('thread');
    const foreground = f.starts[0]; f.settle(foreground);
    const pending = f.store.all<{ phase: string; settled: boolean; sourceRunId: string; usage: { modelCalls: number } }>('projectMemoryAuxiliaryUsage');
    expect(pending).toEqual([expect.objectContaining({ phase: 'EXTRACTION', settled: false, sourceRunId: foreground.runId, usage: expect.objectContaining({ modelCalls: 0 }) })]);
    expect(f.service.isUpdateIdle()).toBe(false);
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    expect(f.service.projectMemory.usage(await f.currentAccess()).extraction).toMatchObject({ modelCalls: 0, pending: 1 });
    release(auxiliary.runtime); await vi.waitFor(() => expect(auxiliary.runtime.dispose).toHaveBeenCalledOnce());
    expect(f.service.projectMemory.usage(await f.currentAccess()).extraction).toMatchObject({ modelCalls: 1, pending: 0 });
  } finally { release(auxiliary.runtime); }
});

it('counts a scheduled and dispatched extraction as one pending auxiliary owner', async () => {
  const auxiliary = extractionAdapter(() => {}), factory = vi.fn((_job: MemoryExtractionJob) => auxiliary.runtime);
  const f = await fixture({ memoryExtractionRuntimeFactory: factory });
  await f.send('SQLite extraction with an active provider call.'); await f.service.deliverOutbox('thread'); f.settle(f.starts[0]);
  await vi.waitFor(() => expect(auxiliary.starts).toHaveLength(1));
  expect(f.service.projectMemory.usage(await f.currentAccess()).extraction).toMatchObject({ modelCalls: 1, inputTokens: null, outputTokens: null, cost: null, pending: 1 });
});

it('recovers orphaned auxiliary reservations without replaying inference or erasing unknown attempted spend', async () => {
  const factory = vi.fn((_job: MemoryExtractionJob) => extractionAdapter(() => {}).runtime), f = await fixture({ memoryExtractionRuntimeFactory: factory });
  const access = await f.currentAccess();
  f.store.internal('fixture-interrupted-memory-owner', 'thread', () => {
    const base = { profileId: access.profileId, projectIdentity: access.projectIdentity, projectId: access.projectId, accountId: access.accountId, phase: 'EXTRACTION', sourceRunId: 'interrupted-source-run', settled: false, startedAt: new Date().toISOString(), finishedAt: null };
    f.store.put('projectMemoryAuxiliaryUsage', 'memory-schedule:interrupted', 'thread', { ...base, id: 'memory-schedule:interrupted', status: 'SCHEDULED', usage: { modelCalls: 0, inputBytes: 0, outputBytes: 0, inputTokens: 0, outputTokens: 0, cost: 0 } });
    f.store.put('projectMemoryAuxiliaryUsage', 'interrupted-model-call', null, { ...base, id: 'interrupted-model-call', modelId: 'test/model', status: 'PENDING', usage: { modelCalls: 1, inputBytes: 1024, outputBytes: 0, inputTokens: null, outputTokens: null, cost: null } });
  });
  await f.service.recover();
  expect(factory).not.toHaveBeenCalled();
  expect(f.service.projectMemory.usage(await f.currentAccess()).extraction).toMatchObject({ modelCalls: 1, inputTokens: null, outputTokens: null, cost: null, pending: 0 });
  expect(f.store.get('projectMemoryAuxiliaryUsage', 'memory-schedule:interrupted')).toMatchObject({ settled: true, interrupted: true, usage: { modelCalls: 0 } });
  expect(f.store.get('projectMemoryAuxiliaryUsage', 'interrupted-model-call')).toMatchObject({ settled: false, interrupted: true, usage: { modelCalls: 1, inputTokens: null, outputTokens: null, cost: null } });
});

it('refuses host recovery while a current auxiliary owner remains active', async () => {
  const auxiliary = extractionAdapter(() => {}), f = await fixture({ memoryExtractionRuntimeFactory: () => auxiliary.runtime });
  await f.send('SQLite extraction with a live recovery owner.'); await f.service.deliverOutbox('thread'); f.settle(f.starts[0]);
  await vi.waitFor(() => expect(auxiliary.starts).toHaveLength(1));
  await expect(f.service.recover()).rejects.toThrow();
  expect(f.service.projectMemory.usage(await f.currentAccess()).extraction).toMatchObject({ modelCalls: 1, pending: 1 });
  const attempted = f.store.all<{ settled: boolean; interrupted?: boolean; usage: { modelCalls: number } }>('projectMemoryAuxiliaryUsage').find(row => row.usage.modelCalls === 1)!;
  expect(attempted.settled).toBe(false); expect(attempted.interrupted).not.toBe(true);
});

it('rechecks auxiliary ownership after awaited library initialization during recovery', async () => {
  let release!: () => void, entered = false; const gate = new Promise<void>(done => { release = done; });
  const auxiliary = extractionAdapter(() => {}), f = await fixture({ memoryExtractionRuntimeFactory: () => auxiliary.runtime, source: {
    runtime: { sourceBusy: false, reviewBusy: false, async cancelBackground() {}, async sourceRequest<T>(): Promise<T> { throw Error('Unused source request'); } },
    library: { async initialize() { entered = true; await gate; return { migrated: 0 }; }, async refresh() {}, async command() { throw Error('Unused library command'); }, async view() { throw Error('Unused library view'); }, async proposal() { throw Error('Unused library proposal'); } },
  } });
  const recovery = f.service.recover();
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    await f.send('SQLite extraction admitted during initialization.'); await f.service.deliverOutbox('thread'); f.settle(f.starts[0]);
    await vi.waitFor(() => expect(auxiliary.starts).toHaveLength(1));
    release(); await expect(recovery).rejects.toThrow();
    expect(f.service.projectMemory.usage(await f.currentAccess()).extraction).toMatchObject({ modelCalls: 1, pending: 1 });
    const attempted = f.store.all<{ interrupted?: boolean; usage: { modelCalls: number } }>('projectMemoryAuxiliaryUsage').find(row => row.usage.modelCalls === 1)!;
    expect(attempted.interrupted).not.toBe(true);
  } finally { release(); await recovery.catch(() => {}); }
});

it('cancels and drains auxiliary extraction before admitting new foreground work and refuses late proposals', async () => {
  let release!: () => void; const gate = new Promise<void>(done => { release = done; });
  const auxiliary = extractionAdapter(() => {}, { cancel: async () => { await gate; } });
  const factory = vi.fn((_job: MemoryExtractionJob) => auxiliary.runtime), f = await fixture({ memoryExtractionRuntimeFactory: factory });
  let next: Promise<unknown> | undefined;
  try {
    await f.send('SQLite persistence source for an auxiliary task.'); await f.service.deliverOutbox('thread'); f.settle(f.starts[0]);
    await vi.waitFor(() => expect(auxiliary.starts).toHaveLength(1));
    let accepted = false; next = f.send('Foreground work takes precedence.').then(value => { accepted = true; return value; });
    await vi.waitFor(() => expect(auxiliary.runtime.cancel).toHaveBeenCalled());
    expect(accepted).toBe(false); expect(f.starts).toHaveLength(1);
    const input = auxiliary.starts[0], cut = extractionCut(input);
    auxiliary.callbacks().onEvent({ ...input, type: 'assistant.message', content: JSON.stringify([{ kind: 'FACT', text: 'Late cancelled claim must not publish.', sourceRefs: [cut.sources[0].ref] }]) });
    auxiliary.callbacks().onEvent({ ...input, type: 'usage', usage: { inputTokens: 5, outputTokens: 3, cost: 0.001 } });
    auxiliary.callbacks().onEvent({ ...input, type: 'settled' });
    release(); await next; await f.service.deliverOutbox('thread');
    expect(f.starts).toHaveLength(2); expect(f.starts[1].prompt).toContain('Foreground work takes precedence.');
    expect(f.store.all('projectMemoryItem')).toEqual([]);
    expect(f.store.all('projectMemoryAuxiliaryUsage')).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'EXTRACTION', status: 'CANCELLED', settled: true, usage: expect.objectContaining({ inputTokens: 5, outputTokens: 3, cost: 0.001 }) })]));
    expect(f.service.projectMemory.usage(await f.currentAccess()).extraction).toMatchObject({ modelCalls: 1, inputTokens: 5, outputTokens: 3, cost: 0.001, pending: 0 });
  } finally { release(); if (next) await next.catch(() => {}); }
});

it('drains auxiliary extraction before dispatching an executor-generated outbox input', async () => {
  let release!: () => void; const gate = new Promise<void>(done => { release = done; });
  const auxiliary = extractionAdapter(() => {}, { cancel: async () => { await gate; } });
  const f = await fixture({ memoryExtractionRuntimeFactory: () => auxiliary.runtime });
  let delivery: Promise<void> | undefined;
  try {
    await f.send('SQLite extraction before the executor completes.'); await f.service.deliverOutbox('thread'); f.settle(f.starts[0]);
    await vi.waitFor(() => expect(auxiliary.starts).toHaveLength(1));
    f.store.internal('fixture-executor-result', 'thread', () => f.store.put('outbox', 'operation-result:fixture', 'thread', { id: 'operation-result:fixture', threadId: 'thread', content: 'Executor receipt: the approved operation succeeded.', status: 'persisted', runId: null }));
    let delivered = false; delivery = f.service.deliverOutbox('thread').then(() => { delivered = true; });
    await vi.waitFor(() => expect(auxiliary.runtime.cancel).toHaveBeenCalled());
    expect(delivered).toBe(false); expect(f.starts).toHaveLength(1);
    release(); await delivery;
    expect(f.starts).toHaveLength(2); expect(f.starts[1].prompt).toContain('Executor receipt: the approved operation succeeded.');
    expect(f.service.projectMemory.usage(await f.currentAccess()).extraction.pending).toBe(0);
  } finally { release(); if (delivery) await delivery.catch(() => {}); }
});

it('drains scheduled source cleanup before cancellation completes even before an extraction runtime exists', async () => {
  let release!: () => void, reviewing = false; const gate = new Promise<void>(done => { release = done; });
  const cleanup = vi.fn(async () => { await gate; reviewing = false; });
  const factory = vi.fn((_job: MemoryExtractionJob) => extractionAdapter(() => {}).runtime);
  const f = await fixture({ memoryExtractionRuntimeFactory: factory, source: {
    runtime: { sourceBusy: false, get reviewBusy() { return reviewing; }, cancelBackground: cleanup, async sourceRequest<T>(): Promise<T> { throw Error('Unused source request'); } },
    library: { async initialize() { return { migrated: 0 }; }, async refresh() {}, async command() { throw Error('Unused library command'); }, async view() { throw Error('Unused library view'); }, async proposal() { throw Error('Unused library proposal'); } },
  } });
  let cancellation: Promise<void> | undefined;
  try {
    await f.send('SQLite extraction waits for original source cleanup.'); await f.service.deliverOutbox('thread'); reviewing = true; f.settle(f.starts[0]);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalled());
    let cancelled = false; cancellation = f.service.cancelComposerPredictions().then(() => { cancelled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(cancelled).toBe(false); expect(factory).not.toHaveBeenCalled();
    release(); await cancellation;
    expect(factory).not.toHaveBeenCalled(); expect(f.service.projectMemory.usage(await f.currentAccess()).extraction.pending).toBe(0);
  } finally { release(); if (cancellation) await cancellation.catch(() => {}); }
});

function checkpointRequest(input: StartRun, sessionPath: string) {
  return { apiVersion: 2 as const, requestId: 'checkpoint:' + randomUUID(), adapterId: 'pi' as const, ctx: { threadId: input.threadId, runId: input.runId, epoch: input.epoch }, sessionPath, modelId: input.modelId, accountId: input.accountId ?? null, reason: 'threshold' as const };
}

it('rejects a native checkpoint when its session changes while host access is awaited', async () => {
  const f = await fixture(); f.accept(); await f.send(); await f.service.deliverOutbox('thread');
  const input = f.starts[0], path = join(f.store.dataDir, 'before-session.json');
  f.callbacks().onEvent({ ...input, type: 'session', sessionPath: path });
  const memory = f.service.projectMemory, originalAccess = memory.access.bind(memory);
  let release!: () => void, entered = false; const gate = new Promise<void>(done => { release = done; });
  vi.spyOn(memory, 'access').mockImplementationOnce(async (...args) => { entered = true; await gate; return originalAccess(...args); });
  const acknowledgement = f.callbacks().onMemoryCheckpoint!(checkpointRequest(input, path));
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    f.callbacks().onEvent({ ...input, type: 'session', sessionPath: join(f.store.dataDir, 'after-session.json') });
    release(); await expect(acknowledgement).rejects.toThrow();
    expect(f.store.all('projectMemoryDerived')).toEqual([]);
  } finally { release(); await acknowledgement.catch(() => {}); }
});

it('acknowledges a host checkpoint only after durable accepted-revision persistence and registers it for Forget', async () => {
  const f = await fixture(), item = f.accept(); await f.send(); await f.service.deliverOutbox('thread');
  const input = f.starts[0], path = join(f.store.dataDir, 'owned-session.json');
  f.callbacks().onEvent({ ...input, type: 'session', sessionPath: path });
  expect(f.callbacks().onMemoryCheckpoint).toBeTypeOf('function');
  const request = checkpointRequest(input, path), acknowledgement = await f.callbacks().onMemoryCheckpoint!(request);
  expect(acknowledgement).toMatchObject({ apiVersion: 2, requestId: request.requestId, persisted: true, checkpointId: expect.stringMatching(/^memory-checkpoint:/), digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(f.store.get('projectMemoryDerived', acknowledgement.checkpointId)).toMatchObject({ valid: true, refs: [{ itemId: item.id, revision: item.revision }], checkpoint: { digest: acknowledgement.digest, accountId: null, threadId: 'thread', constraints: [{ itemId: item.id, revision: item.revision, text: item.text }] } });
  const access = await f.currentAccess(); expect(f.service.projectMemory.forgetPreview(access, item.id, item.revision).affectedDerivedArtifacts).toContain(acknowledgement.checkpointId);
  await f.review({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  expect(f.store.get('projectMemoryDerived', acknowledgement.checkpointId)).toMatchObject({ valid: false });
});

it.each(['epoch', 'model', 'account', 'session'] as const)('refuses a native checkpoint request with a stale %s binding', async kind => {
  const f = await fixture(); f.accept(); await f.send(); await f.service.deliverOutbox('thread');
  const input = f.starts[0], path = join(f.store.dataDir, 'owned-session.json'); f.callbacks().onEvent({ ...input, type: 'session', sessionPath: path });
  const request = checkpointRequest(input, path);
  if (kind === 'epoch') request.ctx.epoch++;
  if (kind === 'model') request.modelId = 'test/changed';
  if (kind === 'account') request.accountId = 'changed-account';
  if (kind === 'session') request.sessionPath = join(f.store.dataDir, 'other-session.json');
  expect(f.callbacks().onMemoryCheckpoint).toBeTypeOf('function');
  await expect(f.callbacks().onMemoryCheckpoint!(request)).rejects.toThrow();
  expect(f.store.all('projectMemoryDerived')).toEqual([]);
});

it('blocks native manual compaction on a required host checkpoint failure and retains the original session path', async () => {
  const f = await fixture(); f.accept(); await f.send(); await f.service.deliverOutbox('thread');
  const foreground = f.starts[0], path = join(f.store.dataDir, 'owned-session.json');
  f.callbacks().onEvent({ ...foreground, type: 'session', sessionPath: path }); f.settle(foreground);
  await vi.waitFor(() => expect(f.service.thread('thread').runId).toBeNull());
  let compacted = false;
  vi.spyOn(f.service.projectMemory, 'persistCheckpoint').mockImplementation(() => { throw Error('Durable checkpoint persistence refused'); });
  vi.mocked(f.runtime.compact).mockImplementation(async (ctx, sessionPath, modelId, accountId, requirement) => {
    expect(requirement).toEqual({ apiVersion: 2, required: true });
    await f.callbacks().onMemoryCheckpoint!({ apiVersion: 2, requestId: 'manual-checkpoint', adapterId: 'pi', ctx, sessionPath, modelId, accountId: accountId ?? null, reason: 'manual' });
    compacted = true;
  });
  await f.command('run.compact');
  await vi.waitFor(() => expect(f.service.thread('thread').error).toMatch(/checkpoint/i));
  expect(f.runtime.compact).toHaveBeenCalledOnce(); expect(compacted).toBe(false);
  expect(f.service.thread('thread').sessionPath).toBe(path); expect(f.store.all('projectMemoryDerived')).toEqual([]);
});

it('keeps the required memory checkpoint inside the admitted loss-aware compaction run', async () => {
  const f = await fixture(); f.accept(); await f.send(); await f.service.deliverOutbox('thread');
  const foreground = f.starts[0], path = join(f.store.dataDir, 'owned-session.json');
  f.callbacks().onEvent({ ...foreground, type: 'session', sessionPath: path }); f.settle(foreground);
  await vi.waitFor(() => expect(f.service.thread('thread').runId).toBeNull());
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
  f.runtime.nativeHistoryDigest = async () => ({ sha256: 'a'.repeat(64), messages: [
    { role: 'user', content: 'Original native instruction' },
    { role: 'assistant', content: 'Earlier settled response eligible for summarization' },
    { role: 'user', content: 'Current native instruction' },
  ] });
  let compacted = false;
  const persist = vi.spyOn(f.service.projectMemory, 'persistCheckpoint').mockImplementation(() => { throw Error('Durable checkpoint persistence refused'); });
  f.runtime.compactProtected = vi.fn(async (ctx, sessionPath, modelId, accountId, protection, requirement) => {
    expect(requirement).toEqual({ apiVersion: 2, required: true });
    expect(f.service.thread('thread')).toMatchObject({ runId: ctx.runId, epoch: ctx.epoch, status: 'working' });
    expect(ctx.runId).not.toBe(foreground.runId);
    expect(protection.plan.owner).toMatchObject({ threadId: ctx.threadId, runId: ctx.runId, epoch: ctx.epoch });
    await f.callbacks().onMemoryCheckpoint!({ apiVersion: 2, requestId: 'loss-aware-checkpoint', adapterId: 'hermes', ctx,
      sessionPath, modelId, accountId, reason: 'manual' });
    compacted = true;
    throw Error('Protected compaction must not apply after a refused checkpoint');
  });
  await expect(f.command('run.compact')).rejects.toMatchObject({ code: 'COMPACTION_FAILED' });
  expect(f.runtime.compactProtected).toHaveBeenCalledOnce();
  expect(f.runtime.compact).not.toHaveBeenCalled();
  expect(persist).toHaveBeenCalledOnce();
  expect(compacted).toBe(false);
  expect(f.store.all('compactionUsage')).toEqual([]);
  expect(f.service.thread('thread').sessionPath).toBe(path);
});
