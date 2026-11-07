import type {ComparisonIdentity, ComparisonPatch, ComparisonRead} from '../../../../packages/contracts/code-review';
import type {ReviewSelection} from './model';
import {ApiError, authenticated, read} from '../api';

async function get<T>(selection: ReviewSelection, path: string, extra: Record<string, string>, signal?: AbortSignal): Promise<T> {
  if (selection.owner.authority.kind !== 'local') throw new ApiError('ACCESS_DENIED', 'Code review requires a local project owner.');
  const query = new URLSearchParams();
  if (selection.owner.threadId) query.set('threadId', selection.owner.threadId);
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return authenticated(() => fetch(`/api/projects/${encodeURIComponent(selection.owner.projectId)}${path}?${query}`, {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal})).then(read<T>);
}
export const codeReviewClient = {
  comparison(selection: ReviewSelection, signal?: AbortSignal): Promise<ComparisonRead> {
    return selection.target.kind === 'local'
      ? get(selection, '/git/comparison', {scope: selection.target.scope}, signal)
      : get(selection, `/pull-requests/${selection.target.number}/comparison`, {}, signal);
  },
  file(selection: ReviewSelection, identity: ComparisonIdentity, path: string, signal?: AbortSignal): Promise<ComparisonPatch> {
    return get(selection, selection.target.kind === 'local' ? '/git/comparison/file' : '/pull-request-comparison/file', {comparisonId: identity.id, path}, signal);
  },
};

export function reviewError(cause: unknown): string {
  const code = cause instanceof ApiError ? cause.code : '';
  if (['ACCESS_DENIED', 'CAPABILITY_DENIED', 'AUTH_REQUIRED', 'PROJECT_READ_ONLY'].includes(code)) return 'Access unavailable or revoked. Check project access, then refresh.';
  if (['REVISION_CHANGED', 'COMPARISON_IDENTITY_CHANGED', 'COMPARISON_EXPIRED'].includes(code)) return 'Comparison changed or expired. Refresh and review the current comparison.';
  if (code === 'RESOURCE_LIMIT') return 'This comparison exceeds the read limit. Review a smaller set of changes.';
  return 'Could not read the comparison. Check the connection, then retry.';
}
