import {createCommunicationFixture} from '../../../apps/web/src/company/communication-fixture';
import {prepareEmployeeReceivedCommand, type EmployeeReceivedContext} from '../../../packages/company-contracts/communications/employee-received';
import {canonicalBytes} from '../../../packages/company-contracts/communications/json';
import received from '../../../packages/company-contracts/communications/v1/golden/employee-received.json';
import workPlan from '../../../packages/company-contracts/owner-work-plan-candidate.1/examples.json';
import {captureWorkPlanRequest, validateWorkPlanResponse, workPlanCanonicalBytes} from '../../../packages/company-contracts/work-plan';

const state = window as unknown as {companyCspValidation?: () => Promise<{messages: number; workPlans: number; rejected: number; evalBlocked: boolean}>};
state.companyCspValidation = async () => {
  // Import the actual later lazy UI path as well as its validator.
  await import('../../../apps/web/src/company/WorkPlanReview');
  const model = await createCommunicationFixture();
  let workPlans = 0, rejected = 0;
  for (const example of workPlan.cases) {
    const operation = example.path.endsWith('/propose') ? 'propose' : example.path.endsWith('/authorize') ? 'authorize' : 'read';
    await validateWorkPlanResponse(operation, workPlanCanonicalBytes(example.response), example.request); workPlans++;
  }
  try {captureWorkPlanRequest('propose', {...workPlan.cases[0].request, evil: true});} catch {rejected++;}
  const example = received.example;
  try {await prepareEmployeeReceivedCommand(canonicalBytes({...example.command, evil: true}), {
    company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}, machine_principal_id: 'machine:E11', journal_owner_id: 'supervisor-E11', recipient: example.envelope.delivery.recipient as EmployeeReceivedContext['recipient'],
  }, canonicalBytes(example.envelope));} catch {rejected++;}
  let evalBlocked = false;
  try {new Function('return 1')();} catch (cause) {evalBlocked = cause instanceof EvalError;}
  return {messages: model.messages.length, workPlans, rejected, evalBlocked};
};
