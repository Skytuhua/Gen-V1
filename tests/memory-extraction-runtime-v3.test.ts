import { afterEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeAdapter, RuntimeCallbacks, StartRun } from '../packages/contracts/index.ts';
import { Store } from '../packages/storage/store.ts';
import { memoryFixture } from './project-memory-fixture.ts';
import { MemoryExtractionCoordinator } from '../packages/core/memory-extraction.ts';

const fixtures: Awaited<ReturnType<typeof memoryFixture>>[] = [];
async function fixture() {
  const f = await memoryFixture(store => store.internal('fixture-model', 'thread', () => store.put('thread', 'thread', 'thread', {...store.get<Record<string, unknown>>('thread', 'thread')!, modelId: 'provider/model'}))); fixtures.push(f);
  f.store.internal('fixture-settled', 'thread', () => f.store.put('outbox', 'input', 'thread', {id: 'input', threadId: 'thread', messageId: 'source', content: 'Use SQLite.', status: 'handled', runId: 'run'}));
  return f;
}
afterEach(() => {vi.useRealTimers(); for (const f of fixtures.splice(0)) {f.store.close(); rmSync(f.root, {recursive: true, force: true});}});
const source = {threadId: 'thread', runId: 'run', epoch: 1};
function adapter(run: (input: StartRun, callbacks: RuntimeCallbacks) => void | Promise<void>, dispose = async () => {}) {
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = {configure: value => {callbacks = value;}, models: async () => [], start: async input => run(input, callbacks), followUp: async () => {throw new Error('No continuation');}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose};
  return runtime;
}

it('commits metadata-only pending usage before native dispatch and retains unknown cost when teardown fails', async () => {
  const f = await fixture(); let observed: unknown;
  const runtime = adapter((input, callbacks) => {
    const reopened = new Store(join(f.root, 'profile'));
    try {observed = reopened.all('projectMemoryAuxiliaryUsage')[0];} finally {reopened.close();}
    callbacks.onEvent({...input, type: 'assistant.message', content: '[]'});
    callbacks.onEvent({...input, type: 'settled'});
  }, async () => {throw new Error('Synthetic native teardown failure');});
  const coordinator = new MemoryExtractionCoordinator(f.store, f.memory, {factory: () => runtime});
  try {
    const result = await coordinator.extract({access: f.access, source, modelId: 'provider/model'});
    expect(observed).toMatchObject({phase: 'EXTRACTION', status: 'PENDING', settled: false, finishedAt: null, usage: {modelCalls: 1, inputBytes: expect.any(Number), inputTokens: null, outputTokens: null, cost: null}});
    expect((observed as {usage:{inputBytes?:number}}).usage.inputBytes).toBeGreaterThan(0);
    expect(JSON.stringify(observed)).not.toContain('Use SQLite');
    expect(result.status).toBe('FAILED'); expect(coordinator.busy).toBe(true);
    expect(f.store.all<{settled?:boolean;status?:string;usage?:{modelCalls?:number;cost?:unknown;inputBytes?:number;inputTokens?:number;outputTokens?:number}}>('projectMemoryAuxiliaryUsage')[0]).toMatchObject({settled: false, usage: {modelCalls: 1, cost: null}});
  } finally {await expect(coordinator.dispose()).rejects.toMatchObject({code: 'MEMORY_EXTRACTION_CLEANUP_FAILED'});}
});

