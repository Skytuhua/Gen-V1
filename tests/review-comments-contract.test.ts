import { afterEach, describe, expect, it } from 'vitest';
import { REVIEW_COMMENT_LIMITS, ReviewCommentAnchorV1, ReviewCommentCreatePayloadV1, ReviewCommentIdsV1, ReviewCommentV1, ReviewResolveToolInput } from '../packages/contracts/review-comments.ts';
import { capabilityEnabled, __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';

afterEach(() => { __setCapabilityFlagForTests('ui.reviewCommentsV1', undefined); });

const anchor = (over: Record<string, unknown> = {}) => ({
  path: 'src/a.ts', side: 'new', startLine: 40, endLine: 42, scope: 'worktree',
  head: 'a'.repeat(40), revision: 'rev-1', hunkHeader: '@@ -38,6 +38,8 @@',
  excerpt: 'line one\nline two', excerptTruncated: false, ...over,
});
const comment = (over: Record<string, unknown> = {}) => ({
  version: 1, id: '9b3f6a4d-2c18-4e7a-9f2d-1c5a8b7d6e4f', threadId: 't-1', projectId: 'p-1',
  anchor: anchor(), body: 'please rename this', status: 'draft',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  sentAt: null, inputId: null, runId: null, resolvedBy: null, agentNote: null, rev: 1, ...over,
});

describe('review comment contracts (#1288)', () => {
  it('accepts a valid anchor and comment', () => {
    expect(ReviewCommentAnchorV1.parse(anchor()).path).toBe('src/a.ts');
    expect(ReviewCommentV1.parse(comment()).status).toBe('draft');
  });
  it('rejects invalid anchors', () => {
    const bad = [
      anchor({ endLine: 39 }),                                    // endLine < startLine
      anchor({ startLine: 1, endLine: 51 }),                      // 51-line range
      anchor({ path: '/abs' }), anchor({ path: 'a/../b' }), anchor({ path: 'a\\b' }),
      anchor({ path: 'a/\0/b' }), anchor({ path: '' }), anchor({ path: 'a'.repeat(1025) }),
      anchor({ excerpt: 'x'.repeat(REVIEW_COMMENT_LIMITS.excerptBytes + 1) }),
    ];
    for (const candidate of bad) expect(ReviewCommentAnchorV1.safeParse(candidate).success).toBe(false);
    expect(ReviewCommentAnchorV1.safeParse(anchor({ excerpt: 'x'.repeat(REVIEW_COMMENT_LIMITS.excerptBytes) })).success).toBe(true);
  });
  it('rejects out-of-range bodies and unknown keys', () => {
    expect(ReviewCommentV1.safeParse(comment({ body: '' })).success).toBe(false);
    expect(ReviewCommentV1.safeParse(comment({ body: 'x'.repeat(4001) })).success).toBe(false);
    expect(ReviewCommentV1.safeParse(comment({ body: 'x'.repeat(4000) })).success).toBe(true);
    expect(ReviewCommentV1.safeParse(comment({ extra: true })).success).toBe(false);
  });
  it('validates the resolve tool input', () => {
    expect(ReviewResolveToolInput.safeParse({ commentId: comment().id, outcome: 'not_changed' }).success).toBe(false);
    expect(ReviewResolveToolInput.safeParse({ commentId: comment().id, outcome: 'not_changed', note: ' ' }).success).toBe(false);
    expect(ReviewResolveToolInput.safeParse({ commentId: comment().id, outcome: 'not_changed', note: 'already done' }).success).toBe(true);
    expect(ReviewResolveToolInput.safeParse({ commentId: comment().id, outcome: 'fixed', note: 'renamed in a.ts' }).success).toBe(true);
    expect(ReviewResolveToolInput.safeParse({ commentId: 'not-a-uuid', outcome: 'fixed' }).success).toBe(false);
  });
  it('bounds reviewCommentIds on message.send', () => {
    const id = comment().id;
    expect(ReviewCommentIdsV1.safeParse([]).success).toBe(false);
    expect(ReviewCommentIdsV1.safeParse([id]).success).toBe(true);
    expect(ReviewCommentIdsV1.safeParse([id, id]).success).toBe(false);
    expect(ReviewCommentIdsV1.safeParse(Array(21).fill('9b3f6a4d-2c18-4e7a-9f2d-000000000001').map((v, i) => v.slice(0, -8) + String(i).padStart(8, '0'))).success).toBe(false);
    expect(ReviewCommentIdsV1.safeParse(Array.from({ length: 20 }, (_, i) => `9b3f6a4d-2c18-4e7a-9f2d-${String(i).padStart(12, '0')}`)).success).toBe(true);
  });
  it('validates command payloads strictly', () => {
    expect(ReviewCommentCreatePayloadV1.safeParse({ id: comment().id, anchor: anchor(), body: 'x' }).success).toBe(true);
    expect(ReviewCommentCreatePayloadV1.safeParse({ id: comment().id, anchor: anchor(), body: 'x', hack: 1 }).success).toBe(false);
  });
  it('registers ui.reviewCommentsV1 default off', () => {
    expect(capabilityEnabled('ui.reviewCommentsV1')).toBe(false);
    __setCapabilityFlagForTests('ui.reviewCommentsV1', true);
    expect(capabilityEnabled('ui.reviewCommentsV1')).toBe(true);
  });
});
