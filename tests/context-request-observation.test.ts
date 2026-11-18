import { testEffectAuthenticator } from './fixtures/effect-authenticator.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Service } from '../packages/core/service';
import { Store } from '../packages/storage/store';
import { capabilityEnabled, M04_FLAG_KEYS, __setCapabilityFlagForTests } from '../packages/core/capability-flags';
import type { RequestContextV1, RuntimeAdapter, RuntimeCallbacks, RunContext } from '../packages/contracts';
import { createInferenceBudgetLedger } from '../packages/runtime-hermes/context-budget';
import type { NativeCompactionEnvelopeV1, NativeCompactionReceiptV1, NativeCompactionOwnerV1 } from '../packages/contracts/native-compaction.ts';
import type { SourceRefV1 } from '../packages/contracts/source-selection.ts';

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
  const budget = createInferenceBudgetLedger(null).preview({ sequence: 4, inputIds: ['input'], phase: 'foreground' }, 13);
  const observedBudget = () => store.get<{ value: { inferenceBudget?: unknown } }>('usage', ctx.threadId)?.value?.inferenceBudget;
  expect(M04_FLAG_KEYS.map(key => capabilityEnabled(key))).toEqual([false, false, false, false]);
  emit(1);
  callbacks.onEvent({ ...ctx, type: 'context.budget', provider: 'hermes', budget });
  expect(observed()).toBeUndefined();
  expect(observedBudget()).toBeUndefined();
  __setCapabilityFlagForTests('context.compilerV1', true);
  callbacks.onEvent({ ...ctx, epoch: 3, type: 'context.budget', provider: 'hermes', budget });
  callbacks.onEvent({ ...ctx, type: 'context.budget', provider: 'hermes', budget: { ...budget, rawText: 'synthetic private text' } });
  expect(observedBudget()).toBeUndefined();
  callbacks.onEvent({ ...ctx, type: 'context.budget', provider: 'hermes', budget });
  callbacks.onEvent({ ...ctx, type: 'context.budget', provider: 'hermes', budget: { ...budget, sequence: 3 } });
  callbacks.onEvent({ ...ctx, type: 'usage', usage: { inferenceBudget: { rawText: 'synthetic private text' } } });
  expect(observedBudget()).toEqual({ ...ctx, budget });
  emit(4, { epoch: 3 }); expect(observed()).toBeUndefined();
  emit(4, { promptBytes: -1 }); expect(observed()).toBeUndefined();
  emit(4); emit(3);
  expect(observed()).toEqual({ ...ctx, sequence: 4, promptBytes: 13, knownInputs: 1, visibility: 'OPAQUE_NATIVE_CONTEXT', source: 'hermes' });
  callbacks.onEvent({ ...ctx, type: 'usage', usage: { lastRequest: { rawText: 'synthetic private text' } } });
  expect(observed()).toMatchObject({ sequence: 4, promptBytes: 13 });
  const nativeSources = { source: 'ORIGINAL_ACP_MESSAGES', measurement: 'BYTE_ONLY', generation: 1, revisionDigest: 'a'.repeat(64), change: 'RESET', sourceCount: 1, sourceBytes: 30,
    reusedSources: 0, compiledSources: 1, inspectedSources: 1, newToolResults: null, newToolResultBytes: null,
    sources: [{ category: 'USER', sourceId: 'native:1:0', sourceRevision: 1, utf8Bytes: 30, sha256: 'b'.repeat(64) }], omittedSources: 0 };
  emit(5, { nativeSources }); expect(observed()).toMatchObject({ sequence: 5, nativeSources, visibility: 'OPAQUE_NATIVE_CONTEXT' });
  emit(6, { nativeSources: { ...nativeSources, rawText: 'synthetic private text' } });
  expect(observed()).toMatchObject({ sequence: 6, nativeSourcesUnavailable: 'UNSUPPORTED_SOURCE' }); expect(observed()).not.toHaveProperty('nativeSources');
  expect(JSON.stringify(store.eventsAfter(0))).not.toContain('synthetic private text');
});

it('spills only large catalog results and retrieves the exact range under the same live owner', async () => {
  const path = mkdtempSync(join(tmpdir(), 'm04-catalog-')), store = new Store(path);
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {},
    followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true }, toolEffectAuthenticator: testEffectAuthenticator() });
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

