import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Service } from '../packages/core/service';
import { Store } from '../packages/storage/store';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags';
import type { RuntimeAdapter, RuntimeCallbacks, RuntimeUsage, Thread } from '../packages/contracts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  __setCapabilityFlagForTests('context.compilerV1', undefined);
  for (const close of cleanup.splice(0)) await close();
});
function fixture(additionalTool?: () => Promise<unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'm04-relevance-host-')), store = new Store(directory);
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = { configure: value => { callbacks = value; }, models: async () => [],
    start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { additionalTool });
  cleanup.push(async () => { await service.dispose(); store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const ctx = { threadId: 'thread', runId: 'run', epoch: 1 };
  const update = (patch: Partial<Thread>) => store.internal('fixture', ctx.threadId, () => store.put('thread', ctx.threadId, ctx.threadId, {
    id: ctx.threadId, title: 'Fixture', status: 'working', modelId: 'test/model', runId: ctx.runId, epoch: ctx.epoch,
    ...store.get<Thread>('thread', ctx.threadId), ...patch,
  }));
  update({});
  const emit = (sequence: number) => callbacks.onEvent({ ...ctx, type: 'context.request', provider: 'hermes', sequence, promptBytes: 42, knownInputs: 1 });
  const request = () => store.get<{ value: RuntimeUsage }>('usage', ctx.threadId)?.value.lastRequest;
  return { service, store, ctx, update, emit, request, callbacks, read: () => service.tool({ name: 'ui_discover', args: { query: 'Comparison' } }, ctx) };
}

it('observes completed old host reads once without changing their delivered result or persisting content', async () => {
  const f = fixture();
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1);
  const result = await f.read(), delivered = JSON.stringify(result);
  f.emit(2); f.emit(3);
  expect(f.request()?.relevance).toBeUndefined();
  f.emit(4);
  expect(f.request()?.relevance).toMatchObject({ source: 'HOST_READ_RESULTS', measurement: 'BYTE_ONLY', observedAtSequence: 4,
    inspectedResults: 1, protectedResults: 0, omittedResults: 0, estimatedSavingsBytes: Buffer.byteLength(delivered) });
  expect(f.request()?.relevance?.candidateIds).toHaveLength(1);
  const cut = f.request()?.relevance;
  f.emit(4); f.emit(5);
  expect(f.request()?.relevance).toEqual(cut);
  expect(JSON.stringify(result)).toBe(delivered);
  expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('Comparison');
  expect(f.request()).toMatchObject({ promptBytes: 42, visibility: 'OPAQUE_NATIVE_CONTEXT' });
});

it('never retrospectively observes disabled or unsequenced result delivery', async () => {
  const f = fixture();
  await f.read(); f.emit(1);
  expect(f.request()).toBeUndefined();
  __setCapabilityFlagForTests('context.compilerV1', true);
  await f.read(); f.emit(5);
  expect(f.request()?.relevance).toBeUndefined();
  await f.read(); f.emit(8);
  expect(f.request()?.relevance?.candidateIds).toHaveLength(1);
});

it.each(['pending-approval', 'prepared', 'running', 'unknown'])('protects all old reads while %s remains unresolved', async status => {
  const f = fixture();
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1); await f.read();
  const kind = status === 'pending-approval' ? 'request' : 'operation';
  f.store.internal('fixture', f.ctx.threadId, () => f.store.put(kind, 'active', f.ctx.threadId, { id: 'active', threadId: f.ctx.threadId, status: kind === 'request' ? 'pending' : status }));
  f.emit(4);
  expect(f.request()?.relevance).toMatchObject({ candidateIds: [], protectedResults: 1, estimatedSavingsBytes: 0 });
  f.store.internal('fixture', f.ctx.threadId, () => f.store.remove(kind, 'active'));
  f.emit(5);
  expect(f.request()?.relevance?.candidateIds).toHaveLength(1);
});

it('excludes writes and failed tool dispatches from the old-result report', async () => {
  const f = fixture();
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1);
  await f.service.tool({ name: 'task_memory', args: { action: 'save', key: 'decision', baseRevision: 0, content: 'A current decision' } }, f.ctx);
  await expect(f.service.tool({ name: 'ui_discover', args: { limit: -1 } }, f.ctx)).rejects.toBeDefined();
  f.emit(4);
  expect(f.request()?.relevance).toBeUndefined();
});

