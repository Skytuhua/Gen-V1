import {afterEach, expect, it, vi} from 'vitest';
import {rmSync} from 'node:fs';
import type {RuntimeAdapter, RuntimeCallbacks, StartRun, Thread} from '../packages/contracts/index.ts';
import {MemoryExtractionCoordinator, type MemoryExtractionHooks, type MemoryExtractionJob} from '../packages/core/memory-extraction.ts';
import type {ProjectMemoryHost} from '../packages/core/project-memory-host.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import type {ServiceOptions} from '../packages/core/service.ts';
import {hermesRequestScheduler, RequestScheduler} from '../packages/runtime/request-scheduler.ts';
import {createHermesService} from '../apps/server/hermes-service.ts';
import {memoryFixture} from './project-memory-fixture.ts';

// This fixture never opens a terminal; keep the unrelated native PTY dependency
// outside the production composition assertion on non-Windows test hosts.
vi.mock('../packages/workspace/terminal.ts', () => ({TerminalHost: class {async dispose() {}}}));

type Admission = (job: Readonly<MemoryExtractionJob>, signal: AbortSignal) => Promise<() => void>;
const source = {threadId: 'thread', runId: 'run', epoch: 1};
const fixtures: Awaited<ReturnType<typeof memoryFixture>>[] = [];
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((done, fail) => {resolve = done; reject = fail;}); return {promise, resolve, reject};}
async function fixture(modelId = 'provider/model') {
  const f = await memoryFixture(store => store.internal('fixture-model', 'thread', () => store.put('thread', 'thread', 'thread', {...store.get<Thread>('thread', 'thread')!, modelId})));
  fixtures.push(f);
  f.store.internal('fixture-settled', 'thread', () => f.store.put('outbox', 'input', 'thread', {id: 'input', threadId: 'thread', messageId: 'source', content: 'Use SQLite.', status: 'handled', runId: 'run'}));
  return {...f, modelId};
}
afterEach(() => {
  vi.restoreAllMocks();
  __setCapabilityFlagForTests('memory.projectV1', undefined);
  for (const f of fixtures.splice(0)) {f.store.close(); rmSync(f.root, {recursive: true, force: true});}
});
function runtime(run: (input: StartRun, callbacks: RuntimeCallbacks) => void | Promise<void> = (input, callbacks) => {
  callbacks.onEvent({...input, type: 'assistant.message', content: '[]'}); callbacks.onEvent({...input, type: 'settled'});
}) {
  let callbacks!: RuntimeCallbacks;
  return {configure: (value: RuntimeCallbacks) => {callbacks = value;}, models: async () => [], start: vi.fn(async (input: StartRun) => run(input, callbacks)), followUp: async () => {}, cancel: vi.fn(async () => {}), compact: async () => {}, history: async () => [], dispose: vi.fn(async () => {})} satisfies RuntimeAdapter;
}
function admission(scheduler: RequestScheduler) {
  return vi.fn(async (job: Readonly<MemoryExtractionJob>, signal: AbortSignal) => {
    const permit = await scheduler.acquire(job.modelId.split('/')[0], job.access.accountId, signal, {requestClass: 'background'});
    return permit.release;
  });
}
function coordinator(f: Awaited<ReturnType<typeof fixture>>, hooks: MemoryExtractionHooks & {admit: Admission}) {return new MemoryExtractionCoordinator(f.store, f.memory, hooks);}
function job(f: Awaited<ReturnType<typeof fixture>>, signal?: AbortSignal): MemoryExtractionJob {return {access: f.access, source, modelId: f.modelId, signal};}

it('queues behind the same account limit as background work without source bytes or provider calls', async () => {
  const f = await fixture(), scheduler = new RequestScheduler(2), first = await scheduler.acquire('provider', 'account'), second = await scheduler.acquire('provider', 'account');
  const admit = admission(scheduler), factory = vi.fn(() => runtime()), owner = coordinator(f, {factory, admit});
  const pending = owner.extract(job(f)); let urgent: Awaited<ReturnType<typeof scheduler.acquire>> | undefined;
  try {
    await turn(); expect(admit).toHaveBeenCalledOnce(); expect(factory).not.toHaveBeenCalled(); expect(owner.busy).toBe(true);
    expect(f.memory.usage(f.access).extraction).toMatchObject({modelCalls: 0, inputTokens: 0, cost: 0});
    expect(f.store.all<{usage: {inputBytes: number}}>('projectMemoryAuxiliaryUsage').reduce((sum, value) => sum + value.usage.inputBytes, 0)).toBe(0);
    const foreground = scheduler.acquire('provider', 'account', undefined, {requestClass: 'foreground'});
    first.release(); urgent = await foreground; await turn(); expect(factory).not.toHaveBeenCalled();
    urgent.release();
    await expect(pending).resolves.toMatchObject({status: 'EMPTY', usage: {modelCalls: 1}});
    expect(factory).toHaveBeenCalledOnce(); expect(owner.busy).toBe(false);
  } finally {first.release(); second.release(); urgent?.release(); await pending; await owner.dispose();}
});

