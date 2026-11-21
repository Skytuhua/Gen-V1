import { z } from 'zod';
import { ApiError, authenticated, csrfToken, read } from './api.ts';

// Client-side zod mirror of the publish wire contract in
// packages/contracts/workspace-publish.ts @ 79d9396743 (PR #1291). The web
// bundle consumes HTTP JSON and cannot import the workspace package, so the
// schema is vendored here; keep it in sync while that PR is in review.
const identifier = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/),
  oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const repoName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const branchName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9/_-]{0,150}$/);
const unicode = (value: string) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\0') && unicode(value));
const boundedText = (max: number) => z.string().max(max).refine(unicode);
const pathName = z.string().min(1).max(1024);
const fileCounts = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();

export const PUBLISH_LIMITS = {
  files: 1000,
  selectedPaths: 1000,
  title: 200,
  commitMessage: 4000,
  body: 64000,
  subjectLength: 72,
} as const;

export const publishFileSchema = z.strictObject({
  path: pathName,
  added: fileCounts,
  removed: fileCounts,
  untracked: z.boolean(),
});
export type PublishFile = z.infer<typeof publishFileSchema>;

export const publishDraftV1Schema = z.strictObject({
  version: z.literal(1),
  projectId: identifier,
  threadId: identifier,
  branch: z.string().max(1024),
  head: oid,
  revision,
  base: branchName,
  baseNote: boundedText(1000).optional(),
  files: z.array(publishFileSchema).max(PUBLISH_LIMITS.files),
  commitMessage: text(PUBLISH_LIMITS.commitMessage),
  title: text(PUBLISH_LIMITS.title),
  body: boundedText(PUBLISH_LIMITS.body),
});
export type PublishDraftV1 = z.infer<typeof publishDraftV1Schema>;

export const publishRequestV1Schema = z.strictObject({
  id: identifier,
  threadId: identifier,
  head: oid,
  revision,
  selectedPaths: z.array(pathName).max(PUBLISH_LIMITS.selectedPaths),
  commitMessage: text(PUBLISH_LIMITS.commitMessage).refine((value) => value.trim().length > 0),
  title: text(PUBLISH_LIMITS.title).refine((value) => value.trim().length > 0),
  body: boundedText(PUBLISH_LIMITS.body),
  base: branchName,
});
export type PublishRequestV1 = z.infer<typeof publishRequestV1Schema>;

export const publishStepStateSchema = z.enum(['not-started', 'confirmed', 'not-applied', 'uncertain']);
export const publishStepSchema = z.strictObject({
  state: publishStepStateSchema,
  receiptId: identifier.optional(),
  at: z.string().max(64).optional(),
  error: z
    .strictObject({ code: z.string().min(1).max(200), message: z.string().max(4000) })
    .optional(),
});
export type PublishStep = z.infer<typeof publishStepSchema>;

export const publishOperationV1Schema = z.strictObject({
  id: identifier,
  owner: z.strictObject({ projectId: identifier, threadId: identifier }),
  createdAt: z.string().max(64),
  request: publishRequestV1Schema,
  steps: z.strictObject({
    commit: publishStepSchema,
    push: publishStepSchema,
    pr: publishStepSchema,
    link: publishStepSchema,
  }),
  result: z
    .strictObject({ url: z.string().max(2048), number: z.number().int().positive(), head: oid, repo: repoName })
    .optional(),
});
export type PublishOperationV1 = z.infer<typeof publishOperationV1Schema>;

const endpoint = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/publish`;

export async function readPublishDraft(projectId: string, threadId: string, signal?: AbortSignal): Promise<PublishDraftV1> {
  const value = await authenticated(() =>
    fetch(`${endpoint(projectId)}/draft?threadId=${encodeURIComponent(threadId)}`, { credentials: 'same-origin', cache: 'no-store', signal }),
  ).then(read<unknown>);
  const parsed = publishDraftV1Schema.safeParse(value);
  if (!parsed.success) throw new ApiError('INVALID_RESPONSE', 'The host returned an unexpected publish draft.');
  return parsed.data;
}

export async function executePublish(projectId: string, request: PublishRequestV1, signal?: AbortSignal): Promise<PublishOperationV1> {
  const value = await authenticated(() =>
    fetch(endpoint(projectId), {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken },
      body: JSON.stringify(request),
    }),
  ).then(read<unknown>);
  const parsed = publishOperationV1Schema.safeParse(value);
  if (!parsed.success) throw new ApiError('INVALID_RESPONSE', 'The host returned an unexpected publish result.');
  return parsed.data;
}

export type PublishReviewOpen =
  | { kind: 'draft'; draft: PublishDraftV1 }
  | { kind: 'auth' }
  | { kind: 'unavailable' };

/** One draft probe gates the composer Create PR chip: flag on with a writable
 * managed copy returns a review draft, a missing GitHub sign-in opens the
 * sheet's inline sign-in state, and every other outcome keeps the legacy
 * prompt-insert behaviour. */
export async function probePublishDraft(projectId: string, threadId: string, signal?: AbortSignal): Promise<PublishReviewOpen> {
  try {
    return { kind: 'draft', draft: await readPublishDraft(projectId, threadId, signal) };
  } catch (cause) {
    return { kind: cause instanceof ApiError && cause.code === 'GITHUB_AUTH_REQUIRED' ? 'auth' : 'unavailable' };
  }
}
