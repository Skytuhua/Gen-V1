import './validation-policy';
import {parseDesktopSurface, desktopSurfaceKey, type DesktopSurface} from '../../../../packages/desktop-contract';
import {captureApprovedJobRead, type ApprovedJobRead} from '../../../../packages/company-contracts/approved-job-read';
import {prepareEditorHandoff} from '../editor-handoff';
import {journalFlush} from '../journal';
import {getCompanyStatus} from './api';
import {getCompanyWorkflow} from './workflow-api';

export type CompanyTaskDesktopSurface = Extract<DesktopSurface, {kind: 'company-task'}>;
export function companyTaskSurface(value: ApprovedJobRead): CompanyTaskDesktopSurface {
  const job = captureApprovedJobRead(value);
  return parseDesktopSurface({kind: 'company-task', companyId: job.companyId, projectId: job.projectId, resourceId: job.workOrderId}) as CompanyTaskDesktopSurface;
}
export function bindCompanyTaskSurface(value: unknown, independent: ApprovedJobRead): ApprovedJobRead {
  const surface = parseDesktopSurface(value), job = captureApprovedJobRead(independent);
  if (surface.kind !== 'company-task' || desktopSurfaceKey(surface) !== desktopSurfaceKey(companyTaskSurface(job))) throw Error('The task window does not match this company project.');
  return job;
}
export async function resolveCompanyTaskSurface(value: unknown, signal?: AbortSignal) {
  const surface = parseDesktopSurface(value);
  if (surface.kind !== 'company-task') throw Error('This company task surface is unavailable.');
  const workflow = await getCompanyWorkflow(signal);
  if (!workflow.approvedJob) throw Error('The host has no approved task reference.');
  const binding = bindCompanyTaskSurface(surface, workflow.approvedJob);
  const status = await getCompanyStatus({kind: 'project', id: binding.projectId}, signal);
  return {binding, projectName: status.data.project!.name};
}
export async function flushCompanyTaskHandoff() {await prepareEditorHandoff(); await journalFlush();}
