import {expect, it} from 'vitest';
import examples from '../packages/company-contracts/owner-work-plan-candidate.1/examples.json';
import {bindReviewedWorkOrder} from '../apps/web/src/company/WorkPlanReview';
import {validateWorkPlanResponse, workPlanCanonicalBytes, workPlanDigest, type WorkPlanAuthorizeResponse, type WorkPlanAuthorizeRequest, type WorkPlanReadResponse} from '../packages/company-contracts/work-plan';

const approved = examples.cases.find(item => item.name === 'authorize_exact')! as unknown as {request: WorkPlanAuthorizeRequest; response: WorkPlanAuthorizeResponse};
const plan = (examples.cases.find(item => item.name === 'read_proposed')!.response as unknown as WorkPlanReadResponse).plan;
const sign = async <T extends {digest: string}>(value: T) => {const {digest: _digest, ...body} = value; value.digest = await workPlanDigest(body);};
it('joins an immediate or cached authorization to the independently reviewed full plan', async () => {
  await expect(bindReviewedWorkOrder(approved.response, approved.request, plan)).resolves.toEqual(approved.response);
});
it.each(['budget', 'staff'] as const)('rejects a self-consistently signed wrong-%s WorkOrder which passes the ref-only wire boundary', async field => {
  const forged = structuredClone(approved.response), auth = forged.authorization;
  if (field === 'budget') auth.work_order.record.budget_cents++;
  else auth.work_order.record.employee_ids = ['E01'];
  auth.work_order.digest = await workPlanDigest(auth.work_order.record);
  auth.owner_approval.scope = structuredClone(auth.work_order.record);
  await sign(auth); forged.receipt.work_order_digest = auth.work_order.digest; await sign(forged.receipt);
  await expect(validateWorkPlanResponse('authorize', workPlanCanonicalBytes(forged), approved.request)).resolves.toBeDefined();
  await expect(bindReviewedWorkOrder(forged, approved.request, plan)).rejects.toMatchObject({code: 'RESPONSE'});
});
