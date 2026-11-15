import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Service } from '../packages/core/service';
import { Store } from '../packages/storage/store';
import { capabilityEnabled, M04_FLAG_KEYS, __setCapabilityFlagForTests } from '../packages/core/capability-flags';
import type { RuntimeAdapter, RuntimeCallbacks } from '../packages/contracts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
it('only projects minimal, current request observations under the host flag', async () => {
  const path = mkdtempSync(join(tmpdir(), 'm04-observation-')), store = new Store(path);
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = { configure: next => { callbacks = next; }, models: async () => [],
    start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {},
    history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime);
  cleanup.push(async () => {
    __setCapabilityFlagForTests('context.compilerV1', undefined);
    await service.dispose(); store.close(); rmSync(path, { recursive: true, force: true, maxRetries: 5 });
  });
  const ctx = { threadId: 'thread', runId: 'run', epoch: 4 };
  store.internal('fixture', ctx.threadId, () => store.put('thread', ctx.threadId, ctx.threadId, {
    id: ctx.threadId, epoch: ctx.epoch, runId: ctx.runId, title: 'Fixture', status: 'working',
  }));
  const emit = (sequence: number, patch: Record<string, unknown> = {}) => callbacks.onEvent({
    ...ctx, type: 'context.request', sequence, promptBytes: 13, knownInputs: 1, provider: 'hermes', rawText: 'synthetic private text', ...patch,
  });
  const observed = () => (store.get<{ value: { lastRequest?: unknown } }>('usage', ctx.threadId)?.value)?.lastRequest;
  expect(M04_FLAG_KEYS.map(key => capabilityEnabled(key))).toEqual([false, false, false, false]);
  emit(1);
  expect(observed()).toBeUndefined();
  __setCapabilityFlagForTests('context.compilerV1', true);
  emit(4, { epoch: 3 }); expect(observed()).toBeUndefined();
  emit(4, { promptBytes: -1 }); expect(observed()).toBeUndefined();
  emit(4); emit(3);
  expect(observed()).toEqual({ ...ctx, sequence: 4, promptBytes: 13, knownInputs: 1, visibility: 'OPAQUE_NATIVE_CONTEXT', source: 'hermes' });
  callbacks.onEvent({ ...ctx, type: 'usage', usage: { lastRequest: { rawText: 'synthetic private text' } } });
  expect(observed()).toMatchObject({ sequence: 4, promptBytes: 13 });
  expect(JSON.stringify(store.eventsAfter(0))).not.toContain('synthetic private text');
});

it('spills only large catalog results and retrieves the exact range under the same live owner', async () => {
  const path = mkdtempSync(join(tmpdir(), 'm04-catalog-')), store = new Store(path);
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {},
    followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true } });
  cleanup.push(async () => {
    __setCapabilityFlagForTests('context.compilerV1', undefined);
    __setCapabilityFlagForTests('tools.deferredV1', undefined);
    await service.dispose(); store.close(); rmSync(path, { recursive: true, force: true, maxRetries: 5 });
  });
  const ctx = { threadId: 'thread', runId: 'run', epoch: 4 }, other = { ...ctx, threadId: 'other', runId: 'other-run' };
  const putThread = (binding: typeof ctx, accountId: string) => store.internal('fixture', binding.threadId, () => store.put('thread', binding.threadId, binding.threadId, {
    id: binding.threadId, epoch: binding.epoch, runId: binding.runId, title: 'Fixture', status: 'working', accountId,
  }));
  putThread(ctx, 'account'); putThread(other, 'account');
  const query = { name: 'ui_discover', args: { details: true, limit: 8, query: 'detail' } };
  const original = Buffer.from(JSON.stringify(await service.tool(query, ctx)));
  expect(original.length).toBeGreaterThan(16384);
  __setCapabilityFlagForTests('context.compilerV1', true);
  __setCapabilityFlagForTests('tools.deferredV1', true);
  const spilled = await service.tool(query, ctx) as { status: string; handle: string; preview: string };
  expect(spilled.status).toBe('AVAILABLE');
  expect(Buffer.byteLength(spilled.preview)).toBeLessThanOrEqual(16384);
  const call = { name: 'context_result_read', args: { handle: spilled.handle, offset: 0, length: 20 } };
  expect(await service.tool(call, ctx)).toMatchObject({ status: 'OK', text: original.subarray(0, 20).toString(), totalBytes: original.length });
  expect(await service.tool(call, other)).toEqual({ status: 'UNAVAILABLE' });
  putThread(ctx, 'new-account');
  expect(await service.tool(call, ctx)).toEqual({ status: 'UNAVAILABLE' });
});

it('projects only metadata for admitted host input without changing the model-visible prompt', async () => {
  async function submit(compiler: boolean) {
    const directory = mkdtempSync(join(tmpdir(), 'm04-host-projection-')), store = new Store(directory);
    let captured = '';
    const runtime: RuntimeAdapter = {
      configure: () => {}, models: async () => [{ id: 'test/model', name: 'Fixture model', provider: 'test' }],
      start: async input => { captured = input.prompt; }, followUp: async () => {}, cancel: async () => {},
      compact: async () => {}, history: async () => [], dispose: async () => {},
    };
    const service = new Service(store, runtime);
    __setCapabilityFlagForTests('context.compilerV1', compiler);
    try {
      store.internal('fixture', 'thread-host', () => {
        store.put('thread', 'thread-host', 'thread-host', { id: 'thread-host', title: 'Fixture', runId: null, epoch: 1,
          status: 'ready', modelId: 'test/model', projectName: null, sessionPath: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
        store.put('outbox', 'fixed-input', 'thread-host', { id: 'fixed-input', threadId: 'thread-host', content: 'keep this fixture verbatim', status: 'persisted', runId: null });
      });
      const deliver = Reflect.get(service, 'deliverOutbox') as (id: string) => Promise<void>;
      await deliver.call(service, 'thread-host');
      return { captured, receipt: store.get<{ value: { hostProjection?: unknown } }>('usage', 'thread-host')?.value?.hostProjection };
    } finally {
      __setCapabilityFlagForTests('context.compilerV1', undefined);
      await service.dispose(); store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
    }
  }
  const disabled = await submit(false), enabled = await submit(true);
  expect(enabled.captured).toBe(disabled.captured);
  expect(enabled.captured).toContain('keep this fixture verbatim');
  expect(disabled.receipt).toBeUndefined();
  expect(enabled.receipt).toMatchObject({ measurement: 'BYTE_ONLY', sources: expect.arrayContaining([
    expect.objectContaining({ category: 'USER', utf8Bytes: 26 }),
  ]) });
  expect(JSON.stringify(enabled.receipt)).not.toContain('keep this fixture verbatim');
});

it('does not implement loss-aware compaction by calling legacy native compaction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'm04-compaction-gate-')), store = new Store(directory);
  let calls = 0;
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {},
    followUp: async () => {}, cancel: async () => {}, compact: async () => { calls++; }, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime);
  try {
    const threadId = 'thread-compact-fixture';
    store.internal('fixture', threadId, () => store.put('thread', threadId, threadId, {
      id: threadId, title: 'Fixture', runId: null, epoch: 1, status: 'ready', modelId: 'test/model',
      sessionPath: '/synthetic-session', projectName: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }));
    const before = store.sequence;
    __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
    await expect(service.command({ id: 'compact', type: 'run.compact', threadId, payload: {} })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMPACTION' });
    expect(calls).toBe(0);
    expect(store.sequence).toBe(before);
  } finally {
    __setCapabilityFlagForTests('context.lossAwareCompactionV1', undefined);
    await service.dispose(); store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
