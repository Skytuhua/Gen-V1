import { HarnessError, type HostCommand, type Thread } from '../contracts/index.ts';
import { REVIEW_COMMENT_LIMITS, ReviewCommentCreatePayloadV1, ReviewCommentEditPayloadV1, ReviewCommentRevPayloadV1, ReviewCommentV1, type ReviewComment } from '../contracts/review-comments.ts';
import type { Store } from '../storage/store.ts';

export const REVIEW_COMMENT_KIND = 'reviewComment';
const now = () => new Date().toISOString();

/** Thread-scoped comments; malformed rows are skipped and logged, never crash the thread. */
export function listReviewComments(store: Store, threadId: string): ReviewComment[] {
  const comments: ReviewComment[] = [];
  for (const row of store.all<unknown>(REVIEW_COMMENT_KIND, threadId)) {
    const parsed = ReviewCommentV1.safeParse(row);
    if (parsed.success) comments.push(parsed.data);
    else console.warn('Skipping malformed review comment row:', parsed.error.issues[0]?.message);
  }
  return comments;
}

export function reviewComment(store: Store, threadId: string, id: string): ReviewComment {
  const parsed = ReviewCommentV1.safeParse(store.get(REVIEW_COMMENT_KIND, id));
  if (!parsed.success || parsed.data.threadId !== threadId) throw new HarnessError('NOT_FOUND', 'Unknown review comment.');
  return parsed.data;
}

const expectRev = (comment: ReviewComment, expectedRev: number): void => {
  if (comment.rev !== expectedRev) throw new HarnessError('CONFLICT', 'The review comment changed. Reload it before retrying.');
};

/** Invoke inside the owning command transaction; writes emit the command event. */
export function changeReviewComment(store: Store, thread: Thread, command: HostCommand): unknown {
  const p = command.payload, stamp = now();
  if (command.type === 'review.comment.create') {
    const input = ReviewCommentCreatePayloadV1.parse(p);
    if (thread.sideParentId || thread.kind === 'side' || thread.kind === 'delegate') throw new HarnessError('CAPABILITY_DENIED', 'Review comments belong to the main task.');
    if (!thread.projectId) throw new HarnessError('INVALID_INPUT', 'Review comments need a project-bound thread.');
    if (store.get(REVIEW_COMMENT_KIND, input.id)) throw new HarnessError('CONFLICT', 'A review comment with that id already exists.');
    if (listReviewComments(store, thread.id).length >= REVIEW_COMMENT_LIMITS.perThread) throw new HarnessError('RESOURCE_LIMIT', 'This thread has reached the review comment limit.');
    const body = input.body.trim();
    if (!body) throw new HarnessError('INVALID_INPUT', 'Write a comment first.');
    const comment: ReviewComment = { version: 1, id: input.id, threadId: thread.id, projectId: thread.projectId, anchor: input.anchor, body, status: 'draft', createdAt: stamp, updatedAt: stamp, sentAt: null, inputId: null, runId: null, resolvedBy: null, agentNote: null, rev: 1 };
    store.put(REVIEW_COMMENT_KIND, comment.id, thread.id, comment);
    return { commentId: comment.id, rev: comment.rev, comment };
  }
  const load = (payload: Record<string, unknown>) => {
    const input = ReviewCommentRevPayloadV1.parse(payload), comment = reviewComment(store, thread.id, input.id);
    expectRev(comment, input.expectedRev);
    return comment;
  };
  if (command.type === 'review.comment.edit') {
    const input = ReviewCommentEditPayloadV1.parse(p), comment = reviewComment(store, thread.id, input.id);
    expectRev(comment, input.expectedRev);
    if (comment.status === 'sent' || comment.status === 'resolved') throw new HarnessError('INVALID_INPUT', 'Only draft, replied or unaddressed comments can be edited.');
    const body = input.body.trim();
    if (!body) throw new HarnessError('INVALID_INPUT', 'Write a comment first.');
    // Editing a replied or unaddressed comment returns it to a draft; the last
    // agent note stays for context until the next resolution round.
    const next: ReviewComment = { ...comment, body, status: 'draft', updatedAt: stamp, rev: comment.rev + 1 };
    store.put(REVIEW_COMMENT_KIND, next.id, thread.id, next);
    return { commentId: next.id, rev: next.rev, comment: next };
  }
  const comment = load(p);
  if (command.type === 'review.comment.delete') {
    store.remove(REVIEW_COMMENT_KIND, comment.id);
    return { commentId: comment.id, deleted: true };
  }
  if (command.type === 'review.comment.resolve') {
    if (comment.status === 'draft') throw new HarnessError('INVALID_INPUT', 'Only a sent comment can be resolved.');
    const next: ReviewComment = { ...comment, status: 'resolved', resolvedBy: 'user', updatedAt: stamp, rev: comment.rev + 1 };
    store.put(REVIEW_COMMENT_KIND, next.id, thread.id, next);
    return { commentId: next.id, rev: next.rev, comment: next };
  }
  if (command.type === 'review.comment.reopen') {
    if (comment.status === 'draft' || comment.status === 'sent') throw new HarnessError('INVALID_INPUT', 'Only a resolved, replied or unaddressed comment can be reopened.');
    const next: ReviewComment = { ...comment, status: 'draft', sentAt: null, inputId: null, runId: null, resolvedBy: null, updatedAt: stamp, rev: comment.rev + 1 };
    store.put(REVIEW_COMMENT_KIND, next.id, thread.id, next);
    return { commentId: next.id, rev: next.rev, comment: next };
  }
  throw new HarnessError('UNKNOWN_COMMAND', 'Unknown command: ' + command.type);
}

/** Settlement/tool transitions commit outside a user command; they share the
 * review.comment.* event prefix so open panels refetch (R12). */
export function transitionReviewComment(store: Store, comment: ReviewComment, next: Partial<ReviewComment>, type: 'review.comment.changed' | 'review.comment.deleted' = 'review.comment.changed'): ReviewComment {
  const updated: ReviewComment = { ...comment, ...next, updatedAt: now(), rev: comment.rev + 1 };
  store.internal(type, comment.threadId, () => { store.put(REVIEW_COMMENT_KIND, updated.id, comment.threadId, updated); return { commentId: updated.id, rev: updated.rev, status: updated.status }; });
  return updated;
}