it.each(['cancel', 'timeout'] as const)('aborts queued acquisition on %s with no factory, calls or source bytes', async reason => {
  const f = await fixture(), scheduler = new RequestScheduler(1), held = await scheduler.acquire('provider', 'account'), control = new AbortController();
  const admit = admission(scheduler), factory = vi.fn(() => runtime()), owner = coordinator(f, {factory, admit, timeoutMs: 100});
  const pending = owner.extract(job(f, control.signal));
  try {
    await turn(); expect(admit).toHaveBeenCalledOnce(); expect(factory).not.toHaveBeenCalled();
    const queueSignal = admit.mock.calls[0][1]; expect(queueSignal).not.toBe(control.signal);
    if (reason === 'cancel') control.abort();
    await expect(pending).resolves.toMatchObject({status: reason === 'cancel' ? 'CANCELLED' : 'TIMEOUT', usage: {modelCalls: 0, inputBytes: 0, cost: null}});
    await owner.cancel(); expect(queueSignal.aborted).toBe(true); expect(control.signal.aborted).toBe(reason === 'cancel');
    expect(factory).not.toHaveBeenCalled(); expect(owner.busy).toBe(false);
    expect(f.store.all('projectMemoryAuxiliaryUsage')).toMatchObject([{settled: true, usage: {modelCalls: 0, inputBytes: 0, cost: null}}]);
    held.release(); const next = await scheduler.acquire('provider', 'account'); next.release();
  } finally {control.abort(); held.release(); await pending; await owner.dispose();}
});

it.each(['forget', 'consent', 'source', 'model', 'account'] as const)('revalidates %s after queued admission and before creating a runtime', async change => {
  const f = await fixture(), accepted = f.accept(), scheduler = new RequestScheduler(1), held = await scheduler.acquire('provider', 'account');
  const admit = admission(scheduler), factory = vi.fn(() => runtime()), owner = coordinator(f, {factory, admit});
  const pending = owner.extract(job(f));
  try {
    await turn(); expect(admit).toHaveBeenCalledOnce(); expect(factory).not.toHaveBeenCalled();
    if (change === 'forget') f.act({action: 'forget', itemId: accepted.id, baseRevision: accepted.revision});
    if (change === 'consent') f.act({action: 'configure', enabled: false, sourceThreadIds: ['thread'], baseRevision: 1});
    if (change === 'source') f.store.internal('fixture-source-changed', 'thread', () => f.store.put('message', 'source', 'thread', {...f.store.get<Record<string, unknown>>('message', 'source'), content: 'Changed source after queue admission.'}));
    if (change === 'model' || change === 'account') f.store.internal('fixture-binding-changed', 'thread', () => f.store.put('thread', 'thread', 'thread', {...f.store.get<Thread>('thread', 'thread')!, ...(change === 'model' ? {modelId: 'other/model'} : {accountId: 'other-account'})}));
    held.release();
    await expect(pending).resolves.toMatchObject({status: 'STALE', usage: {modelCalls: 0, inputBytes: 0, cost: null}});
    expect(factory).not.toHaveBeenCalled(); expect(owner.busy).toBe(false);
    const next = await scheduler.acquire('provider', 'account'); next.release();
  } finally {held.release(); await pending; await owner.dispose();}
});