it('captures the automatic compaction requirement from the host flag without adding model-visible instructions', async () => {
  async function submit(enabled: boolean) {
    const directory=mkdtempSync(join(tmpdir(),'m04-auto-policy-')),store=new Store(directory);
    let captured:import('../packages/contracts').StartRun|undefined,callbacks!:RuntimeCallbacks;
    const runtime:RuntimeAdapter={configure:next=>{callbacks=next;},models:async()=>[{id:'test/model',name:'Fixture',provider:'test'}],start:async input=>{captured=input;},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
    const service=new Service(store,runtime);
    __setCapabilityFlagForTests('context.lossAwareCompactionV1',enabled);
    try{
      store.internal('fixture','auto-policy',()=>{
        store.put('thread','auto-policy','auto-policy',{id:'auto-policy',title:'Fixture',runId:null,epoch:1,status:'ready',modelId:'test/model',projectName:null,sessionPath:null,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'});
        store.put('outbox','auto-input','auto-policy',{id:'auto-input',threadId:'auto-policy',content:'Keep the original source unchanged.',status:'persisted',runId:null});
      });
      const deliver=Reflect.get(service,'deliverOutbox') as (id:string)=>Promise<void>;
      await deliver.call(service,'auto-policy');
      expect(captured).toBeDefined();
      const {threadId,runId,epoch,modelId}=captured!,ctx={threadId,runId,epoch},sessionPath='/fixture/auto-session';
      callbacks.onEvent({...ctx,type:'session',sessionPath});
      const before=store.sequence,generation=store.get('requestContextGeneration',threadId),usage=store.get('usage',threadId);
      const refusal={version:1,status:'REFUSED',reason:'AUTOMATIC_PROTECTION_UNAVAILABLE',method:'compress',trigger:'pre_api',
        owner:{ctx,sessionPath,modelId,accountId:null}};
      callbacks.onEvent({...ctx,type:'context.compaction.refused',refusal});
      for(const invalid of [{...refusal,status:'APPLIED'},{...refusal,owner:{...refusal.owner,sessionPath:'/another-session'}},
        {...refusal,owner:{...refusal.owner,accountId:'other-account'}},{...refusal,owner:{...refusal.owner,ctx:{...ctx,runId:'another-run'}}}])
        callbacks.onEvent({...ctx,type:'context.compaction.refused',refusal:invalid});
      const events=store.eventsAfter(before),accepted=events.filter(event=>event.type==='runtime.context.compaction.refused')
        .flatMap(event=>{const result=(event.payload as {result:{refusal?:unknown}}).result;return result.refusal?[result.refusal]:[];});
      expect(accepted).toEqual(enabled?[refusal]:[]);
      expect(events.some(event=>['runtime.compaction.start','runtime.compaction.end','context.compaction.applied'].includes(event.type))).toBe(false);
      expect(store.get('requestContextGeneration',threadId)).toEqual(generation);
      expect(store.get('usage',threadId)).toEqual(usage);
      return captured!;
    }finally{__setCapabilityFlagForTests('context.lossAwareCompactionV1',undefined);await service.dispose();store.close();rmSync(directory,{recursive:true,force:true,maxRetries:5});}
  }
  const disabled=await submit(false),enabled=await submit(true);
  expect(disabled).not.toHaveProperty('automaticCompactionProtection');
  expect(enabled.automaticCompactionProtection).toEqual({apiVersion:1,required:true});
  expect(enabled.prompt).toBe(disabled.prompt);
  expect(enabled).toMatchObject({threadId:'auto-policy',runId:expect.any(String),epoch:2,modelId:'test/model',accountId:null});
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

const nativeSnapshot = () => ({sha256: 'd'.repeat(64), messages: [
  {role: 'user', content: 'Preserve the public API requirement.'},
  {role: 'assistant', content: 'Completed investigation. '.repeat(600)},
  {role: 'user', content: 'Continue the current task.'},
  {role: 'assistant', content: 'Recent response.'},
]});
const nativeProof = (envelope: NativeCompactionEnvelopeV1): NativeCompactionReceiptV1 => ({
  version: 1, candidateId: envelope.plan.candidateId, planDigest: envelope.planDigest, sourceSha256: envelope.plan.sourceSha256,
  status: 'APPLIED', archiveRef: 'native-archive:' + envelope.plan.sourceSha256, archiveSha256: envelope.plan.sourceSha256,
  retainedBytes: 4096, protectedRecords: envelope.plan.retainedIndices.length, referenceCount: envelope.plan.references.length,
  toolPairs: 0, beforeBytes: 20000, afterBytes: 8192, summarySha256: 'f'.repeat(64), reason: null,
});
const commitRequest = (envelope: NativeCompactionEnvelopeV1) => ({version: 1 as const, candidateId: envelope.plan.candidateId,
  planDigest: envelope.planDigest, sourceSha256: envelope.plan.sourceSha256, owner: structuredClone(envelope.plan.owner)});

async function ownedCompactionFixture(requestContextEnabled = false) {
  const directory = mkdtempSync(join(tmpdir(), 'm04-owned-compaction-'));
  let store = new Store(directory);
  const threadId = 'owned-compaction';
  let callbacks!: RuntimeCallbacks;
  const confirm = (ctx: RunContext, envelope: NativeCompactionEnvelopeV1) => {
    expect(callbacks.onCompactionCommit!(commitRequest(envelope))).toEqual({version: 1, accepted: true, planDigest: envelope.planDigest});
    callbacks.onEvent({...ctx, type: 'usage', usage: {inputTokens: 123, outputTokens: 17, cost: 0.02}});
    callbacks.onEvent({...ctx, type: 'compaction.end', reason: 'manual', aborted: false});
    callbacks.onEvent({...ctx, type: 'settled', aborted: false});
    return nativeProof(envelope);
  };
  const protectedCompact: NonNullable<RuntimeAdapter['compactProtected']> = async (ctx, _path, _model, _account, envelope) => {
    callbacks.onEvent({...ctx, type: 'compaction.start', reason: 'manual'});
    return confirm(ctx, envelope);
  };
  const runtime: RuntimeAdapter = {
    configure: value => {callbacks = value;}, models: async () => [{id: 'test/model', provider: 'test', name: 'Fixture model'}],
    start: vi.fn(async () => {}), followUp: async () => {}, cancel: vi.fn(async () => {}), history: async () => [], dispose: async () => {},
    compact: vi.fn(async () => {throw new Error('Loss-aware compaction reached the legacy path.');}),
    compactProtected: vi.fn(protectedCompact), nativeHistoryDigest: vi.fn(async () => nativeSnapshot()),
  };
  let service = new Service(store, runtime, {requestContextEnabled});
  store.internal('fixture', threadId, () => {
    store.put('thread', threadId, threadId, {id: threadId, title: 'Fixture', runId: null, epoch: 4, status: 'ready', modelId: 'test/model', accountId: null,
      sessionPath: '/owned-session', projectName: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'});
    store.put('requestContextReceipt', 'receipt-' + threadId, threadId, compactionReceipt(threadId));
    store.put('requestContextGeneration', threadId, threadId, {generation: 1});
  });
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
  cleanup.push(async () => {
    __setCapabilityFlagForTests('context.lossAwareCompactionV1', undefined);
    __setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);
    await service.dispose(); store.close(); rmSync(directory, {recursive: true, force: true, maxRetries: 5});
  });
  const command = {id: 'owned-compact', type: 'run.compact', threadId, payload: {}};
  return {get service(){return service;}, get store(){return store;}, runtime, threadId, command, callbacks: () => callbacks, confirm,
    async restart(){await service.dispose();store.close();store=new Store(directory);service=new Service(store,runtime,{requestContextEnabled});}};
}
type CompactionFixture = Awaited<ReturnType<typeof ownedCompactionFixture>>;
async function captureMessage(f: CompactionFixture, id: string): Promise<SourceRefV1> {
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  const content = 'Captured assistant evidence ' + id, logicalOwner = f.service.sourceWorkbench.owner(f.threadId);
  f.store.internal('fixture.source', f.threadId, () => f.store.put('message', id, f.threadId, {id, threadId: f.threadId, role: 'assistant', content, runId: 'old', createdAt: '2026-01-01T00:00:00Z'}));
  const descriptor = await f.service.sourceWorkbench.describe({logicalOwner, locator: {kind: 'MESSAGE', sourceId: id}});
  return (await f.service.sourceWorkbench.capture({commandId: 'capture-' + id, source: {kind: 'MESSAGE', sourceId: id,
    sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, logicalOwner, capturedAt: '2026-01-01T00:00:00.000Z',
    range: {encoding: 'UTF16', start: 0, end: content.length, selectedTextDigest: createHash('sha256').update(content).digest('hex')}}})).ref;
}
function deliveredSource(f: CompactionFixture, id: string, ref: SourceRefV1) {
  f.store.internal('input.processing', f.threadId, () => {
    f.store.put('outbox', id, f.threadId, {...f.store.get<Record<string, unknown>>('outbox', id), id, threadId: f.threadId, status: 'handled', runId: 'source-' + id, enteredRuntime: true, sourceRefs: [ref]});
    return {runId: 'source-' + id, inputIds: [id]};
  });
}

it('counts every recorded admitted compaction candidate beyond eight and across host restart', async () => {
  const f = await ownedCompactionFixture();
  let attempts = 0;
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {
    if (++attempts <= 4) throw new Error('Native candidate failed before application.');
    return f.confirm(ctx, envelope);
  });
  for (let index = 0; index < 12; index++) {
    const work = f.service.command({...f.command, id: 'recorded-' + index});
    if (index < 4) await expect(work).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
    else await work;
  }
  const projection = () => f.store.snapshot().usage[f.threadId].compaction!;
  expect(projection().accounting).toEqual({attempts: 12, failed: 4, discarded: 0, costBytes: 0});
  expect(projection().candidates).toHaveLength(8);
  expect(projection().candidates.every(candidate => candidate.status === 'APPLIED')).toBe(true);
  const before = projection();
  await f.restart();
  expect(projection()).toEqual(before);
  await f.service.command({...f.command, id: 'recorded-11'});
  expect(attempts).toBe(12);
  expect(projection()).toEqual(before);
  await f.service.command({...f.command, id: 'recorded-after-restart'});
  expect(projection().accounting).toEqual({attempts: 13, failed: 4, discarded: 0, costBytes: 0});
});

it.each(['projectId', 'workspaceId', 'modelId', 'accountId', 'sessionPath'] as const)('keeps recorded compaction facts private after a same-thread %s change', async field => {
  const f = await ownedCompactionFixture();
  await f.service.command(f.command);
  const before = f.store.snapshot().usage[f.threadId].compaction;
  const original = f.store.get<import('../packages/contracts').Thread>('thread', f.threadId)!;
  f.store.internal('fixture.owner.changed', f.threadId, () => f.store.put('thread', f.threadId, f.threadId, {...original, [field]: 'another-owner'}));
  expect(f.store.snapshot().usage[f.threadId].compaction).toBeUndefined();
  expect(f.store.get<{value: import('../packages/contracts').RuntimeUsage}>('usage', f.threadId)?.value.compaction).toBeUndefined();
  expect(f.store.all('compactionUsage', f.threadId)).toHaveLength(1);
  f.store.internal('fixture.owner.restored', f.threadId, () => f.store.put('thread', f.threadId, f.threadId, original));
  expect(f.store.snapshot().usage[f.threadId].compaction).toEqual(before);
  expect(f.runtime.compactProtected).toHaveBeenCalledOnce();
});

it('counts recorded candidates for the admitted account separately from the selected default and another saved account', async () => {
  const f = await ownedCompactionFixture();
  const create = async (id: string) => (await f.service.command({id, type: 'account.create', payload: {providerId: 'openai', label: id}})).result as {id: string};
  const first = await create('recorded-first'), second = await create('recorded-second');
  await f.service.command({id: 'recorded-default', type: 'account.select', payload: {providerId: 'openai', accountId: second.id}});
  const selectOwner = (accountId: string) => f.store.internal('fixture.recorded-account', f.threadId, () => {
    f.store.put('thread', f.threadId, f.threadId, {...f.service.thread(f.threadId), modelId: 'openai/model', accountId});
    f.store.put('requestContextReceipt', 'receipt-' + f.threadId, f.threadId, {receipt: {...compactionReceipt(f.threadId).receipt, modelBinding: {modelId: 'openai/model', accountId}}});
  });
  let calls = 0;
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {
    if (++calls === 2) throw new Error('The second recorded candidate failed.');
    return f.confirm(ctx, envelope);
  });
  selectOwner(first.id);
  await f.service.command({...f.command, id: 'recorded-first-applied'});
  await expect(f.service.command({...f.command, id: 'recorded-first-failed'})).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
  expect(f.store.snapshot().usage[f.threadId].compaction?.accounting).toEqual({attempts: 2, failed: 1, discarded: 0, costBytes: 0});
  selectOwner(second.id);
  expect(f.store.snapshot().usage[f.threadId].compaction).toBeUndefined();
  await f.service.command({...f.command, id: 'recorded-second-applied'});
  expect(f.store.snapshot().usage[f.threadId].compaction?.accounting).toEqual({attempts: 1, failed: 0, discarded: 0, costBytes: 0});
  selectOwner(first.id);
  expect(f.store.snapshot().usage[f.threadId].compaction?.accounting).toEqual({attempts: 2, failed: 1, discarded: 0, costBytes: 0});
  expect(calls).toBe(3);
  expect(f.store.snapshot().settings.selectedAccounts?.openai).toBe(second.id);
});

it.each(['before native receipt', 'after native receipt'] as const)('restores admitted candidate facts %s without replaying native work', async cut => {
  const f = await ownedCompactionFixture(), directory = mkdtempSync(join(tmpdir(), 'm04-restored-candidate-'));
  let copied = false;
  const capture = () => {f.store.db.prepare('VACUUM INTO ?').run(join(directory, 'harness.sqlite'));copied = true;};
  const unsubscribe = f.store.subscribe(event => {if (cut === 'after native receipt' && event.type === 'context.compaction.applied') capture();});
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {
    if (cut === 'before native receipt') {capture();throw new Error('The original process did not return a native receipt.');}
    return f.confirm(ctx, envelope);
  });
  try {
    const work = f.service.command(f.command);
    if (cut === 'before native receipt') await expect(work).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
    else await work;
    expect(copied).toBe(true);
    const restoredStore = new Store(directory), restoredRuntime: RuntimeAdapter = {...f.runtime,
      start: vi.fn(async () => {}), compactProtected: vi.fn(async () => {throw new Error('Recovery must not invoke native compaction.');}), configure: () => {}};
    const restoredService = new Service(restoredStore, restoredRuntime);
    try {
      await restoredService.recover();
      const projection = restoredStore.snapshot().usage[f.threadId].compaction!;
      expect(projection.accounting).toEqual({attempts: 1, failed: 0, discarded: 0, costBytes: 0});
      expect(projection.candidates).toEqual([expect.objectContaining(cut === 'after native receipt' ?
        {status: 'APPLIED', verdict: 'APPLIED', measuredBeforeBytes: 20000, measuredAfterBytes: 8192} :
        {status: 'READY', verdict: null, measuredBeforeBytes: null, measuredAfterBytes: null})]);
      const candidate = projection.candidates[0];
      expect(candidate.metadata.usageObservationRef).toBe(cut === 'after native receipt' ? `compactionUsage:${candidate.metadata.candidateId}` : null);
      expect(restoredStore.get('compactionAttempt', candidate.metadata.candidateId)).toMatchObject({metadata: candidate.metadata});
      if (cut === 'after native receipt') expect(restoredStore.get('compactionUsage', candidate.metadata.candidateId)).toMatchObject({
        id: candidate.metadata.candidateId, threadId: f.threadId, nativeReceipt: {candidateId: candidate.metadata.candidateId, status: 'APPLIED'}});
      expect(restoredService.thread(f.threadId)).toMatchObject(cut === 'before native receipt' ?
        {runId: null, epoch: 6, status: 'interrupted'} : {runId: null, epoch: 5, status: 'ready'});
      expect(restoredRuntime.start).not.toHaveBeenCalled();
      expect(restoredRuntime.compactProtected).not.toHaveBeenCalled();
    } finally {await restoredService.dispose();restoredStore.close();}
  } finally {unsubscribe();rmSync(directory, {recursive: true, force: true, maxRetries: 5});}
});

it('applies only the protected source-cut CAS and records the exact native receipt', async () => {
  const f = await ownedCompactionFixture();
  await f.service.command(f.command);
  expect(f.runtime.compact).not.toHaveBeenCalled();
  expect(f.runtime.nativeHistoryDigest).toHaveBeenCalledOnce();
  const envelope = vi.mocked(f.runtime.compactProtected!).mock.calls[0][4];
  expect(envelope.plan.sourceSha256).toBe('d'.repeat(64));
  expect(envelope.plan.retainedIndices).toEqual([0, 2, 3]);
  expect(envelope.plan.owner).toMatchObject({threadId: f.threadId, runId: expect.stringMatching(/^compaction:/), epoch: 5,
    workspaceId: 'thread:' + f.threadId, modelId: 'test/model', accountId: null, generation: 1});
  const usage = f.store.get<{value: {compaction: {candidates: unknown[]}}}>('usage', f.threadId);
  expect(usage?.value.compaction.candidates).toEqual([expect.objectContaining({status: 'APPLIED', verdict: 'APPLIED', measuredBeforeBytes: 20000, measuredAfterBytes: 8192,
    metadata: expect.objectContaining({sourceInterval: null, usageObservationRef: `compactionUsage:${envelope.plan.candidateId}`}), retainedConstraints: expect.arrayContaining(['native-record:' + 'd'.repeat(64) + ':0'])})]);
  expect(f.store.get('compactionAttempt', envelope.plan.candidateId)).toMatchObject({metadata: {usageObservationRef: `compactionUsage:${envelope.plan.candidateId}`}});
  expect(f.store.all('compactionUsage', f.threadId)).toEqual([expect.objectContaining({nativeReceipt: nativeProof(envelope), settled: true})]);
});

it('requires the protected adapter even when a native history reader exists', async () => {
  const f = await ownedCompactionFixture(); delete f.runtime.compactProtected;
  const sequence = f.store.sequence;
  await expect(f.service.command(f.command)).rejects.toMatchObject({code: 'UNSUPPORTED_COMPACTION'});
  expect(f.runtime.compact).not.toHaveBeenCalled();
  expect(f.runtime.nativeHistoryDigest).not.toHaveBeenCalled();
  expect(f.store.sequence).toBe(sequence);
});

it('records a failed verdict when the native source-cut CAS refuses', async () => {
  const f = await ownedCompactionFixture();
  vi.mocked(f.runtime.compactProtected!).mockRejectedValue(Object.assign(new Error('Native history changed.'), {code: 'HERMES_COMPACTION_MISMATCH'}));
  await expect(f.service.command(f.command)).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
  const usage = f.store.get<{value: {compaction: {candidates: unknown[]}}}>('usage', f.threadId);
  expect(usage?.value.compaction.candidates).toEqual([expect.objectContaining({status: 'FAILED', verdict: 'FAILED', measuredBeforeBytes: null,
    metadata: expect.objectContaining({usageObservationRef: null})})]);
  expect(f.service.thread(f.threadId)).toMatchObject({status: 'ready', runId: null});
});

it('owns native compaction callbacks and advances durable generation once', async () => {
  const f = await ownedCompactionFixture();
  await f.service.command(f.command);
  expect(f.store.get<{value: unknown}>('usage', f.threadId)?.value).toMatchObject({inputTokens: 123, outputTokens: 17, cost: 0.02, activity: 'idle'});
  expect(f.service.thread(f.threadId)).toMatchObject({runId: null, epoch: 5, status: 'ready'});
  expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({generation: 2});
  await f.service.command(f.command);
  expect(f.runtime.compactProtected).toHaveBeenCalledOnce();
});

it.each(['legacy', 'saved'] as const)('preserves the %s session account when a provider default is selected', async mode => {
  const f = await ownedCompactionFixture();
  const create = async (id: string) => (await f.service.command({id, type: 'account.create', payload: {providerId: 'openai', label: id}})).result as {id: string};
  const selected = await create('default-account'), saved = await create('session-account');
  await f.service.command({id: 'select-default', type: 'account.select', payload: {providerId: 'openai', accountId: selected.id}});
  const expectedAccount = mode === 'saved' ? saved.id : null;
  f.store.internal('fixture.account-binding', f.threadId, () => {
    const {accountId: _accountId, ...thread} = f.service.thread(f.threadId);
    f.store.put('thread', f.threadId, f.threadId, {...thread, modelId: 'openai/model', ...(mode === 'saved' ? {accountId: saved.id} : {})});
    f.store.put('requestContextReceipt', 'receipt-' + f.threadId, f.threadId, {receipt: {...compactionReceipt(f.threadId).receipt, modelBinding: {modelId: 'openai/model', accountId: expectedAccount}}});
  });
  await f.service.command(f.command);
  const thread = f.service.thread(f.threadId);
  expect(Object.hasOwn(thread, 'accountId')).toBe(mode === 'saved');
  expect(thread.accountId).toBe(mode === 'saved' ? saved.id : undefined);
  expect(f.runtime.compactProtected).toHaveBeenCalledWith(expect.objectContaining({accountId: expectedAccount}), '/owned-session', 'openai/model', expectedAccount,
    expect.objectContaining({plan: expect.objectContaining({sourceSha256: 'd'.repeat(64), owner: expect.objectContaining({accountId: expectedAccount})})}), undefined);
  expect(f.store.snapshot().settings.selectedAccounts?.openai).toBe(selected.id);
});

it.each(['before source admission', 'after native application'] as const)('delivers queued input %s only after recording the compaction result', async timing => {
  const f = await ownedCompactionFixture();
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  let releaseSnapshot!: (value: ReturnType<typeof nativeSnapshot>) => void, releaseResult!: () => void, applied = false;
  const snapshot = new Promise<ReturnType<typeof nativeSnapshot>>(resolve => {releaseSnapshot = resolve;});
  const result = new Promise<void>(resolve => {releaseResult = resolve;});
  vi.mocked(f.runtime.nativeHistoryDigest!).mockReturnValueOnce(snapshot);
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {
    const proof = f.confirm(ctx, envelope); applied = true; await result; return proof;
  });
  let stateAtStart: unknown;
  vi.mocked(f.runtime.start).mockImplementation(async () => {stateAtStart = {generation: f.store.get('requestContextGeneration', f.threadId), usage: f.store.get('usage', f.threadId)};});
  const compacted = f.service.command(f.command).then(() => 'APPLIED', () => 'FAILED');
  const queue = () => f.service.command({id: 'queued-after-compaction', type: 'message.send', threadId: f.threadId, payload: {content: 'Continue after compaction', modelId: 'test/model', sendMode: 'AFTER_CURRENT'}});
  try {
    await vi.waitFor(() => expect(f.runtime.nativeHistoryDigest).toHaveBeenCalledOnce());
    if (timing === 'before source admission') await queue();
    releaseSnapshot(nativeSnapshot());
    await vi.waitFor(() => expect(applied).toBe(true));
    if (timing === 'after native application') await queue();
    expect(f.runtime.start).not.toHaveBeenCalled();
    expect(f.store.get('outbox', 'queued-after-compaction')).toMatchObject({status: 'persisted', runId: null});
    releaseResult(); expect(await compacted).toBe('APPLIED');
    await vi.waitFor(() => expect(f.runtime.start).toHaveBeenCalledOnce());
    expect(stateAtStart).toMatchObject({generation: {generation: 2}, usage: {value: {compaction: {candidates: [expect.objectContaining({status: 'APPLIED', verdict: 'APPLIED'})]}}}});
    expect(f.service.thread(f.threadId)).toMatchObject({epoch: 6, status: 'working'});
  } finally {releaseSnapshot(nativeSnapshot()); releaseResult(); await compacted;}
});

it.each(['prepared input', 'stop', 'model'] as const)('retains native application when %s changes after the commit but before receipt return', async change => {
  const f = await ownedCompactionFixture(change === 'prepared input');
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  let release!: () => void, applied = false;
  const result = new Promise<void>(resolve => {release = resolve;});
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {
    const proof = f.confirm(ctx, envelope); applied = true; await result; return proof;
  });
  const compacted = f.service.command(f.command).then(() => 'APPLIED', () => 'FAILED');
  try {
    await vi.waitFor(() => expect(applied).toBe(true));
    if (change === 'prepared input') await f.service.command({id: 'queued-prepared-input', type: 'message.send', threadId: f.threadId, payload: {content: 'Continue with prepared context', modelId: 'test/model', sendMode: 'AFTER_CURRENT'}});
    else if (change === 'stop') await f.service.command({id: 'stop-after-native-apply', type: 'run.stop', threadId: f.threadId, payload: {}});
    else f.store.internal('owner.model-changed', f.threadId, () => f.store.put('thread', f.threadId, f.threadId, {...f.service.thread(f.threadId), modelId: 'test/other'}));
    expect(f.runtime.start).not.toHaveBeenCalled();
    release(); expect(await compacted).toBe('APPLIED');
    expect(f.store.all('compactionUsage', f.threadId)).toEqual([expect.objectContaining({beforeBytes: 20000, afterBytes: 8192,
      nativeReceipt: expect.objectContaining({status: 'APPLIED'})})]);
    const projection = f.store.snapshot().usage[f.threadId].compaction;
    if (change === 'model') expect(projection).toBeUndefined();
    else expect(projection?.candidates).toEqual([expect.objectContaining({status: 'APPLIED', verdict: 'APPLIED', measuredBeforeBytes: 20000, measuredAfterBytes: 8192})]);
    if (change === 'prepared input') {
      await vi.waitFor(() => expect(f.runtime.start).toHaveBeenCalledOnce());
      expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({generation: 3});
    } else {
      expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({generation: 2});
      expect(f.service.thread(f.threadId)).toMatchObject(change === 'stop' ? {status: 'stopped', runId: null} : {modelId: 'test/other', runId: null});
    }
  } finally {release(); await compacted;}
});

it('rejects a queued draft generation that changes before the native commit gate', async () => {
  const f = await ownedCompactionFixture(true);
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  let release!: () => void;
  const beforeCommit = new Promise<void>(resolve => {release = resolve;});
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {await beforeCommit; return f.confirm(ctx, envelope);});
  const compacted = f.service.command(f.command).then(() => 'APPLIED', () => 'FAILED');
  try {
    await vi.waitFor(() => expect(f.runtime.compactProtected).toHaveBeenCalledOnce());
    await f.service.command({id: 'queued-before-commit', type: 'message.send', threadId: f.threadId, payload: {content: 'Continue with this queued draft', modelId: 'test/model', sendMode: 'AFTER_CURRENT'}});
    expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({generation: 2});
    expect(f.runtime.start).not.toHaveBeenCalled();
    release(); expect(await compacted).toBe('FAILED');
    expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
    expect(f.store.get('outbox', 'queued-before-commit')).toMatchObject({content: 'Continue with this queued draft'});
    expect(f.store.get<{enteredRuntime?: boolean}>('outbox', 'queued-before-commit')?.enteredRuntime).not.toBe(true);
    expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({generation: 2});
  } finally {release(); await compacted;}
});

