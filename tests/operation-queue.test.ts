import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import type { Operation, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread } from '../packages/contracts/index.ts';
import * as domain from '../packages/capabilities/index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-operation-queue-')), store = new Store(join(root, 'state'));
  let callbacks!: RuntimeCallbacks; const starts: StartRun[] = [];
  const runtime: RuntimeAdapter = { configure: value => { callbacks = value; }, models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }], start: async input => { starts.push(input); }, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime);
  const command = (type: string, threadId?: string, payload: Record<string, unknown> = {}) => service.command({ id: crypto.randomUUID(), type, payload, threadId });
  const first = (await command('thread.create')).result as Thread;
  const second = (await command('thread.create')).result as Thread;
  function operation(id: string, threadId = first.id) {
    const op: Operation = { id, threadId, revision: 1, kind: 'fixture.check', description: 'Queue regression', args: {}, resourceIds: [], preconditions: {}, status: 'prepared', approved: true, createdAt: new Date().toISOString() };
    store.internal('fixture.operation', threadId, () => store.put('operation', id, threadId, op));
    return op;
  }
  cleanups.push(async () => { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); });
  return { service, store, command, first, second, operation, starts, get callbacks() { return callbacks; } };
}

it('serializes approved effects across threads and executes a queued duplicate only once', async () => {
  const x = await fixture(), entered = deferred(), release = deferred();
  const first = x.operation('first'), second = x.operation('second', x.second.id);
  const calls: string[] = [];
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async op => { calls.push(op.id); if (op.id === first.id) { entered.resolve(); await release.promise; } return { verified: true }; });
  const running = x.service.dispatchOperation(first.id); await entered.promise;
  const waiting = x.service.dispatchOperation(second.id), duplicate = x.service.dispatchOperation(second.id);
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toEqual(['first']);
    expect(x.store.get<Operation>('operation', second.id)?.status).toBe('prepared');
  } finally { release.resolve(); await Promise.allSettled([running, waiting, duplicate]); }
  expect(calls).toEqual(['first', 'second']);
  expect(await duplicate).toMatchObject({ id: second.id, status: 'succeeded' });
});

it('does not revive a queued effect after Stop replaces its cancellation owner', async () => {
  const x = await fixture(), entered = deferred(), release = deferred();
  const first = x.operation('first'), second = x.operation('second', x.second.id);
  const calls: string[] = [];
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async op => { calls.push(op.id); if (op.id === first.id) { entered.resolve(); await release.promise; } return { verified: true }; });
  const running = x.service.dispatchOperation(first.id); await entered.promise;
  const waiting = x.service.dispatchOperation(second.id);
  const stopped = expect(waiting).rejects.toMatchObject({ code: 'CANCELLED_RUN' });
  try {
    await x.command('run.stop', second.threadId);
    await x.command('run.resume', second.threadId, { modelId: 'test/model' });
    expect(x.store.get<Thread>('thread', second.threadId)?.status).toBe('working');
  } finally { release.resolve(); await Promise.allSettled([running, waiting]); }
  await stopped;
  expect(calls).toEqual(['first']);
  expect(x.store.get<Operation>('operation', second.id)?.status).toBe('prepared');
});

it('revalidates withdrawn approval after queue entry and releases the next slot', async () => {
  const x = await fixture(), entered = deferred(), release = deferred();
  const first = x.operation('first'), second = x.operation('second'), third = x.operation('third');
  const calls: string[] = [];
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async op => { calls.push(op.id); if (op.id === first.id) { entered.resolve(); await release.promise; } return { verified: true }; });
  const running = x.service.dispatchOperation(first.id); await entered.promise;
  const waiting = x.service.dispatchOperation(second.id), next = x.service.dispatchOperation(third.id);
  const rejected = expect(waiting).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  try { x.store.internal('fixture.withdraw', second.threadId, () => x.store.put('operation', second.id, second.threadId, { ...second, approved: false })); }
  finally { release.resolve(); await Promise.allSettled([running, waiting, next]); }
  await rejected;
  expect(calls).toEqual(['first', 'third']);
});


