import type {ComparisonIdentity} from '../../../../packages/contracts/code-review';
import type {WorkspaceAuthority} from '../../../../packages/contracts/workspace';

export interface ReviewOwner {authority: WorkspaceAuthority; projectId: string; threadId?: string}
export type ReviewTarget = {kind: 'local'; scope: 'staged' | 'worktree'} | {kind: 'pull-request'; repo: string; number: number};
export interface ReviewSelection {owner: ReviewOwner; target: ReviewTarget}
export interface ActionIdentity {head: string; revision: string; branch: string}
export interface ReviewDraft {version: 1; body: string; commitMessage: string; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; basis: ComparisonIdentity; action: ActionIdentity | null; outcome: 'idle' | 'pending' | 'confirmed' | 'stale' | 'uncertain' | 'revoked'}
export const comparisonKey = (identity: ComparisonIdentity): string => JSON.stringify(identity.kind === 'local'
  ? [identity.kind, identity.id, identity.scope, identity.headOid, identity.branch, identity.revision, identity.base.kind, identity.base.revision, identity.head.kind, identity.head.revision]
  : [identity.kind, identity.id, identity.repo, identity.number, identity.pullRequestId, identity.baseOid, identity.headOid, identity.mergeBaseOid, identity.baseRef, identity.headRef, identity.semantics]);
export const ownerKey = (owner: ReviewOwner): string => JSON.stringify([owner.authority.kind, owner.authority.kind === 'plugin' ? [owner.authority.pluginId, owner.authority.scopeId] : null, owner.projectId, owner.threadId ?? null]);
export const sameOwner = (a: ReviewOwner, b: ReviewOwner): boolean => ownerKey(a) === ownerKey(b);
export const selectionKey = (selection: ReviewSelection): string => JSON.stringify([ownerKey(selection.owner), selection.target.kind === 'local' ? ['local', selection.target.scope] : ['pull-request', selection.target.repo, selection.target.number]]);
const actionKey = (action: ActionIdentity | null) => action ? JSON.stringify([action.head, action.revision, action.branch]) : 'null';
export const newDraft = (basis: ComparisonIdentity, action: ActionIdentity | null): ReviewDraft => ({version: 1, body: '', commitMessage: '', event: 'COMMENT', basis, action, outcome: 'idle'});
export const canUseDraft = (draft: ReviewDraft, identity: ComparisonIdentity, action: ActionIdentity | null): boolean => draft.outcome === 'idle' && comparisonKey(draft.basis) === comparisonKey(identity) && actionKey(draft.action) === actionKey(action);
export const rebindDraft = (draft: ReviewDraft, identity: ComparisonIdentity, action: ActionIdentity | null): ReviewDraft => ['pending', 'uncertain', 'revoked', 'confirmed'].includes(draft.outcome) ? draft : {...draft, basis: identity, action, outcome: 'idle'};
