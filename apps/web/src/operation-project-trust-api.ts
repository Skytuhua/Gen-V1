import type { Thread } from '../../../packages/contracts';
import {
  operationProjectTrustReviewSchema, operationProjectTrustStatusSchema, operationProjectTrustReceiptSchema,
  operationProjectTrustDecisionSchema, operationProjectTrustRevokeSchema,
  type OperationProjectTrustTarget, type OperationProjectTrustDecision, type OperationProjectTrustRevoke,
} from '../../../packages/contracts/operation-project-trust';
import { ApiError, authenticated, csrfToken, read } from './api';

const unavailable = () => new ApiError('INVALID_PROJECT_TRUST_RESPONSE', 'The host returned a different project trust review. Reload the current request.');
function sameTarget(actual: OperationProjectTrustTarget, expected: OperationProjectTrustTarget) {
  return actual.threadId === expected.threadId && actual.operationId === expected.operationId && actual.operationRevision === expected.operationRevision;
}
export async function getOperationProjectTrust(target: OperationProjectTrustTarget, owner?: Thread) {
  const query = new URLSearchParams({ threadId: target.threadId, operationId: target.operationId, operationRevision: String(target.operationRevision) });
  const response = await authenticated(() => fetch('/api/operation-project-trust?' + query, { credentials: 'same-origin', cache: 'no-store' }));
  const parsed = operationProjectTrustReviewSchema.safeParse(await read<unknown>(response));
  if (!parsed.success || !sameTarget(parsed.data, target)) throw unavailable();
  const value = parsed.data;
  if (value.enabled && owner && (value.owner.threadId !== owner.id || value.owner.runId !== owner.runId
    || value.owner.epoch !== owner.epoch || value.owner.accountBinding !== (owner.accountId ?? null)
    || value.owner.projectId !== (owner.projectId ?? null) || value.owner.workspaceId !== (owner.workspaceId ?? null))) throw unavailable();
  return value;
}
export async function getOperationProjectTrustStatus(target: OperationProjectTrustTarget, owner?: Thread) {
  const query = new URLSearchParams({ threadId: target.threadId, operationId: target.operationId, operationRevision: String(target.operationRevision) });
  const response = await authenticated(() => fetch('/api/operation-project-trust/status?' + query, { credentials: 'same-origin', cache: 'no-store' }));
  const parsed = operationProjectTrustStatusSchema.safeParse(await read<unknown>(response));
  if (!parsed.success || !sameTarget(parsed.data, target)) throw unavailable();
  const value = parsed.data;
  if (value.enabled && owner && (value.owner.threadId !== owner.id || value.owner.runId !== owner.runId
    || value.owner.epoch !== owner.epoch || value.owner.accountBinding !== (owner.accountId ?? null)
    || value.owner.projectId !== (owner.projectId ?? null) || value.owner.workspaceId !== (owner.workspaceId ?? null))) throw unavailable();
  return value;
}
async function mutate(path: string, target: OperationProjectTrustTarget, payload: unknown) {
  const response = await authenticated(() => fetch('/api/operation-project-trust/' + path, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body: JSON.stringify(payload),
  }));
  const parsed = operationProjectTrustReceiptSchema.safeParse(await read<unknown>(response));
  if (!parsed.success || !sameTarget(parsed.data, target)) throw unavailable();
  return parsed.data;
}
export function decideOperationProjectTrust(input: OperationProjectTrustDecision) {
  return mutate('decisions', input, operationProjectTrustDecisionSchema.parse(input));
}
export function revokeOperationProjectTrust(input: OperationProjectTrustRevoke) {
  return mutate('revocations', input, operationProjectTrustRevokeSchema.parse(input));
}
