import {ApiError, authenticated, csrfToken, read} from '../api';
import type {ProjectContextInput, ProjectContextResponse, TaskContextInput, TaskContextResponse} from '../../../../packages/company-contracts/manager';

export interface ContextAvailability {
  configured: boolean; contractId: 'maritime-company-manager'; contractVersion: '1.0.0-candidate.1';
  backendCheckpoint: string; manifestSHA256: string; ownerHostOnly: true; engineAccess: false; blockers: string[];
}
export interface ContextSnapshot<T> {
  data: T; receivedAt: string; source: 'company_service';
  contractId: 'maritime-company-manager'; contractVersion: '1.0.0-candidate.1'; backendCheckpoint: string; manifestSHA256: string;
}
const compatible = (value: {contractId?: unknown; contractVersion?: unknown}) => value.contractId === 'maritime-company-manager' && value.contractVersion === '1.0.0-candidate.1';
export async function getContextAvailability(signal?: AbortSignal): Promise<ContextAvailability> {
  const value = await authenticated(() => fetch('/api/company/context/availability', {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal})).then(read<ContextAvailability>);
  if (!value || !compatible(value) || typeof value.configured !== 'boolean' || value.ownerHostOnly !== true || value.engineAccess !== false || !Array.isArray(value.blockers) || !value.blockers.every(item => typeof item === 'string')) throw new Error('Owner context availability could not be verified.');
  return value;
}
async function contextRead<T extends ProjectContextResponse | TaskContextResponse>(kind: 'project' | 'task', input: ProjectContextInput | TaskContextInput, signal?: AbortSignal): Promise<ContextSnapshot<T>> {
  const body = JSON.stringify(input);
  const response = await authenticated(() => fetch(`/api/company/context/${kind}`, {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: {'Content-Type': 'application/json', 'x-harness-csrf': csrfToken}, body}));
  if (response.status === 409) {
    const value = await response.json().catch(() => null);
    if (value?.error?.code === 'COMPANY_SNAPSHOT_CHANGED' && value.error.restartRequired === true) throw new ApiError('COMPANY_SNAPSHOT_CHANGED', 'The source snapshot changed. Reload from the first page.', {restartRequired: true});
    throw new Error('This context continuation is unavailable. Reload from the first page.');
  }
  const value = await read<ContextSnapshot<T>>(response), data = value?.data;
  if (!value || !compatible(value) || value.source !== 'company_service' || !Number.isFinite(Date.parse(value.receivedAt)) || !data || data.contract_id !== 'maritime-company-manager' || data.contract_version !== '1.0.0-candidate.1' || data.project_id !== input.project_id || data.page?.limit !== input.limit || data.page.entity?.scope.id !== input.project_id) throw new Error('The host returned incompatible project context.');
  if ('task_id' in input && (!('task_id' in data) || data.task_id !== input.task_id || data.section !== input.section)) throw new Error('The host returned another task context.');
  return value;
}
export const getProjectContext = (input: ProjectContextInput, signal?: AbortSignal) => contextRead<ProjectContextResponse>('project', input, signal);
export const getTaskContext = (input: TaskContextInput, signal?: AbortSignal) => contextRead<TaskContextResponse>('task', input, signal);
