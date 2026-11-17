import {afterEach, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service, type ServiceOptions} from '../packages/core/service.ts';
import {SourceWorkbench} from '../packages/core/source-workbench.ts';
import {__setCapabilityFlagForTests, registeredCapabilityFlags} from '../packages/core/capability-flags.ts';
import {SUPPLEMENTAL_EVIDENCE_HEADER} from '../packages/core/request-custody.ts';
import type {ArtifactRecord, DataRecord, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread} from '../packages/contracts/index.ts';
import {memoryFixture} from './project-memory-fixture.ts';

// Real Service, Store, source capture and ProjectMemory custody. The recording
// adapter observes host dispatch only; it is not native Hermes/provider evidence.
const cleanups: (() => Promise<void>)[] = [];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
afterEach(async () => {
  vi.restoreAllMocks();
  try {for (const cleanup of cleanups.splice(0).reverse()) await cleanup();}
  finally {
    __setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);
    __setCapabilityFlagForTests('memory.projectV1', undefined);
    __setCapabilityFlagForTests('context.compilerV1', undefined);
  }
});

function recordingService(root: string, store: Store, options: ServiceOptions = {}) {
  const starts: StartRun[] = [], followUps: StartRun[] = [];
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = {
    configure(value) {callbacks = value;},
    models: async () => [{id: 'test/model', provider: 'test', name: 'Combined custody fixture'}],
    start: async input => {starts.push(input);},
    followUp: async input => {followUps.push(input);},
    cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {},
  };
  const service = new Service(store, runtime, options);
  cleanups.push(async () => {
    try {await service.dispose();}
    finally {store.close(); rmSync(root, {recursive: true, force: true});}
  });
  return {store, service, starts, followUps, callbacks: () => callbacks};
}

function bareFixture(options: ServiceOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'm15-memory-custody-')), store = new Store(join(root, 'profile'));
  const stamp = new Date().toISOString();
  const thread: Thread = {id: 'thread', title: 'Custody owner', projectName: null, createdAt: stamp, updatedAt: stamp, status: 'ready', epoch: 0, runId: null, modelId: 'test/model', sessionPath: null, accountId: null};
  store.internal('fixture.owner', thread.id, () => store.put('thread', thread.id, thread.id, thread));
  return recordingService(root, store, options);
}

it('keeps source workbench, project memory and request custody off by default', async () => {
  expect(registeredCapabilityFlags()).toMatchObject({'ui.sourceWorkbenchV1': false, 'memory.projectV1': false, 'memory.externalRecallExperimentV1': false, 'context.compilerV1': false});
  const f = bareFixture();
  await expect(f.service.prepareRequestContext('thread', 'An ordinary draft', {modelId: 'test/model'})).rejects.toMatchObject({code: 'REQUEST_CONTEXT_DISABLED'});
  expect(f.store.all('requestContextGeneration')).toEqual([]);
  const command = {id: 'default-off-send', type: 'message.send', threadId: 'thread', payload: {content: 'An ordinary draft', modelId: 'test/model'}};
  await f.service.command(command); await f.service.deliverOutbox('thread');
  expect(f.starts).toHaveLength(1); expect(f.followUps).toEqual([]);
  expect(f.starts[0].requestContext).toBeUndefined(); expect(f.starts[0].sourceRefs).toBeUndefined(); expect(f.starts[0].memoryCheckpoint).toBeUndefined();
  expect(f.service.sourceWorkbench.context('thread')).toMatchObject({state: 'EMPTY', requestContext: null});
  expect((await f.service.sourceWorkbench.evidence('thread')).modules.find(module => module.id === 'M04')).toMatchObject({state: 'DISABLED'});
  expect(registeredCapabilityFlags()).toMatchObject({'ui.sourceWorkbenchV1': false, 'memory.projectV1': false, 'context.compilerV1': false});
});

