import { z } from 'zod';

// Same bounded identifier/revision/OID domains as workspace-action-outcomes.ts.
const identifier = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/),
  oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
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

/** One row of the reviewed working-copy change list. */
export const publishFileSchema = z.strictObject({
  path: pathName,
  added: fileCounts,
  removed: fileCounts,
  untracked: z.boolean(),
});
export interface PublishFile extends z.infer<typeof publishFileSchema> {}

/** Read-only preview of the commit and draft pull request the review sheet shows. */
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
export interface PublishDraftV1 extends z.infer<typeof publishDraftV1Schema> {}

/** Host-only write request: reviewed head and revision must match exactly. */
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
export interface PublishRequestV1 extends z.infer<typeof publishRequestV1Schema> {}

export const publishStepStateSchema = z.enum(['not-started', 'confirmed', 'not-applied', 'uncertain']);
export const publishStepSchema = z.strictObject({
  state: publishStepStateSchema,
  receiptId: identifier.optional(),
  at: z.string().max(64).optional(),
  error: z
    .strictObject({ code: z.string().min(1).max(200), message: z.string().max(4000) })
    .optional(),
});
export interface PublishStep extends z.infer<typeof publishStepSchema> {}

/** Durable per-thread publish operation: written before the first write step. */
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
    .strictObject({ url: z.string().max(2048), number: z.number().int().positive(), head: oid, repo })
    .optional(),
});
export interface PublishOperationV1 extends z.infer<typeof publishOperationV1Schema> {}