it('releases a late grant after cancellation without creating a runtime', async () => {
  const f = await fixture(), control = new AbortController(), granted = deferred<() => void>(), release = vi.fn(), factory = vi.fn(() => runtime());
  let queueSignal: AbortSignal | undefined;
  const admit: Admission = (_job, signal) => {queueSignal = signal; return granted.promise;};
  const owner = coordinator(f, {factory, admit}), pending = owner.extract(job(f, control.signal));
  try {
    await turn(); expect(queueSignal).toBeDefined(); expect(factory).not.toHaveBeenCalled(); control.abort();
    await expect(pending).resolves.toMatchObject({status: 'CANCELLED', usage: {modelCalls: 0, inputBytes: 0}});
    expect(queueSignal!.aborted).toBe(true); expect(owner.busy).toBe(true); expect(release).not.toHaveBeenCalled();
    granted.resolve(release); await owner.cancel();
    expect(release).toHaveBeenCalledOnce(); expect(factory).not.toHaveBeenCalled(); expect(owner.busy).toBe(false);
  } finally {control.abort(); granted.resolve(release); await pending; await owner.dispose();}
});

it('retains its permit until both startup and native cleanup settle after cancellation', async () => {
  const f = await fixture(), scheduler = new RequestScheduler(1), control = new AbortController(), startup = deferred<void>(), cleanup = deferred<void>();
  const native = runtime(() => startup.promise); native.dispose.mockImplementation(() => cleanup.promise);
  const admit = admission(scheduler), owner = coordinator(f, {factory: () => native, admit}), pending = owner.extract(job(f, control.signal));
  const waitingControl = new AbortController(); let waiting: Promise<Awaited<ReturnType<typeof scheduler.acquire>>> | undefined, granted = false;
  try {
    await vi.waitFor(() => expect(native.start).toHaveBeenCalledOnce());
    waiting = scheduler.acquire('provider', 'account', waitingControl.signal); void waiting.then(() => {granted = true;}, () => {});
    control.abort(); await expect(pending).resolves.toMatchObject({status: 'CANCELLED', usage: {modelCalls: 1}});
    await vi.waitFor(() => expect(native.dispose).toHaveBeenCalledOnce()); expect(granted).toBe(false); expect(owner.busy).toBe(true);
    cleanup.resolve(); await turn(); expect(granted).toBe(false); expect(owner.busy).toBe(true);
    startup.resolve(); await owner.cancel(); const next = await waiting; next.release();
    expect(granted).toBe(true); expect(owner.busy).toBe(false);
  } finally {control.abort(); startup.resolve(); cleanup.resolve(); waitingControl.abort(); (await waiting?.catch(() => undefined))?.release(); await pending; await owner.dispose();}
});

it.each(['cancel', 'dispose'] as const)('retains the shared permit when native %s fails', async failure => {
  const f = await fixture(), scheduler = new RequestScheduler(1), control = new AbortController(), native = runtime(() => {});
  native[failure].mockRejectedValue(new Error('Synthetic unconfirmed native cleanup'));
  const admit = admission(scheduler), owner = coordinator(f, {factory: () => native, admit}), pending = owner.extract(job(f, control.signal));
  const waitingControl = new AbortController(); let waiting: Promise<Awaited<ReturnType<typeof scheduler.acquire>>> | undefined, granted = false;
  try {
    await vi.waitFor(() => expect(native.start).toHaveBeenCalledOnce()); control.abort();
    await expect(pending).resolves.toMatchObject({status: 'CANCELLED', usage: {modelCalls: 1}});
    await expect(owner.cancel()).rejects.toMatchObject({code: 'MEMORY_EXTRACTION_CLEANUP_FAILED'});
    waiting = scheduler.acquire('provider', 'account', waitingControl.signal); void waiting.then(() => {granted = true;}, () => {});
    await turn(); expect(granted).toBe(false); expect(owner.busy).toBe(true);
    expect(f.store.all('projectMemoryAuxiliaryUsage')).toMatchObject([{settled: false, usage: {modelCalls: 1, cost: null}}]);
  } finally {control.abort(); waitingControl.abort(); await waiting?.catch(() => undefined); await pending; await expect(owner.dispose()).rejects.toMatchObject({code: 'MEMORY_EXTRACTION_CLEANUP_FAILED'});}
});

