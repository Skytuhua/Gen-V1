import {afterEach, expect, it, vi} from 'vitest';
import {buildCompanyServer, type CompanyContextReader} from '../apps/server/company-mode.ts';
import {CompanyError} from '../packages/company-client/index.ts';
import samples from '../packages/company-contracts/company-manager.v1.samples.json';

const apps: Awaited<ReturnType<typeof buildCompanyServer>>[] = [];
afterEach(async () => {for (const app of apps.splice(0)) await app.close();});
async function setup(contextReader?: CompanyContextReader) {
  const app = await buildCompanyServer({port:4319, contextReader}); apps.push(app);
  const bootstrap = await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4319'}});
  const headers = {host:'127.0.0.1:4319',cookie:bootstrap.headers['set-cookie']!.toString().split(';')[0],'x-harness-csrf':bootstrap.json().csrfToken};
  return {app,headers};
}
const project = samples.examples[0], task = samples.examples[1];
function reader() {return {role:'owner' as const,projectContext:vi.fn(async()=>structuredClone(project.response)),taskContext:vi.fn(async()=>structuredClone(task.response))} as unknown as CompanyContextReader;}
it('keeps the candidate unavailable in the default host and rejects employee composition',async()=>{
  const {app,headers}=await setup();
  const availability=(await app.inject({url:'/api/company/context/availability',headers})).json();
  expect(availability).toMatchObject({configured:false,ownerHostOnly:true,engineAccess:false,manifestSHA256:'fb4e7d2eba19275c5d4013576a01d90984c9f716ce9f0d6e1d1b31a15d46a033'});
  expect((await app.inject({method:'POST',url:'/api/company/context/project',headers,payload:project.request})).statusCode).toBe(503);
  const wrongRole = {...reader(),role:'employee'} as unknown as CompanyContextReader;
  await expect(buildCompanyServer({port:4319,contextReader:wrongRole})).rejects.toThrow('owner');
});
it('forwards only exact owner context reads and labels the separate candidate pin',async()=>{
  const client=reader(),{app,headers}=await setup(client);
  for(const [route,example,call] of [['project',project,client.projectContext],['task',task,client.taskContext]] as const){
    const response=await app.inject({method:'POST',url:`/api/company/context/${route}`,headers,payload:example.request});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({data:example.response,source:'company_service',contractId:'maritime-company-manager',backendCheckpoint:'aca8ec09de5cda73b014a348a05a8f05b43f465b'});
    expect(call).toHaveBeenCalledExactlyOnceWith(example.request);
  }
});
it('validates scope inputs, session and CSRF before calling the context reader',async()=>{
  const client=reader(),{app,headers}=await setup(client);
  for(const request of [
    {headers,payload:{...project.request,query:'*'}},
    {headers,payload:{...project.request,limit:51}},
    {headers:{...headers,'x-harness-csrf':'wrong'},payload:project.request},
    {headers:{host:headers.host},payload:project.request},
  ]) expect((await app.inject({method:'POST',url:'/api/company/context/project',...request})).statusCode).toBeGreaterThanOrEqual(400);
  expect(client.projectContext).not.toHaveBeenCalled();
});
it('preserves a sanitized snapshot restart response instead of serving mixed pages',async()=>{
  const client=reader(),{app,headers}=await setup(client);
  vi.mocked(client.projectContext).mockRejectedValue(new CompanyError('COMPANY_SNAPSHOT_CHANGED'));
  const response=await app.inject({method:'POST',url:'/api/company/context/project',headers,payload:project.request});
  expect(response.statusCode).toBe(409);expect(response.json()).toMatchObject({error:{code:'COMPANY_SNAPSHOT_CHANGED',restartRequired:true}});
  vi.mocked(client.projectContext).mockRejectedValue(new Error('secret private host path'));
  const failure=await app.inject({method:'POST',url:'/api/company/context/project',headers,payload:project.request});
  expect(failure.statusCode).toBe(503);expect(failure.body).not.toContain('secret');
});
