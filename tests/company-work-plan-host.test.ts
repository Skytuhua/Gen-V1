import {afterEach, expect, it, vi} from 'vitest';
import samples from '../packages/company-contracts/owner-work-plan-candidate.1/examples.json';
import {buildCompanyServer, readCompanyHostOptions} from '../apps/server/company-mode';
import type {CompanyWorkPlanClient} from '../apps/server/company-workflow';

const apps: Awaited<ReturnType<typeof buildCompanyServer>>[] = [];
afterEach(async () => {await Promise.all(apps.splice(0).map(app => app.close()));});
const example = (name: string) => samples.cases.find(item => item.name === name)!;
async function setup(configured = true) {
  const client = {role: 'owner', propose: vi.fn(async () => example('propose_initial').response), read: vi.fn(async () => example('read_proposed').response), authorize: vi.fn(async () => example('authorize_exact').response)};
  const app = await buildCompanyServer({port: 4319, ...(configured ? {workPlanClient: client as unknown as CompanyWorkPlanClient} : {})}); apps.push(app);
  const boot = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4319'}});
  const headers = {host: '127.0.0.1:4319', cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken};
  return {app, headers, client};
}
it('keeps work plan storage opt-in and execution disabled even with an owner status token', async () => {
  const env = {GEN_COMPANY_SERVICE_ORIGIN: 'http://127.0.0.1:9999', GEN_COMPANY_SERVICE_TOKEN: 'PUBLIC-test'};
  expect(readCompanyHostOptions(env).workPlanClient).toBeUndefined();
  expect(readCompanyHostOptions({...env, GEN_COMPANY_WORK_PLANS: 'true'}).workPlanClient?.role).toBe('owner');
  expect(() => readCompanyHostOptions({GEN_COMPANY_WORK_PLANS: 'true'})).toThrow();
  const {app, headers} = await setup(false);
  expect((await app.inject({url: '/api/company/workflow', headers})).json()).toMatchObject({authorize: false, progress: false, result: false, workPlans: {configured: false}});
  const response = await app.inject({url: '/api/company/workflow/work-plan/authorize', method: 'POST', headers, payload: example('authorize_exact').request});
  expect(response.statusCode).toBe(503);
});
it('checks session, CSRF and closed fields before calling the fixed owner service methods', async () => {
  const {app, headers, client} = await setup();
  const url = '/api/company/workflow/work-plan/propose', payload = example('propose_initial').request;
  expect((await app.inject({url, method: 'POST', headers: {host: headers.host}, payload})).statusCode).toBe(401);
  expect((await app.inject({url, method: 'POST', headers: {...headers, 'x-harness-csrf': 'wrong'}, payload})).statusCode).toBe(403);
  expect((await app.inject({url, method: 'POST', headers, payload: {...payload, actor: 'owner'}})).statusCode).toBe(400);
  expect(client.propose).not.toHaveBeenCalled();
  for (const [operation, sample] of [['propose', 'propose_initial'], ['read', 'read_proposed'], ['authorize', 'authorize_exact']] as const) {
    const result = await app.inject({url: `/api/company/workflow/work-plan/${operation}`, method: 'POST', headers, payload: example(sample).request});
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual(example(sample).response);
    expect(client[operation]).toHaveBeenCalledExactlyOnceWith(example(sample).request);
  }
});
it('rejects mismatched signed responses and never exposes raw upstream exceptions or retries', async () => {
  const {app, headers, client} = await setup();
  client.read.mockResolvedValueOnce({...example('read_proposed').response, plan: {...(example('read_proposed').response as {plan: object}).plan, project_id: 'beta'}} as never);
  const read = await app.inject({url: '/api/company/workflow/work-plan/read', method: 'POST', headers, payload: example('read_proposed').request});
  expect(read.statusCode).toBe(502);
  client.authorize.mockRejectedValueOnce(new Error('PRIVATE-service-token-path'));
  const failed = await app.inject({url: '/api/company/workflow/work-plan/authorize', method: 'POST', headers, payload: example('authorize_exact').request});
  expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain('PRIVATE'); expect(client.authorize).toHaveBeenCalledTimes(1);
});
