import { expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContextResults, CONTEXT_PREVIEW_CAP_BYTES } from '../packages/core/context-results.ts';
import { createContextCompiler } from '../packages/core/context-compiler.ts';
import { previewCompaction } from '../packages/core/context-compaction.ts';
import { M04_FLAG_KEYS, capabilityEnabled, __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { createHermesRuntime, type HermesRuntimeOptions, type HermesSourceClient } from '../packages/runtime-hermes/index.ts';
import type { RuntimeAdapter, RuntimeCallbacks, RuntimeEvent, StartRun } from '../packages/contracts/index.ts';

const owner = { threadId: 'thread-v6', workspaceId: 'workspace-v6', accountId: 'account-v6' };

it('preserves the exact RequestContextV1, ToolResultHandleV1 and candidate contract spellings', async () => {
  const records: Array<Record<string, unknown>> = [];
  const vault = createContextResults({
    now: () => 0, isAuthorized: () => true,
    storage: { put: async (_key, _bytes, record) => { records.push({ ...record }); }, get: async () => undefined },
  });
  const issued = await vault.spill({ owner, invocationId: 'invocation-v6', bytes: Buffer.from('contract'), mediaType: 'text/plain', expiresAtMs: 1000 });
  expect(issued.status).toBe('AVAILABLE');
  expect(Object.keys(records[0]!).sort()).toEqual(['bytes', 'digest', 'expiresAtMs', 'handle', 'mediaType', 'operation', 'owner', 'sourceInvocationId']);
  expect(records[0]).toMatchObject({ operation: 'read-result-range', expiresAtMs: 1000 });
  expect(records[0]).not.toHaveProperty('expiry');
  const compiled = createContextCompiler({ readSource: () => 'Aé漢🙂' }).compile({
    owner: { threadId: 'thread-v6', workspaceId: 'workspace-v6' },
    modelBinding: { modelId: 'model-v6', accountId: null },
    contextGeneration: 1, instructionDigest: 'instructions-v6', toolRegistryDigest: 'tools-v6',
    sources: [{ sequence: 1, id: 'source-v6', revision: 1, category: 'USER' }],
  });
  expect(compiled.modelBinding.accountId).toBeNull();
  expect(compiled.segments[0]).toMatchObject({ utf8Bytes: 10, tokens: null, measurement: 'BYTE_ONLY' });
  expect(compiled.budget.measurement).toBe('BYTE_ONLY');
  expect(compiled.nativeContext).toBeNull();
  const binding = { generation: 1, modelId: 'model-v6', accountId: null, workspaceId: 'workspace-v6', instructionDigest: 'instructions-v6', toolRegistryDigest: 'tools-v6', sourceCut: '1:1' };
  const candidate = previewCompaction({ binding, unresolvedRefs: ['constraint'], toolPairs: [{ call: 'call-1', result: 'result-1' }] });
  expect(Object.keys(candidate).sort()).toEqual(['binding', 'retained', 'status', 'toolPairs']);
  expect(['PREPARING', 'READY', 'DISCARDED', 'APPLIED', 'FAILED']).toContain(candidate.status);
  expect(M04_FLAG_KEYS.map(key => capabilityEnabled(key))).toEqual([false, false, false, false]);
  expect(() => __setCapabilityFlagForTests('context.notARealFlag' as never, true)).toThrow(/Unknown capability flag/);
});

it('D02: only the authorized live owner reads bytes, including when ownership changes while the read awaits', async () => {
  let now = 0, allowed = true;
  let release!: (bytes: Uint8Array | undefined) => void;
  const pending = new Promise<Uint8Array | undefined>(resolve => { release = resolve; });
  const stored = new Map<string, Uint8Array>();
  const vault = createContextResults({
    now: () => now, isAuthorized: () => allowed,
    storage: {
      put: async (key, bytes) => { stored.set(key, bytes.slice()); },
      get: async key => (stored.has(key) ? pending : undefined),
    },
  });
  const issued = await vault.spill({ owner, invocationId: 'invocation-d02', bytes: Buffer.from('authorized exact bytes'), mediaType: 'text/plain', expiresAtMs: 100 });
  const handle = issued.handle!;
  expect(issued.status).toBe('AVAILABLE');
  const foreign = await vault.read({ owner: { ...owner, accountId: 'foreign-account' }, handle, offset: 0, length: 4 });
  expect(foreign).toEqual({ status: 'UNAVAILABLE' });
  const late = vault.read({ owner, handle, offset: 0, length: 10 });
  allowed = false;
  release(stored.get(handle));
  expect(await late).toEqual({ status: 'UNAVAILABLE' });
  allowed = true;
  const exact = vault.read({ owner, handle, offset: 0, length: 10 });
  release(stored.get(handle));
  const range = await exact;
  expect(range).toMatchObject({ status: 'OK', totalBytes: 22, omittedBytes: 12 });
  if (range.status !== 'OK') throw new Error('authorized range missing');
  expect(Buffer.from(range.bytes).toString()).toBe('authorized');
  now = 100;
  expect(await vault.read({ owner, handle, offset: 0, length: 4 })).toEqual({ status: 'UNAVAILABLE' });
});

it('D03: previews split multibyte characters at both caps with valid UTF-8 and exact omitted bytes', async () => {
  const spillOf = async (bytes: Uint8Array) => {
    const vault = createContextResults({ now: () => 0, isAuthorized: () => true, storage: { put: async () => {}, get: async () => undefined } });
    return vault.spill({ owner, invocationId: 'invocation-d03', bytes, mediaType: 'text/plain', expiresAtMs: 1000 });
  };
  const short = Buffer.from('short λ result 🙂');
  const shortPreview = await spillOf(short);
  expect(shortPreview).toMatchObject({ status: 'AVAILABLE', omittedBytes: 0 });
  expect(shortPreview.preview).toBe(short.toString());
  const calibration = await spillOf(Buffer.from('a'.repeat(40000)));
  const marker = '\n[… result clipped …]\n';
  expect(calibration.preview).toContain(marker);
  const markerBytes = Buffer.byteLength(marker);
  const half = Math.floor((CONTEXT_PREVIEW_CAP_BYTES - markerBytes) / 2);
  const headText = 'a'.repeat(half - 1) + '🙂';
  const tailText = 'cc' + 'λ' + 'c'.repeat(half - 4) + 'END';
  const middle = 'b'.repeat(20000);
  const full = Buffer.from(headText + middle + tailText);
  const headBoundary = Buffer.byteLength(headText) - 3;
  expect(full[headBoundary]! & 0xc0).toBe(0x80);
  expect(full[full.length - half]! & 0xc0).toBe(0x80);
  const result = await spillOf(full);
  expect(result.status).toBe('AVAILABLE');
  expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(CONTEXT_PREVIEW_CAP_BYTES);
  const split = result.preview.split(marker);
  expect(split).toHaveLength(2);
  const [head, tail] = split as [string, string];
  expect(() => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(result.preview))).not.toThrow();
  expect(full.toString().startsWith(head)).toBe(true);
  expect(full.toString().endsWith(tail)).toBe(true);
  expect(Buffer.byteLength(head)).toBeLessThanOrEqual(8192);
  expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(8192);
  expect(head.endsWith('a')).toBe(true);
  expect(tail.startsWith('c')).toBe(true);
  expect(result.omittedBytes).toBe(full.length - Buffer.byteLength(head) - Buffer.byteLength(tail));
  expect(result.omittedBytes).toBeGreaterThan(0);
});

