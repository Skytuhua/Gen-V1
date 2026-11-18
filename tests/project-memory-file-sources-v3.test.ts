import {afterEach, expect, it, vi} from 'vitest';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {ResourceGrant, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread} from '../packages/contracts/index.ts';
import {PROJECT_MEMORY_LIMITS, type MemorySourceSnapshot} from '../packages/contracts/project-memory.ts';
import type {SourceRefV1} from '../packages/contracts/source-selection.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import {Service, type ServiceOptions} from '../packages/core/service.ts';
import {digest} from '../packages/storage/store.ts';
import {memoryFixture} from './project-memory-fixture.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  __setCapabilityFlagForTests('memory.projectV1', undefined);
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);
});

async function fixture(options: ServiceOptions = {}) {
  __setCapabilityFlagForTests('memory.projectV1', true);
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  const f = await memoryFixture(store => store.internal('fixture.accounts', null, () => {
    for (const id of ['thread', 'other']) store.put('thread', id, id, {...store.get<Thread>('thread', id)!, accountId: null, modelId: 'test/model'});
  }));
  let callbacks!: RuntimeCallbacks;
  const starts: StartRun[] = [];
  const runtime: RuntimeAdapter = {configure(value) {callbacks = value;}, models: async () => [{id: 'test/model', name: 'Fixture', provider: 'test'}],
    start: async input => {starts.push(input);}, followUp: async () => {}, compact: async () => {}, cancel: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(f.store, runtime, {requestContextEnabled: true, ...options});
  cleanups.push(async () => {await service.dispose(); f.store.close(); rmSync(f.root, {recursive: true, force: true});});
  const owner = service.sourceWorkbench.owner('thread'), physical = statSync(f.path, {bigint: true});
  const grant: ResourceGrant = {id: 'selected-project', threadId: 'thread', kind: 'project', path: f.path, identity: {dev: String(physical.dev), ino: String(physical.ino)},
    label: 'Selected project', writable: false, createdAt: '2026-11-17T00:00:00.000Z'};
  f.store.internal('fixture.grant', 'thread', () => f.store.put('resource', grant.id, 'thread', grant));
  const access = () => service.projectMemory.currentAccess('project', 'thread');
  return {...f, service, starts, callbacks: () => callbacks, grant, owner, access};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Cross-platform fixture of an already admitted, immutable M15 capture. It
 * does not claim Linux can perform a new native file-leaf capture. The Windows
 * integration below exercises actual describe/capture/send/settle admission. */
function retainedCapture(f: Fixture, text = 'Use SQLite for durable project storage.', id = randomUUID()): SourceRefV1 {
  const complete = 'Unselected first line\n' + text + '\nUnselected last line\n';
  const source: SourceRefV1['source'] = {kind: 'FILE_RANGE', sourceId: f.grant.id, path: 'decisions.md', sourceRevision: sha(complete), contentDigest: sha(complete),
    logicalOwner: f.owner, capturedAt: f.grant.createdAt, range: {encoding: 'LINES_1_BASED', startLine: 2, endLine: 2}};
  const ownerStamp = digest({owner: f.owner, accountId: null, project: f.store.get('workspaceProject', 'project'), root: f.store.get('workspaceProjectRoot', 'project'), workspace: null});
  const scopeDigest = digest({id: f.grant.id, threadId: 'thread', kind: f.grant.kind, path: f.grant.path, createdAt: f.grant.createdAt, selectedPath: source.path});
  f.store.internal('fixture.retained-file', 'thread', () => f.store.put('sourceCapture', id, 'thread', {id, threadId: 'thread', source, label: 'decisions.md', text, ownerStamp, scopeDigest, selectedDigest: sha(text)}));
  return {captureId: id, source, keepCaptured: false};
}
function handledInput(f: Fixture, refs: SourceRefV1[], options: {id?: string; runId?: string; enteredRuntime?: boolean; status?: string} = {}) {
  const id = options.id ?? 'handled-file-input', runId = options.runId ?? 'settled-source-run';
  f.store.internal('fixture.handled-input', 'thread', () => {
    f.store.put('message', 'selected-source-message', 'thread', {id: 'selected-source-message', threadId: 'thread', role: 'user', content: 'Review the selected source.', createdAt: f.grant.createdAt, runId: 'settled-source-run'});
    f.store.put('outbox', id, 'thread', {id, threadId: 'thread', content: 'Review the selected source.', messageId: 'selected-source-message', status: options.status ?? 'handled', runId,
      enteredRuntime: options.enteredRuntime ?? true, sourceRefs: refs});
  });
}
const cut = (f: Fixture) => f.service.projectMemory.extractionCut(f.access(), {threadId: 'thread', epoch: 1, runId: 'settled-source-run'});
const fileSources = (f: Fixture) => cut(f).sources.filter(source => source.ref.sourceKind === 'FILE');

it('includes only the exact file selection from an actually handled opted-in input through Service memory composition', async () => {
  const f = await fixture(), selected = retainedCapture(f); handledInput(f, [selected]);
  retainedCapture(f, 'An unsent capture must never enter extraction.');
  const sources = fileSources(f);
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatchObject({content: 'Use SQLite for durable project storage.', label: 'decisions.md (lines 2-2)',
    ref: {sourceKind: 'FILE', sourceId: 'source-capture:' + selected.captureId, sourceRevision: selected.source.sourceRevision, digest: sha('Use SQLite for durable project storage.'), observedStatus: 'OBSERVED'}});
  expect(JSON.stringify(sources)).not.toContain('Unselected'); expect(JSON.stringify(sources)).not.toContain('fileGrant');
  expect(f.store.get<MemorySourceSnapshot>('projectMemorySource', digest(sources[0].ref))?.fileGrant).toEqual({resourceId: f.grant.id, grantDigest: digest(f.grant)});
  const first = sources[0].ref;
  expect(fileSources(f)[0].ref).toEqual(first);
  const item = f.service.projectMemory.propose(f.access(), {kind: 'DECISION', text: sources[0].content, sourceRefs: [first]}, {kind: 'AGENT', id: 'extraction-fixture'});
  expect(item.state).toBe('PROPOSED'); expect(f.service.projectMemory.accepted(f.access())).toEqual([]);
  expect(f.service.projectMemory.source(f.access(), item.id, item.revision, first.digest, first)).toMatchObject({ref: first, content: sources[0].content});
});

it.each([false, true])('retains the sent revision after the file changes (Keep captured %s) without rereading or widening the selection', async keepCaptured => {
  const f = await fixture(), selected = {...retainedCapture(f), keepCaptured}; handledInput(f, [selected]);
  writeFileSync(join(f.path, 'decisions.md'), 'Replacement whole-file content must not become a memory source.');
  expect(fileSources(f)).toEqual([expect.objectContaining({content: 'Use SQLite for durable project storage.', ref: expect.objectContaining({sourceRevision: selected.source.sourceRevision})})]);
});

it.each(['revoked', 'changed-grant', 'missing-physical-identity', 'foreign-owner', 'changed-selection', 'changed-revision', 'corrupt-capture'] as const)('excludes a retained selection with %s custody', async kind => {
  const f = await fixture(), selected = retainedCapture(f);
  if (kind === 'foreign-owner') selected.source.logicalOwner = {...selected.source.logicalOwner, threadId: 'other'};
  if (kind === 'changed-selection' && selected.source.kind === 'FILE_RANGE') selected.source.range = {encoding: 'LINES_1_BASED', startLine: 1, endLine: 1};
  if (kind === 'changed-revision') selected.source.sourceRevision = 'f'.repeat(64);
  handledInput(f, [selected]);
  f.store.internal('fixture.revoke', 'thread', () => {
    if (kind === 'revoked') f.store.remove('resource', f.grant.id);
    if (kind === 'changed-grant') f.store.put('resource', f.grant.id, 'thread', {...f.grant, createdAt: '2026-11-17T01:00:00.000Z'});
    if (kind === 'missing-physical-identity') {const {identity: _, ...unbound} = f.grant; f.store.put('resource', f.grant.id, 'thread', unbound);}
    if (kind === 'corrupt-capture') f.store.put('sourceCapture', selected.captureId, 'thread', {...f.store.get<Record<string, unknown>>('sourceCapture', selected.captureId)!, text: 'Tampered text'});
  });
  expect(fileSources(f)).toEqual([]);
  expect(f.store.all<MemorySourceSnapshot>('projectMemorySource').filter(source => source.ref.sourceKind === 'FILE')).toEqual([]);
});

it.each([{runId: 'older-run'}, {enteredRuntime: false}])('does not extract an attachment that lacks the exact handled runtime witness %j', async changed => {
  const f = await fixture(), selected = retainedCapture(f); handledInput(f, [selected], changed);
  expect(fileSources(f)).toEqual([]);
});

it('excludes an old captured selection after its conversation moves to another working copy', async () => {
  const f = await fixture(), selected = retainedCapture(f); handledInput(f, [selected]);
  const path = join(f.root, 'replacement-workspace'); mkdirSync(path); const physical = statSync(path, {bigint: true});
  f.store.internal('fixture.moved-owner', 'thread', () => {
    f.store.put('workspaceBinding', 'new-workspace', 'thread', {id: 'new-workspace', threadId: 'thread', projectId: 'project', path, identity: {dev: String(physical.dev), ino: String(physical.ino)}});
    f.store.put('thread', 'thread', 'thread', {...f.store.get<Thread>('thread', 'thread')!, workspaceId: 'new-workspace'});
  });
  expect(fileSources(f)).toEqual([]);
});

it('denies a new pending input and an unselected source conversation before retaining file memory', async () => {
  const f = await fixture(), selected = retainedCapture(f); handledInput(f, [selected], {status: 'persisted'});
  expect(() => cut(f)).toThrow(expect.objectContaining({code: 'MEMORY_SOURCE_BUSY'}));
  handledInput(f, [selected]);
  const access = f.access(), revision = f.service.projectMemory.read(access).configRevision;
  f.service.projectMemory.review(access, {id: randomUUID(), type: 'project.memory.review', threadId: 'thread', payload: {operation: {action: 'configure', enabled: true, sourceThreadIds: ['other'], baseRevision: revision}}}, 'local-user');
  expect(() => cut(f)).toThrow(expect.objectContaining({code: 'MEMORY_SOURCE_DENIED'}));
  expect(f.store.all<MemorySourceSnapshot>('projectMemorySource').some(source => source.ref.sourceKind === 'FILE')).toBe(false);
});

it.each(['api_key=abcdefghijklmnop0123456789', 'x'.repeat(PROJECT_MEMORY_LIMITS.sourceBytes - 1)])('does not retain secret-bearing or unframeable selected bytes', async content => {
  const f = await fixture(), selected = retainedCapture(f, content); handledInput(f, [selected]);
  expect(fileSources(f)).toEqual([]);
  expect(Buffer.byteLength(JSON.stringify(cut(f)))).toBeLessThanOrEqual(PROJECT_MEMORY_LIMITS.sourceBytes);
  expect(f.store.all<MemorySourceSnapshot>('projectMemorySource').some(source => source.ref.sourceKind === 'FILE')).toBe(false);
});

it('deduplicates selected captures and caps the complete cut at 64 sources and 64 KiB', async () => {
  const f = await fixture(), refs = Array.from({length: 72}, (_, index) => retainedCapture(f, 'Bounded retained fact ' + index));
  for (let offset = 0; offset < refs.length; offset += 8) handledInput(f, refs.slice(offset, offset + 8), {id: 'input-' + offset});
  handledInput(f, [refs[0]], {id: 'duplicate-selection'});
  const selected = cut(f), files = selected.sources.filter(source => source.ref.sourceKind === 'FILE');
  expect(files.length).toBeGreaterThan(0); expect(selected.sources.length).toBeLessThanOrEqual(PROJECT_MEMORY_LIMITS.sources);
  expect(new Set(files.map(source => source.ref.sourceId)).size).toBe(files.length);
  expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThanOrEqual(PROJECT_MEMORY_LIMITS.sourceBytes);
});

it('revokes already retained file memories when their source grant is removed', async () => {
  const f = await fixture(), selected = retainedCapture(f); handledInput(f, [selected]);
  const source = fileSources(f)[0]; expect(source).toBeDefined();
  const access = f.access(), item = f.service.projectMemory.propose(access, {kind: 'FACT', text: source.content, sourceRefs: [source.ref]}, {kind: 'AGENT', id: 'fixture'});
  f.service.projectMemory.review(access, {id: randomUUID(), type: 'project.memory.review', threadId: 'thread', payload: {operation: {action: 'accept', itemId: item.id, baseRevision: item.revision}}}, 'local-user');
  expect(f.service.projectMemory.accepted(access)).toHaveLength(1);
  f.store.internal('fixture.revoke', 'thread', () => f.store.remove('resource', f.grant.id));
  expect(f.service.projectMemory.sourceAvailable(access, source.ref)).toBe(false); expect(f.service.projectMemory.accepted(access)).toEqual([]);
  expect(() => f.service.projectMemory.source(access, item.id, 2, source.ref.digest, source.ref)).toThrow();
});

it('does not recapture a forgotten selected source during a repeated extraction cut', async () => {
  const f = await fixture(), selected = retainedCapture(f); handledInput(f, [selected]);
  const source = fileSources(f)[0]; expect(source).toBeDefined();
  const access = f.access(), item = f.service.projectMemory.propose(access, {kind: 'FACT', text: source.content, sourceRefs: [source.ref]}, {kind: 'AGENT', id: 'fixture'});
  f.service.projectMemory.review(access, {id: randomUUID(), type: 'project.memory.review', threadId: 'thread', payload: {operation: {action: 'forget', itemId: item.id, baseRevision: item.revision}}}, 'local-user');
  expect(fileSources(f)).toEqual([]);
  expect(f.service.projectMemory.sourceAvailable(access, source.ref)).toBe(false);
  expect(f.store.get('sourceCapture', selected.captureId)).not.toBeNull();
});

it.runIf(process.platform === 'win32').each([false, true])('extracts an actually captured/sent FILE_RANGE through native Windows admission and Service settlement (Keep captured %s)', async keepCaptured => {
  const auxiliaryStarts: StartRun[] = []; let auxiliaryCallbacks!: RuntimeCallbacks;
  const auxiliary: RuntimeAdapter = {configure(value) {auxiliaryCallbacks = value;}, models: async () => [], start: async input => {
    auxiliaryStarts.push(input);
    const selected = JSON.parse(input.prompt.slice(input.prompt.indexOf('\n{') + 1)).sources.find((source: MemorySourceSnapshot) => source.ref.sourceKind === 'FILE') as MemorySourceSnapshot;
    expect(selected).toBeDefined();
    auxiliaryCallbacks.onEvent({...input, type: 'assistant.message', content: JSON.stringify([{kind: 'DECISION', text: selected.content, sourceRefs: [selected.ref]}])});
    auxiliaryCallbacks.onEvent({...input, type: 'settled'});
  }, followUp: async () => {}, compact: async () => {}, cancel: async () => {}, history: async () => [], dispose: vi.fn(async () => {})};
  const f = await fixture({memoryExtractionRuntimeFactory: () => auxiliary}), path = join(f.path, 'decisions.md');
  writeFileSync(path, 'Not selected\nUse SQLite for durable project storage.\nNot selected either\n');
  const descriptor = await f.service.sourceWorkbench.describe({logicalOwner: f.owner, locator: {kind: 'FILE_RANGE', sourceId: f.grant.id, path: 'decisions.md'}});
  const captured = await f.service.sourceWorkbench.capture({commandId: randomUUID(), source: {...descriptor.locator, logicalOwner: f.owner, sourceRevision: descriptor.sourceRevision,
    contentDigest: descriptor.contentDigest, capturedAt: f.grant.createdAt, range: {encoding: 'LINES_1_BASED', startLine: 2, endLine: 2}}});
  if (keepCaptured) writeFileSync(path, 'Changed current bytes must not enter extraction.');
  await f.service.command({id: randomUUID(), type: 'message.send', threadId: 'thread', payload: {content: 'Review the selected source.', modelId: 'test/model', sourceRefs: [{...captured.ref, keepCaptured}]}});
  await f.service.deliverOutbox('thread'); expect(f.starts).toHaveLength(1);
  const input = f.starts[0]; expect(input.prompt).toContain('Use SQLite for durable project storage.'); expect(input.prompt).not.toContain('Not selected');
  f.callbacks().onEvent({...input, type: 'input.processing', inputIds: input.inputIds});
  f.callbacks().onEvent({...input, type: 'assistant.message', messageId: 'review-response', content: 'Reviewed.', inputIds: input.inputIds});
  f.callbacks().onEvent({...input, type: 'settled'});
  await vi.waitFor(() => expect(auxiliary.dispose).toHaveBeenCalledOnce());
  expect(auxiliaryStarts).toHaveLength(1); expect(auxiliaryStarts[0].resources).toEqual([]);
  const item = f.service.projectMemory.read(f.access()).items[0].item;
  expect(item).toMatchObject({state: 'PROPOSED', text: 'Use SQLite for durable project storage.', sourceRefs: [expect.objectContaining({sourceKind: 'FILE', sourceRevision: descriptor.sourceRevision})]});
});
