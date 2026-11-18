import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../packages/storage/store.ts';
import type { RequestContextV1 } from '../packages/contracts/request-context.ts';
import type { NativeCompactionOwnerV1, NativeCompactionReceiptV1, NativeCompactionReferenceV1 } from '../packages/contracts/native-compaction.ts';
import type { SourceRefV1 } from '../packages/contracts/source-selection.ts';
import { readCompactionHostCut, prepareNativeCompaction, nativeCompactionEnvelope, requireNativeCompactionReceipt } from '../packages/core/native-compaction-protection.ts';

const snapshot = () => ({sha256: 'd'.repeat(64), messages: [
  {role: 'system', content: 'Retain the system constraint.'},
  {role: 'user', content: 'Unresolved requirement: retain the public API.'},
  {role: 'assistant', content: 'Completed investigation. '.repeat(600)},
  {role: 'assistant', content: null, tool_calls: [{id: 'read-1', type: 'function', function: {name: 'repository_read', arguments: '{}'}}]},
  {role: 'tool', tool_call_id: 'read-1', content: 'Evidence at revision 7.'},
  {role: 'user', content: 'Recent 日本語 request.'},
  {role: 'assistant', content: 'Recent response.'},
]});
const references: NativeCompactionReferenceV1[] = [
  {kind: 'DECISION', id: 'note:api', revision: 2, digest: 'a'.repeat(64), content: 'Preserve the old endpoint.'},
  {kind: 'PENDING_APPROVAL', id: 'request:approval', revision: 3, digest: 'b'.repeat(64)},
  {kind: 'ACTIVE_WORK', id: 'work:pending', revision: 4, digest: 'c'.repeat(64)},
  {kind: 'SOURCE_EVIDENCE', id: 'capture:source', revision: 'opaque-source-revision', digest: 'e'.repeat(64)},
];
const owner: NativeCompactionOwnerV1 = {threadId: 'thread', runId: 'maintenance', epoch: 2, workspaceId: 'thread:thread',
  modelId: 'test/model', accountId: null, generation: 1, instructionDigest: 'a'.repeat(64), toolRegistryDigest: 'b'.repeat(64)};

