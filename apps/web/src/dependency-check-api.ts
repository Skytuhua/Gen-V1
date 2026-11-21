import { authenticated, command, read } from './api';
import type { Operation } from '../../../packages/contracts/index.ts';

export interface DependencyCapability { available: boolean; sources?: { osv: boolean; github: boolean } }
export interface DependencyCoverageItem { relativePath: string; format: string; status: string; reason?: string }
export interface DependencyOccurrence { occurrenceId: string; ecosystem: string; name: string; installedVersion: string; directness: string; lockPath: string; importerPath?: string }
export interface DependencyFinding { occurrence: DependencyOccurrence; advisoryIds: string[]; severity: string; severitySource?: string; fixedVersions: string[]; upgradeCandidate: string | null; candidateEligible: boolean }
export interface DependencyRemoteAlert { package: string; manifestPath?: string; advisoryIds: string[]; severity: string; firstPatched: string | null; matchedOccurrence: boolean }
export interface DependencyScanResult {
  scanId: string; status: 'prepared' | 'running' | 'complete' | 'partial' | 'unavailable' | 'cancelled' | 'stale';
  checkedAt: string; scopeKey: string; inputDigest: string; fresh: boolean;
  coverage: DependencyCoverageItem[]; queriedCount: number;
  findings: DependencyFinding[]; remoteAlerts: DependencyRemoteAlert[]; remoteAlertState: string; nextCursor?: string;
}

const api = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/dependency-check`;
const post = async <T>(url: string, body: unknown): Promise<T> => read<T>(await authenticated(() => fetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));

export const dependencyCapability = async (projectId: string, threadId: string) =>
  read<DependencyCapability>(await authenticated(() => fetch(`${api(projectId)}/capability?threadId=${encodeURIComponent(threadId)}`, { credentials: 'same-origin', cache: 'no-store' })));

export const dependencyResult = async (projectId: string, threadId: string, scanId?: string, cursor?: string) => {
  const q = new URLSearchParams({ threadId });
  if (scanId) q.set('scanId', scanId);
  if (cursor) q.set('cursor', cursor);
  const response = await authenticated(() => fetch(`${api(projectId)}/result?${q}`, { credentials: 'same-origin', cache: 'no-store' }));
  if (response.status === 404 || !response.ok) return null;
  return read<DependencyScanResult>(response);
};

export const dependencyScanPrepare = (projectId: string, threadId: string, sources: { github?: boolean }) =>
  post<Operation>(`${api(projectId)}/scan`, { threadId, sources });

export const dependencyScanRun = (projectId: string, threadId: string, operationId: string) =>
  post<unknown>(`${api(projectId)}/scan/run`, { threadId, operationId });

export const dependencyScanCancel = (projectId: string, threadId: string, operationId: string) =>
  post<Operation>(`${api(projectId)}/scan/cancel`, { threadId, operationId });

export const dependencyApprove = (threadId: string, operationId: string, revision: number) =>
  command('operation.approve', { operationId, revision }, threadId);

export const dependencyDecline = (threadId: string, operationId: string, revision: number) =>
  command('operation.reject', { operationId, revision }, threadId);
