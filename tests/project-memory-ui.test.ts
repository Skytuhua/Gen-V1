import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {MemoryScope, MemoryItemV1, ProjectMemoryView} from '../packages/contracts/project-memory';
import type {Snapshot, Thread} from '../packages/contracts';

const scope: MemoryScope = {projectId: 'project-a', projectIdentity: 'a'.repeat(64), threadId: 'thread-a', accountId: 'account-a', bindingDigest: 'b'.repeat(64)};
const item: MemoryItemV1 = {id: 'memory-a', projectIdentity: scope.projectIdentity, scope: 'PROJECT', kind: 'CONSTRAINT', text: 'Use UTC for exported dates.', revision: 2, state: 'ACCEPTED', sourceRefs: [{ownerThreadId: 'thread-a', sourceKind: 'MESSAGE', sourceId: 'message-a', sourceRevision: '1', capturedSeq: 4, digest: 'c'.repeat(64), observedStatus: 'REPORTED'}], assertedBy: {kind: 'USER', id: 'local-user'}, observedAt: '2026-11-15T00:00:00Z', expiresAt: null, supersedes: [], sensitivity: 'NORMAL', reviewDecision: null};
const view = (): ProjectMemoryView => ({scope, projectName: 'Project A', available: true, disabledReason: null, enabled: true, configRevision: 1, sourceThreadIds: ['thread-a'], eligibleThreads: [{id: 'thread-a', title: 'Source conversation'}], items: [{item, lastUsedAt: null, conflictRevisions: []}], tombstones: []});
const owner = {projectId: scope.projectId, threadId: scope.threadId, accountId: scope.accountId};
const api = async () => {
  const module = await import('../apps/web/src/project-memory-api').catch(() => null);
  expect(module, 'The bounded project memory client must be implemented.').not.toBeNull();
  return module!;
};
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
function responses(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/bootstrap' ? Response.json({csrfToken: 'csrf'}) : Response.json(body)));
}