it('returns the same admitted compaction through authenticated HTTP and exposes its measured result', async () => {
  const f = await ownedCompactionFixture(), {buildServer} = await import('../apps/server/server.ts');
  const app = await buildServer(f.service, {port: 4317, dev: false});
  try {
    const host = {host: '127.0.0.1:4317'};
    expect((await app.inject({method: 'POST', url: '/api/commands', headers: host, payload: f.command})).statusCode).toBe(401);
    const bootstrap = await app.inject({url: '/api/bootstrap', headers: host});
    const headers = {...host, cookie: String(bootstrap.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.json().csrfToken};
    const first = await app.inject({method: 'POST', url: '/api/commands', headers, payload: f.command});
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({method: 'POST', url: '/api/commands', headers, payload: f.command});
    expect(replay.statusCode).toBe(200); expect(replay.json()).toEqual(first.json());
    expect(f.runtime.compactProtected).toHaveBeenCalledOnce();
    const snapshot = (await app.inject({url: '/api/snapshot', headers})).json();
    expect(snapshot.usage[f.threadId]).toMatchObject({inputTokens: 123, outputTokens: 17, cost: 0.02,
      compaction: {candidates: [expect.objectContaining({status: 'APPLIED', verdict: 'APPLIED', measuredBeforeBytes: 20000, measuredAfterBytes: 8192})]}});
  } finally {await app.close();}
});

it.each(['silent', 'settled without compaction', 'failed', 'receipt without host admission'] as const)('rejects a %s native result', async result => {
  const f = await ownedCompactionFixture();
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {
    if (result === 'settled without compaction') f.callbacks().onEvent({...ctx, type: 'settled', aborted: false});
    if (result === 'failed') f.callbacks().onEvent({...ctx, type: 'error', message: 'Native compaction failed'});
    return result === 'receipt without host admission' ? nativeProof(envelope) : undefined as unknown as NativeCompactionReceiptV1;
  });
  await expect(f.service.command(f.command)).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
  expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
  expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({generation: 1});
});