it('rechecks authority after pending usage observers opt out and records zero dispatches', async () => {
  const f = await fixture(); let revoked = false;
  const unsubscribe = f.store.subscribe(event => {
    if (revoked || event.type !== 'project.memory.extraction.usage' || f.store.all<{settled?:boolean;status?:string;usage?:{modelCalls?:number;cost?:unknown;inputBytes?:number;inputTokens?:number;outputTokens?:number}}>('projectMemoryAuxiliaryUsage')[0]?.status !== 'PENDING') return;
    revoked = true;
    f.act({action: 'configure', enabled: false, sourceThreadIds: ['thread'], baseRevision: 1});
  });
  const start = vi.fn((input: StartRun, callbacks: RuntimeCallbacks) => {
    callbacks.onEvent({...input, type: 'assistant.message', content: '[]'}); callbacks.onEvent({...input, type: 'settled'});
  });
  const coordinator = new MemoryExtractionCoordinator(f.store, f.memory, {factory: () => adapter(start)});
  try {
    const result = await coordinator.extract({access: f.access, source, modelId: 'provider/model'});
    expect(revoked).toBe(true); expect(start).not.toHaveBeenCalled(); expect(result.status).toBe('STALE');
    expect(result.usage).toMatchObject({modelCalls: 0, inputBytes: 0, cost: null});
    expect(f.store.all<{settled?:boolean;status?:string;usage?:{modelCalls?:number;cost?:unknown;inputBytes?:number;inputTokens?:number;outputTokens?:number}}>('projectMemoryAuxiliaryUsage')[0]).toMatchObject({status: 'STALE', settled: true, usage: {modelCalls: 0, inputBytes: 0, cost: null}});
  } finally {unsubscribe(); await coordinator.dispose();}
});

it('persists known zero dispatches after observer opt-out even while native teardown remains occupied', async () => {
  const f = await fixture(); let revoked = false, release!: () => void;
  const cleanup = new Promise<void>(done => {release = done;}), dispose = vi.fn(() => cleanup), start = vi.fn();
  const unsubscribe = f.store.subscribe(event => {
    if (revoked || event.type !== 'project.memory.extraction.usage' || f.store.all<{settled?:boolean;status?:string;usage?:{modelCalls?:number;cost?:unknown;inputBytes?:number;inputTokens?:number;outputTokens?:number}}>('projectMemoryAuxiliaryUsage')[0]?.status !== 'PENDING') return;
    revoked = true; f.act({action: 'configure', enabled: false, sourceThreadIds: ['thread'], baseRevision: 1});
  });
  const coordinator = new MemoryExtractionCoordinator(f.store, f.memory, {factory: () => adapter(start, dispose)});
  const pending = coordinator.extract({access: f.access, source, modelId: 'provider/model'});
  try {
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(start).not.toHaveBeenCalled(); expect(coordinator.busy).toBe(true);
    expect(f.store.all<{settled?:boolean;status?:string;usage?:{modelCalls?:number;cost?:unknown;inputBytes?:number;inputTokens?:number;outputTokens?:number}}>('projectMemoryAuxiliaryUsage')[0]).toMatchObject({status: 'STALE', settled: false, usage: {modelCalls: 0, inputBytes: 0, cost: null}});
  } finally {unsubscribe(); release(); await pending; await coordinator.dispose();}
});

it('revalidates opt-in at final native extraction dispatch after configure yields to queued host changes', async () => {
  const f = await fixture(), start = vi.fn((input: StartRun, callbacks: RuntimeCallbacks) => {
    callbacks.onEvent({...input, type: 'assistant.message', content: '[]'});
    callbacks.onEvent({...input, type: 'settled'});
  });
  const runtime = adapter(start), configure = runtime.configure.bind(runtime);
  runtime.configure = callbacks => {
    configure(callbacks);
    queueMicrotask(() => f.act({action: 'configure', enabled: false, sourceThreadIds: ['thread'], baseRevision: 1}));
  };
  const coordinator = new MemoryExtractionCoordinator(f.store, f.memory, {factory: () => runtime});
  try {
    const result = await coordinator.extract({access: f.access, source, modelId: 'provider/model'});
    expect(result.status).toBe('STALE');
    expect(start).not.toHaveBeenCalled();
    expect(result.usage).toMatchObject({modelCalls: 0, inputBytes: 0, cost: null});
  } finally {await coordinator.dispose();}
});