it.each([true, false])('uses the host request-context option %s without rewriting capability flags', async enabled => {
  // Each option deliberately overrides the opposite independent M04 flag.
  __setCapabilityFlagForTests('context.compilerV1', !enabled);
  const flags = registeredCapabilityFlags(), f = bareFixture({requestContextEnabled: enabled});
  const prompt = 'An explicit host custody option';
  const preparation = enabled ? await f.service.prepareRequestContext('thread', prompt, {modelId: 'test/model'}) : null;
  if (!enabled) await expect(f.service.prepareRequestContext('thread', prompt, {modelId: 'test/model'})).rejects.toMatchObject({code: 'REQUEST_CONTEXT_DISABLED'});
  const command = {id: 'host-option-send', type: 'message.send', threadId: 'thread', payload: {content: prompt, modelId: 'test/model', ...(preparation ? {requestContextId: preparation.requestId} : {})}};
  await f.service.command(command); await f.service.deliverOutbox('thread');
  expect(f.starts).toHaveLength(1); expect(f.followUps).toEqual([]);
  if (preparation) {
    expect(f.starts[0].requestContext).toMatchObject({requestId: preparation.requestId, contextGeneration: preparation.contextGeneration});
    expect(f.service.sourceWorkbench.context('thread')).toMatchObject({state: 'AVAILABLE', requestContext: {receipt: f.starts[0].requestContext}});
  } else {
    expect(f.starts[0].requestContext).toBeUndefined();
    expect(f.service.sourceWorkbench.context('thread')).toMatchObject({state: 'EMPTY', requestContext: null});
  }
  expect(f.starts[0].memoryCheckpoint).toBeUndefined();
  expect(registeredCapabilityFlags()).toEqual(flags);
  expect((await f.service.sourceWorkbench.evidence('thread')).modules.find(module => module.id === 'M04')).toMatchObject({state: enabled ? 'AVAILABLE' : 'DISABLED'});
});

