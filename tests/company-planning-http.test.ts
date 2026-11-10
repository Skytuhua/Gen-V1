import {afterEach, expect, it, vi} from 'vitest';
import {buildCompanyServer, readCompanyHostOptions, type CompanyPlanningClient} from '../apps/server/company-mode.ts';
import {CompanyError, type CompanyErrorCode} from '../packages/company-client/index.ts';
import samples from '../packages/company-contracts/company-manager.commands.v1.samples.json';

const apps: Awaited<ReturnType<typeof buildCompanyServer>>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});
const operations=[['mandate','setMandate'],['intake','recordIntake'],['proposal','submitProposal'],['review','reviewProposal'],['context','planningContext']] as const;
function client(){return Object.assign({role:'owner' as const},Object.fromEntries(operations.map(([,method],index)=>[method,vi.fn(async()=>structuredClone(samples.examples[index].response))]))) as unknown as CompanyPlanningClient;}
async function setup(planningClient?:CompanyPlanningClient){
  const app=await buildCompanyServer({port:4319,planningClient});apps.push(app);
  const bootstrap=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4319'}});
  const headers={host:'127.0.0.1:4319',cookie:bootstrap.headers['set-cookie']!.toString().split(';')[0],'x-harness-csrf':bootstrap.json().csrfToken};
  return {app,headers};
}
it('keeps all planning operations unavailable in ordinary CLI composition',async()=>{
  const options=readCompanyHostOptions({GEN_COMPANY_SERVICE_ORIGIN:'http://127.0.0.1:1234',GEN_COMPANY_SERVICE_TOKEN:'synthetic-fixture-only'});
  expect(options.planningClient).toBeUndefined();expect(options.manager).toBeUndefined();
  const {app,headers}=await setup();
  expect((await app.inject({url:'/api/company/planning/availability',headers})).json()).toMatchObject({configured:false,mode:'planning_records_only',executionAuthorized:false,dispatchAuthorized:false,engineAccess:false});
  for(const [index,[route]] of operations.entries())expect((await app.inject({method:'POST',url:`/api/company/planning/${route}`,headers,payload:samples.examples[index].request})).statusCode).toBe(503);
  expect((await app.inject({url:'/api/company/connection',headers})).json().mode).toBe('read_only');
  await expect(buildCompanyServer({port:4319,planningClient:{...client(),role:'employee'} as unknown as CompanyPlanningClient})).rejects.toThrow('owner');
});
it('forwards the five exact typed operations without treating storage or review as admission',async()=>{
  const planningClient=client(),{app,headers}=await setup(planningClient);
  expect((await app.inject({url:'/api/company/connection',headers})).json().mode).toBe('planning_records');
  for(const [index,[route,method]] of operations.entries()){
    const response=await app.inject({method:'POST',url:`/api/company/planning/${route}`,headers,payload:samples.examples[index].request});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({data:samples.examples[index].response,source:'company_service',contractId:'maritime-company-manager-commands',backendCheckpoint:'b4317f308ca84a26de5cd647706b3f9997cddfd3'});
    expect(planningClient[method]).toHaveBeenCalledExactlyOnceWith(samples.examples[index].request);
    if(index<4)expect(response.json().data.receipt).toMatchObject({authority:'planning_only',execution_authorized:false,dispatch_authorized:false,work_order_id:null});
  }
});
it('checks exact input, session, CSRF and origin before forwarding an owner mutation',async()=>{
  const planningClient=client(),{app,headers}=await setup(planningClient),request=samples.examples[0].request;
  for(const attempt of [
    {headers,payload:{...request,dispatch_authorized:true}},
    {headers:{host:headers.host},payload:request},
    {headers:{...headers,'x-harness-csrf':'wrong'},payload:request},
    {headers:{...headers,origin:'https://untrusted.invalid'},payload:request},
  ])expect((await app.inject({method:'POST',url:'/api/company/planning/mandate',...attempt})).statusCode).toBeGreaterThanOrEqual(400);
  expect(planningClient.setMandate).not.toHaveBeenCalled();
  expect((await app.inject({method:'POST',url:'/api/company/planning/action',headers,payload:{operation:'setMandate',...request}})).statusCode).toBe(404);
});
it('uses the larger byte bound only for the five new paths',async()=>{
  const planningClient=client(),{app,headers}=await setup(planningClient);
  const request=structuredClone(samples.examples[1].request) as typeof samples.examples[1]['request']&{intake:{instruction:string}};
  request.intake.instruction='漢'.repeat(16000);
  expect(Buffer.byteLength(JSON.stringify(request))).toBeGreaterThan(32768);
  expect((await app.inject({method:'POST',url:'/api/company/planning/intake',headers,payload:request})).statusCode).toBe(200);
  expect(planningClient.recordIntake).toHaveBeenCalledExactlyOnceWith(request);
  expect((await app.inject({method:'POST',url:'/api/company/status',headers,payload:{scope:{kind:'project',id:'alpha'},text:'x'.repeat(33000)}})).statusCode).toBe(413);
  expect((await app.inject({method:'POST',url:'/api/company/planning/intake',headers,payload:{text:'x'.repeat(131073)}})).statusCode).toBe(413);
});
it.each([
  ['COMPANY_MESSAGE_CONFLICT',409],['COMPANY_REVISION_CONFLICT',409],['COMPANY_STALE_BASIS',409],['COMPANY_REFERENCE_MISMATCH',409],
  ['COMPANY_RECORD_TOO_LARGE',413],['COMPANY_STORAGE_UNAVAILABLE',503],['COMPANY_CAPABILITY_UNAVAILABLE',503],['COMPANY_NOT_FOUND',404],
  ['COMPANY_AUTH',401],['COMPANY_FORBIDDEN',403],['COMPANY_REQUEST',400],
] as const)('preserves fixed planning error %s without snapshot-restart semantics',async(code,status)=>{
  const planningClient=client(),{app,headers}=await setup(planningClient);
  vi.mocked(planningClient.setMandate).mockRejectedValue(new CompanyError(code as CompanyErrorCode));
  const response=await app.inject({method:'POST',url:'/api/company/planning/mandate',headers,payload:samples.examples[0].request});
  expect(response.statusCode).toBe(status);expect(response.json().error.code).toBe(code);expect(response.json().error.restartRequired).toBeUndefined();
});
it.each(operations.flatMap(([route,method],index)=>[
  {route,method,index,code:'COMPANY_AUTH' as const,status:401},
  {route,method,index,code:'COMPANY_FORBIDDEN' as const,status:403},
]))('clears a prior owner authentication observation when $route returns $code',async({route,method,index,code,status})=>{
  const planningClient=client(),{app,headers}=await setup(planningClient),request=samples.examples[index].request;
  const invoke=()=>app.inject({method:'POST',url:`/api/company/planning/${route}`,headers,payload:request});
  const connection=async()=>(await app.inject({url:'/api/company/connection',headers})).json();
  expect((await connection()).ownerAuthenticated).toBe(false);
  expect((await invoke()).statusCode).toBe(200);
  expect((await connection()).ownerAuthenticated).toBe(true);
  vi.mocked(planningClient[method]).mockRejectedValueOnce(new CompanyError(code));
  const rejected=await invoke();
  expect(rejected.statusCode).toBe(status);expect(rejected.json().error.code).toBe(code);
  expect((await connection()).ownerAuthenticated).toBe(false);
  expect(planningClient[method]).toHaveBeenCalledTimes(2);
  expect(vi.mocked(planningClient[method]).mock.calls.map(call=>call[0])).toEqual([request,request]);
  expect((await invoke()).statusCode).toBe(200);
  expect((await connection()).ownerAuthenticated).toBe(true);
});
it('keeps the exact mutation identity for explicit recovery and never retries automatically',async()=>{
  const planningClient=client(),{app,headers}=await setup(planningClient),request=samples.examples[0].request;
  vi.mocked(planningClient.setMandate).mockRejectedValueOnce(new CompanyError('COMPANY_TIMEOUT'));
  const first=await app.inject({method:'POST',url:'/api/company/planning/mandate',headers,payload:request});
  expect(first.statusCode).toBe(504);expect(planningClient.setMandate).toHaveBeenCalledTimes(1);
  const recovered=await app.inject({method:'POST',url:'/api/company/planning/mandate',headers,payload:request});
  expect(recovered.statusCode).toBe(200);expect(vi.mocked(planningClient.setMandate).mock.calls.map(call=>call[0])).toEqual([request,request]);
  vi.mocked(planningClient.setMandate).mockRejectedValue(new Error('private-token-and-path'));
  const failed=await app.inject({method:'POST',url:'/api/company/planning/mandate',headers,payload:request});
  expect(failed.statusCode).toBe(503);expect(failed.body).not.toContain('private-token-and-path');
});