it.each(['stop', 'account', 'model', 'thinking', 'workspace', 'session', 'generation', 'receipt'] as const)('refuses compaction when %s changes while the source snapshot is pending', async change => {
  const f = await ownedCompactionFixture();
  let release!: (value: ReturnType<typeof nativeSnapshot>) => void;
  const snapshot = new Promise<ReturnType<typeof nativeSnapshot>>(resolve => {release = resolve;});
  vi.mocked(f.runtime.nativeHistoryDigest!).mockReturnValueOnce(snapshot);
  const result = f.service.command(f.command).then(() => 'APPLIED', () => 'REFUSED');
  await vi.waitFor(() => expect(f.runtime.nativeHistoryDigest).toHaveBeenCalledOnce());
  if (change === 'stop') await f.service.command({id: 'stop-compaction', type: 'run.stop', threadId: f.threadId, payload: {}});
  else if (change === 'generation') f.store.internal('generation-changed', f.threadId, () => f.store.put('requestContextGeneration', f.threadId, f.threadId, {generation: 2}));
  else if (change === 'receipt') f.store.internal('receipt-changed', f.threadId, () => f.store.put('requestContextReceipt', 'new-receipt', f.threadId, {receipt: {...compactionReceipt(f.threadId).receipt, requestId: 'new-receipt'}}));
  else f.store.internal('owner-changed', f.threadId, () => f.store.put('thread', f.threadId, f.threadId, {...f.service.thread(f.threadId),
    ...({account: {accountId: 'other-account'}, model: {modelId: 'test/other'}, thinking: {thinkingLevel: 'high'}, workspace: {workspaceId: 'other-workspace'}, session: {sessionPath: '/other-session'}}[change])}));
  release(nativeSnapshot()); expect(await result).toBe('REFUSED');
  expect(f.runtime.compactProtected).not.toHaveBeenCalled();
  expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
});

