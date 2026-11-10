import {afterEach, expect, it, vi} from 'vitest';
import {buildCompanyServer, readCompanyHostOptions} from '../apps/server/company-mode.ts';
import type {CompanyInstructionClient} from '../apps/server/company-workflow.ts';

const apps: Awaited<ReturnType<typeof buildCompanyServer>>[] = [];
afterEach(async () => {await Promise.all(apps.splice(0).map(app => app.close()));});
const input = {project_id: 'alpha', message_id: 'owner-request-1', instruction: 'Inspect the approved task. Publish nothing.'};
const proposal = {...input, id: 'proposal-1', kind: 'planning_proposal', state: 'planning_only', planner: 'capability_missing', model_produced: false, dispatch_authorized: false, live_ready: false, evidence_scope: 'local_owner_instruction', blockers: ['Employee execution is unavailable.']};
async function setup(client?: CompanyInstructionClient) {
  const app = await buildCompanyServer({port: 4319, instructionClient: client}); apps.push(app);
  const boot = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4319'}});
  const headers = {host: '127.0.0.1:4319', cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken};
  return {app, headers};
}
it('keeps default instruction intake and real authorization/progress/results unavailable', async () => {
  const {app, headers} = await setup();
  const value = (await app.inject({url: '/api/company/workflow', headers})).json();
  expect(value).toMatchObject({mode: 'planning_only', recordInstruction: false, authorize: false, progress: false, result: false});
  expect((await app.inject({method: 'POST', url: '/api/company/workflow/instruction', headers, payload: input})).statusCode).toBe(503);
  for (const action of ['authorize', 'start', 'result']) expect((await app.inject({method: 'POST', url: `/api/company/workflow/${action}`, headers, payload: input})).statusCode).toBe(404);
});
it('requires an explicit host opt-in; owner status connection alone grants no intake', () => {
  const env = {GEN_COMPANY_SERVICE_ORIGIN: 'http://127.0.0.1:9999', GEN_COMPANY_SERVICE_TOKEN: 'PUBLIC-fixture'};
  expect(readCompanyHostOptions(env).instructionClient).toBeUndefined();
  expect(readCompanyHostOptions({...env, GEN_COMPANY_PLANNING_INTAKE: 'true'}).instructionClient?.role).toBe('owner');
  expect(() => readCompanyHostOptions({GEN_COMPANY_PLANNING_INTAKE: 'true'})).toThrow();
});
it('checks local owner session, CSRF and closed inputs before one exact current-authorized service call', async () => {
  const plan = vi.fn(async () => proposal), {app, headers} = await setup({role: 'owner', plan} as CompanyInstructionClient);
  expect((await app.inject({method: 'POST', url: '/api/company/workflow/instruction', headers: {host: headers.host}, payload: input})).statusCode).toBe(401);
  expect((await app.inject({method: 'POST', url: '/api/company/workflow/instruction', headers: {...headers, 'x-harness-csrf': 'wrong'}, payload: input})).statusCode).toBe(403);
  expect((await app.inject({method: 'POST', url: '/api/company/workflow/instruction', headers, payload: {...input, approved: true}})).statusCode).toBe(400);
  expect(plan).not.toHaveBeenCalled();
  const response = await app.inject({method: 'POST', url: '/api/company/workflow/instruction', headers, payload: input});
  expect(response.statusCode).toBe(200);
  expect(plan).toHaveBeenCalledExactlyOnceWith(input);
  expect(response.json()).toMatchObject({source: 'company_service', proposal: {id: 'proposal-1', dispatch_authorized: false, model_produced: false}});
  expect(response.body).not.toContain('message_id');
});
it('rejects cross-project or changed-instruction receipts and strips unrecognized credential fields', async () => {
  const plan = vi.fn(async () => ({...proposal, project_id: 'beta'})), {app, headers} = await setup({role: 'owner', plan} as CompanyInstructionClient);
  expect((await app.inject({method: 'POST', url: '/api/company/workflow/instruction', headers, payload: input})).statusCode).toBe(502);
  plan.mockResolvedValueOnce({...proposal, instruction: 'Changed input'});
  expect((await app.inject({method: 'POST', url: '/api/company/workflow/instruction', headers, payload: input})).statusCode).toBe(502);
  plan.mockResolvedValueOnce({...proposal, token: 'must-not-reach-browser'} as typeof proposal);
  const response = await app.inject({method: 'POST', url: '/api/company/workflow/instruction', headers, payload: input});
  expect(response.statusCode).toBe(200); expect(response.body).not.toContain('must-not-reach-browser');
});
it('preserves stable owner command identity without retrying uncertain service failures or leaking raw errors', async () => {
  const plan = vi.fn(async () => {throw new Error('PRIVATE-token-path');}), {app, headers} = await setup({role: 'owner', plan} as CompanyInstructionClient);
  const response = await app.inject({method: 'POST', url: '/api/company/workflow/instruction', headers, payload: input});
  expect(response.statusCode).toBe(503); expect(response.body).not.toContain('PRIVATE'); expect(plan).toHaveBeenCalledTimes(1);
});
