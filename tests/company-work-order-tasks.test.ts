import {afterEach, expect, it, vi} from 'vitest';
import {createServer, type Server} from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../packages/company-contracts/work-order-tasks-candidate.1/tasks.schema.json';
import golden from '../packages/company-contracts/work-order-tasks-candidate.1/examples.json';
import threeStep from './company/fixtures/work-order-tasks-context.json';
import plans from '../packages/company-contracts/owner-work-plan-candidate.1/examples.json';
import {WorkPlanClient} from '../packages/company-client/work-plan.ts';
import {WORK_ORDER_TASKS_PIN, prepareWorkOrderTasksRequest, validateWorkOrderTasksResponse, type WorkOrderTasksContext, type WorkOrderTasksRequest, type WorkOrderTasksResponse} from '../packages/company-contracts/work-order-tasks.ts';
import {workPlanCanonicalBytes, workPlanDigest, workPlanRef} from '../packages/company-contracts/work-plan.ts';
const servers: Server[] = [];
afterEach(async () => {for (const server of servers.splice(0)) {server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept()));}});
async function fixture() {
  const context = {companyId: 'leo-company', projectId: 'alpha', principalId: 'control', proposal: {request: plans.cases[0].request, response: plans.cases[0].response}, authorization: {request: plans.cases[2].request, response: plans.cases[2].response}} as unknown as WorkOrderTasksContext;
  const auth = context.authorization.response.authorization, plan = context.proposal.response.plan;
  const request = {project_id: 'alpha', message_id: 'gen-materialize-1', plan_ref: workPlanRef(plan), work_order_id: auth.work_order.id} satisfies WorkOrderTasksRequest;
  const ids = new Map(await Promise.all(plan.plan.steps.map(async step => [step.key, 'work-plan-task-' + await workPlanDigest([request.plan_ref, request.work_order_id, step.key])] as const)));
  const tasks = await Promise.all(plan.plan.steps.map(async step => {
    const input = {kind: 'work_plan_task_input' as const, schema_version: 1 as const, company_id: 'leo-company', project_id: 'alpha', plan_ref: request.plan_ref, authorization_digest: auth.digest, work_order_ref: {id: auth.work_order.id, digest: auth.work_order.digest}, basis_digest: await workPlanDigest(plan.basis), step, repository_inputs: plan.plan.repository_inputs, binding_digest: 'b'.repeat(64), reservation_ceiling_cents: plan.plan.budget_cents};
    return {step_key: step.key, dependencies: step.depends_on.map(key => ids.get(key)!), scheduler_hint_digest: 'c'.repeat(64), input,
      task: {id: ids.get(step.key)!, work_order_id: request.work_order_id, scope: {kind: 'project' as const, id: 'alpha'}, employee_id: step.employee_id, input_digest: await workPlanDigest(input), binding_digest: input.binding_digest, cost_cents: plan.plan.budget_cents, playbook_digest: 'none' as const}};
  }));
  const receipt = {kind: 'work_order_task_receipt' as const, schema_version: 1 as const, id: 'work-order-task-receipt-' + await workPlanDigest([context.principalId, request.message_id]), action: 'work_order.materialize' as const, company_id: 'leo-company', project_id: 'alpha', principal_id: context.principalId, command_id: request.message_id, request_digest: await workPlanDigest(['work_order.materialize', request]), plan_ref: request.plan_ref, authorization_digest: auth.digest, work_order_ref: {id: auth.work_order.id, digest: auth.work_order.digest}, accepted_at_epoch_seconds: auth.recorded_at_epoch_seconds + 1, task_set_digest: await workPlanDigest(tasks), task_materialization: true as const, dispatch_authorized: false as const, live_ready: false as const, evidence_scope: 'synthetic_only' as const};
  const response = {schema_version: 1, tasks, receipt: {...receipt, digest: await workPlanDigest(receipt)}} satisfies WorkOrderTasksResponse;
  return {context: structuredClone(context), request, response};
}
async function resign(value: WorkOrderTasksResponse) {
  for (const item of value.tasks) item.task.input_digest = await workPlanDigest(item.input);
  value.receipt.task_set_digest = await workPlanDigest(value.tasks);
  const {digest: _digest, ...receipt} = value.receipt; value.receipt.digest = await workPlanDigest(receipt); return value;
}
it('pins exact producer bytes and compiles closed actual examples', () => {
  for (const [name, expected] of [['manifest.json', WORK_ORDER_TASKS_PIN.manifestSHA256], ['tasks.schema.json', WORK_ORDER_TASKS_PIN.schemaSHA256], ['examples.json', WORK_ORDER_TASKS_PIN.examplesSHA256]]) expect(createHash('sha256').update(readFileSync(`packages/company-contracts/work-order-tasks-candidate.1/${name}`)).digest('hex')).toBe(expected);
  const ajv = new Ajv2020({strict: true}); ajv.addSchema(schema);
  expect(ajv.getSchema(schema.$id + '#/$defs/MaterializeRequest')!(golden.request)).toBe(true);
  expect(ajv.getSchema(schema.$id + '#/$defs/MaterializeResponse')!(golden.response)).toBe(true);
});
it('validates a complete retained reviewed plan and authorization before accepting exact task inputs', async () => {
  const f = await fixture(), prepared = await prepareWorkOrderTasksRequest(f.request, f.context);
  expect(prepared.request).toEqual(f.request); expect(Object.isFrozen(prepared.context.proposal.response.plan.basis)).toBe(true);
  const response = await validateWorkOrderTasksResponse(workPlanCanonicalBytes(f.response), f.request, f.context);
  expect(response).toEqual(f.response); expect(Object.isFrozen(response.tasks[0].input)).toBe(true);
  expect(response.receipt.dispatch_authorized).toBe(false);
});
it('validates all three actual golden tasks after strict JSON decoding without dropping uniqueItems checks', async () => {
  const response = await validateWorkOrderTasksResponse(workPlanCanonicalBytes(golden.response), golden.request, threeStep.context as unknown as WorkOrderTasksContext);
  expect(response).toEqual(golden.response); expect(response.tasks).toHaveLength(3);
  const duplicate = structuredClone(golden.response); duplicate.tasks[1] = structuredClone(duplicate.tasks[0]);
  await expect(validateWorkOrderTasksResponse(workPlanCanonicalBytes(duplicate), golden.request, threeStep.context as unknown as WorkOrderTasksContext)).rejects.toMatchObject({code: 'RESPONSE'});
});
it('rejects changed independent context or original envelopes before asking for credentials', async () => {
  const f = await fixture();
  for (const change of [(value: WorkOrderTasksContext) => {value.companyId = 'other';}, (value: WorkOrderTasksContext) => {value.principalId = 'other';}, (value: WorkOrderTasksContext) => {value.projectId = 'beta';}, (value: WorkOrderTasksContext) => {value.proposal.request.plan.summary = 'Changed reviewed plan';}, (value: WorkOrderTasksContext) => {value.authorization.request.message_id = 'changed';}]) {
    const context = structuredClone(f.context); change(context);
    await expect(prepareWorkOrderTasksRequest(f.request, context)).rejects.toMatchObject({code: 'REQUEST'});
  }
  const credential = vi.fn(() => 'PUBLIC-unused');
  const client = new WorkPlanClient({origin: 'http://127.0.0.1:9', role: 'owner', credential});
  await expect(client.materialize({...f.request, work_order_id: 'foreign'}, f.context)).rejects.toMatchObject({code: 'REQUEST'});
  expect(credential).not.toHaveBeenCalled();
});
it('rejects internally rehashed task mutations and mismatched dependencies instead of treating hashes as approval', async () => {
  const f = await fixture();
  const mutations = [(v: WorkOrderTasksResponse) => {v.tasks[0].input.step.instruction = 'Unapproved new action';}, (v: WorkOrderTasksResponse) => {v.tasks[0].input.repository_inputs[0].paths = ['elsewhere/'];}, (v: WorkOrderTasksResponse) => {v.tasks[0].task.cost_cents = 0;}, (v: WorkOrderTasksResponse) => {v.tasks[0].input.reservation_ceiling_cents = 0;}, (v: WorkOrderTasksResponse) => {v.tasks[0].dependencies = ['foreign'];}, (v: WorkOrderTasksResponse) => {v.tasks[0].task.id = 'foreign';}, (v: WorkOrderTasksResponse) => {v.tasks[0].task.scope.id = 'beta';}, (v: WorkOrderTasksResponse) => {v.receipt.authorization_digest = 'a'.repeat(64);}, (v: WorkOrderTasksResponse) => {v.receipt.principal_id = 'foreign';}, (v: WorkOrderTasksResponse) => {v.receipt.accepted_at_epoch_seconds = f.context.authorization.request.expires_at_epoch_seconds;}, (v: WorkOrderTasksResponse) => {v.tasks.push(structuredClone(v.tasks[0]));}];
  for (const change of mutations) {const value = structuredClone(f.response); change(value); await resign(value); await expect(validateWorkOrderTasksResponse(workPlanCanonicalBytes(value), f.request, f.context)).rejects.toMatchObject({code: 'RESPONSE'});}
});
it('rejects malformed/overbound output, extra request authority and mismatched retained refs', async () => {
  const f = await fixture();
  for (const input of [{...f.request, approved: true}, {...f.request, work_order_id: 'foreign'}, {...f.request, plan_ref: {...f.request.plan_ref, digest: '0'.repeat(64)}}]) await expect(prepareWorkOrderTasksRequest(input, f.context)).rejects.toThrow();
  for (const raw of [new Uint8Array(262145), new Uint8Array([255]), workPlanCanonicalBytes({...f.response, extra: true})]) await expect(validateWorkOrderTasksResponse(raw, f.request, f.context)).rejects.toThrow();
});
it('retains strict lexical and prototype-key rejection before ordinary-object schema validation', async () => {
  const f = await fixture(), encode = new TextEncoder();
  const raw = JSON.stringify(f.response);
  await expect(validateWorkOrderTasksResponse(encode.encode(raw.replace('{', '{"__proto__":{"polluted":true},')), f.request, f.context)).rejects.toThrow();
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  await expect(validateWorkOrderTasksResponse(encode.encode(raw.replace('"schema_version":1', '"schema_version":1.0')), f.request, f.context)).rejects.toThrow();
  await expect(prepareWorkOrderTasksRequest(encode.encode(JSON.stringify(f.request).replace('"revision":1', '"revision":1e0')), f.context)).rejects.toThrow();
});
it('captures the whole action and review context before credential await and sends only the fixed operation', async () => {
  const f = await fixture(), original = structuredClone(f.request); let release!: (token: string) => void, sent: unknown, calls = 0;
  const server = createServer((request, response) => {const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
    calls++; sent = JSON.parse(Buffer.concat(chunks).toString('utf8')); expect(request.url).toBe('/v1/owner/work-plan/materialize'); expect(request.headers.authorization).toBe('Bearer PUBLIC-task-test');
    const raw = workPlanCanonicalBytes(f.response); response.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': raw.length}); response.end(raw);
  });}); servers.push(server); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Test listener unavailable');
  const client = new WorkPlanClient({origin: `http://127.0.0.1:${address.port}`, role: 'owner', credential: () => new Promise<string>(accept => {release = accept;})});
  const pending = client.materialize(f.request, f.context);
  f.request.project_id = 'beta'; f.context.proposal.request.plan.summary = 'Mutated'; f.context.authorization.request.message_id = 'Mutated';
  await vi.waitFor(() => expect(release).toBeTypeOf('function')); release('PUBLIC-task-test');
  await expect(pending).resolves.toEqual(f.response); expect(sent).toEqual(original); expect(calls).toBe(1);
});
it('returns a closed denial without automatic replay or replacement IDs', async () => {
  const f = await fixture(); let calls = 0;
  const server = createServer((_request, response) => {calls++; const raw = workPlanCanonicalBytes({schema_version: 1, error: {code: 'command_conflict'}}); response.writeHead(409, {'Content-Type': 'application/json', 'Content-Length': raw.length}); response.end(raw);});
  servers.push(server); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Test listener unavailable');
  const client = new WorkPlanClient({origin: `http://127.0.0.1:${address.port}`, role: 'owner', credential: () => 'PUBLIC-test'});
  await expect(client.materialize(f.request, f.context)).rejects.toMatchObject({code: 'command_conflict', status: 409});
  expect(calls).toBe(1);
});
