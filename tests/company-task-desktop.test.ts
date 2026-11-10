import {expect, it} from 'vitest';
import examples from '../packages/company-contracts/owner-work-plan-candidate.1/examples.json';
import {captureApprovedJobRead} from '../packages/company-contracts/approved-job-read';
import {bindCompanyTaskSurface, companyTaskSurface} from '../apps/web/src/company/company-task-desktop';
import type {WorkPlanReadResponse} from '../packages/company-contracts/work-plan';

const response = examples.cases.find(item => item.name === 'read_authorized_recovery')!.response as unknown as WorkPlanReadResponse;
const authorization = response.authorization!.authorization;
const job = captureApprovedJobRead({companyId: 'leo-company', projectId: response.plan.project_id, instructionId: response.plan.instruction_id,
  planRef: {kind: 'work_plan', id: response.plan.id, project_id: response.plan.project_id, revision: response.plan.revision, digest: response.plan.digest},
  workOrderId: authorization.work_order.id, authorizationDigest: authorization.digest, authorizationExpiresAt: authorization.expires_at_epoch_seconds});

it('uses the existing scoped WorkOrder as the single company task surface identity', () => {
  const surface = companyTaskSurface(job);
  expect(surface).toEqual({kind: 'company-task', companyId: 'leo-company', projectId: job.projectId, resourceId: job.workOrderId});
  expect(bindCompanyTaskSurface(surface, job)).toEqual(job);
});
it.each([
  {kind: 'company-task', companyId: 'other', projectId: job.projectId, resourceId: job.workOrderId},
  {kind: 'company-task', companyId: 'leo-company', projectId: 'other', resourceId: job.workOrderId},
  {kind: 'company-task', companyId: 'leo-company', projectId: job.projectId, resourceId: 'other'},
  {...companyTaskSurfaceShape(), destination: 'http://example.com'},
  {kind: 'workspace', threadId: 'personal-thread'},
])('rejects foreign, personal or widened native surface identity %#', surface => {
  expect(() => bindCompanyTaskSurface(surface, job)).toThrow();
});
function companyTaskSurfaceShape() {return {kind: 'company-task', companyId: 'leo-company', projectId: job.projectId, resourceId: job.workOrderId};}
