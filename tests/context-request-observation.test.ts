import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Service } from '../packages/core/service';
import { Store } from '../packages/storage/store';
import { capabilityEnabled, M04_FLAG_KEYS, __setCapabilityFlagForTests } from '../packages/core/capability-flags';
import type { RequestContextV1, RuntimeAdapter, RuntimeCallbacks } from '../packages/contracts';

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

const compactionReceipt = (threadId: string): { receipt: RequestContextV1 } => ({ receipt: {
  requestId: `receipt-${threadId}`, contextGeneration: 1, segments: [],
  modelBinding: { modelId: 'test/model', accountId: null }, owner: { threadId, workspaceId: 'thread:' + threadId },
  instructionDigest: 'a'.repeat(64), toolRegistryDigest: 'b'.repeat(64),
  sourceCut: { sequence: 18, revisionDigest: 'c'.repeat(64) }, budget: { utf8Bytes: 4096, tokens: null, measurement: 'BYTE_ONLY' },
  nativeContext: { visibility: 'OPAQUE_NATIVE_CONTEXT', totalBytes: null },
}});

it('applies loss-aware compaction only through the verified native source-cut CAS', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'm04-compaction-cas-')), store = new Store(directory);
  const compactCalls: Array<{ expected?: string }> = [];
  let historyCalls = 0, callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = { configure: value => { callbacks = value; }, models: async () => [], start: async () => {},
    followUp: async () => {}, cancel: async () => {},
    compact: async (ctx, _session, _model, _account, _checkpoint, expectedHistorySha256) => {
      compactCalls.push({ expected: expectedHistorySha256 });
      callbacks.onEvent({ ...ctx, type: 'compaction.start', reason: 'manual' });
      callbacks.onEvent({ ...ctx, type: 'compaction.end', reason: 'manual', aborted: false });
      callbacks.onEvent({ ...ctx, type: 'settled', aborted: false });
    },
    history: async () => [], dispose: async () => {},
    nativeHistoryDigest: async () => { historyCalls++; return { sha256: 'd'.repeat(64), messages: [{ role: 'user', content: `segment ${historyCalls}` }] }; } };
  const service = new Service(store, runtime);
  try {
    const threadId = 'thread-cas-fixture';
    store.internal('fixture', threadId, () => {
      store.put('thread', threadId, threadId, {
        id: threadId, title: 'Fixture', runId: null, epoch: 1, status: 'ready', modelId: 'test/model',
        sessionPath: '/synthetic-session', projectName: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      });
      store.put('requestContextReceipt', `receipt-${threadId}`, threadId, compactionReceipt(threadId));
    });
    __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
    await service.command({ id: 'compact', type: 'run.compact', threadId, payload: {} });
    expect(compactCalls).toEqual([{ expected: 'd'.repeat(64) }]);
    expect(historyCalls).toBe(2);
    const usage = store.get<{ value: { compaction?: { candidates: Array<{ status: string; verdict: string | null; measuredBeforeBytes: number | null; measuredAfterBytes: number | null }> } } }>('usage', threadId);
    const candidate = usage?.value.compaction?.candidates[0];
    expect(candidate).toMatchObject({ status: 'APPLIED', verdict: 'APPLIED' });
    expect(typeof candidate?.measuredBeforeBytes).toBe('number');
    expect(typeof candidate?.measuredAfterBytes).toBe('number');
  } finally {
    __setCapabilityFlagForTests('context.lossAwareCompactionV1', undefined);
    await service.dispose(); store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

it('records a failed verdict without mutating when the native source-cut digest mismatches', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'm04-compaction-mismatch-')), store = new Store(directory);
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {},
    followUp: async () => {}, cancel: async () => {},
    compact: async () => { const error = new Error('The native source history changed after admission; the compaction was not applied.') as Error & { code?: string }; error.code = 'HERMES_COMPACTION_MISMATCH'; throw error; },
    history: async () => [], dispose: async () => {},
    nativeHistoryDigest: async () => ({ sha256: 'e'.repeat(64), messages: [{ role: 'user', content: 'segment' }] }) };
  const service = new Service(store, runtime);
  try {
    const threadId = 'thread-mismatch-fixture';
    store.internal('fixture', threadId, () => {
      store.put('thread', threadId, threadId, {
        id: threadId, title: 'Fixture', runId: null, epoch: 1, status: 'ready', modelId: 'test/model',
        sessionPath: '/synthetic-session', projectName: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      });
      store.put('requestContextReceipt', `receipt-${threadId}`, threadId, compactionReceipt(threadId));
    });
    __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
    await expect(service.command({ id: 'compact', type: 'run.compact', threadId, payload: {} })).rejects.toMatchObject({ code: 'COMPACTION_FAILED' });
    const usage = store.get<{ value: { compaction?: { candidates: Array<{ status: string; verdict: string | null; measuredBeforeBytes: number | null }> } } }>('usage', threadId);
    const candidate = usage?.value.compaction?.candidates[0];
    expect(candidate).toMatchObject({ status: 'FAILED', verdict: 'FAILED' });
    expect(candidate?.measuredBeforeBytes).toBeNull();
    expect(store.get('thread', threadId)).toMatchObject({ status: 'ready', runId: null });
  } finally {
    __setCapabilityFlagForTests('context.lossAwareCompactionV1', undefined);
    await service.dispose(); store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function ownedCompactionFixture(requestContextEnabled = false) {
  const directory = mkdtempSync(join(tmpdir(), 'm04-owned-compaction-')), store = new Store(directory);
  const threadId = 'owned-compaction';
  let callbacks!: RuntimeCallbacks, historyReads = 0;
  const runtime: RuntimeAdapter = {
    configure: value => { callbacks = value; }, models: async () => [{ id: 'test/model', provider: 'test', name: 'Fixture model' }], start: vi.fn(async () => {}), followUp: async () => {},
    cancel: vi.fn(async () => {}), history: async () => [], dispose: async () => {},
    compact: vi.fn(async ctx => {
      callbacks.onEvent({ ...ctx, type: 'compaction.start', reason: 'manual' });
      callbacks.onEvent({ ...ctx, type: 'usage', usage: { inputTokens: 123, outputTokens: 17, cost: 0.02 } });
      callbacks.onEvent({ ...ctx, type: 'compaction.end', reason: 'manual', aborted: false });
      callbacks.onEvent({ ...ctx, type: 'settled', aborted: false });
    }),
    nativeHistoryDigest: vi.fn(async () => ({ sha256: (++historyReads === 1 ? 'd' : 'e').repeat(64), messages: [{ role: 'user', content: historyReads === 1 ? 'Original context' : 'Summary' }] })),
  };
  const service = new Service(store, runtime, { requestContextEnabled });
  store.internal('fixture', threadId, () => {
    store.put('thread', threadId, threadId, { id: threadId, title: 'Fixture', runId: null, epoch: 4, status: 'ready', modelId: 'test/model', accountId: null,
      sessionPath: '/owned-session', projectName: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    store.put('requestContextReceipt', `receipt-${threadId}`, threadId, { receipt: { ...compactionReceipt(threadId).receipt, requestId: `receipt-${threadId}`, owner: { threadId, workspaceId: 'thread:' + threadId } } });
    store.put('requestContextGeneration', threadId, threadId, { generation: 1 });
  });
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
  cleanup.push(async () => {
    __setCapabilityFlagForTests('context.lossAwareCompactionV1', undefined);
    __setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);
    await service.dispose(); store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const command = { id: 'owned-compact', type: 'run.compact', threadId, payload: {} };
  return { service, store, runtime, threadId, command, callbacks: () => callbacks };
}

it('owns native compaction callbacks and advances the durable context generation after application', async () => {
  const f = await ownedCompactionFixture();
  await f.service.command(f.command);
  expect(f.store.get<{ value: unknown }>('usage', f.threadId)?.value).toMatchObject({ inputTokens: 123, outputTokens: 17, cost: 0.02, activity: 'idle' });
  expect(f.service.thread(f.threadId)).toMatchObject({ runId: null, epoch: 5, status: 'ready' });
  expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({ generation: 2 });
  await f.service.command(f.command);
  expect(f.runtime.compact).toHaveBeenCalledOnce();
});

it.each(['legacy', 'saved'] as const)('preserves the %s session account when a provider default is selected', async mode => {
  const f = await ownedCompactionFixture();
  const create = async (id: string) => (await f.service.command({ id, type: 'account.create', payload: { providerId: 'openai', label: id } })).result as { id: string };
  const selected = await create('default-account'), saved = await create('session-account');
  await f.service.command({ id: 'select-default', type: 'account.select', payload: { providerId: 'openai', accountId: selected.id } });
  const expectedAccount = mode === 'saved' ? saved.id : null;
  f.store.internal('fixture.account-binding', f.threadId, () => {
    const { accountId: _accountId, ...thread } = f.service.thread(f.threadId);
    f.store.put('thread', f.threadId, f.threadId, { ...thread, modelId: 'openai/model', ...(mode === 'saved' ? { accountId: saved.id } : {}) });
    f.store.put('requestContextReceipt', `receipt-${f.threadId}`, f.threadId, { receipt: { ...compactionReceipt(f.threadId).receipt, modelBinding: { modelId: 'openai/model', accountId: expectedAccount } } });
  });
  await f.service.command(f.command);
  const thread = f.service.thread(f.threadId);
  expect(Object.hasOwn(thread, 'accountId')).toBe(mode === 'saved');
  expect(thread.accountId).toBe(mode === 'saved' ? saved.id : undefined);
  expect(f.runtime.compact).toHaveBeenCalledWith(expect.objectContaining({ accountId: expectedAccount }), '/owned-session', 'openai/model', expectedAccount, undefined, 'd'.repeat(64));
  expect(f.store.snapshot().settings.selectedAccounts?.openai).toBe(selected.id);
});

it.each(['before settlement', 'during finalization'] as const)('delivers queued input %s only after recording the applied compaction', async timing => {
  const f = await ownedCompactionFixture();
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  type Snapshot = { sha256: string; messages: unknown[] };
  let releaseBefore!: (value: Snapshot) => void, releaseAfter!: (value: Snapshot) => void;
  const before = new Promise<Snapshot>(resolve => { releaseBefore = resolve; }), after = new Promise<Snapshot>(resolve => { releaseAfter = resolve; });
  vi.mocked(f.runtime.nativeHistoryDigest!).mockReturnValueOnce(before).mockReturnValueOnce(after);
  let stateAtStart: unknown;
  vi.mocked(f.runtime.start).mockImplementation(async () => {
    stateAtStart = { generation: f.store.get('requestContextGeneration', f.threadId), usage: f.store.get('usage', f.threadId) };
  });
  const compacted = f.service.command(f.command).then(() => 'APPLIED', () => 'FAILED');
  const queue = () => f.service.command({ id: 'queued-after-compaction', type: 'message.send', threadId: f.threadId, payload: { content: 'Continue after compaction', modelId: 'test/model', sendMode: 'AFTER_CURRENT' } });
  try {
    await vi.waitFor(() => expect(f.runtime.nativeHistoryDigest).toHaveBeenCalledTimes(1));
    if (timing === 'before settlement') await queue();
    releaseBefore({ sha256: 'd'.repeat(64), messages: [{ role: 'user', content: 'Original context' }] });
    await vi.waitFor(() => expect(f.runtime.nativeHistoryDigest).toHaveBeenCalledTimes(2));
    if (timing === 'during finalization') await queue();
    expect(f.runtime.start).not.toHaveBeenCalled();
    expect(f.store.get('outbox', 'queued-after-compaction')).toMatchObject({ status: 'persisted', runId: null });
    releaseAfter({ sha256: 'e'.repeat(64), messages: [{ role: 'user', content: 'Summary' }] });
    expect(await compacted).toBe('APPLIED');
    await vi.waitFor(() => expect(f.runtime.start).toHaveBeenCalledOnce());
    expect(stateAtStart).toMatchObject({ generation: { generation: 2 }, usage: { value: { compaction: { candidates: [expect.objectContaining({ status: 'APPLIED', verdict: 'APPLIED' })] } } } });
    expect(f.service.thread(f.threadId)).toMatchObject({ epoch: 6, status: 'working' });
  } finally {
    releaseBefore({ sha256: 'd'.repeat(64), messages: [] });
    releaseAfter({ sha256: 'e'.repeat(64), messages: [] });
    await compacted;
  }
});

it.each(['prepared input', 'stop', 'model'] as const)('retains confirmed native application when %s changes during optional usage measurement', async change => {
  const f = await ownedCompactionFixture(change === 'prepared input');
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  let releaseAfter!: (value: { sha256: string; messages: unknown[] }) => void;
  const after = new Promise<{ sha256: string; messages: unknown[] }>(resolve => { releaseAfter = resolve; });
  vi.mocked(f.runtime.nativeHistoryDigest!).mockResolvedValueOnce({ sha256: 'd'.repeat(64), messages: [{ role: 'user', content: 'Original context' }] }).mockReturnValueOnce(after);
  const compacted = f.service.command(f.command).then(() => 'APPLIED', () => 'FAILED');
  try {
    await vi.waitFor(() => expect(f.runtime.nativeHistoryDigest).toHaveBeenCalledTimes(2));
    if (change === 'prepared input') await f.service.command({ id: 'queued-prepared-input', type: 'message.send', threadId: f.threadId, payload: { content: 'Continue with prepared context', modelId: 'test/model', sendMode: 'AFTER_CURRENT' } });
    else if (change === 'stop') await f.service.command({ id: 'stop-after-native-apply', type: 'run.stop', threadId: f.threadId, payload: {} });
    else f.store.internal('owner.model-changed', f.threadId, () => f.store.put('thread', f.threadId, f.threadId, { ...f.service.thread(f.threadId), modelId: 'test/other' }));
    expect(f.runtime.start).not.toHaveBeenCalled();
    releaseAfter({ sha256: 'e'.repeat(64), messages: [{ role: 'user', content: 'Summary' }] });
    expect(await compacted).toBe('APPLIED');
    const usage = f.store.get<{ value: { compaction: { candidates: unknown[] } } }>('usage', f.threadId);
    expect(usage?.value.compaction.candidates).toEqual([expect.objectContaining({ status: 'APPLIED', verdict: 'APPLIED', measuredBeforeBytes: expect.any(Number), measuredAfterBytes: null })]);
    if (change === 'prepared input') {
      await vi.waitFor(() => expect(f.runtime.start).toHaveBeenCalledOnce());
      expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({ generation: 3 });
    } else {
      expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({ generation: 2 });
      expect(f.service.thread(f.threadId)).toMatchObject(change === 'stop' ? { status: 'stopped', runId: null } : { modelId: 'test/other', runId: null });
    }
  } finally {
    releaseAfter({ sha256: 'e'.repeat(64), messages: [] });
    await compacted;
  }
});

it('advances past a queued draft generation when native compaction confirms its fenced source', async () => {
  const f = await ownedCompactionFixture(true);
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  let finishNative!: () => void;
  const native = new Promise<void>(resolve => { finishNative = resolve; });
  vi.mocked(f.runtime.compact).mockImplementation(async ctx => {
    await native;
    f.callbacks().onEvent({ ...ctx, type: 'compaction.end', reason: 'manual', aborted: false });
    f.callbacks().onEvent({ ...ctx, type: 'settled', aborted: false });
  });
  const compacted = f.service.command(f.command).then(() => 'APPLIED', () => 'FAILED');
  try {
    await vi.waitFor(() => expect(f.runtime.compact).toHaveBeenCalledOnce());
    await f.service.command({ id: 'queued-during-native', type: 'message.send', threadId: f.threadId, payload: { content: 'Continue with this queued draft', modelId: 'test/model', sendMode: 'AFTER_CURRENT' } });
    expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({ generation: 2 });
    expect(f.runtime.start).not.toHaveBeenCalled();
    finishNative();
    expect(await compacted).toBe('APPLIED');
    await vi.waitFor(() => expect(f.runtime.start).toHaveBeenCalledOnce());
    expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({ generation: 3 });
    expect(f.store.get('outbox', 'queued-during-native')).toMatchObject({ status: 'processing' });
  } finally { finishNative(); await compacted; }
});

it('returns the same admitted compaction through authenticated HTTP and exposes its measured result', async () => {
  const f = await ownedCompactionFixture(), { buildServer } = await import('../apps/server/server.ts');
  const app = await buildServer(f.service, { port: 4317, dev: false });
  try {
    const host = { host: '127.0.0.1:4317' };
    expect((await app.inject({ method: 'POST', url: '/api/commands', headers: host, payload: f.command })).statusCode).toBe(401);
    const bootstrap = await app.inject({ url: '/api/bootstrap', headers: host });
    const headers = { ...host, cookie: String(bootstrap.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.json().csrfToken };
    const first = await app.inject({ method: 'POST', url: '/api/commands', headers, payload: f.command });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({ method: 'POST', url: '/api/commands', headers, payload: f.command });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(f.runtime.compact).toHaveBeenCalledOnce();
    const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
    expect(snapshot.usage[f.threadId]).toMatchObject({ inputTokens: 123, outputTokens: 17, cost: 0.02,
      compaction: { candidates: [expect.objectContaining({ status: 'APPLIED', verdict: 'APPLIED', measuredBeforeBytes: expect.any(Number), measuredAfterBytes: expect.any(Number) })] } });
  } finally { await app.close(); }
});

it.each(['silent', 'settled without compaction', 'failed'] as const)('does not publish an applied candidate for a %s native result', async result => {
  const f = await ownedCompactionFixture();
  vi.mocked(f.runtime.compact).mockImplementation(async ctx => {
    if (result === 'settled without compaction') f.callbacks().onEvent({ ...ctx, type: 'settled', aborted: false });
    if (result === 'failed') f.callbacks().onEvent({ ...ctx, type: 'error', message: 'Native compaction failed' });
  });
  await expect(f.service.command(f.command)).rejects.toMatchObject({ code: 'COMPACTION_FAILED' });
  expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
  expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({ generation: 1 });
});

it.each(['stop', 'account', 'model', 'thinking', 'workspace', 'session', 'generation', 'receipt'] as const)('refuses native compaction when %s changes while the source snapshot is pending', async change => {
  const f = await ownedCompactionFixture();
  let resolveSnapshot!: (value: { sha256: string; messages: unknown[] }) => void;
  const snapshot = new Promise<{ sha256: string; messages: unknown[] }>(resolve => { resolveSnapshot = resolve; });
  vi.mocked(f.runtime.nativeHistoryDigest!).mockReturnValueOnce(snapshot);
  const result = f.service.command(f.command).then(() => 'APPLIED', () => 'REFUSED');
  await vi.waitFor(() => expect(f.runtime.nativeHistoryDigest).toHaveBeenCalledOnce());
  if (change === 'stop') await f.service.command({ id: 'stop-compaction', type: 'run.stop', threadId: f.threadId, payload: {} });
  else if (change === 'generation') f.store.internal('generation-changed', f.threadId, () => f.store.put('requestContextGeneration', f.threadId, f.threadId, { generation: 2 }));
  else if (change === 'receipt') f.store.internal('receipt-changed', f.threadId, () => f.store.put('requestContextReceipt', 'new-receipt', f.threadId, { receipt: { ...compactionReceipt(f.threadId).receipt, requestId: 'new-receipt' } }));
  else f.store.internal('owner-changed', f.threadId, () => f.store.put('thread', f.threadId, f.threadId, {
    ...f.service.thread(f.threadId), ...({ account: { accountId: 'other-account' }, model: { modelId: 'test/other' }, thinking: { thinkingLevel: 'high' }, workspace: { workspaceId: 'other-workspace' }, session: { sessionPath: '/other-session' } }[change]),
  }));
  resolveSnapshot({ sha256: 'd'.repeat(64), messages: [{ role: 'user', content: 'Original context' }] });
  expect(await result).toBe('REFUSED');
  expect(f.runtime.compact).not.toHaveBeenCalled();
  expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
});