it('protects exact native roles, complete tool groups and the recent tail without fabricating host sequences', () => {
  const source = snapshot(), original = structuredClone(source), refs = structuredClone(references);
  const prepared = prepareNativeCompaction(source, refs), envelope = nativeCompactionEnvelope(prepared, 'candidate', owner);
  expect(prepared.retainedIndices).toEqual([0, 1, 3, 4, 5, 6]);
  expect(prepared.toolPairs).toEqual([{call: 'read-1', result: 'native-record:' + source.sha256 + ':4'}]);
  expect(prepared.references).toEqual(references);
  expect(prepared.sourceInterval).toBeNull();
  expect(prepared.retainedBytes).toBeGreaterThan(Buffer.byteLength('Recent 日本語 request.'));
  expect(source).toEqual(original);
  expect(envelope.plan.owner).toEqual(owner);
  expect(envelope.planDigest).toBe(createHash('sha256').update(JSON.stringify(envelope.plan)).digest('hex'));
  refs[0].digest = 'f'.repeat(64);
  expect(prepared.references).toEqual(references);
});
it.each([
  {messages: [{role: 'assistant', tool_calls: [{id: 'pending'}]}, {role: 'user', content: 'Interrupted pair'}]},
  {messages: [{role: 'tool', tool_call_id: 'unknown', content: 'Orphan result'}]},
  {messages: [{role: 'assistant', tool_calls: [{id: 'duplicate'}, {id: 'duplicate'}]}]},
  {messages: [{role: 'assistant', tool_calls: {id: 'not-an-array'}}]},
  {messages: [{role: 'function', content: 'Unsupported native record'}]},
])('refuses malformed native tool custody %j', ({messages}) => {
  expect(() => prepareNativeCompaction({sha256: 'd'.repeat(64), messages}, [])).toThrow(expect.objectContaining({code: 'COMPACTION_TOOL_PAIRS'}));
});
it('refuses a fully protected source before spending on a summary', () => {
  expect(() => prepareNativeCompaction({sha256: 'd'.repeat(64), messages: [{role: 'user', content: 'Required'}, {role: 'assistant', content: 'Recent tail'}]}, []))
    .toThrow(expect.objectContaining({code: 'COMPACTION_NO_REDUCTION'}));
});
it('counts multibyte protected content against the 64 KiB bound', () => {
  const source = snapshot(); source.messages[1] = {role: 'user', content: '界'.repeat(22000)};
  expect(() => prepareNativeCompaction(source, [])).toThrow(expect.objectContaining({code: 'COMPACTION_PROTECTION_LIMIT'}));
});
it('bounds the native source record count and serialized bytes before constructing a plan', () => {
  expect(() => prepareNativeCompaction({sha256: 'd'.repeat(64), messages: Array.from({length: 4097}, () => ({role: 'assistant', content: 'x'}))}, []))
    .toThrow(expect.objectContaining({code: 'COMPACTION_PROTECTION_LIMIT'}));
  expect(() => prepareNativeCompaction({sha256: 'd'.repeat(64), messages: [{role: 'assistant', content: 'x'.repeat(32 * 1024 * 1024)}]}, []))
    .toThrow(expect.objectContaining({code: 'COMPACTION_PROTECTION_LIMIT'}));
});

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
const requestReceipt = (): RequestContextV1 => ({requestId: 'receipt', owner: {threadId: 'thread', workspaceId: 'thread:thread'}, contextGeneration: 1,
  modelBinding: {modelId: 'test/model', accountId: null}, sourceCut: {sequence: null, revisionDigest: 'c'.repeat(64)},
  instructionDigest: 'a'.repeat(64), toolRegistryDigest: 'b'.repeat(64), segments: [], budget: {utf8Bytes: 0, tokens: null, measurement: 'BYTE_ONLY'}, nativeContext: null});
function hostFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'm04-protected-cut-')), store = new Store(directory);
  cleanups.push(() => { store.close(); rmSync(directory, {recursive: true, force: true, maxRetries: 5}); });
  const ref: SourceRefV1 = {captureId: 'capture', keepCaptured: false, source: {kind: 'FILE_RANGE', sourceId: 'grant', path: 'src/api.ts',
    sourceRevision: 'opaque-source-revision', logicalOwner: {threadId: 'thread', projectId: null, workspaceId: null}, contentDigest: 'e'.repeat(64),
    capturedAt: '2026-01-01T00:00:00.000Z', range: {encoding: 'LINES_1_BASED', startLine: 1, endLine: 2}}};
  store.internal('fixture', 'thread', () => {
    store.put('taskMemory', 'thread:api', 'thread', {id: 'thread:api', threadId: 'thread', key: 'api', content: 'Keep the old API.', revision: 1, author: 'user', updatedAt: ''});
    store.put('request', 'approval', 'thread', {id: 'approval', threadId: 'thread', revision: 1, status: 'pending', title: 'Approve write', prompt: 'Review the write', responseSchema: {}, basis: [], artifactId: null});
    store.put('operation', 'operation', 'thread', {id: 'operation', threadId: 'thread', revision: 1, status: 'running', approved: true, kind: 'write', description: 'Owned work', args: {}, resourceIds: [], preconditions: {}, createdAt: ''});
    store.put('agentWork', 'child-work', 'thread', {workId: 'child-work', parentOwner: {threadId: 'thread', runId: 'old', epoch: 1}, state: 'RUNNING', revision: 1});
    store.put('outbox', 'queued', 'thread', {id: 'queued', threadId: 'thread', status: 'persisted', enteredRuntime: false, sourceRefs: [{...ref, captureId: 'not-delivered'}]});
    store.put('outbox', 'delivered', 'thread', {id: 'delivered', threadId: 'thread', status: 'handled', enteredRuntime: true, sourceRefs: [ref]});
  });
  store.internal('input.processing', 'thread', () => ({runId: 'first', inputIds: ['delivered']}));
  return {store, ref};
}
it('captures only delivered source refs and keeps the exact latest explicit captured-version choice', () => {
  const {store, ref} = hostFixture(), first = readCompactionHostCut(store, 'thread', requestReceipt());
  expect(first.references.map(item => item.kind)).toEqual(['ACTIVE_WORK', 'ACTIVE_WORK', 'DECISION', 'PENDING_APPROVAL', 'SOURCE_EVIDENCE']);
  expect(first.sourceRefs).toEqual([ref]);
  expect(first.references.find(item => item.kind === 'SOURCE_EVIDENCE')).toMatchObject({id: 'capture:capture', revision: ref.source.sourceRevision});
  store.internal('input.processing', 'thread', () => {
    store.put('outbox', 'later', 'thread', {id: 'later', threadId: 'thread', status: 'handled', enteredRuntime: true, sourceRefs: [{...ref, keepCaptured: true}]});
    return {runId: 'second', inputIds: ['later']};
  });
  const second = readCompactionHostCut(store, 'thread', requestReceipt());
  expect(second.sourceRefs).toEqual([{...ref, keepCaptured: true}]); expect(second.revisionDigest).not.toBe(first.revisionDigest);
});
it('orders KEEP_CAPTURED recovery of an older queued row by its admitted delivery', () => {
  const {store, ref} = hostFixture(), first = readCompactionHostCut(store, 'thread', requestReceipt());
  const row = (id: string) => (store.db.prepare("SELECT rowid FROM entities WHERE kind='outbox' AND id=?").get(id) as {rowid: number}).rowid;
  const queuedRow = row('queued'); expect(queuedRow).toBeLessThan(row('delivered'));
  store.internal('source.input.recover', 'thread', () => {
    store.put('outbox', 'queued', 'thread', {...store.get<Record<string, unknown>>('outbox', 'queued'), sourceRefs: [{...ref, keepCaptured: true}],
      sourceRecovery: {action: 'KEEP_CAPTURED', commandId: 'keep', at: '2026-01-02T00:00:00.000Z', resumeRequired: true}});
    return {inputId: 'queued', action: 'KEEP_CAPTURED', resumeRequired: true};
  });
  expect(readCompactionHostCut(store, 'thread', requestReceipt()).sourceRefs).toEqual([ref]);
  store.internal('input.processing', 'thread', () => {
    store.put('outbox', 'queued', 'thread', {...store.get<Record<string, unknown>>('outbox', 'queued'), status: 'processing', runId: 'recovered',
      enteredRuntime: false, sourceRecovery: {action: 'KEEP_CAPTURED', commandId: 'keep', at: '2026-01-02T00:00:00.000Z', resumeRequired: false}});
    return {runId: 'recovered', inputIds: ['queued']};
  });
  store.internal('runtime.input.processing', 'thread', () => {
    store.put('outbox', 'queued', 'thread', {...store.get<Record<string, unknown>>('outbox', 'queued'), enteredRuntime: true});
    return {runId: 'recovered'};
  });
  const recovered = readCompactionHostCut(store, 'thread', requestReceipt());
  expect(row('queued')).toBe(queuedRow);
  expect(recovered.sourceRefs).toEqual([{...ref, keepCaptured: true}]);
  expect(recovered.revisionDigest).not.toBe(first.revisionDigest);
  store.internal('input.processing', 'thread', () => ({runId: 'newer-current-choice', inputIds: ['delivered']}));
  expect(readCompactionHostCut(store, 'thread', requestReceipt()).sourceRefs).toEqual([ref]);
});
it('refuses a missing admission witness or conflicting choices in the same admission', () => {
  const {store, ref} = hostFixture();
  store.internal('unknown-delivery', 'thread', () => store.put('outbox', 'unknown', 'thread', {id: 'unknown', threadId: 'thread', enteredRuntime: true, sourceRefs: [ref]}));
  expect(() => readCompactionHostCut(store, 'thread', requestReceipt())).toThrow(expect.objectContaining({code: 'STALE_REQUEST_CONTEXT'}));
  store.internal('input.processing', 'thread', () => {
    store.put('outbox', 'unknown', 'thread', {id: 'unknown', threadId: 'thread', enteredRuntime: true, sourceRefs: [{...ref, keepCaptured: true}]});
    return {runId: 'ambiguous', inputIds: ['unknown', 'delivered']};
  });
  expect(() => readCompactionHostCut(store, 'thread', requestReceipt())).toThrow(expect.objectContaining({code: 'STALE_REQUEST_CONTEXT'}));
});
it.each([['taskMemory', 'thread:api', 'content'], ['request', 'approval', 'prompt'], ['operation', 'operation', 'description'], ['agentWork', 'child-work', 'state']] as const)
  ('detects changed %s content even without a numeric revision change', (kind, id, field) => {
    const {store} = hostFixture(), before = readCompactionHostCut(store, 'thread', requestReceipt());
    store.internal('changed', 'thread', () => store.put(kind, id, 'thread', {...store.get<Record<string, unknown>>(kind, id), [field]: 'changed'}));
    expect(readCompactionHostCut(store, 'thread', requestReceipt()).revisionDigest).not.toBe(before.revisionDigest);
  });
