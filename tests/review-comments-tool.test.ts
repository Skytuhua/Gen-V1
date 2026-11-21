import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store.ts';
import { Service, type ServiceOptions } from '../packages/core/service.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { HarnessError, type RuntimeAdapter, type StartRun, type Thread } from '../packages/contracts/index.ts';
import { listReviewComments } from '../packages/core/review-comments.ts';
import { createHostTools } from '../packages/runtime-pi/tool-definitions.ts';
import { ToolAuthority, buildToolRegistry } from '../packages/core/tool-authority.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); __setCapabilityFlagForTests('ui.reviewCommentsV1', undefined); });

const anchor = { path: 'src/a.ts', side: 'new', startLine: 40, endLine: 42, scope: 'worktree', head: 'a'.repeat(40), revision: 'rev-1', hunkHeader: '@@ -38,6 +38,8 @@', excerpt: 'line one\nline two', excerptTruncated: false };
const id = (n: number) => `9b3f6a4d-2c18-4e7a-9f2d-${String(n).padStart(12, '0')}`;
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const code = (error: unknown) => (error as HarnessError).code;

function fixture(options: ServiceOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'review-tool-')), store = new Store(dir);
  const starts: StartRun[] = [];
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }], start: async input => { starts.push(input); }, followUp: async input => { starts.push(input); }, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { reviewGitRevision: async () => 'rev-1', ...options });
  cleanups.push(async () => { await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const thread: Thread = { id: 'thread-a', title: 'Task', projectName: 'P', projectId: 'p-1', createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null, kind: 'main' };
  store.internal('fixture', thread.id, () => store.put('thread', thread.id, thread.id, thread));
  __setCapabilityFlagForTests('ui.reviewCommentsV1', true);
  const deliver = async (commentId: string) => {
    await service.command({ id: 'c-' + commentId.slice(-4), type: 'review.comment.create', threadId: thread.id, payload: { id: commentId, anchor, body: 'fix this' } });
    await service.command({ id: 's-' + commentId.slice(-4), type: 'message.send', threadId: thread.id, payload: { modelId: 'test/model', content: 'go', reviewCommentIds: [commentId] } });
    await tick();
    return { threadId: thread.id, runId: starts.at(-1)!.runId, epoch: starts.at(-1)!.epoch };
  };
  return { store, service, thread, starts, deliver, resolve: (ctx: { threadId: string; runId: string; epoch: number }, args: Record<string, unknown>) => service.tool({ name: 'review_comment_resolve', args } as never, ctx as never) };
}

describe('review_comment_resolve agent tool (#1288 T05)', () => {
  it('is listed in shared host-tool metadata with an authority classification', () => {
    const tools = createHostTools([], async () => null);
    const tool = tools.find(t => t.name === 'review_comment_resolve');
    expect(tool?.parameters).toMatchObject({ type: 'object' });
    const authority = new ToolAuthority(buildToolRegistry());
    expect(authority.definition('review_comment_resolve')).toMatchObject({ risk: 'WORKSPACE_WRITE', approval: 'none' });
  });
  it('denies the tool when the flag is off', async () => {
    const f = fixture(); const ctx = await f.deliver(id(1));
    __setCapabilityFlagForTests('ui.reviewCommentsV1', false);
    expect(code(await f.resolve(ctx, { commentId: id(1), outcome: 'fixed' }).catch(e => e))).toBe('CAPABILITY_DENIED');
  });
  it('resolves fixed comments as agent-resolved', async () => {
    const f = fixture(); const ctx = await f.deliver(id(1));
    const before = f.store.sequence;
    const result = await f.resolve(ctx, { commentId: id(1), outcome: 'fixed' });
    expect(result).toMatchObject({ ok: true, commentId: id(1), status: 'resolved' });
    const comment = listReviewComments(f.store, f.thread.id)[0];
    expect(comment.status).toBe('resolved'); expect(comment.resolvedBy).toBe('agent');
    expect(f.store.eventsAfter(before).some(e => e.type === 'review.comment.changed')).toBe(true);
  });
  it('replies with a required note on not_changed', async () => {
    const f = fixture(); const ctx = await f.deliver(id(1));
    expect(await f.resolve(ctx, { commentId: id(1), outcome: 'not_changed' }).catch(e => e)).toBeInstanceOf(Error);
    const result = await f.resolve(ctx, { commentId: id(1), outcome: 'not_changed', note: 'matches the codebase convention' });
    expect(result).toMatchObject({ ok: true, status: 'replied' });
    expect(listReviewComments(f.store, f.thread.id)[0].agentNote).toBe('matches the codebase convention');
  });
  it('rejects comments not delivered to the calling run', async () => {
    const f = fixture(); const ctx = await f.deliver(id(1));
    await f.service.command({ id: 'c-draft', type: 'review.comment.create', threadId: f.thread.id, payload: { id: id(9), anchor, body: 'still a draft' } });
    expect(code(await f.resolve(ctx, { commentId: id(9), outcome: 'fixed' }).catch(e => e))).toBe('REVIEW_COMMENT_NOT_IN_RUN');
    expect(code(await f.resolve(ctx, { commentId: id(8), outcome: 'fixed' }).catch(e => e))).toBe('REVIEW_COMMENT_NOT_IN_RUN');
  });
  it('returns nonfatal ok:false when the user changed the comment meanwhile', async () => {
    const f = fixture(); const ctx = await f.deliver(id(1));
    const comment = listReviewComments(f.store, f.thread.id)[0];
    await f.service.command({ id: 'u1', type: 'review.comment.resolve', threadId: f.thread.id, payload: { id: comment.id, expectedRev: comment.rev } });
    const result = await f.resolve(ctx, { commentId: id(1), outcome: 'fixed' });
    expect(result).toMatchObject({ ok: false, reason: 'comment_changed' });
    expect(listReviewComments(f.store, f.thread.id)[0].resolvedBy).toBe('user');
  });
  it('repeats identical calls idempotently', async () => {
    const f = fixture(); const ctx = await f.deliver(id(1));
    await f.resolve(ctx, { commentId: id(1), outcome: 'fixed' });
    const rev = listReviewComments(f.store, f.thread.id)[0].rev;
    const again = await f.resolve(ctx, { commentId: id(1), outcome: 'fixed' });
    expect(again).toMatchObject({ ok: true, status: 'resolved' });
    expect(listReviewComments(f.store, f.thread.id)[0].rev).toBe(rev);
    const withReceipt = await f.resolve(ctx, { commentId: id(1), outcome: 'fixed', commandId: 'rc-1' });
    expect(withReceipt).toMatchObject({ ok: true });
    expect(await f.resolve(ctx, { commentId: id(1), outcome: 'fixed', commandId: 'rc-1' })).toEqual(withReceipt);
  });
});