it.each(['settles', 'rejects'] as const)('joins the original cancellation promise when it %s instead of releasing through a second cancel call', async result => {
  const f = await fixture(), scheduler = new RequestScheduler(1), control = new AbortController(), cancellation = deferred<void>(), native = runtime(() => {});
  native.cancel.mockImplementationOnce(() => cancellation.promise).mockResolvedValue(undefined);
  const owner = coordinator(f, {factory: () => native, admit: admission(scheduler)}), pending = owner.extract(job(f, control.signal));
  const waitingControl = new AbortController(); let waiting: Promise<Awaited<ReturnType<typeof scheduler.acquire>>> | undefined, granted = false;
  try {
    await vi.waitFor(() => expect(native.start).toHaveBeenCalledOnce());
    waiting = scheduler.acquire('provider', 'account', waitingControl.signal); void waiting.then(() => {granted = true;}, () => {});
    control.abort(); await expect(pending).resolves.toMatchObject({status: 'CANCELLED', usage: {modelCalls: 1}});
    await turn(); expect(granted).toBe(false); expect(owner.busy).toBe(true); expect(native.cancel).toHaveBeenCalledOnce(); expect(native.dispose).not.toHaveBeenCalled();
    if (result === 'settles') {
      cancellation.resolve(); await owner.cancel(); const next = await waiting; next.release();
      expect(granted).toBe(true); expect(owner.busy).toBe(false); expect(native.dispose).toHaveBeenCalledOnce();
    } else {
      cancellation.reject(new Error('Synthetic original cancellation failure'));
      await expect(owner.cancel()).rejects.toMatchObject({code: 'MEMORY_EXTRACTION_CLEANUP_FAILED'});
      await turn(); expect(granted).toBe(false); expect(owner.busy).toBe(true); expect(native.dispose).not.toHaveBeenCalled();
    }
    expect(native.cancel).toHaveBeenCalledOnce();
  } finally {control.abort(); cancellation.resolve(); waitingControl.abort(); (await waiting?.catch(() => undefined))?.release(); await pending; await owner.dispose().catch(() => {});}
});

it('retains the permit when cancellation begins during successful disposal', async () => {
  const f = await fixture(), scheduler = new RequestScheduler(1), control = new AbortController(), disposal = deferred<void>(), cancellation = deferred<void>(), native = runtime();
  native.dispose.mockImplementation(() => disposal.promise); native.cancel.mockImplementation(() => cancellation.promise);
  const owner = coordinator(f, {factory: () => native, admit: admission(scheduler)}), pending = owner.extract(job(f, control.signal));
  const waitingControl = new AbortController(); let waiting: Promise<Awaited<ReturnType<typeof scheduler.acquire>>> | undefined, granted = false;
  try {
    await vi.waitFor(() => expect(native.dispose).toHaveBeenCalledOnce());
    waiting = scheduler.acquire('provider', 'account', waitingControl.signal); void waiting.then(() => {granted = true;}, () => {});
    control.abort(); await expect(pending).resolves.toMatchObject({status: 'CANCELLED', usage: {modelCalls: 1}});
    disposal.resolve(); await turn(); expect(granted).toBe(false); expect(owner.busy).toBe(true); expect(native.cancel).toHaveBeenCalledOnce();
    cancellation.resolve(); await owner.cancel(); const next = await waiting; next.release(); expect(owner.busy).toBe(false);
  } finally {control.abort(); disposal.resolve(); cancellation.resolve(); waitingControl.abort(); (await waiting?.catch(() => undefined))?.release(); await pending; await owner.dispose();}
});

it('production Service composition forwards the shared per-account background admission through its memory host', async () => {
  __setCapabilityFlagForTests('memory.projectV1', true);
  const f = await fixture('openai/model'), service = createHermesService(f.store, runtime());
  const factory = vi.fn(() => runtime()); (Reflect.get(service, 'options') as ServiceOptions).memoryExtractionRuntimeFactory = factory;
  const first = await hermesRequestScheduler.acquire('openai', 'account'), second = await hermesRequestScheduler.acquire('openai', 'account');
  const acquire = vi.spyOn(hermesRequestScheduler, 'acquire');
  service.projectMemory;
  const host = Reflect.get(service, 'memoryHostInstance') as ProjectMemoryHost;
  const scheduled = f.store.internal('fixture-settled-admission', source.threadId, () => host.scheduleSettled(source)); expect(scheduled).not.toBeNull();
  const pending = host.runSettled(source);
  try {
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledWith('openai', 'account', expect.any(AbortSignal), {requestClass: 'background'}));
    expect(factory).not.toHaveBeenCalled();
    expect(service.projectMemory.usage(await service.projectMemory.access('project', 'thread')).extraction).toMatchObject({modelCalls: 0, pending: 1});
    await host.cancel(); await pending; expect(factory).not.toHaveBeenCalled();
  } finally {await host.cancel(); first.release(); second.release(); await pending; await service.dispose();}
});
