import type {FastifyInstance} from 'fastify';
import {CompanyError, type CompanyClient} from '../../packages/company-client/index.ts';
import {COMPANY_PROTOCOL, OwnerPlanInputSchema, PlanningProposalSchema} from '../../packages/company-contracts/index.ts';
import type {WorkPlanClient} from '../../packages/company-client/work-plan.ts';
import {captureWorkPlanRequest, validateWorkPlanResponse, WORK_PLAN_PIN} from '../../packages/company-contracts/work-plan.ts';
import {captureApprovedJobRead, validateApprovedJobRead, type ApprovedJobRead} from '../../packages/company-contracts/approved-job-read.ts';

// A Gen owner-host projection over the existing frozen planning-only operation.
// It owns no operational records or execution/approval authority.
export type CompanyInstructionClient = Pick<CompanyClient<'owner'>, 'role' | 'plan'>;
export type CompanyWorkPlanClient = Pick<WorkPlanClient, 'role' | 'propose' | 'read' | 'authorize'>;
export type CompanyWorkPlanReader = Pick<WorkPlanClient, 'role' | 'read'>;
export function registerCompanyWorkflow(app: FastifyInstance, client?: CompanyInstructionClient, workPlans?: CompanyWorkPlanClient, approvedRead?: {client: CompanyWorkPlanReader; binding: ApprovedJobRead}) {
  if (client && client.role !== 'owner') throw new Error('Instruction intake requires the separate owner connection.');
  if (workPlans && workPlans.role !== 'owner') throw new Error('Work plan storage requires the separate owner connection.');
  if (approvedRead && (approvedRead.client.role !== 'owner' || client || workPlans)) throw new Error('Approved job reads cannot enable work plan writes.');
  const approvedJob = approvedRead && captureApprovedJobRead(approvedRead.binding);
  app.get('/api/company/workflow', async () => ({
    protocol: COMPANY_PROTOCOL, mode: 'planning_only', recordInstruction: Boolean(client),
    authorize: false, progress: false, result: false,
    workPlans: {configured: Boolean(workPlans || approvedRead), readOnly: Boolean(approvedRead), ...WORK_PLAN_PIN},
    ...(approvedJob ? {approvedJob} : {}),
    blockers: [
      ...(!client ? ['Task submission is not connected on this device. Your draft can be saved here.'] : []),
      'The company service cannot yet produce an executable plan or admit this task.',
      'Real employee progress and returned results are unavailable.',
    ],
  }));
  app.post('/api/company/workflow/instruction', async request => {
    const input = OwnerPlanInputSchema.parse(request.body);
    if (!client) throw new CompanyError('COMPANY_CAPABILITY_UNAVAILABLE');
    // Service checks current owner identity/scope/permission on every call and
    // durably deduplicates stable principal + message_id. No automatic retry.
    const proposal = PlanningProposalSchema.parse(await client.plan(input));
    if (proposal.project_id !== input.project_id || proposal.instruction !== input.instruction) throw new CompanyError('COMPANY_RESPONSE');
    return {protocol: COMPANY_PROTOCOL, source: 'company_service', receivedAt: new Date().toISOString(), proposal};
  });
  for (const operation of ['propose', 'read', 'authorize'] as const) {
    app.post(`/api/company/workflow/work-plan/${operation}`, async request => {
      const captured = captureWorkPlanRequest(operation, request.body);
      if (operation === 'read' && approvedRead && approvedJob) {
        const expected = captureWorkPlanRequest('read', {project_id: approvedJob.projectId, instruction_id: approvedJob.instructionId, plan_ref: approvedJob.planRef});
        if (captured.body !== expected.body) throw new CompanyError('COMPANY_FORBIDDEN');
        return validateApprovedJobRead(await approvedRead.client.read(expected.request), approvedJob);
      }
      if (!workPlans) throw new CompanyError('COMPANY_CAPABILITY_UNAVAILABLE');
      // All three methods perform current owner/project authorization in CONTROL.
      // Local session/CSRF was already checked by the isolated owner host.
      const value = await workPlans[operation](captured.request as never);
      return validateWorkPlanResponse(operation, new TextEncoder().encode(JSON.stringify(value)), captured.request);
    });
  }
}