it('makes project memory reachable from an owning main project context without making a request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const {ProjectContextSurface} = await import('../apps/web/src/ProjectContextSurface');
  const thread = {id: 'thread-a', projectId: 'project-a', kind: 'main', accountId: 'account-a'} as Thread;
  const snapshot = {threads: [thread], data: [], messages: [], artifacts: [], operations: [], requests: []} as unknown as Snapshot;
  expect(renderToStaticMarkup(createElement(ProjectContextSurface, {thread, snapshot}))).toContain('Project memory');
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['projectId', 'threadId', 'accountId'] as const)('rejects a view returned for a different %s', async field => {
  responses({...view(), scope: {...scope, [field]: 'foreign'}});
  await expect((await api()).getProjectMemory(owner)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('rejects an item from a different physical project inside a valid response envelope', async () => {
  const value = view(); value.items[0].item = {...item, projectIdentity: 'd'.repeat(64)}; responses(value);
  await expect((await api()).getProjectMemory(owner)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('refuses a replacement physical binding during an open review', async () => {
  responses({...view(), scope: {...scope, bindingDigest: 'd'.repeat(64)}});
  await expect((await api()).getProjectMemory(owner, undefined, scope)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('rejects a view that republishes text for an existing deletion tombstone', async () => {
  const value = view(); value.tombstones = [{itemId: item.id, projectIdentity: scope.projectIdentity, deletionRevision: 3, deletedAt: item.observedAt, sourceExclusions: item.sourceRefs, affectedDerivedArtifacts: [], purgeStatus: 'PENDING'}]; responses(value);
  await expect((await api()).getProjectMemory(owner)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('requests the exact item revision and source digest and rejects another source revision', async () => {
  responses({scope, ref: {...item.sourceRefs[0], sourceRevision: '2'}, label: 'Message', content: 'Changed source'});
  await expect((await api()).getMemorySource(scope, item, item.sourceRefs[0])).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
  const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  expect(requests.at(-1)).toContain('itemId=memory-a&revision=2&sourceDigest=' + 'c'.repeat(64));
});

it('pins the complete source reference when equal content has multiple origins', async () => {
  const pinned = {...item, sourceRefs: [{...item.sourceRefs[0], digest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'}]};
  responses({scope, ref: pinned.sourceRefs[0], label: 'Message', content: 'hello'});
  await expect((await api()).getMemorySource(scope, pinned, pinned.sourceRefs[0])).resolves.toMatchObject({content: 'hello'});
  const request = new URL(String(vi.mocked(fetch).mock.calls.at(-1)![0]), 'http://local');
  expect(JSON.parse(request.searchParams.get('sourceRef') ?? 'null')).toEqual(pinned.sourceRefs[0]);
});

it('rejects source bytes that do not match the immutable recorded digest', async () => {
  const pinned = {...item, sourceRefs: [{...item.sourceRefs[0], digest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'}]};
  responses({scope, ref: pinned.sourceRefs[0], label: 'Message', content: 'tampered'});
  await expect((await api()).getMemorySource(scope, pinned, pinned.sourceRefs[0])).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('does not publish source content when browser digest verification is unavailable', async () => {
  vi.stubGlobal('crypto', {});
  const pinned = {...item, sourceRefs: [{...item.sourceRefs[0], digest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'}]};
  responses({scope, ref: pinned.sourceRefs[0], label: 'Message', content: 'hello'});
  await expect((await api()).getMemorySource(scope, pinned, pinned.sourceRefs[0])).rejects.toMatchObject({code: 'SOURCE_UNAVAILABLE'});
});

it('does not accept a forget preview for another revision', async () => {
  responses({scope, itemId: item.id, revision: 3, affectedDerivedArtifacts: [], immediateExclusion: true, localPurgeAfter: '2026-11-22T00:00:00Z', externalDeletion: 'NOT_SUPPORTED'});
  await expect((await api()).getMemoryForgetPreview(scope, item)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('sends a revision-bound user action with CSRF and a stable command ID on a transport retry', async () => {
  let attempted = 0; const writes: {body: string; csrf: string | null}[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/bootstrap') return Response.json({csrfToken: 'csrf'});
    writes.push({body: String(init?.body), csrf: new Headers(init?.headers).get('x-harness-csrf')});
    if (!attempted++) throw Error('Connection lost');
    return Response.json({commandId: 'review-command', eventSeq: 9, result: {itemId: item.id, revision: 3, state: 'ACCEPTED'}});
  }));
  await expect((await api()).mutateProjectMemory(scope, {action: 'accept', itemId: item.id, baseRevision: 2}, 'review-command', () => true)).resolves.toMatchObject({commandId: 'review-command'});
  expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]); expect(writes[0].csrf).toBe('csrf');
  expect(JSON.parse(writes[0].body)).toEqual({commandId: 'review-command', scope, operation: {action: 'accept', itemId: 'memory-a', baseRevision: 2}});
});

it('does not dispatch a mutation after the owning view changes', async () => {
  responses({});
  await expect((await api()).mutateProjectMemory(scope, {action: 'expire', itemId: item.id, baseRevision: 2}, 'review-command', () => false)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/actions'))).toHaveLength(0);
});

it('rejects another command receipt instead of acknowledging the reviewed revision', async () => {
  responses({commandId: 'wrong-command', eventSeq: 9, result: {itemId: item.id, revision: 3, state: 'ACCEPTED'}});
  await expect((await api()).mutateProjectMemory(scope, {action: 'accept', itemId: item.id, baseRevision: 2}, 'review-command', () => true)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('rejects an export whose owner differs or whose redaction claim is absent', async () => {
  responses({scope: {...scope, accountId: 'foreign'}, redacted: true, items: [], tombstones: []});
  await expect((await api()).exportProjectMemory(scope, () => true)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
  responses({scope, redacted: false, items: [], tombstones: []});
  await expect((await api()).exportProjectMemory(scope, () => true)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('only exposes recall for the exact request generation and owner', async () => {
  const module = await import('../apps/web/src/ContextInspector');
  expect(typeof module.ownedMemoryRecall, 'Context inspector must fence request-bound recall.').toBe('function');
  const thread = {id: 'thread-a', projectId: 'project-a', accountId: 'account-a', kind: 'main'} as Thread;
  const presentation = {threadId: thread.id, projectId: 'project-a', accountId: 'account-a', projectIdentity: scope.projectIdentity, requestId: 'request-a', contextGeneration: 7, injectedBytes: 200, items: [item], recall: {requestId: 'request-a', projectIdentity: scope.projectIdentity, contextGeneration: 7, queryDigest: 'd'.repeat(64), candidateIds: [item.id], selectedRevisions: [{itemId: item.id, revision: 2}], scores: [], exclusions: [], budgetBytes: 4096, producedAt: item.observedAt, status: 'COMPLETE' as const}};
  expect(module.ownedMemoryRecall(thread, presentation)?.recall.requestId).toBe('request-a');
  expect(module.ownedMemoryRecall({...thread, accountId: 'foreign'}, presentation)).toBeUndefined();
  expect(module.ownedMemoryRecall(thread, {...presentation, contextGeneration: 8})).toBeUndefined();
  expect(module.ownedMemoryRecall(thread, {...presentation, items: [{...item, revision: 3}]})).toBeUndefined();
  expect(module.ownedMemoryRecall(thread, {...presentation, injectedBytes: 5000})).toBeUndefined();
});
