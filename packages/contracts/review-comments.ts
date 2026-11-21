import { z } from "zod";

// Inline review comments on the working-copy diff (issue #1288, flag
// ui.reviewCommentsV1). Comments are host-persisted entities; excerpts and
// bodies are inert quoted data and are never treated as instructions.
export const REVIEW_COMMENT_LIMITS = {
  bodyChars: 4000,
  noteChars: 2000,
  excerptBytes: 8192,
  rangeLines: 50,
  perThread: 200,
  perSend: 20,
  blockBytes: 65536,
} as const;

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

/** Repo-relative path: '/' separators, no '..', '.', empty segments, leading '/', '\\' or NUL. */
export const ReviewCommentPathV1 = z.string().min(1).max(1024).refine(
  (value) =>
    !value.includes("\0") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
  "repo-relative '/'-separated path",
);

export const ReviewCommentAnchorV1 = z
  .strictObject({
    path: ReviewCommentPathV1,
    side: z.enum(["new", "old"]),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    scope: z.enum(["worktree", "staged"]),
    head: z.string().max(64),
    revision: z.string().max(128),
    hunkHeader: z.string().max(512),
    excerpt: z.string().refine((value) => utf8Length(value) <= REVIEW_COMMENT_LIMITS.excerptBytes, "excerpt exceeds 8 KiB"),
    excerptTruncated: z.boolean(),
  })
  .refine(
    (anchor) => anchor.endLine >= anchor.startLine && anchor.endLine - anchor.startLine < REVIEW_COMMENT_LIMITS.rangeLines,
    "endLine must be >= startLine and the range may span at most 50 lines",
  );

export const ReviewCommentStatusV1 = z.enum(["draft", "sent", "resolved", "replied", "unaddressed"]);

export const ReviewCommentV1 = z.strictObject({
  version: z.literal(1),
  id: z.string().uuid(),
  threadId: z.string(),
  projectId: z.string(),
  anchor: ReviewCommentAnchorV1,
  body: z.string().min(1).max(REVIEW_COMMENT_LIMITS.bodyChars),
  status: ReviewCommentStatusV1,
  createdAt: z.string(),
  updatedAt: z.string(),
  sentAt: z.string().nullable(),
  inputId: z.string().nullable(),
  runId: z.string().nullable(),
  resolvedBy: z.enum(["agent", "user"]).nullable(),
  agentNote: z.string().max(REVIEW_COMMENT_LIMITS.noteChars).nullable(),
  rev: z.number().int().min(1),
});

/** Transcript metadata stored on the user message that carried the comments. */
export const ReviewCommentRefV1 = z.strictObject({
  id: z.string().uuid(),
  path: ReviewCommentPathV1,
  side: z.enum(["new", "old"]),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});

/** Optional message.send payload field: drafts (and reopened comments) to deliver. */
export const ReviewCommentIdsV1 = z
  .array(z.string().uuid())
  .min(1)
  .max(REVIEW_COMMENT_LIMITS.perSend)
  .refine((ids) => new Set(ids).size === ids.length, "duplicate review comment id");

export const ReviewResolveToolInput = z
  .strictObject({
    commentId: z.string().uuid(),
    outcome: z.enum(["fixed", "not_changed"]),
    note: z.string().max(REVIEW_COMMENT_LIMITS.noteChars).optional(),
  })
  .refine(
    (input) => input.outcome !== "not_changed" || (typeof input.note === "string" && input.note.trim().length >= 1),
    "note is required for not_changed",
  );

// Command payloads (HostCommand.type → payload): the authenticated
// /api/commands path validates these strictly per command type.
export const ReviewCommentCreatePayloadV1 = z.strictObject({
  id: z.string().uuid(),
  anchor: ReviewCommentAnchorV1,
  body: z.string().min(1).max(REVIEW_COMMENT_LIMITS.bodyChars),
});
export const ReviewCommentEditPayloadV1 = z.strictObject({
  id: z.string().uuid(),
  body: z.string().min(1).max(REVIEW_COMMENT_LIMITS.bodyChars),
  expectedRev: z.number().int().min(1),
});
// review.comment.delete / .resolve / .reopen share one payload shape.
export const ReviewCommentRevPayloadV1 = z.strictObject({
  id: z.string().uuid(),
  expectedRev: z.number().int().min(1),
});

export type ReviewCommentAnchor = z.infer<typeof ReviewCommentAnchorV1>;
export type ReviewCommentStatus = z.infer<typeof ReviewCommentStatusV1>;
export type ReviewComment = z.infer<typeof ReviewCommentV1>;
export type ReviewCommentRef = z.infer<typeof ReviewCommentRefV1>;
export type ReviewResolveInput = z.infer<typeof ReviewResolveToolInput>;