it('retires an operation-only owner after execution while preserving its durable receipt hold', async () => {
  const x = await fixture(), entered = deferred(), release = deferred(), op = x.operation('only-operation');
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async () => { entered.resolve(); await release.promise; return { verified: true }; });
  const running = x.service.dispatchOperation(op.id);
  try {
    await entered.promise; expect(x.service.isUpdateIdle()).toBe(false);
    release.resolve(); await running; await new Promise<void>(resolve => setImmediate(resolve));
    expect(x.store.get<Operation>('operation', op.id)?.status).toBe('succeeded');
    expect(x.service.isUpdateIdle()).toBe(false);
    // This runtime-free task has no consumer. Simulate durable receipt acknowledgement.
    x.store.internal('fixture.receipt_acknowledged', op.threadId, () => {
      const receipt = x.store.get<{id:string;status:string}>('outbox', 'operation-result:' + op.id)!;
      x.store.put('outbox', receipt.id, op.threadId, {...receipt, status:'handled'});
    });
    expect(x.service.isUpdateIdle()).toBe(true);
  } finally { release.resolve(); await running; }
});

it('foreground settlement keeps running and queued effects owned until Stop cancels both', async () => {
  const x = await fixture(), entered = deferred(), release = deferred();
  await x.command('message.send', x.first.id, {content:'Check the fixture',modelId:'test/model'});
  await x.service.deliverOutbox(x.first.id); const run = x.starts[0];
  const first = x.operation('running'), second = x.operation('queued');
  let signal!: AbortSignal;
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async (_op, ctx) => { signal = ctx.signal!; entered.resolve(); await release.promise; return { verified: true }; });
  const running = x.service.dispatchOperation(first.id); await entered.promise;
  const waiting = x.service.dispatchOperation(second.id), outcome = waiting.then(value=>({value}),error=>({error}));
  try {
    x.callbacks.onEvent({...run,type:'input.processing',inputIds:run.inputIds});
    x.callbacks.onEvent({...run,type:'assistant.message',content:'Done',inputIds:run.inputIds});
    x.callbacks.onEvent({...run,type:'settled'}); await x.service.deliverOutbox(run.threadId);
    expect(x.service.isUpdateIdle()).toBe(false);
    await x.command('run.stop', x.first.id); expect(signal.aborted).toBe(true);
  } finally { release.resolve(); await Promise.allSettled([running, waiting]); }
  expect(await outcome).toMatchObject({error:{code:'CANCELLED_RUN'}});
  expect(x.store.get<Operation>('operation', second.id)?.status).toBe('prepared');
});

it('an old queued owner and stale settlement cannot retire the second run controller', async () => {
  const x = await fixture(), entered = deferred(), release = deferred(), newEntered = deferred(), newRelease = deferred();
  await x.command('message.send', x.second.id, {content:'First run',modelId:'test/model'});
  await x.service.deliverOutbox(x.second.id); const firstRun = x.starts[0];
  const blocker = x.operation('blocker'), queued = x.operation('old-queued', x.second.id);
  let newSignal!: AbortSignal;
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async (op, ctx) => {
    if(op.id === blocker.id) { entered.resolve(); await release.promise; }
    else { newSignal = ctx.signal!; newEntered.resolve(); await newRelease.promise; }
    return { verified:true };
  });
  const running = x.service.dispatchOperation(blocker.id); await entered.promise;
  const waiting = x.service.dispatchOperation(queued.id), rejected = expect(waiting).rejects.toMatchObject({code:'CANCELLED_RUN'});
  let newer: Promise<unknown> | undefined;
  try {
    await x.command('run.stop', x.second.id);
    await x.command('run.resume', x.second.id, {modelId:'test/model'}); await x.service.deliverOutbox(x.second.id);
    expect(x.starts[1].runId).not.toBe(firstRun.runId);
    x.callbacks.onEvent({...firstRun,type:'settled'});
    const next = x.operation('new-operation', x.second.id); newer = x.service.dispatchOperation(next.id);
    // Settle the new run before the old queued completion: only exact controller
    // identity distinguishes its live queued effect from the retired old owner.
    const secondRun = x.starts[1];
    x.callbacks.onEvent({...secondRun,type:'input.processing',inputIds:secondRun.inputIds});
    x.callbacks.onEvent({...secondRun,type:'assistant.message',content:'Done',inputIds:secondRun.inputIds});
    x.callbacks.onEvent({...secondRun,type:'settled'});
    release.resolve(); await running; await rejected; await newEntered.promise;
    await x.command('run.stop', x.second.id); expect(newSignal.aborted).toBe(true); expect(x.service.isUpdateIdle()).toBe(false);
  } finally { release.resolve(); newRelease.resolve(); await Promise.allSettled([running,waiting,...(newer?[newer]:[])]); }
});
