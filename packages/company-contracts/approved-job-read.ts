import {WorkPlanError, captureWorkPlanRequest, validateWorkPlanResponse, workPlanCanonicalBytes, type WorkPlanReadResponse, type WorkPlanRef} from './work-plan.ts';
/** Local read selection only; never a grant, approval or company record. */
export interface ApprovedJobRead {companyId: 'leo-company'; projectId: string; instructionId: string; planRef: WorkPlanRef; workOrderId: string; authorizationDigest: string; authorizationExpiresAt: number}
export function captureApprovedJobRead(value: unknown): ApprovedJobRead {
  try {
    const item = structuredClone(value) as ApprovedJobRead;
    const names = ['companyId', 'projectId', 'instructionId', 'planRef', 'workOrderId', 'authorizationDigest', 'authorizationExpiresAt'].sort();
    if (!item || !item.planRef || Object.keys(item).sort().join('|') !== names.join('|') || item.companyId !== 'leo-company' || typeof item.workOrderId !== 'string' || typeof item.authorizationDigest !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$(?![\s\S])/.test(item.workOrderId) || !/^[a-f0-9]{64}$(?![\s\S])/.test(item.authorizationDigest) || !Number.isSafeInteger(item.authorizationExpiresAt) || item.authorizationExpiresAt <= 0) throw 0;
    captureWorkPlanRequest('read', {project_id: item.projectId, instruction_id: item.instructionId, plan_ref: item.planRef});
    Object.freeze(item.planRef); return Object.freeze(item);
  } catch {throw new WorkPlanError('REQUEST');}
}
export async function validateApprovedJobRead(value: unknown, independent: ApprovedJobRead): Promise<WorkPlanReadResponse> {
  try {
    const binding = captureApprovedJobRead(independent);
    const read = await validateWorkPlanResponse('read', workPlanCanonicalBytes(value), {project_id: binding.projectId, instruction_id: binding.instructionId, plan_ref: binding.planRef}, binding.companyId);
    const authorization = read.authorization?.authorization;
    if (!authorization || authorization.digest !== binding.authorizationDigest || authorization.work_order.id !== binding.workOrderId || authorization.expires_at_epoch_seconds !== binding.authorizationExpiresAt) throw 0;
    return read;
  } catch {throw new WorkPlanError('RESPONSE');}
}
