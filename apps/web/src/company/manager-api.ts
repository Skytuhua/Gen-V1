import {authenticated, csrfToken, read} from '../api';
import {CompanyManagerProposalSchema, type CompanyManagerInput} from '../../../../packages/company-manager/contracts';
import type {CompanyManagerInteraction} from '../../../../packages/company-manager/journal';

export interface ManagerAvailability {
  configured: boolean;
  mode: 'shadow_proposals';
  admission: 'checked_per_request';
  dispatchAuthorized: false;
  durableCompanyStorage: false;
  blockers: string[];
}
export type ManagerReference = Pick<CompanyManagerInput, 'projectId' | 'requestId'>;

export async function getManagerAvailability(signal?: AbortSignal): Promise<ManagerAvailability> {
  const value = await authenticated(() => fetch('/api/company/manager/availability', {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal})).then(read<ManagerAvailability>);
  if (!value || typeof value.configured !== 'boolean' || value.mode !== 'shadow_proposals' || value.admission !== 'checked_per_request' || value.dispatchAuthorized !== false || value.durableCompanyStorage !== false || !Array.isArray(value.blockers) || !value.blockers.every(item => typeof item === 'string')) throw new Error('Local E01 planning availability could not be verified.');
  return value;
}

export function validateManagerInteraction(value: unknown, reference: ManagerReference): CompanyManagerInteraction {
  const record = value as CompanyManagerInteraction | null;
  if (!record || record.id !== reference.requestId || record.projectId !== reference.projectId || record.scope !== 'local_ui_interaction' || record.companyReceipt !== null || !['pending', 'stop_requested', 'draft_ready', 'failed', 'cancelled', 'uncertain'].includes(record.status) || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt) || record.input?.requestId !== reference.requestId || record.input.projectId !== reference.projectId || typeof record.input.instruction !== 'string') throw new Error('The host returned an incompatible local E01 interaction.');
  if (record.status === 'draft_ready') {
    const draft = record.draft;
    if (!draft || typeof draft.id !== 'string' || draft.kind !== 'local_manager_draft' || draft.state !== 'unsubmitted' || draft.authority !== 'proposal_only' || draft.evidenceScope !== 'local_manager_output' || draft.projectId !== reference.projectId || draft.requestId !== reference.requestId || draft.dispatchAuthorized !== false || draft.companyReceipt !== null || !Array.isArray(draft.sourceRefs) || !draft.sourceRefs.every(item => typeof item === 'string') || !CompanyManagerProposalSchema.safeParse(draft.content).success) throw new Error('The host returned an incompatible local E01 draft.');
  }
  return record;
}

async function managerRequest(action: 'propose' | 'request' | 'cancel', input: ManagerReference | CompanyManagerInput) {
  const body = JSON.stringify(input);
  // Session renewal reuses this exact identity and body. Network failures are
  // recovered through /request, never by automatically replaying inference.
  const value = await authenticated(() => fetch(`/api/company/manager/${action}`, {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: {'Content-Type': 'application/json', 'x-harness-csrf': csrfToken}, body})).then(read<unknown>);
  return validateManagerInteraction(value, input);
}
export const proposeManagerDraft = (input: CompanyManagerInput) => managerRequest('propose', input);
export const getManagerRequest = (input: ManagerReference) => managerRequest('request', input);
export const cancelManagerRequest = (input: ManagerReference) => managerRequest('cancel', input);