async function hermesFixture(extra: Partial<HermesRuntimeOptions> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'm04-v6-hermes-'));
  const events: RuntimeEvent[] = [];
  const sources: Array<{ options: ConstructorParameters<typeof import('../packages/runtime-hermes/client.ts').HermesClient>[0]; calls: Array<{ method: string; params: Record<string, unknown> }>; client: HermesSourceClient }> = [];
  const accounts = { get: () => null, claimUse: vi.fn(() => ({ id: 'lease', nonce: 'nonce' })), releaseUse: vi.fn() };
  const catalog: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  let externalCalls = 0;
  const runtime = createHermesRuntime({
    dataDir, nativeCatalog: catalog, accounts,
    hostTools: [
      { name: 'codemode', description: 'Script execution', parameters: { type: 'object' } },
      { name: 'bash', description: 'Shell', parameters: { type: 'object' } },
      { name: 'repository_status', description: 'Read tracked file status', parameters: { type: 'object' } },
      { name: 'host_task', description: 'Direct tool', parameters: { type: 'object' } },
    ], ...extra,
  }, {
    createClient(options) {
      const entry = { options, calls: [] as Array<{ method: string; params: Record<string, unknown> }>, client: {} as HermesSourceClient };
      entry.client = {
        request: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
          entry.calls.push({ method, params });
          if (method === 'hello') return { protocolVersion: 1, engineClass: 'run_agent.AIAgent', sourceCommit: 'c627ec84664d43e0b18b95d9d86d8963747d56c7' } as never;
          if (method === 'agent.start' || method === 'agent.followUp' || method === 'agent.cancel') return { accepted: true } as never;
          return {} as never;
        }), dispose: vi.fn(async () => {}),
      };
      sources.push(entry);
      return entry.client;
    },
    createNativeRuntime() {
      const entry: { callbacks?: RuntimeCallbacks; input?: StartRun; runtime: RuntimeAdapter } = { runtime: {} as RuntimeAdapter };
      entry.runtime = { configure: next => { entry.callbacks = next; }, models: async () => [], start: async input => { entry.input = input; }, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
      return entry.runtime;
    },
  });
  runtime.configure({ onEvent: event => events.push(event), onTool: async () => { externalCalls++; return { ok: true }; } });
  const source = () => sources.at(-1)!;
  const start = () => source().calls.filter(call => call.method === 'agent.start').at(-1)!.params;
  const call = (name: string, args: Record<string, unknown> = {}, scope?: Record<string, unknown>) =>
    source().options.onHostCall!({ id: name, name, args, ctx: scope ?? start().ctx as Record<string, unknown> });
  const settle = async () => {
    const ctx = start().ctx as Record<string, unknown>;
    source().options.onEvent?.({ event: 'foreground_settled', ctx: { ...ctx, phase: 'foreground' }, data: {} });
    source().options.onEvent?.({ event: 'settled', ctx: { ...ctx, phase: 'foreground' }, data: {} });
    await vi.waitFor(() => expect(runtime.reviewBusy).toBe(false));
  };
  return { runtime, call, start, settle, externalCalls: () => externalCalls };
}