it.each(['threadId', 'runId', 'epoch', 'workspaceId', 'generation', 'instructionDigest', 'toolRegistryDigest', 'modelId', 'accountId'] as const)
  ('rejects a private commit with wrong %s even if the adapter returns an applied receipt', async field => {
    const f = await ownedCompactionFixture();
    vi.mocked(f.runtime.compactProtected!).mockImplementation(async (_ctx, _path, _model, _account, envelope) => {
      const request = commitRequest(envelope), changed: NativeCompactionOwnerV1 = {...request.owner,
        [field]: field === 'epoch' || field === 'generation' ? request.owner[field] + 1 : field.endsWith('Digest') ? 'e'.repeat(64) : 'other-owner'};
      expect(() => f.callbacks().onCompactionCommit!({...request, owner: changed})).toThrow(expect.objectContaining({code: 'HERMES_COMPACTION_OWNER'}));
      expect(() => f.callbacks().onCompactionCommit!(request)).toThrow(expect.objectContaining({code: 'HERMES_COMPACTION_OWNER'}));
      return nativeProof(envelope);
    });
    await expect(f.service.command(f.command)).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
    expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
  });

it('does not share mutable expected owner or source identity with the adapter', async () => {
  const f = await ownedCompactionFixture();
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (_ctx, _path, _model, _account, envelope) => {
    envelope.plan.owner.workspaceId = 'mutated-workspace';
    envelope.plan.sourceSha256 = 'e'.repeat(64);
    expect(() => f.callbacks().onCompactionCommit!(commitRequest(envelope))).toThrow(expect.objectContaining({code: 'HERMES_COMPACTION_OWNER'}));
    return nativeProof(envelope);
  });
  await expect(f.service.command(f.command)).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
  expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
});

