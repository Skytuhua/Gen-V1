import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { buildServer } from '../apps/server/server.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { HarnessError, type ReviewComment, type RuntimeAdapter, type Thread } from '../packages/contracts/index.ts';
import { listReviewComments, REVIEW_COMMENT_KIND } from '../packages/core/review-comments.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); __setCapabilityFlagForTests('ui.reviewCommentsV1', undefined); });

const anchor = { path: 'src/a.ts', side: 'new', startLine: 40, endLine: 42, scope: 'worktree', head: 'a'.repeat(40), revision: 'rev-1', hunkHeader: '@@ -38,6 +38,8 @@', excerpt: 'line one\nline two', excerptTruncated: false };
const id = (n: number | string) => `9b3f6a4d-2c18-4e7a-9f2d-${String(n).padStart(12, '0')}`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'review-comments-')), store = new Store(dir);
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime);
  cleanups.push(async () => { await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const thread: Thread = { id: 'thread-a', title: 'Task', projectName: 'P', projectId: 'p-1', createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null, kind: 'main' };
  const side: Thread = { ...thread, id: 'side-a', kind: 'side', sideParentId: thread.id, parentThreadId: thread.id };
  store.internal('fixture', thread.id, () => { store.put('thread', thread.id, thread.id, thread); store.put('thread', side.id, side.id, side); });
  __setCapabilityFlagForTests('ui.reviewCommentsV1', true);
  const send = (commandId: string, type: string, payload: Record<string, unknown>, threadId = thread.id) => service.command({ id: commandId, type, threadId, payload });
  const create = (commandId: string, commentId: string, over: Record<string, unknown> = {}, threadId = thread.id) =>
    send(commandId, 'review.comment.create', { id: commentId, anchor: { ...anchor, ...(over.anchor as object ?? {}) }, body: 'fix this', ...over }, threadId);
  return { store, service, thread, send, create };
}
const code = (error: unknown) => (error as HarnessError).code;

describe('review comment host commands (#1288 T03)', () => {
  it('rejects every command while the flag is off and stores nothing', async () => {
    const f = fixture(); __setCapabilityFlagForTests('ui.reviewCommentsV1', false);
    const error = await f.create('cmd-off', id(1)).catch(e => e);
    expect(code(error)).toBe('CAPABILITY_DENIED');
    expect(f.store.all(REVIEW_COMMENT_KIND)).toEqual([]);
  });
  it('creates a draft at rev 1 and emits a review.comment.* event', async () => {
    const f = fixture(), before = f.store.sequence;
    const receipt = await f.create('cmd-create', id(1));
    const result = receipt.result as { commentId: string; rev: number; comment: ReviewComment };
    expect(result.comment.status).toBe('draft'); expect(result.rev).toBe(1);
    const event = f.store.eventsAfter(before).find(e => e.type === 'review.comment.create');
    expect(event?.threadId).toBe(f.thread.id);
  });
  it('enforces the per-thread limit', async () => {
    const f = fixture();
    f.store.internal('fixture.comments', f.thread.id, () => {
      for (let i = 0; i < 200; i++) f.store.put(REVIEW_COMMENT_KIND, id(i), f.thread.id, { version: 1, id: id(i), threadId: f.thread.id, projectId: 'p-1', anchor, body: 'n', status: 'draft', createdAt: 't', updatedAt: 't', sentAt: null, inputId: null, runId: null, resolvedBy: null, agentNote: null, rev: 1 });
    });
    expect(code(await f.create('cmd-limit', id(201)).catch(e => e))).toBe('RESOURCE_LIMIT');
  });
  it('rejects edit with a stale rev and edit of a sent comment', async () => {
    const f = fixture(); await f.create('cmd-1', id(1));
    expect(code(await f.send('cmd-edit-stale', 'review.comment.edit', { id: id(1), body: 'new', expectedRev: 9 }).catch(e => e))).toBe('CONFLICT');
    f.store.internal('fixture.sent', f.thread.id, () => { const c = listReviewComments(f.store, f.thread.id)[0]; f.store.put(REVIEW_COMMENT_KIND, c.id, c.threadId, { ...c, status: 'sent', rev: 2 }); });
    expect(code(await f.send('cmd-edit-sent', 'review.comment.edit', { id: id(1), body: 'new', expectedRev: 2 }).catch(e => e))).toBe('INVALID_INPUT');
  });
  it('edits a replied comment back to draft and keeps the agent note', async () => {
    const f = fixture(); await f.create('cmd-1', id(1));
    f.store.internal('fixture.replied', f.thread.id, () => { const c = listReviewComments(f.store, f.thread.id)[0]; f.store.put(REVIEW_COMMENT_KIND, c.id, c.threadId, { ...c, status: 'replied', agentNote: 'not applicable', rev: 2 }); });
    const result = (await f.send('cmd-edit', 'review.comment.edit', { id: id(1), body: 'clarified', expectedRev: 2 })).result as { comment: ReviewComment };
    expect(result.comment.status).toBe('draft'); expect(result.comment.agentNote).toBe('not applicable'); expect(result.comment.rev).toBe(3);
  });
  it('deletes a comment physically', async () => {
    const f = fixture(); await f.create('cmd-1', id(1));
    await f.send('cmd-del', 'review.comment.delete', { id: id(1), expectedRev: 1 });
    expect(listReviewComments(f.store, f.thread.id)).toEqual([]);
  });
  it('rejects resolving a draft and resolves an unaddressed comment as user', async () => {
    const f = fixture(); await f.create('cmd-1', id(1)); await f.create('cmd-2', id(2));
    expect(code(await f.send('cmd-res-draft', 'review.comment.resolve', { id: id(1), expectedRev: 1 }).catch(e => e))).toBe('INVALID_INPUT');
    f.store.internal('fixture.unaddressed', f.thread.id, () => { const c = listReviewComments(f.store, f.thread.id).find(x => x.id === id(2))!; f.store.put(REVIEW_COMMENT_KIND, c.id, c.threadId, { ...c, status: 'unaddressed', rev: 2 }); });
    const result = (await f.send('cmd-res', 'review.comment.resolve', { id: id(2), expectedRev: 2 })).result as { comment: ReviewComment };
    expect(result.comment.status).toBe('resolved'); expect(result.comment.resolvedBy).toBe('user');
  });
  it('reopens a resolved comment to draft, clears send state, keeps the note', async () => {
    const f = fixture(); await f.create('cmd-1', id(1));
    f.store.internal('fixture.resolved', f.thread.id, () => { const c = listReviewComments(f.store, f.thread.id)[0]; f.store.put(REVIEW_COMMENT_KIND, c.id, c.threadId, { ...c, status: 'resolved', resolvedBy: 'agent', agentNote: 'done', sentAt: 't', inputId: 'in-1', runId: 'r-1', rev: 3 }); });
    const result = (await f.send('cmd-reopen', 'review.comment.reopen', { id: id(1), expectedRev: 3 })).result as { comment: ReviewComment };
    expect(result.comment).toMatchObject({ status: 'draft', sentAt: null, inputId: null, runId: null, resolvedBy: null, agentNote: 'done', rev: 4 });
  });
  it('rejects commands on a side conversation', async () => {
    const f = fixture();
    expect(code(await f.create('cmd-side', id(9), {}, 'side-a').catch(e => e))).toBe('SIDE_CHAT_READ_ONLY');
    expect(listReviewComments(f.store, 'side-a')).toEqual([]);
  });
  it('replays the same command id once', async () => {
    const f = fixture(), command = { id: 'cmd-replay', type: 'review.comment.create', threadId: f.thread.id, payload: { id: id(1), anchor, body: 'fix this' } };
    const first = await f.service.command(command), second = await f.service.command(command);
    expect(second).toEqual(first); expect(listReviewComments(f.store, f.thread.id)).toHaveLength(1);
  });
  it('keeps comments scoped to and retained with their thread', async () => {
    const f = fixture(); await f.create('cmd-1', id(1));
    const other: Thread = { ...f.thread, id: 'thread-b', projectId: 'p-1' };
    f.store.internal('fixture.other', other.id, () => f.store.put('thread', other.id, other.id, other));
    expect(listReviewComments(f.store, other.id)).toEqual([]);
    // No physical thread delete exists (T01 D5): archiving retains comments.
    await f.send('cmd-archive', 'thread.archive', {});
    expect(listReviewComments(f.store, f.thread.id)).toHaveLength(1);
  });
});

describe('review comment read route (#1288 T03)', () => {
  async function http(flag: boolean) {
    const f = fixture(), app = await buildServer(f.service, { port: 4317, dev: false });
    cleanups.push(async () => { await app.close(); });
    const bootstrap = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } });
    const headers = { host: '127.0.0.1:4317', cookie: String(bootstrap.headers['set-cookie']).split(';')[0] };
    __setCapabilityFlagForTests('ui.reviewCommentsV1', flag);
    return { ...f, app, headers };
  }
  it('reports disabled with the flag off and lists comments with it on', async () => {
    const f = await http(true); await f.create('cmd-1', id(1));
    const on = await f.app.inject({ url: `/api/threads/${f.thread.id}/review-comments`, headers: f.headers });
    expect(on.statusCode).toBe(200); expect(on.headers['cache-control']).toBe('no-store');
    expect(on.json()).toMatchObject({ enabled: true }); expect(on.json().comments).toHaveLength(1);
    __setCapabilityFlagForTests('ui.reviewCommentsV1', false);
    const off = await f.app.inject({ url: `/api/threads/${f.thread.id}/review-comments`, headers: f.headers });
    expect(off.json()).toEqual({ enabled: false, comments: [] });
  });
  it('requires authentication and rejects unknown threads', async () => {
    const f = await http(true);
    expect((await f.app.inject({ url: `/api/threads/${f.thread.id}/review-comments`, headers: { host: '127.0.0.1:4317' } })).statusCode).toBe(401);
    expect((await f.app.inject({ url: '/api/threads/nope/review-comments', headers: f.headers })).statusCode).toBe(404);
  });
});