it('D04: hidden tools cannot dispatch by direct name, script or child phase; the external-call counter stays zero', async () => {
  const f = await hermesFixture();
  __setCapabilityFlagForTests('context.compilerV1', true);
  __setCapabilityFlagForTests('tools.deferredV1', true);
  try {
    await f.runtime.start({ threadId: 'thread', runId: 'run', epoch: 1, inputId: 'input', modelId: 'openai/model', accountId: null, sessionPath: null, prompt: 'Original user prompt', resources: [] });
    const ctx = f.start().ctx as Record<string, unknown>;
    expect((f.start().hostTools as Array<{ name: string }>).map(tool => tool.name)).not.toContain('codemode');
    expect((f.start().hostTools as Array<{ name: string }>).map(tool => tool.name)).not.toContain('bash');
    await f.call('$context.tools.snapshot', { sequence: 1 });
    await expect(f.call('codemode')).rejects.toMatchObject({ code: 'HERMES_TOOL_DENIED' });
    await expect(f.call('bash')).rejects.toMatchObject({ code: 'HERMES_TOOL_DENIED' });
    await expect(f.call('codemode', { script: 'return host_task({})' })).rejects.toMatchObject({ code: 'HERMES_TOOL_DENIED' });
    await expect(f.call('context_describe_tool', { name: 'codemode' })).resolves.toBeNull();
    await expect(f.call('context_describe_tool', { name: 'bash' })).resolves.toBeNull();
    await expect(f.call('host_task', {}, { ...ctx, phase: 'background_review' })).rejects.toMatchObject({ code: 'HERMES_TOOL_DENIED' });
    await expect(f.call('codemode', {}, { ...ctx, phase: 'background_review' })).rejects.toMatchObject({ code: 'HERMES_TOOL_DENIED' });
    await expect(f.call('repository_status')).rejects.toMatchObject({ code: 'HERMES_TOOL_DENIED' });
    expect(f.externalCalls()).toBe(0);
    expect(await f.call('context_describe_tool', { name: 'repository_status' })).toMatchObject({ name: 'repository_status' });
    await f.call('$context.tools.snapshot', { sequence: 2 });
    await expect(f.call('repository_status')).resolves.toEqual({ ok: true });
    expect(f.externalCalls()).toBe(1);
    await f.settle();
  } finally {
    __setCapabilityFlagForTests('context.compilerV1', undefined);
    __setCapabilityFlagForTests('tools.deferredV1', undefined);
    await f.runtime.dispose();
  }
});

