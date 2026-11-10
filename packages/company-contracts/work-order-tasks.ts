// Trusted host only. This operation is not imported by the browser or enabled by the host.
import Ajv2020 from 'ajv/dist/2020.js';
import schema from './work-order-tasks-candidate.1/tasks.schema.json';
import {WorkPlanError, decodeWorkPlanJson, validateWorkPlanResponse, workPlanCanonicalBytes, workPlanDigest, workPlanRef, type WorkPlanAuthorizeRequest, type WorkPlanAuthorizeResponse, type WorkPlanProposeRequest, type WorkPlanProposeResponse, type WorkPlanRef, type WorkPlanBody} from './work-plan.ts';

export const WORK_ORDER_TASKS_PIN = Object.freeze({contract: 'maritime-work-order-tasks', version: '1.0.0-candidate.1', backendCheckpoint: '20ea1aa0fa277d43c6904c2b35d761d5483820c5',
  manifestSHA256: 'dd19ed8d94e71edf5a284d65ea3372ee30f00f848149ac8fd3970a0c40de6193', schemaSHA256: '82176ce76a62543d5567bdd42ec06d1b58a94f31c446c65e9dbb1ad60c7f0418', examplesSHA256: '51ebd91e1ceaad269e9e5b6e0583e2cb109397779322cb8be7da55e66c772e0e', requestBytes: 32768, responseBytes: 262144});
export interface WorkOrderTasksRequest {project_id: string; message_id: string; plan_ref: WorkPlanRef; work_order_id: string}
export interface WorkOrderTasksContext {
  companyId: string; projectId: string; principalId: string;
  proposal: {request: WorkPlanProposeRequest; response: WorkPlanProposeResponse};
  authorization: {request: WorkPlanAuthorizeRequest; response: WorkPlanAuthorizeResponse};
}
interface WorkOrderRef {id: string; digest: string}
export interface WorkOrderTaskItem {
  step_key: string; dependencies: string[]; scheduler_hint_digest: string;
  task: {id: string; work_order_id: string; scope: {kind: 'project'; id: string}; employee_id: string; input_digest: string; binding_digest: string; cost_cents: number; playbook_digest: 'none'};
  input: {kind: 'work_plan_task_input'; schema_version: 1; company_id: string; project_id: string; plan_ref: WorkPlanRef; authorization_digest: string; work_order_ref: WorkOrderRef; basis_digest: string; step: WorkPlanBody['steps'][number]; repository_inputs: WorkPlanBody['repository_inputs']; binding_digest: string; reservation_ceiling_cents: number};
}
export interface WorkOrderTasksResponse {schema_version: 1; tasks: WorkOrderTaskItem[]; receipt: {
  kind: 'work_order_task_receipt'; schema_version: 1; id: string; action: 'work_order.materialize'; company_id: string; project_id: string; principal_id: string; command_id: string; request_digest: string; plan_ref: WorkPlanRef; authorization_digest: string; work_order_ref: WorkOrderRef; accepted_at_epoch_seconds: number; task_set_digest: string; task_materialization: true; dispatch_authorized: false; live_ready: false; evidence_scope: 'synthetic_only'; digest: string;
}}
const ajv = new Ajv2020({strict: true, allErrors: false}); ajv.addSchema(schema);
const requestShape = ajv.getSchema(schema.$id + '#/$defs/MaterializeRequest')!;
const responseShape = ajv.getSchema(schema.$id + '#/$defs/MaterializeResponse')!;
const requireValue = (value: unknown): void => {if (!value) throw new Error('Materialization mismatch');};
const same = (left: unknown, right: unknown) => Buffer.from(workPlanCanonicalBytes(left)).equals(Buffer.from(workPlanCanonicalBytes(right)));
function freeze<T>(value: T): T {if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);} return value;}
function keys(value: unknown, expected: string[]) {requireValue(value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...expected].sort()));}