it('reports effective M04 custody after the same M05 preparation and retained M15 source reach one real host dispatch', async () => {
  __setCapabilityFlagForTests('memory.projectV1', true);
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  __setCapabilityFlagForTests('context.compilerV1', false);
  const seeded = await memoryFixture(store => store.internal('fixture.combined-owner', null, () => {
    for (const id of ['thread', 'other']) store.put('thread', id, id, {...store.get<Thread>('thread', id)!, accountId: null, modelId: 'test/model'});
  }));
  // Seed accepted evidence before constructing Service. All preparation, source
  // reads and dispatch below use its actual host-owned instances and one Store.
  const accepted = seeded.accept('SQLite persistence must preserve reviewed source identity.');
  const f = recordingService(seeded.root, seeded.store, {requestContextEnabled: false});
  const workbench = f.service.sourceWorkbench, owner = workbench.owner('thread'), stamp = f.service.thread('thread').createdAt;
  expect(owner).toEqual({threadId: 'thread', projectId: 'project', workspaceId: null});
  const data: DataRecord = {id: 'combined-data', threadId: 'thread', revision: 1, value: [{name: 'Retained SQLite source', count: 7}], provenance: 'executor', createdAt: stamp};
  const artifact: ArtifactRecord = {id: 'combined-artifact', threadId: 'thread', messageId: 'source', title: 'Combined source', purpose: 'Retained source and prepared memory custody', kind: 'structured', revision: 1, spec: {root: 'rows', elements: {rows: {type: 'Table', props: {rowsBinding: 'rows'}}}}, widget: null, bindings: {rows: {mode: 'live', id: data.id}}, actions: {}, stateId: 'combined-state', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1', createdAt: stamp, updatedAt: stamp};
  f.store.internal('fixture.combined-artifact', 'thread', () => {f.store.put('data', data.id, 'thread', data); f.store.put('artifact', artifact.id, 'thread', artifact);});
  const descriptor = await workbench.describe({logicalOwner: owner, locator: {kind: 'ARTIFACT_REGION', sourceId: artifact.id, binding: 'rows'}});
  const captured = await workbench.capture({commandId: 'combined-capture', source: {...descriptor.locator, logicalOwner: owner, sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, capturedAt: stamp, range: {encoding: 'JSON_POINTER', pointer: '/0'}}});
  const originalCapture = f.store.get('sourceCapture', captured.ref.captureId), prompt = 'SQLite project persistence';
  const prepared = await f.service.prepareProjectMemory('project', 'thread', prompt, {modelId: 'test/model'});
  expect(prepared).not.toBeNull();
  expect(prepared!.items).toEqual([accepted]);
  expect(prepared!.phase).toBe('PREPARING');
  expect(f.service.getRequestPreparation('thread', prepared!.requestId).contextGeneration).toBe(prepared!.contextGeneration);
  expect(f.starts).toEqual([]); expect(f.store.all('outbox', 'thread')).toEqual([]);
  const command = {id: 'combined-source-memory-send', type: 'message.send', threadId: 'thread', payload: {content: prompt, modelId: 'test/model', requestContextId: prepared!.requestId, sourceRefs: [captured.ref], sendMode: 'NOW'}};
  const receipt = await f.service.command(command); await f.service.deliverOutbox('thread');
  expect(receipt.result).toMatchObject({inputId: command.id});
  expect(f.starts).toHaveLength(1); expect(f.followUps).toEqual([]);
  const input = f.starts[0];
  expect(input).toMatchObject({threadId: owner.threadId, accountId: null, modelId: 'test/model', inputId: command.id, inputIds: [command.id], sourceRefs: [captured.ref], resources: [], memoryCheckpoint: {apiVersion: 2, required: true}});
  expect(input.requestContext).toMatchObject({requestId: prepared!.requestId, contextGeneration: prepared!.contextGeneration, owner: {threadId: 'thread', workspaceId: 'project:project'}, modelBinding: {modelId: 'test/model', accountId: null}});
  const sourceLines = input.prompt.split('\n').filter(line => line.startsWith('{"captureId":'));
  expect(sourceLines).toHaveLength(1);
  expect(JSON.parse(sourceLines[0])).toEqual({captureId: captured.ref.captureId, source: captured.ref.source, version: 'current captured version', text: '{"name":"Retained SQLite source","count":7}'});
  const sourceStart = input.prompt.indexOf('\n\nSelected source evidence'), memoryStart = input.prompt.indexOf(SUPPLEMENTAL_EVIDENCE_HEADER);
  expect(sourceStart).toBeGreaterThan(0); expect(memoryStart).toBeGreaterThan(sourceStart);
  const selectedText = input.prompt.slice(sourceStart, memoryStart), memoryText = input.prompt.slice(memoryStart + SUPPLEMENTAL_EVIDENCE_HEADER.length);
  expect(JSON.parse(memoryText)).toEqual({kind: 'project-memory-evidence', authority: 'CONTEXT_ONLY', projectIdentity: prepared!.scope.projectIdentity, items: [{id: accepted.id, revision: accepted.revision, kind: accepted.kind, text: accepted.text, sourceRefs: accepted.sourceRefs}]});
  expect(input.requestContext!.segments.filter(segment => segment.category === 'REFERENCE')).toEqual([expect.objectContaining({sourceId: 'selected-sources:' + command.id, sourceRevision: 1, utf8Bytes: Buffer.byteLength(selectedText), contentRef: 'sha256:' + sha(selectedText)})]);
  expect(input.requestContext!.segments.filter(segment => segment.category === 'MEMORY')).toEqual([expect.objectContaining({sourceId: 'project-memory:' + prepared!.requestId, sourceRevision: prepared!.contextGeneration, utf8Bytes: prepared!.injectedBytes, contentRef: 'sha256:' + sha(memoryText)})]);
  expect(prepared!.injectedBytes).toBe(Buffer.byteLength(SUPPLEMENTAL_EVIDENCE_HEADER + memoryText));
  expect(input.requestContext!.budget.utf8Bytes).toBe(Buffer.byteLength(input.prompt));
  expect(f.store.get('sourceCapture', captured.ref.captureId)).toEqual(originalCapture);
  expect(await workbench.open({logicalOwner: owner, ref: captured.ref})).toMatchObject({ref: captured.ref, state: 'CURRENT', text: '{"name":"Retained SQLite source","count":7}'});
  expect(f.store.all('outbox', 'thread')).toEqual([expect.objectContaining({id: command.id, threadId: 'thread', content: prompt, requestContextId: prepared!.requestId, sourceRefs: [captured.ref], status: 'processing', runId: input.runId, enteredRuntime: false})]);
  expect(f.store.all('projectMemoryRequestUsage')).toEqual([]);
  expect(await f.service.latestProjectMemory('project', 'thread')).toBeNull();
  f.callbacks().onEvent({...input, type: 'input.processing', inputIds: [command.id]});
  expect(await f.service.latestProjectMemory('project', 'thread')).toMatchObject({requestId: prepared!.requestId, contextGeneration: prepared!.contextGeneration, phase: 'CAPTURED', items: [accepted]});
  expect(f.store.all('projectMemoryRequestUsage')).toEqual([expect.objectContaining({requestId: prepared!.requestId, contextGeneration: prepared!.contextGeneration, injectedBytes: prepared!.injectedBytes})]);
  expect(await f.service.command(command)).toEqual(receipt); await f.service.deliverOutbox('thread');
  expect(f.store.all('outbox', 'thread')).toHaveLength(1); expect(f.starts).toHaveLength(1); expect(f.followUps).toEqual([]);
  expect(f.store.get('sourceCapture', captured.ref.captureId)).toEqual(originalCapture);
  expect(workbench.context('thread')).toMatchObject({logicalOwner: owner, state: 'AVAILABLE', requestContext: {receipt: input.requestContext}});
  expect(registeredCapabilityFlags()).toMatchObject({'ui.sourceWorkbenchV1': true, 'memory.projectV1': true, 'context.compilerV1': false});
  // The asserted capability must describe the effective owning Service, which
  // has now issued and delivered this exact context despite the M04 flag/option.
  const evidence = await workbench.evidence('thread');
  expect(evidence.modules.find(module => module.id === 'M04')).toMatchObject({state: 'AVAILABLE', reason: null, href: '/api/workbench/threads/thread/context'});
});

async function memoryReadFixture(records: 'none' | 'accepted' | 'forgotten' = 'none') {
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  const seeded = await memoryFixture(store => store.internal('fixture.memory-read-owner', null, () => {
    for (const id of ['thread', 'other']) store.put('thread', id, id, {...store.get<Thread>('thread', id)!, accountId: null, modelId: 'test/model'});
  }));
  const accepted = records === 'none' ? null : seeded.accept('This private SQLite memory body stays behind its owning reader.');
  if (records === 'forgotten') seeded.act({action: 'forget', itemId: accepted!.id, baseRevision: accepted!.revision});
  const f = recordingService(seeded.root, seeded.store), memory = f.service.projectMemory;
  const view = memory.read(await memory.access('project', 'thread'));
  return {...f, memory, view, accepted};
}

it.each([
  {label: 'disabled with no records', hostEnabled: false, records: 'none', state: 'DISABLED'},
  {label: 'disabled with retained records', hostEnabled: false, records: 'accepted', state: 'DISABLED'},
  {label: 'enabled with no records', hostEnabled: true, records: 'none', state: 'EMPTY'},
  {label: 'enabled with retained records', hostEnabled: true, records: 'accepted', state: 'AVAILABLE'},
  {label: 'enabled with only retained tombstones', hostEnabled: true, records: 'forgotten', state: 'AVAILABLE'},
] as const)('projects M05 $label through authorized read-only metadata', async ({hostEnabled, records, state}) => {
  __setCapabilityFlagForTests('memory.projectV1', hostEnabled);
  const f = await memoryReadFixture(records), flags = registeredCapabilityFlags();
  expect(f.view.available).toBe(hostEnabled);
  expect(f.view.scope).toMatchObject({projectId: 'project', threadId: 'thread', accountId: null});
  expect(f.view.items).toHaveLength(records === 'accepted' ? 1 : 0);
  expect(f.view.tombstones).toHaveLength(records === 'forgotten' ? 1 : 0);
  const before = {items: f.store.all('projectMemoryItem'), sources: f.store.all('projectMemorySource'), tombstones: f.store.all('projectMemoryTombstone'), config: f.store.all('projectMemoryScope')};
  const evidence = await f.service.sourceWorkbench.evidence('thread'), module = evidence.modules.find(module => module.id === 'M05');
  expect(module).toMatchObject({id: 'M05', title: 'Memory review', state, readOnly: true, href: '/api/projects/project/memory?threadId=thread'});
  expect(module!.reason).toBe(hostEnabled ? null : f.view.disabledReason);
  if (!hostEnabled) expect(module!.reason).toContain('Existing records remain reviewable');
  expect(evidence.logicalOwner).toEqual({threadId: 'thread', projectId: 'project', workspaceId: null});
  expect(evidence.items).toEqual([]);
  if (f.accepted) expect(JSON.stringify(evidence)).not.toContain(f.accepted.text);
  expect({items: f.store.all('projectMemoryItem'), sources: f.store.all('projectMemorySource'), tombstones: f.store.all('projectMemoryTombstone'), config: f.store.all('projectMemoryScope')}).toEqual(before);
  expect(f.store.all('sourceCapture')).toEqual([]); expect(f.store.all('outbox')).toEqual([]);
  expect(f.store.all('requestContextGeneration')).toEqual([]); expect(f.store.all('requestContextReceipt')).toEqual([]);
  expect(f.starts).toEqual([]); expect(f.followUps).toEqual([]); expect(registeredCapabilityFlags()).toEqual(flags);
});

it('reports project-less M05 as empty without opening memory storage or inventing a scoped link', async () => {
  __setCapabilityFlagForTests('memory.projectV1', true);
  const f = bareFixture(), reader = vi.spyOn(f.service, 'projectMemory', 'get');
  const evidence = await f.service.sourceWorkbench.evidence('thread');
  expect(evidence.logicalOwner).toEqual({threadId: 'thread', projectId: null, workspaceId: null});
  expect(evidence.modules.find(module => module.id === 'M05')).toMatchObject({state: 'EMPTY', readOnly: true, href: null});
  expect(reader).not.toHaveBeenCalled();
  expect(f.store.all('projectMemoryStorageFormat')).toEqual([]);
  expect(f.store.all('outbox')).toEqual([]); expect(f.starts).toEqual([]);
});

it('keeps M05 unsupported when a bare SourceWorkbench has no owning module reader', async () => {
  __setCapabilityFlagForTests('memory.projectV1', true);
  const f = await memoryReadFixture('accepted'), workbench = new SourceWorkbench(f.store);
  expect((await workbench.evidence('thread')).modules.find(module => module.id === 'M05')).toMatchObject({state: 'UNSUPPORTED', readOnly: true, href: null});
  expect(f.store.all('sourceCapture')).toEqual([]); expect(f.store.all('outbox')).toEqual([]); expect(f.starts).toEqual([]);
});

it.each(['account', 'project'] as const)('rejects a changed %s during the actual owning M05 read instead of returning empty metadata', async changed => {
  __setCapabilityFlagForTests('memory.projectV1', true);
  const f = await memoryReadFixture('accepted'), originalAccess = f.memory.access.bind(f.memory);
  let entered!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => {entered = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  vi.spyOn(f.memory, 'access').mockImplementationOnce(async (...args) => {
    const access = await originalAccess(...args);
    entered(); await gate; return access;
  });
  const result = f.service.sourceWorkbench.evidence('thread').then(value => ({status: 'fulfilled' as const, value}), reason => ({status: 'rejected' as const, reason}));
  try {
    // A missing adapter settles immediately. Fail at that observable boundary
    // instead of waiting for a callback that the current implementation lacks.
    expect(await Promise.race([began.then(() => 'entered'), result.then(() => 'settled')])).toBe('entered');
    const thread = f.store.get<Thread>('thread', 'thread')!;
    f.store.internal('fixture.changed-memory-read-owner', 'thread', () => f.store.put('thread', 'thread', 'thread', {...thread, ...(changed === 'account' ? {accountId: 'replacement-account'} : {projectId: 'replacement-project'})}));
    release();
    expect(await result).toMatchObject({status: 'rejected', reason: {code: 'CAPABILITY_DENIED'}});
    expect(f.store.all('outbox')).toEqual([]); expect(f.store.all('sourceCapture')).toEqual([]);
    expect(f.starts).toEqual([]); expect(f.followUps).toEqual([]);
  } finally {release(); await result;}
});

it('propagates an unexpected owning memory read failure instead of manufacturing an empty module', async () => {
  __setCapabilityFlagForTests('memory.projectV1', true);
  const f = await memoryReadFixture('accepted'), failure = new Error('fixture owning memory read failed');
  vi.spyOn(f.memory, 'read').mockImplementationOnce(() => {throw failure;});
  await expect(f.service.sourceWorkbench.evidence('thread')).rejects.toBe(failure);
  expect(f.store.all('outbox')).toEqual([]); expect(f.store.all('sourceCapture')).toEqual([]); expect(f.starts).toEqual([]);
});
