import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import type { Operation, RuntimeAdapter, Thread } from '../packages/contracts/index.ts';
import * as domain from '../packages/capabilities/index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-operation-queue-')), store = new Store(join(root, 'state'));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
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
  return { service, store, command, first, second, operation };
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