export async function prepareWorkOrderTasksRequest(input: unknown, independent: WorkOrderTasksContext): Promise<{request: WorkOrderTasksRequest; context: WorkOrderTasksContext; body: string}> {
  try {
    // Capture the entire independent review and action before the first await.
    const request = (input instanceof Uint8Array ? decodeWorkPlanJson(input, 32768) : structuredClone(input)) as WorkOrderTasksRequest;
    const context = structuredClone(independent);
    requireValue(requestShape(request)); const raw = workPlanCanonicalBytes(request); requireValue(raw.length <= WORK_ORDER_TASKS_PIN.requestBytes);
    keys(context, ['companyId', 'projectId', 'principalId', 'proposal', 'authorization']);
    keys(context.proposal, ['request', 'response']); keys(context.authorization, ['request', 'response']);
    requireValue(context.companyId === 'leo-company' && context.projectId === request.project_id && typeof context.principalId === 'string' && context.principalId.length > 0);
    const proposal = await validateWorkPlanResponse('propose', workPlanCanonicalBytes(context.proposal.response), context.proposal.request, context.companyId);
    const authorized = await validateWorkPlanResponse('authorize', workPlanCanonicalBytes(context.authorization.response), context.authorization.request, context.companyId);
    const plan = proposal.plan, auth = authorized.authorization, order = auth.work_order;
    requireValue(plan.project_id === context.projectId && auth.project_id === context.projectId && plan.owner_principal === context.principalId && auth.owner_principal === context.principalId);
    requireValue(same(request.plan_ref, workPlanRef(plan)) && same(auth.plan_ref, request.plan_ref) && auth.instruction_id === plan.instruction_id && request.work_order_id === order.id);
    requireValue(same(order.record.employee_ids, plan.plan.employee_ids) && order.record.budget_cents === plan.plan.budget_cents && auth.recorded_at_epoch_seconds >= plan.recorded_at_epoch_seconds);
    requireValue(plan.basis.staffing.every(item => auth.expires_at_epoch_seconds <= item.expires_at_epoch_seconds));
    return freeze({request, context, body: new TextDecoder().decode(raw)});
  } catch {throw new WorkPlanError('REQUEST');}
}
export async function validateWorkOrderTasksResponse(raw: Uint8Array, input: unknown, independent: WorkOrderTasksContext): Promise<WorkOrderTasksResponse> {
  try {
    const {request, context} = await prepareWorkOrderTasksRequest(input, independent);
    // The strict parser deliberately returns null-prototype objects. Ajv's
    // uniqueItems equality helper needs ordinary JSON objects; cloning changes
    // prototypes only, after lexical/UTF8/duplicate-key checks, not JSON values.
    const value = structuredClone(decodeWorkPlanJson(raw, 262144)) as unknown as WorkOrderTasksResponse;
    requireValue(responseShape(value) && workPlanCanonicalBytes(value).length <= WORK_ORDER_TASKS_PIN.responseBytes);
    const {plan} = context.proposal.response, auth = context.authorization.response.authorization;
    const orderRef = {id: auth.work_order.id, digest: auth.work_order.digest}, receipt = value.receipt;
    requireValue(receipt.company_id === context.companyId && receipt.project_id === context.projectId && receipt.principal_id === context.principalId && receipt.command_id === request.message_id);
    requireValue(same(receipt.plan_ref, request.plan_ref) && receipt.authorization_digest === auth.digest && same(receipt.work_order_ref, orderRef));
    requireValue(receipt.request_digest === await workPlanDigest(['work_order.materialize', request]) && receipt.id === 'work-order-task-receipt-' + await workPlanDigest([context.principalId, request.message_id]));
    requireValue(receipt.accepted_at_epoch_seconds >= auth.recorded_at_epoch_seconds && receipt.accepted_at_epoch_seconds < auth.expires_at_epoch_seconds);
    requireValue(value.tasks.length === plan.plan.steps.length);
    const ids = new Map(await Promise.all(plan.plan.steps.map(async step => [step.key, 'work-plan-task-' + await workPlanDigest([request.plan_ref, request.work_order_id, step.key])] as const)));
    const basis = await workPlanDigest(plan.basis);
    for (const [index, item] of value.tasks.entries()) {
      const step = plan.plan.steps[index], task = item.task;
      requireValue(item.step_key === step.key && task.id === ids.get(step.key) && same(item.dependencies, step.depends_on.map(key => ids.get(key))));
      const expectedInput = {kind: 'work_plan_task_input', schema_version: 1, company_id: context.companyId, project_id: context.projectId, plan_ref: request.plan_ref,
        authorization_digest: auth.digest, work_order_ref: orderRef, basis_digest: basis, step, repository_inputs: plan.plan.repository_inputs,
        binding_digest: task.binding_digest, reservation_ceiling_cents: auth.work_order.record.budget_cents};
      requireValue(same(item.input, expectedInput) && task.input_digest === await workPlanDigest(item.input));
      requireValue(task.work_order_id === request.work_order_id && same(task.scope, {kind: 'project', id: context.projectId}) && task.employee_id === step.employee_id && task.cost_cents === auth.work_order.record.budget_cents);
      // Binding and scheduler hint digests are server-owned assertions, not a
      // client grant or proof of current execution/accounting readiness.
    }
    requireValue(new Set(value.tasks.map(item => item.task.id)).size === value.tasks.length && receipt.task_set_digest === await workPlanDigest(value.tasks));
    const {digest, ...receiptBody} = receipt; requireValue(digest === await workPlanDigest(receiptBody));
    return freeze(value);
  } catch {throw new WorkPlanError('RESPONSE');}
}
