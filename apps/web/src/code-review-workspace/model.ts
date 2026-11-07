import type {ComparisonIdentity} from '../../../../packages/contracts/code-review';
import type {WorkspaceAuthority} from '../../../../packages/contracts/workspace';

export interface ReviewOwner {authority: WorkspaceAuthority; projectId: string; threadId?: string}
export type ReviewTarget = {kind: 'local'; scope: 'staged' | 'worktree'} | {kind: 'pull-request'; repo: string; number: number};
export interface ReviewSelection {owner: ReviewOwner; target: ReviewTarget}
export interface ActionIdentity {head: string; revision: string; branch: string}
export interface ReviewActionContext {selection: ReviewSelection; comparison: ComparisonIdentity; action: ActionIdentity}
export type ReviewCommand =
  | {operation: 'stage' | 'unstage'; payload: {paths: string[]; revision: string; expectedHead: string}}
  | {operation: 'commit'; payload: {message: string; revision: string; expectedHead: string}}
  | {operation: 'review'; payload: {number: number; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; body: string; head: string; revision: string}};
/** Immutable admitted write, independent of the editable draft's basis and text. */
export type ReviewAttempt = ReviewActionContext & ReviewCommand & {attemptId: string};
export interface ReviewDraft {version: 1; attempt?: ReviewAttempt; body: string; commitMessage: string; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; basis: ComparisonIdentity; action: ActionIdentity | null; outcome: 'idle' | 'pending' | 'confirmed' | 'stale' | 'uncertain' | 'revoked'}
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

export const isHeldDraft = (draft: ReviewDraft): boolean => ['pending', 'uncertain', 'revoked'].includes(draft.outcome);
// Terminal acknowledgments retire the attempt. Later action/catch/inspection results
// cannot regress it, even if editing has since changed confirmed to idle.
export function acknowledgeAttempt(draft: ReviewDraft, attemptId: string, outcome: ReviewDraft['outcome']): ReviewDraft | null {
  return draft.attempt?.attemptId === attemptId && ['pending', 'uncertain'].includes(draft.outcome)
    ? {...draft, outcome} : null;
}
export function validAttempt(attempt: ReviewAttempt, selection: ReviewSelection): boolean {
  try {
    if (!attempt || typeof attempt.attemptId !== 'string' || !attempt.attemptId || selectionKey(attempt.selection) !== selectionKey(selection)
      || !comparisonKey(attempt.comparison) || !['head', 'revision', 'branch'].every(key => typeof attempt.action?.[key as keyof ActionIdentity] === 'string')) return false;
    const target = attempt.selection.target, comparison = attempt.comparison, payload = attempt.payload;
    if (payload.revision !== attempt.action.revision || comparison.headOid !== attempt.action.head) return false;
    if (attempt.operation === 'review') return target.kind === 'pull-request' && comparison.kind === 'pull-request' && target.repo === comparison.repo && target.number === comparison.number
      && attempt.payload.number === target.number && attempt.payload.head === attempt.action.head && typeof attempt.payload.body === 'string' && attempt.payload.body.length <= 64000 && ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(attempt.payload.event);
    if (target.kind !== 'local' || comparison.kind !== 'local' || target.scope !== comparison.scope || comparison.branch !== attempt.action.branch || !('expectedHead' in payload) || payload.expectedHead !== attempt.action.head) return false;
    if (attempt.operation === 'commit') return typeof attempt.payload.message === 'string' && attempt.payload.message.length <= 4000;
    return (attempt.operation === 'stage' && target.scope === 'worktree' || attempt.operation === 'unstage' && target.scope === 'staged')
      && Array.isArray(attempt.payload.paths) && attempt.payload.paths.length > 0 && attempt.payload.paths.every(path => typeof path === 'string' && !!path);
  } catch {return false;}
}