it('D05: observer failure leaves foreground bytes unchanged and a stale binding never calls native apply', async () => {
  const { createShadowRelevancePhase } = await import('../packages/core/context-relevance.ts') as {
    createShadowRelevancePhase: (options: { approval: { modelId: string; accountId: string; budgetCalls: number } | null; observe: (cut: unknown) => Promise<unknown> }) => { run(cut: unknown): Promise<{ status: string; observation: unknown }> };
  };
  const { applyCompactionCandidate } = await import('../packages/core/context-compaction.ts') as {
    applyCompactionCandidate: (input: { candidate: unknown; expected: unknown; current: unknown; cancelled: boolean; retainedTailBytes: number; maxRetainedTailBytes: number; nativeApply?: (candidate: unknown) => Promise<{ generation: number; usageObservationRef: string }> }) => Promise<{ status: string }>;
  };
  const foreground = Object.freeze({ prompt: 'foreground request bytes stay verbatim 🙂', segments: Object.freeze([{ id: 'user-1', bytes: 42 }]) });
  const serialized = JSON.stringify(foreground);
  const cut = Object.freeze({ cutId: 'd05-cut', retainedTailStart: 5, inspectionBudgetBytes: 100, segments: Object.freeze([{ id: 'old', inputSequence: 1, bytes: 10, kind: 'tool-result', completed: true, protected: false }]) });
  const phase = createShadowRelevancePhase({ approval: { modelId: 'aux', accountId: 'aux-account', budgetCalls: 1 }, observe: async () => { throw new Error('observer crashed'); } });
  expect(await phase.run(cut)).toMatchObject({ status: 'FAILED', observation: null });
  expect(JSON.stringify(foreground)).toBe(serialized);
  expect(JSON.stringify(cut)).toContain('d05-cut');
  const binding = { generation: 3, modelId: 'model-v6', accountId: 'account-v6', workspaceId: 'workspace-v6', instructionDigest: 'instructions-v6', toolRegistryDigest: 'tools-v6', sourceCut: '1:9' };
  const candidate = previewCompaction({ binding, unresolvedRefs: ['constraint'], toolPairs: [{ call: 'call-1', result: 'result-1' }] });
  let applyCalls = 0;
  const nativeApply = async () => { applyCalls++; return { generation: 4, usageObservationRef: 'usage-1' }; };
  const options = { candidate, expected: binding, cancelled: false, retainedTailBytes: 0, maxRetainedTailBytes: 1024, nativeApply };
  expect((await applyCompactionCandidate({ ...options, current: { ...binding, sourceCut: '1:10' } })).status).toBe('DISCARDED');
  expect((await applyCompactionCandidate({ ...options, current: { ...binding, accountId: 'other-account' } })).status).toBe('DISCARDED');
  expect(applyCalls).toBe(0);
  expect(candidate.status).toBe('READY');
});

it('D01: replays an identical prepared send once and rejects prompt or owner mutation before native dispatch', async () => {
  const { Service } = await import('../packages/core/service.ts');
  const { Store } = await import('../packages/storage/store.ts');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const base = mkdtempSync(join(tmpdir(), 'm04-d01-')), store = new Store(join(base, 'profile'));
  const starts: StartRun[] = [], followUps: StartRun[] = [];
  const runtime: RuntimeAdapter = {
    configure() {},
    models: vi.fn(async () => [{ id: 'test/model', provider: 'test', name: 'Fixture' }]),
    start: vi.fn(async (input: StartRun) => { starts.push(input); }),
    followUp: vi.fn(async (input: StartRun) => { followUps.push(input); }),
    cancel: vi.fn(async () => {}), compact: vi.fn(async () => {}), history: vi.fn(async () => []), dispose: vi.fn(async () => {}),
  };
  const service = new Service(store, runtime, { requestContextEnabled: true });
  try {
    const send = (type: string, payload: Record<string, unknown> = {}, threadId?: string, id: string = crypto.randomUUID()) => service.command({ id, type, threadId, payload });
    const thread = (await send('thread.create', {})).result as { id: string };
    const other = (await send('thread.create', {})).result as { id: string };
    const preparation = await service.prepareRequestContext(thread.id, 'Prepared send', { modelId: 'test/model' });
    const identity = JSON.parse(JSON.stringify({ requestId: preparation.requestId, contextGeneration: preparation.contextGeneration, promptDigest: preparation.promptDigest, bindingDigest: preparation.bindingDigest }));
    const commandId = crypto.randomUUID();
    const admitted = await send('message.send', { content: 'Prepared send', modelId: 'test/model', requestContextId: preparation.requestId }, thread.id, commandId);
    expect(await send('message.send', { content: 'Prepared send', modelId: 'test/model', requestContextId: preparation.requestId }, thread.id, commandId)).toEqual(admitted);
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    expect(followUps).toEqual([]);
    expect(store.all('outbox')).toHaveLength(1);
    await expect(send('message.send', { content: 'Prepared send', modelId: 'test/model', requestContextId: preparation.requestId }, thread.id)).rejects.toThrow();
    expect(JSON.parse(JSON.stringify({ requestId: preparation.requestId, contextGeneration: preparation.contextGeneration, promptDigest: preparation.promptDigest, bindingDigest: preparation.bindingDigest }))).toEqual(identity);
    const next = await service.prepareRequestContext(thread.id, 'Bound prompt', { modelId: 'test/model' });
    await expect(send('message.send', { content: 'Mutated prompt', modelId: 'test/model', requestContextId: next.requestId }, thread.id)).rejects.toThrow();
    await expect(send('message.send', { content: 'Bound prompt', modelId: 'test/model', requestContextId: next.requestId }, other.id)).rejects.toThrow();
    expect(starts).toHaveLength(1);
    expect(followUps).toEqual([]);
    expect(store.all('outbox')).toHaveLength(1);
  } finally {
    await service.dispose(); store.close(); rmSync(base, { recursive: true, force: true });
  }
});