it.each(['run', 'epoch', 'workspace', 'generation', 'instruction', 'registry', 'decision', 'approval', 'work', 'flag'] as const)
  ('rechecks current %s authority after asynchronous native work and before commit', async change => {
    const f = await ownedCompactionFixture();
    f.store.internal('fixture.protected-records', f.threadId, () => {
      f.store.put('taskMemory', 'note', f.threadId, {id: 'note', threadId: f.threadId, key: 'api', content: 'Keep the API.', revision: 1, author: 'user', updatedAt: ''});
      f.store.put('request', 'approval', f.threadId, {id: 'approval', threadId: f.threadId, status: 'pending', revision: 1, prompt: 'Approve the original operation.', title: 'Review', basis: [], responseSchema: {}, artifactId: null});
      f.store.put('operation', 'work', f.threadId, {id: 'work', threadId: f.threadId, status: 'running', revision: 1, approved: true, description: 'Original work.'});
    });
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {release = resolve;});
    vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {await waiting; return f.confirm(ctx, envelope);});
    const result = f.service.command(f.command).then(() => 'APPLIED', () => 'REFUSED');
    try {
      await vi.waitFor(() => expect(f.runtime.compactProtected).toHaveBeenCalledOnce());
      if (change === 'flag') __setCapabilityFlagForTests('context.lossAwareCompactionV1', false);
      else if (change === 'registry') Reflect.set(f.service, 'requestRegistryDigest', 'e'.repeat(64));
      else f.store.internal('authority.changed', f.threadId, () => {
        if (change === 'run' || change === 'epoch' || change === 'workspace') f.store.put('thread', f.threadId, f.threadId, {...f.service.thread(f.threadId),
          ...(change === 'run' ? {runId: 'new-owner'} : change === 'epoch' ? {epoch: 99} : {workspaceId: 'new-workspace'})});
        else if (change === 'generation') f.store.put('requestContextGeneration', f.threadId, f.threadId, {generation: 2});
        else if (change === 'instruction') f.store.put('requestContextReceipt', 'receipt-' + f.threadId, f.threadId, {receipt: {...compactionReceipt(f.threadId).receipt, instructionDigest: 'e'.repeat(64)}});
        else {
          const kind = change === 'decision' ? 'taskMemory' : change === 'approval' ? 'request' : 'operation', id = change === 'decision' ? 'note' : change === 'approval' ? 'approval' : 'work';
          f.store.put(kind, id, f.threadId, {...f.store.get<Record<string, unknown>>(kind, id), [change === 'decision' ? 'content' : change === 'approval' ? 'prompt' : 'description']: 'Changed without a revision increment.'});
        }
      });
      release(); expect(await result).toBe('REFUSED');
      expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
    } finally {release(); await result;}
  });

