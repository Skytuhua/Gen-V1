import {expect, it} from 'vitest';
import examples from '../packages/company-contracts/owner-work-plan-candidate.1/examples.json';
import {captureWorkPlanRequest, validateWorkPlanResponse, workPlanCanonicalBytes, workPlanDigest, workPlanRef, type WorkPlanProposeRequest, type WorkPlanProposeResponse, type WorkPlanReadRequest, type WorkPlanReadResponse, type WorkPlanAuthorizeRequest, type WorkPlanAuthorizeResponse} from '../packages/company-contracts/work-plan.ts';

const cases = examples.cases;
const first = cases[0] as unknown as {request: WorkPlanProposeRequest; response: WorkPlanProposeResponse};
const authorization = cases[2] as unknown as {request: WorkPlanAuthorizeRequest; response: WorkPlanAuthorizeResponse};
const read = cases[3] as unknown as {request: WorkPlanReadRequest; response: WorkPlanReadResponse};
const historical = cases[5] as unknown as {request: WorkPlanReadRequest; response: WorkPlanReadResponse};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const signed = async (value: Record<string, unknown>) => {const {digest: _digest, ...body} = value; return {...body, digest: await workPlanDigest(body)};};
it('validates all six producer examples including historical expired acceptance without granting execution', async () => {
  for (const item of cases) {
    const operation = item.path.endsWith('/propose') ? 'propose' : item.path.endsWith('/authorize') ? 'authorize' : 'read';
    const value = await validateWorkPlanResponse(operation, bytes(item.response), item.request);
    expect(value.schema_version).toBe(1); expect(Object.isFrozen(value)).toBe(true);
  }
  const recovered = await validateWorkPlanResponse('read', bytes(historical.response), historical.request);
  expect(recovered.eligibility.authorization_current).toBe(false);
  expect(recovered.authorization?.receipt.work_order_stored).toBe(true);
  expect(recovered.eligibility.dispatch_authorized).toBe(false);
});
it('captures exact arguments immutably and bounds decoded UTF8 text plus whole encoded request', () => {
  const request = structuredClone(first.request), original = structuredClone(request);
  const captured = captureWorkPlanRequest('propose', request);
  request.plan.summary = 'Modified after capture';
  expect(captured.request).toEqual(original); expect(Object.isFrozen(captured.request.plan)).toBe(true);
  expect(() => captureWorkPlanRequest('propose', {...original, plan: {...original.plan, summary: 'é'.repeat(1024)}})).not.toThrow();
  expect(() => captureWorkPlanRequest('propose', {...original, plan: {...original.plan, summary: 'é'.repeat(1025)}})).toThrow();
  expect(() => captureWorkPlanRequest('propose', {...original, plan: {...original.plan, summary: '\u0000'}})).toThrow();
  expect(() => captureWorkPlanRequest('propose', {...original, approved: true})).toThrow();
});
it('rejects invalid dependency graphs, employees, duplicate repositories and relative path escapes', () => {
  const request = structuredClone(first.request);
  for (const plan of [
    {...request.plan, steps: [{...request.plan.steps[0], depends_on: ['implementation']}]},
    {...request.plan, steps: [{...request.plan.steps[0], depends_on: ['unknown']}]},
    {...request.plan, employee_ids: ['E01']},
    {...request.plan, repository_inputs: [...request.plan.repository_inputs, ...request.plan.repository_inputs]},
    {...request.plan, repository_inputs: [{...request.plan.repository_inputs[0], paths: ['../private']}]},
  ]) expect(() => captureWorkPlanRequest('propose', {...request, plan})).toThrow();
});
it('uses new route integer lexemes without changing frozen C01: -0 normalizes, floats/exponents/BOM/duplicates reject', () => {
  const source = JSON.stringify(first.request).replace('"budget_cents":500', '"budget_cents":-0');
  expect((captureWorkPlanRequest('propose', bytes(JSON.parse(source))).request as typeof first.request).plan.budget_cents).toBe(0);
  expect(captureWorkPlanRequest('propose', new TextEncoder().encode(source)).request.plan.budget_cents).toBe(0);
  for (const token of ['1.0', '1e0', '9007199254740992', 'NaN']) expect(() => captureWorkPlanRequest('propose', new TextEncoder().encode(source.replace(':-0', ':' + token)))).toThrow();
  expect(() => captureWorkPlanRequest('propose', new TextEncoder().encode('\uFEFF' + source))).toThrow();
  expect(() => captureWorkPlanRequest('propose', new TextEncoder().encode(source.replace('"project_id":"alpha"', '"project_id":"alpha","project_id":"alpha"')))).toThrow();
});
it('rejects changed independent project, instruction, proposal args and expected head', async () => {
  for (const input of [{...first.request, project_id: 'beta'}, {...first.request, instruction_id: 'other'}, {...first.request, message_id: 'other'}, {...first.request, plan: {...first.request.plan, summary: 'Changed'}}]) {
    await expect(validateWorkPlanResponse('propose', bytes(first.response), input)).rejects.toThrow();
  }
  await expect(validateWorkPlanResponse('read', bytes(read.response), {...read.request, plan_ref: {...read.request.plan_ref, digest: '0'.repeat(64)}})).rejects.toThrow();
});
it('rejects all signed-record and fullref tampering even when structural schema passes', async () => {
  const mutations = [
    (value: any) => {value.plan.plan.summary = 'tampered';},
    (value: any) => {value.plan.basis.instruction.record.instruction = 'tampered';},
    (value: any) => {value.plan.basis.charter.spec.name = 'tampered';},
    (value: any) => {value.receipt.plan_ref.digest = '0'.repeat(64);},
    (value: any) => {value.receipt.request_digest = '0'.repeat(64);},
  ];
  for (const mutate of mutations) {const value = structuredClone(first.response); mutate(value); await expect(validateWorkPlanResponse('propose', bytes(value), first.request)).rejects.toThrow();}
});
it('joins authorization request, ID preimages, OwnerApproval, WorkOrder, receipt and exact retained expiry', async () => {
  const value = await validateWorkPlanResponse('authorize', bytes(authorization.response), authorization.request);
  expect(value.authorization.request).toEqual(authorization.request);
  await expect(validateWorkPlanResponse('authorize', bytes(authorization.response), {...authorization.request, expires_at_epoch_seconds: 999})).rejects.toThrow();
  const forged: any = structuredClone(authorization.response);
  forged.authorization.owner_approval.audit_ref = 'foreign plan';
  forged.authorization = await signed(forged.authorization);
  await expect(validateWorkPlanResponse('authorize', bytes(forged), authorization.request)).rejects.toThrow();
});
it('does not accept internally rehashed foreign current head or contradictory eligibility', async () => {
  const value: any = structuredClone(read.response);
  value.current_head_ref.id = 'foreign';
  await expect(validateWorkPlanResponse('read', bytes(value), read.request)).rejects.toThrow();
  const contradiction: any = structuredClone(historical.response);
  contradiction.eligibility.can_authorize = true;
  await expect(validateWorkPlanResponse('read', bytes(contradiction), historical.request)).rejects.toThrow();
});
it('canonicalizes Python key order, preserves text/array order, and derives the complete record ref', async () => {
  expect(new TextDecoder().decode(workPlanCanonicalBytes({'\u{1F600}': 1, '\uE000': 2, a: 'e\u0301'}))).toBe('{"a":"é","":2,"😀":1}');
  expect(workPlanRef(first.response.plan)).toEqual(first.response.receipt.plan_ref);
  expect(await workPlanDigest(first.response.plan.basis.instruction.record)).toBe(first.response.plan.basis.instruction.digest);
});
it('rejects overlarge, malformed UTF8 and trailing output before admitting any record', async () => {
  await expect(validateWorkPlanResponse('propose', new Uint8Array(262145), first.request)).rejects.toThrow();
  await expect(validateWorkPlanResponse('propose', new Uint8Array([0xff]), first.request)).rejects.toThrow();
  await expect(validateWorkPlanResponse('propose', new TextEncoder().encode(JSON.stringify(first.response) + '{}'), first.request)).rejects.toThrow();
});