it.each(['bytes', 'messages'] as const)('stops retaining %s immediately on output refusal while keeping teardown ownership and late usage', async kind => {
  vi.useFakeTimers(); const f = await fixture();
  let captured!: StartRun, callbacks!: RuntimeCallbacks, release!: () => void;
  const cleanup = new Promise<void>(done => {release = done;});
  const runtime = adapter((input, value) => {captured = input; callbacks = value;}, () => cleanup);
  const factory = vi.fn(() => runtime), coordinator = new MemoryExtractionCoordinator(f.store, f.memory, {factory, timeoutMs: 100});
  let result: Awaited<ReturnType<typeof coordinator.extract>> | undefined;
  const pending = coordinator.extract({access: f.access, source, modelId: 'provider/model'}).then(value => {result = value; return value;});
  try {
    await vi.advanceTimersByTimeAsync(0);
    callbacks.onEvent({...captured, type: 'assistant.message', messageId: 'reply', content: '[]'});
    if (kind === 'bytes') callbacks.onEvent({...captured, type: 'assistant.delta', messageId: 'reply', delta: 'x'.repeat(65536)});
    else for (let n = 0; n < 16; n++) callbacks.onEvent({...captured, type: 'assistant.message', messageId: String(n), content: '[]'});
    for (let n = 0; n < 32; n++) callbacks.onEvent({...captured, type: 'assistant.delta', messageId: 'reply', delta: 'y'.repeat(8192)});
    callbacks.onEvent({...captured, type: 'usage', usage: {inputTokens: 11, outputTokens: 7, cost: 0.01}});
    await vi.advanceTimersByTimeAsync(0);
    expect(result?.status).toBe('FAILED');
    expect(result?.usage.outputBytes).toBeLessThanOrEqual(65536);
    expect(coordinator.busy).toBe(true);
    expect((await coordinator.extract({access: f.access, source, modelId: 'provider/model'})).status).toBe('BUSY');
    expect(factory).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.memory.read(f.access).items).toEqual([]);
  } finally {release(); await pending; await coordinator.dispose();}
  expect(coordinator.busy).toBe(false);
  expect(f.store.all<{settled?:boolean;status?:string;usage?:{modelCalls?:number;cost?:unknown;inputBytes?:number;inputTokens?:number;outputTokens?:number}}>('projectMemoryAuxiliaryUsage')[0]).toMatchObject({status: 'FAILED', settled: true, usage: {inputTokens: 11, outputTokens: 7, cost: 0.01}});
});
it('uses a fresh tool-free pinned account/model request, publishes proposals and records all measured auxiliary spend', async () => {
  const f = await fixture(); let received!: StartRun;
  const runtime = adapter((input, callbacks) => {
    received = input;
    const cut = JSON.parse(input.prompt.slice(input.prompt.indexOf('\n{') + 1));
    callbacks.onEvent({...input, type: 'assistant.message', messageId: 'reply', content: JSON.stringify([{kind: 'DECISION', text: 'Use SQLite.', sourceRefs: [cut.sources[0].ref]}])});
    callbacks.onEvent({...input, type: 'usage', usage: {inputTokens: 100, outputTokens: 30, cost: 0.004}});
    callbacks.onEvent({...input, type: 'settled'});
  });
  const factory = vi.fn(async () => runtime);
  const coordinator = new MemoryExtractionCoordinator(f.store, f.memory, {factory});
  const result = await coordinator.extract({access: f.access, source, modelId: 'provider/model'});
  expect(result.status).toBe('PUBLISHED');
  expect(received).toMatchObject({accountId: 'account', modelId: 'provider/model', resources: [], sessionPath: null});
  expect(received.memory).toBeUndefined(); expect(received.threadId).not.toBe('thread');
  expect(f.memory.read(f.access).items[0].item.state).toBe('PROPOSED');
  expect(f.memory.accepted(f.access)).toEqual([]);
  expect(f.store.all<{settled?:boolean;status?:string;usage?:{modelCalls?:number;cost?:unknown;inputBytes?:number;inputTokens?:number;outputTokens?:number}}>('projectMemoryAuxiliaryUsage')[0]).toMatchObject({phase: 'EXTRACTION', settled: true, status: 'PUBLISHED', usage: {modelCalls: 1, inputTokens: 100, outputTokens: 30, cost: 0.004}});
  expect((await coordinator.extract({access: f.access, source, modelId: 'provider/model'})).status).toBe('UNCHANGED');
  expect(factory).toHaveBeenCalledTimes(1);
});