it('refuses cross-thread records and a protected reference set beyond its bound', () => {
  const {store} = hostFixture();
  store.internal('wrong-owner', 'thread', () => store.put('request', 'approval', 'thread', {...store.get<Record<string, unknown>>('request', 'approval'), threadId: 'other'}));
  expect(() => readCompactionHostCut(store, 'thread', requestReceipt())).toThrow(expect.objectContaining({code: 'STALE_REQUEST_CONTEXT'}));
  store.internal('too-many', 'thread', () => {store.remove('request', 'approval'); for (let index = 0; index < 65; index++) store.put('request', 'pending-' + index, 'thread', {id: 'pending-' + index, threadId: 'thread', status: 'pending', revision: 1});});
  expect(() => readCompactionHostCut(store, 'thread', requestReceipt())).toThrow(expect.objectContaining({code: 'COMPACTION_PROTECTION_LIMIT'}));
});
it.each([{archiveRef: null}, {archiveSha256: null}, {sourceSha256: 'f'.repeat(64)}, {protectedRecords: 0}, {referenceCount: 0},
  {toolPairs: 0}, {afterBytes: 20000}, {afterBytes: 0}, {summarySha256: null}, {beforeBytes: 200000, afterBytes: 100000, retainedBytes: 70000}] satisfies Partial<NativeCompactionReceiptV1>[])
  ('rejects incomplete native application proof %j', patch => {
    const prepared = prepareNativeCompaction(snapshot(), references), envelope = nativeCompactionEnvelope(prepared, 'candidate', owner);
    const receipt: NativeCompactionReceiptV1 = {version: 1, candidateId: 'candidate', planDigest: envelope.planDigest, sourceSha256: prepared.sourceSha256,
      status: 'APPLIED', archiveRef: 'native-archive:' + prepared.sourceSha256, archiveSha256: prepared.sourceSha256,
      retainedBytes: prepared.retainedBytes, protectedRecords: prepared.retainedIndices.length, referenceCount: references.length,
      toolPairs: 1, beforeBytes: 20000, afterBytes: 5000, summarySha256: 'f'.repeat(64), reason: null};
    expect(requireNativeCompactionReceipt(receipt, envelope, 1)).toEqual(receipt);
    expect(() => requireNativeCompactionReceipt({...receipt, ...patch}, envelope, 1)).toThrow(expect.objectContaining({code: 'HERMES_COMPACTION_UNCONFIRMED'}));
  });