it('validates all nine retained captures through bounded SourceWorkbench batches', async () => {
  const f = await ownedCompactionFixture(), refs: SourceRefV1[] = [];
  for (let index = 0; index < 9; index++) {const ref = await captureMessage(f, 'message-' + index); refs.push(ref); deliveredSource(f, 'delivery-' + index, ref);}
  const prepare = vi.spyOn(f.service.sourceWorkbench, 'prepareSend');
  await f.service.command(f.command);
  expect(prepare.mock.calls.map(call => (call[1] as SourceRefV1[]).length)).toEqual([8, 1]);
  const envelope = vi.mocked(f.runtime.compactProtected!).mock.calls[0][4];
  expect(envelope.plan.references.filter(ref => ref.kind === 'SOURCE_EVIDENCE').map(ref => ref.revision).sort()).toEqual(refs.map(ref => ref.source.sourceRevision).sort());
  expect(f.store.all('compactionUsage', f.threadId)).toHaveLength(1);
});

it.each(['selected content', 'capture record', 'explicit choice'] as const)('refuses %s drift after source preparation', async change => {
  const f = await ownedCompactionFixture(), ref = await captureMessage(f, 'source-message'); deliveredSource(f, 'source-delivery', ref);
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {
    f.store.internal('source.changed', f.threadId, () => {
      if (change === 'selected content') f.store.put('message', 'source-message', f.threadId, {...f.store.get<Record<string, unknown>>('message', 'source-message'), content: 'Externally changed content.'});
      else if (change === 'capture record') f.store.put('sourceCapture', ref.captureId, f.threadId, {...f.store.get<Record<string, unknown>>('sourceCapture', ref.captureId), text: 'Changed retained bytes.'});
      else f.store.put('outbox', 'source-delivery', f.threadId, {...f.store.get<Record<string, unknown>>('outbox', 'source-delivery'), sourceRefs: [{...ref, keepCaptured: true}]});
    });
    return f.confirm(ctx, envelope);
  });
  await expect(f.service.command(f.command)).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
  expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
});