it.each(['run', 'model', 'account', 'workspace', 'grant'])('drops asynchronous results after the %s owner changes', async change => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>(done => { resolve = done; }), f = fixture(() => pending);
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1);
  const delivered = f.service.tool({ name: 'integration_list', args: {} }, f.ctx).catch(() => null);
  if (change === 'grant') f.store.internal('fixture', f.ctx.threadId, () => f.store.put('resource', 'changed', f.ctx.threadId, { id: 'changed', threadId: f.ctx.threadId, label: 'A newly granted file', path: '/synthetic', writable: false }));
  else f.update(change === 'run' ? { runId: 'replacement', epoch: 2 } : change === 'model' ? { modelId: 'test/other' } : change === 'account' ? { accountId: 'changed-account' } : { workspaceId: 'new-workspace' });
  resolve({ text: 'A late result must not become a candidate' });
  await delivered; f.emit(4);
  expect(f.request()?.relevance).toBeUndefined();
});

it('bounds retained result metadata and reports omissions without retaining tool text', async () => {
  const result = { text: 'PRIVATE_READ_RESULT' }, f = fixture(async () => result);
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1);
  for (let index = 0; index < 66; index++) expect(await f.service.tool({ name: 'integration_list', args: {} }, f.ctx)).toBe(result);
  f.emit(4);
  expect(f.request()?.relevance).toMatchObject({ inspectedResults: 64, omittedResults: 2 });
  expect(f.request()?.relevance?.candidateIds).toHaveLength(64);
  expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('PRIVATE_READ_RESULT');
});

it('retains a late successful read until two requests after its actual delivery', async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>(done => { resolve = done; }), f = fixture(() => pending);
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1);
  const delivered = f.service.tool({ name: 'integration_list', args: {} }, f.ctx);
  f.emit(2); f.emit(3); f.emit(4);
  resolve({ text: 'Just delivered' }); await delivered;
  f.emit(5); f.emit(6);
  expect(f.request()?.relevance).toBeUndefined();
  f.emit(7);
  expect(f.request()?.relevance?.candidateIds).toHaveLength(1);
});

it('never invokes getters or custom serialization and does not block on unsupported result shapes', async () => {
  let reads = 0;
  const result = Object.defineProperty({}, 'toJSON', { get: () => { reads++; throw new Error('Observation must not execute result code'); } });
  const f = fixture(async () => result);
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1);
  expect(await f.service.tool({ name: 'integration_list', args: {} }, f.ctx)).toBe(result);
  f.emit(4);
  expect(reads).toBe(0);
  expect(f.request()).toMatchObject({ sequence: 4, promptBytes: 42 });
  expect(f.request()?.relevance).toBeUndefined();
});

it('does not treat over-budget output as inspected or charge bytes outside the host cap', async () => {
  const f = fixture(async () => 'x'.repeat(65537));
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1);
  expect(await f.service.tool({ name: 'integration_list', args: {} }, f.ctx)).toHaveLength(65537);
  f.emit(4);
  expect(f.request()?.relevance).toBeUndefined();
});

it('checks protection through bounded metadata instead of deserializing the full request and operation history', async () => {
  const f = fixture();
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1); await f.read();
  const readAll = f.store.all.bind(f.store);
  vi.spyOn(f.store, 'all').mockImplementation((kind, threadId) => {
    if (kind === 'operation' || kind === 'request') throw new Error('Unbounded history read');
    return readAll(kind, threadId);
  });
  f.emit(4);
  expect(f.request()?.relevance?.candidateIds).toHaveLength(1);
});

it('conservatively protects results when old work exceeds the bounded protection window', async () => {
  const f = fixture();
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1); await f.read();
  f.store.internal('fixture', f.ctx.threadId, () => {
    for (let index = 0; index < 129; index++) f.store.put('operation', 'old-' + index, f.ctx.threadId, { id: 'old-' + index, threadId: f.ctx.threadId, status: 'succeeded' });
  });
  f.emit(4);
  expect(f.request()?.relevance).toMatchObject({ candidateIds: [], protectedResults: 1 });
});

it('retires the old result window and displayed estimate after confirmed native compaction', async () => {
  const f = fixture();
  __setCapabilityFlagForTests('context.compilerV1', true);
  f.emit(1); await f.read(); f.emit(4);
  expect(f.request()?.relevance?.candidateIds).toHaveLength(1);
  f.callbacks.onEvent({ ...f.ctx, type: 'compaction.end', aborted: true });
  expect(f.request()?.relevance?.candidateIds).toHaveLength(1);
  f.callbacks.onEvent({ ...f.ctx, type: 'compaction.end', aborted: false });
  expect(f.request()?.relevance).toBeUndefined();
  f.emit(5);
  expect(f.request()?.relevance).toBeUndefined();
  await f.read(); f.emit(8);
  expect(f.request()?.relevance?.candidateIds).toHaveLength(1);
});
