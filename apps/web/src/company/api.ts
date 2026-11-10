import {ApiError, authenticated, csrfToken, read} from '../api';
import {COMPANY_PROTOCOL, CompanyScopeSchema, CompanyStatusSchema, type CompanyScope, type CompanyStatus} from '../../../../packages/company-contracts';

export {COMPANY_PROTOCOL};
export type {CompanyScope, CompanyStatus, CompanyProject, CompanyEmployee, CompanyObservation} from '../../../../packages/company-contracts';
export interface CompanyConnection {
  configured: boolean;
  protocol: typeof COMPANY_PROTOCOL;
  serviceBaseline: string;
  backendCheckpoint?: string;
  manifestSHA256?: string;
  mode: 'read_only';
  ownerAuthenticated: boolean;
  capabilities: {status: boolean; artifactPreview: boolean; reviewPackage: boolean; planning: false; dispatch: false; publication: false; events: false; emergencyStop: false};
  blockers: string[];
}
export interface CompanySnapshot {data: CompanyStatus; receivedAt: string; source: 'company_service'; protocol: typeof COMPANY_PROTOCOL; serviceBaseline?: string}

export const isCompanyAccessDenied = (cause: unknown): cause is ApiError => cause instanceof ApiError && ['COMPANY_AUTH', 'COMPANY_FORBIDDEN', 'AUTH_REQUIRED'].includes(cause.code);

function protocol(value: {protocol?: unknown}) {
  if (value.protocol !== COMPANY_PROTOCOL) throw new Error('The company service protocol is incompatible. Refresh after updating the connection.');
}
export async function getCompanyConnection(signal?: AbortSignal): Promise<CompanyConnection> {
  const value = await authenticated(() => fetch('/api/company/connection', {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal})).then(read<CompanyConnection>);
  protocol(value);
  if (value.mode !== 'read_only') throw new Error('The host did not establish the read-only company connection.');
  return value;
}
export async function getCompanyStatus(scope: CompanyScope, signal?: AbortSignal): Promise<CompanySnapshot> {
  CompanyScopeSchema.parse(scope);
  const value = await authenticated(() => fetch('/api/company/status', {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: {'Content-Type': 'application/json', 'x-harness-csrf': csrfToken}, body: JSON.stringify({scope})})).then(read<CompanySnapshot>);
  protocol(value);
  const parsed = CompanyStatusSchema.safeParse(value.data);
  if (value.source !== 'company_service' || !Number.isFinite(Date.parse(value.receivedAt)) || !parsed.success) throw new Error('The company service returned an incompatible status snapshot.');
  if (scope.kind === 'project' && (parsed.data.project?.id !== scope.id || parsed.data.projects.length !== 1 || parsed.data.projects[0].id !== scope.id)) throw new Error('The company service returned another project’s status.');
  return {...value, data: parsed.data};
}