it('uses an older input recovery choice only after delivery and keeps the explicitly retained source version', async () => {
  const f = await ownedCompactionFixture(), ref = await captureMessage(f, 'recover-source');
  f.store.internal('queue.older-input', f.threadId, () => f.store.put('outbox', 'older-input', f.threadId,
    {id: 'older-input', threadId: f.threadId, content: 'Queued earlier.', status: 'persisted', runId: null, enteredRuntime: false, sourceRefs: [ref]}));
  deliveredSource(f, 'newer-input', ref);
  f.store.internal('source.changed', f.threadId, () => f.store.put('message', 'recover-source', f.threadId,
    {...f.store.get<Record<string, unknown>>('message', 'recover-source'), content: 'A newer source revision.'}));
  await f.service.sourceWorkbench.recoverInput({commandId: 'keep-captured', logicalOwner: f.service.sourceWorkbench.owner(f.threadId), inputId: 'older-input', action: 'KEEP_CAPTURED'});
  const recovered = f.store.get<{sourceRefs: SourceRefV1[]}>('outbox', 'older-input')!.sourceRefs[0];
  expect(recovered.keepCaptured).toBe(true);
  deliveredSource(f, 'older-input', recovered);
  await f.service.command(f.command);
  const plan = vi.mocked(f.runtime.compactProtected!).mock.calls[0][4].plan;
  expect(plan.references.filter(item => item.kind === 'SOURCE_EVIDENCE')).toEqual([expect.objectContaining({id: 'capture:' + ref.captureId, revision: ref.source.sourceRevision})]);
  expect(f.store.all('compactionUsage', f.threadId)).toHaveLength(1);
});

it.each([{archiveRef: null}, {archiveSha256: null}, {afterBytes: 20000}, {afterBytes: 0}, {referenceCount: 1}, {toolPairs: 1}] satisfies Partial<NativeCompactionReceiptV1>[])
  ('does not record application for invalid native proof %j', async patch => {
    const f = await ownedCompactionFixture();
    vi.mocked(f.runtime.compactProtected!).mockImplementation(async (_ctx, _path, _model, _account, envelope) => {
      f.callbacks().onCompactionCommit!(commitRequest(envelope)); return {...nativeProof(envelope), ...patch};
    });
    await expect(f.service.command(f.command)).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
    expect(f.store.all('compactionUsage', f.threadId)).toEqual([]);
    expect(f.store.get('requestContextGeneration', f.threadId)).toEqual({generation: 1});
  });

it('refuses a source with no reducible records before invoking native summary work', async () => {
  const f = await ownedCompactionFixture();
  vi.mocked(f.runtime.nativeHistoryDigest!).mockResolvedValue({sha256: 'd'.repeat(64), messages: [{role: 'user', content: 'Required.'}, {role: 'assistant', content: 'Recent tail.'}]});
  await expect(f.service.command(f.command)).rejects.toMatchObject({code: 'COMPACTION_NO_REDUCTION'});
  expect(f.runtime.compactProtected).not.toHaveBeenCalled();
  expect(f.service.thread(f.threadId)).toMatchObject({epoch: 4, runId: null, status: 'ready'});
});

it('consumes the exact private commit once and removes its authority after completion', async () => {
  const f = await ownedCompactionFixture();
  let request!: ReturnType<typeof commitRequest>;
  vi.mocked(f.runtime.compactProtected!).mockImplementation(async (ctx, _path, _model, _account, envelope) => {
    request = commitRequest(envelope);
    const proof = f.confirm(ctx, envelope);
    expect(() => f.callbacks().onCompactionCommit!(request)).toThrow(expect.objectContaining({code: 'HERMES_COMPACTION_OWNER'}));
    return proof;
  });
  await f.service.command(f.command);
  expect(() => f.callbacks().onCompactionCommit!(request)).toThrow(expect.objectContaining({code: 'HERMES_COMPACTION_OWNER'}));
});
