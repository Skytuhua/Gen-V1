import { z } from 'zod';
import type { CommandReceipt } from './index.ts';
import type { ComparisonIdentity } from './code-review.ts';

// Durable command IDs retain the same domain at admission and read-only recovery.
const identifier = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/),
  oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const workspaceActionTypeSchema = z.enum(['stage', 'unstage', 'commit', 'review-pr']);
export type WorkspaceActionType = z.infer<typeof workspaceActionTypeSchema>;
export const workspaceActionEnvelopeSchema = z.strictObject({
  id: identifier,
  type: workspaceActionTypeSchema,
  payload: z.record(z.string(), z.json()),
  threadId: identifier.optional(),
});
export interface WorkspaceActionEnvelope {
  id: string;
  type: WorkspaceActionType;
  payload: Record<string, unknown>;
  threadId?: string;
}
const local = { revision, expectedHead: oid };
const paths = z.array(z.string().min(1).max(1024)).min(1).max(1000);
const unicode = (value: string) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\0') && unicode(value));
export const workspaceActionPayloadSchemas = {
  stage: z.strictObject({ ...local, paths }),
  unstage: z.strictObject({ ...local, paths }),
  commit: z.strictObject({ ...local, message: text(4000).refine((value) => value.trim().length > 0) }),
  'review-pr': z.strictObject({
    number: z.number().int().positive(),
    event: z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']),
    body: z.string().max(64000).refine(unicode),
    head: oid,
    revision,
  }),
};
export type WorkspaceActionPayload = z.infer<(typeof workspaceActionPayloadSchemas)[WorkspaceActionType]>;
export const workspaceActionOwnerSchema = z.strictObject({
  authority: z.strictObject({ kind: z.literal('local') }),
  projectId: identifier,
  threadId: identifier.optional(),
});
const repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  branch = z.string().max(1024);
const localComparison = z.strictObject({
  kind: z.literal('local'),
  id: revision,
  scope: z.enum(['staged', 'worktree']),
  headOid: oid,
  branch,
  revision,
  base: z.strictObject({ kind: z.enum(['commit', 'index']), revision: z.string().min(1).max(128) }),
  head: z.strictObject({ kind: z.enum(['index', 'worktree']), revision: z.string().min(1).max(128) }),
});
const pullComparison = z.strictObject({
  kind: z.literal('pull-request'),
  id: revision,
  repo,
  number: z.number().int().positive(),
  pullRequestId: z.string().min(1).max(200),
  baseOid: oid,
  headOid: oid,
  mergeBaseOid: oid,
  baseRef: branch,
  headRef: branch,
  semantics: z.literal('merge-base'),
});
export const workspaceActionOperationSchema = z.strictObject({
  operationId: identifier,
  operation: workspaceActionTypeSchema,
  selection: z.strictObject({
    owner: workspaceActionOwnerSchema,
    target: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('local'), scope: z.enum(['staged', 'worktree']) }),
      z.strictObject({ kind: z.literal('pull-request'), repo, number: z.number().int().positive() }),
    ]),
  }),
  comparison: z.discriminatedUnion('kind', [localComparison, pullComparison]),
  action: z.strictObject({ head: oid, revision, branch }),
  payload: z.record(z.string(), z.json()),
});
/** Exact browser journal context; none of these fields grant host write authority. */
export interface WorkspaceActionOperation {
  operationId: string;
  operation: WorkspaceActionType;
  selection: {
    owner: { authority: { kind: 'local' }; projectId: string; threadId?: string };
    target: { kind: 'local'; scope: 'staged' | 'worktree' } | { kind: 'pull-request'; repo: string; number: number };
  };
  comparison: ComparisonIdentity;
  action: { head: string; revision: string; branch: string };
  payload: WorkspaceActionPayload;
}
export type WorkspaceActionOutcome = { state: 'confirmed' | 'not-applied' | 'uncertain' | 'revoked' };
export type WorkspaceActionExecution = { state: 'confirmed'; receipt: CommandReceipt } | { state: 'not-applied' | 'uncertain' | 'revoked' };
