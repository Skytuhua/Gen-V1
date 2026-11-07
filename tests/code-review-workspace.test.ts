import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ComparisonIdentity, ComparisonRead} from '../packages/contracts/code-review';
import {codeReviewClient} from '../apps/web/src/code-review-workspace/client';
import {acknowledgeOperation, canUseDraft, comparisonKey, newDraft, rebindDraft, sameOwner, type ReviewOperation} from '../apps/web/src/code-review-workspace/model';

const local: ComparisonIdentity = {kind: 'local', id: 'a'.repeat(64), scope: 'worktree', headOid: '1'.repeat(40), branch: 'topic', revision: 'b'.repeat(64), base: {kind: 'index', revision: 'c'.repeat(64)}, head: {kind: 'worktree', revision: 'b'.repeat(64)}};
const remote: ComparisonIdentity = {kind: 'pull-request', id: 'd'.repeat(64), repo: 'owner/repo', number: 48, pullRequestId: 'PR_real', baseOid: '2'.repeat(40), headOid: '3'.repeat(40), mergeBaseOid: '4'.repeat(40), baseRef: 'main', headRef: 'topic', semantics: 'merge-base'};
const owner = {authority: {kind: 'local' as const}, projectId: 'project-one', threadId: 'copy-one'};
const action = {head: local.headOid, revision: 'e'.repeat(64), branch: 'topic'};
afterEach(() => vi.unstubAllGlobals());

describe('comparison identity and draft authority', () => {
  it('invalidates every exact base/head/local identity change even if the comparison id is reused', () => {
    for (const next of [{...local, revision: 'new'}, {...local, head: {...local.head, revision: 'new'}}, {...local, base: {...local.base, revision: 'new'}}, {...local, branch: 'other'}, {...local, headOid: 'new'}, {...local, scope: 'staged' as const}]) expect(comparisonKey(next)).not.toBe(comparisonKey(local));
    for (const next of [{...remote, baseOid: 'new'}, {...remote, headOid: 'new'}, {...remote, mergeBaseOid: 'new'}, {...remote, pullRequestId: 'other'}, {...remote, repo: 'other/repo'}]) expect(comparisonKey(next)).not.toBe(comparisonKey(remote));
  });
  it('never crosses project, working copy or plugin ownership', () => {
    expect(sameOwner(owner, {...owner})).toBe(true);
    expect(sameOwner(owner, {...owner, threadId: 'copy-two'})).toBe(false);
    expect(sameOwner(owner, {...owner, projectId: 'project-two'})).toBe(false);
    expect(sameOwner(owner, {...owner, authority: {kind: 'plugin', pluginId: 'private', scopeId: 'scope'}})).toBe(false);
  });
  it('retains exact text but invalidates stale action revisions and uncertain outcomes', () => {
    const draft = {...newDraft(local, action), body: '  Keep\nexact text\n', event: 'REQUEST_CHANGES' as const};
    expect(canUseDraft(draft, local, action)).toBe(true);
    expect(canUseDraft(draft, local, {...action, revision: 'changed'})).toBe(false);
    const uncertain = {...draft, outcome: 'uncertain' as const};
    expect(canUseDraft(uncertain, local, action)).toBe(false);
    expect(rebindDraft(uncertain, remote, action)).toEqual(uncertain);
    const rebound = rebindDraft(draft, remote, action);
    expect(rebound.body).toBe('  Keep\nexact text\n');
    expect(rebound.event).toBe('REQUEST_CHANGES');
    expect(canUseDraft(rebound, remote, action)).toBe(true);
  });
});

describe('read-only comparison HTTP boundary', () => {
  it('uses all four exact routes and never substitutes the unstaged diff for a remote PR', async () => {
    const seen: {url: string; init?: RequestInit}[] = [];
    const response: ComparisonRead = {state: 'loading'};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {seen.push({url, init}); return new Response(JSON.stringify(url === '/api/bootstrap' ? {csrfToken: 'synthetic'} : response));});
    await codeReviewClient.comparison({owner, target: {kind: 'local', scope: 'staged'}});
    await codeReviewClient.file({owner, target: {kind: 'local', scope: 'worktree'}}, local, 'src/a #?.ts');
    await codeReviewClient.comparison({owner, target: {kind: 'pull-request', repo: 'owner/repo', number: 48}});
    await codeReviewClient.file({owner, target: {kind: 'pull-request', repo: 'owner/repo', number: 48}}, remote, 'src/a #?.ts');
    expect(seen.filter(row => row.url !== '/api/bootstrap').map(row => row.url)).toEqual([
      '/api/projects/project-one/git/comparison?threadId=copy-one&scope=staged',
      '/api/projects/project-one/git/comparison/file?threadId=copy-one&comparisonId=' + local.id + '&path=src%2Fa+%23%3F.ts',
      '/api/projects/project-one/pull-requests/48/comparison?threadId=copy-one',
      '/api/projects/project-one/pull-request-comparison/file?threadId=copy-one&comparisonId=' + remote.id + '&path=src%2Fa+%23%3F.ts',
    ]);
    for (const row of seen.slice(1)) expect(row.init).toMatchObject({cache: 'no-store', credentials: 'same-origin', redirect: 'error'});
  });
  it('rejects plugin owners before opening any local route', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(codeReviewClient.comparison({owner: {...owner, authority: {kind: 'plugin', pluginId: 'private', scopeId: 'scope'}}, target: {kind: 'local', scope: 'worktree'}})).rejects.toThrow('local');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('immutable attempt ownership', () => {
  const operation: ReviewOperation = {operationId: 'attempt-A', selection: {owner, target: {kind: 'local', scope: 'worktree'}}, comparison: local, action,
    operation: 'stage', payload: {paths: ['src/exact.ts'], revision: action.revision, expectedHead: action.head}};
  it('only acknowledges the unresolved attempt and preserves newer editable content', () => {
    const pending = {...newDraft(local, action), operation, body: 'Newer unsent review', commitMessage: 'Newer unsent commit', outcome: 'pending' as const};
    expect(acknowledgeOperation(pending, 'attempt-older', 'confirmed')).toBeNull();
    const confirmed = acknowledgeOperation(pending, 'attempt-A', 'confirmed')!;
    expect(confirmed).toEqual({...pending, outcome: 'confirmed'});
    for (const outcome of ['confirmed', 'stale', 'uncertain', 'revoked'] as const) {
      expect(acknowledgeOperation(confirmed, 'attempt-A', outcome)).toBeNull();
      expect(acknowledgeOperation({...confirmed, outcome: 'idle'}, 'attempt-A', outcome)).toBeNull();
      expect(acknowledgeOperation({...pending, operation: {...operation, operationId: 'attempt-B'}}, 'attempt-A', outcome)).toBeNull();
    }
  });
  it('never invents ownership for legacy unresolved drafts', () => {
    const legacy = {...newDraft(local, action), body: 'Legacy content', outcome: 'uncertain' as const};
    expect(acknowledgeOperation(legacy, 'attempt-A', 'confirmed')).toBeNull();
    expect(rebindDraft(legacy, remote, action)).toEqual(legacy);
  });
});