it('denies every extraction tool and never publishes executable or fabricated output', async () => {
  const f = await fixture();
  const runtime = adapter(async (input, callbacks) => {
    await expect(callbacks.onTool({name: 'file_write', args: {path: 'unsafe'}}, input)).rejects.toThrow();
    callbacks.onEvent({...input, type: 'assistant.message', messageId: 'reply', content: '[{"kind":"FACT","text":"fabricated","sourceRefs":[],"action":"approve"}]'});
    callbacks.onEvent({...input, type: 'settled'});
  });
  const coordinator = new MemoryExtractionCoordinator(f.store, f.memory, {factory: async () => runtime});
  expect((await coordinator.extract({access: f.access, source, modelId: 'provider/model'})).status).toBe('FAILED');
  expect(f.memory.read(f.access).items).toEqual([]);
});

it('retains occupied capacity after timeout until native cleanup actually completes and ignores late proposals', async () => {
  vi.useFakeTimers(); const f = await fixture();
  let settle!: () => void, release!: () => void;
  const cleanup = new Promise<void>(resolve => {release = resolve;});
  const runtime = adapter((input, callbacks) => new Promise<void>(resolve => {settle = () => {callbacks.onEvent({...input, type: 'assistant.message', messageId: 'reply', content: '[]'}); callbacks.onEvent({...input, type: 'settled'}); resolve();};}), () => cleanup);
  const first = new MemoryExtractionCoordinator(f.store, f.memory, {factory: async () => runtime, timeoutMs: 100});
  const secondFactory = vi.fn(async () => runtime), second = new MemoryExtractionCoordinator(f.store, f.memory, {factory: secondFactory});
  const pending = first.extract({access: f.access, source, modelId: 'provider/model'});
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).status).toBe('TIMEOUT');
  expect((await second.extract({access: f.access, source, modelId: 'provider/model'})).status).toBe('BUSY');
  expect(secondFactory).not.toHaveBeenCalled();
  expect(f.store.all<{settled?:boolean;status?:string;usage?:{modelCalls?:number;cost?:unknown;inputBytes?:number;inputTokens?:number;outputTokens?:number}}>('projectMemoryAuxiliaryUsage')[0].settled).toBe(false);
  settle(); await vi.advanceTimersByTimeAsync(0);
  expect(first.busy).toBe(true);
  release(); await vi.advanceTimersByTimeAsync(0);
  expect(first.busy).toBe(false);
  expect(f.memory.read(f.access).items).toEqual([]);
  expect(f.store.all<{settled?:boolean;status?:string;usage?:{modelCalls?:number;cost?:unknown;inputBytes?:number;inputTokens?:number;outputTokens?:number}}>('projectMemoryAuxiliaryUsage')[0]).toMatchObject({status: 'TIMEOUT', settled: true});
});

it('rejects stale source ownership before publication and cancels without calling a provider when already aborted', async () => {
  const f = await fixture();
  const runtime = adapter((input, callbacks) => {
    f.store.internal('new-run', 'thread', () => f.store.put('thread', 'thread', 'thread', {...f.store.get<Record<string, unknown>>('thread', 'thread')!, runId: 'new', epoch: 2, status: 'working'}));
    callbacks.onEvent({...input, type: 'assistant.message', messageId: 'reply', content: '[]'});
    callbacks.onEvent({...input, type: 'settled'});
  });
  const factory = vi.fn(async () => runtime), coordinator = new MemoryExtractionCoordinator(f.store, f.memory, {factory});
  expect((await coordinator.extract({access: f.access, source, modelId: 'provider/model'})).status).toBe('STALE');
  const control = new AbortController(); control.abort();
  expect((await coordinator.extract({access: f.access, source, modelId: 'provider/model', signal: control.signal})).status).toBe('CANCELLED');
  expect(factory).toHaveBeenCalledTimes(1);
});

it('refuses a provider/model replacement before creating the extraction transport', async () => {
  const f = await fixture(), factory = vi.fn(async () => adapter((input, callbacks) => {callbacks.onEvent({...input, type: 'assistant.message', content: '[]'}); callbacks.onEvent({...input, type: 'settled'});}));
  const coordinator = new MemoryExtractionCoordinator(f.store, f.memory, {factory});
  await expect(coordinator.extract({access: f.access, source, modelId: 'other/provider'})).rejects.toThrow(/model|owner/i);
  expect(factory).not.toHaveBeenCalled();
});
