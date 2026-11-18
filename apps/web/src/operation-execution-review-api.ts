import type { Operation, Thread } from '../../../packages/contracts';
import { operationExecutionReviewSchema, operationExecutionTargetSchema } from '../../../packages/contracts/operation-execution-review';
import { ApiError, authenticated, read } from './api';

const invalid = () => new ApiError('INVALID_EXECUTION_REVIEW_RESPONSE', 'Execution review is unavailable.');
export async function getOperationExecutionReview(operation: Operation, owner?: Thread) {
  const target = operationExecutionTargetSchema.parse({ threadId: operation.threadId, operationId: operation.id, operationRevision: operation.revision });
  const query = new URLSearchParams({ ...target, operationRevision: String(target.operationRevision) });
  const response = await authenticated(() => fetch('/api/operation-execution-review?' + query, { credentials: 'same-origin', cache: 'no-store' }));
  const parsed = operationExecutionReviewSchema.safeParse(await read<unknown>(response));
  if (!parsed.success) throw invalid();
  const value = parsed.data, current = value.current;
  if (value.threadId !== target.threadId || value.operationId !== target.operationId || value.operationRevision !== target.operationRevision
    || current.operationStatus !== operation.status || current.approved !== operation.approved
    || value.execution.runner !== (operation.kind === 'repository.test' ? 'repository-test' : operation.kind === 'integration.context7' ? 'context7-stdio' : null)) throw invalid();
  if (owner && (current.owner.threadId !== owner.id || current.owner.runId !== owner.runId || current.owner.epoch !== owner.epoch
    || current.owner.accountBinding !== (owner.accountId ?? null) || current.owner.projectId !== (owner.projectId ?? null)
    || current.owner.workspaceId !== (owner.workspaceId ?? null) || current.threadStatus !== owner.status || current.threadMode !== (owner.mode ?? 'build'))) throw invalid();
  return value;
}
