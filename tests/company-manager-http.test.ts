import {afterEach, expect, it, vi} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage/store.ts';
import {buildCompanyServer, type CompanyReader} from '../apps/server/company-mode.ts';
import {CompanyManagerJournal} from '../packages/company-manager/journal.ts';
import {createManagerDraft} from '../packages/company-manager/proposals.ts';
const owned: {app: Awaited<ReturnType<typeof buildCompanyServer>>; store: Store; dir: string}[] = [];
afterEach(async () => {for (const item of owned.splice(0)) {await item.app.close(); item.store.close(); await rm(item.dir, {recursive:true,force:true});}});
const input = {projectId:'alpha',requestId:'req-1',instruction:'Plan a scoped fix. Publish nothing.'};
async function setup(configured = true) {
  const dir=await mkdtemp(join(tmpdir(),'company-manager-http-')),store=new Store(dir);
  const manager={propose:vi.fn(async()=>createManagerDraft(input,{summary:'Inspect the behavior',interpretation:'Draft only.',assumptions:[],blockers:[],tasks:[{id:'inspect',title:'Inspect',instructions:'Read approved evidence.',dependsOn:[],proposedEmployeeId:null,sourceRefs:[],deliverable:'research',requiredEvidence:['Read the exact source.']}]},{permitId:'permit-1',policyRevision:'mandate-1',sourceRefs:[],createdAt:100})),cancel:vi.fn(async()=>{}),dispose:vi.fn(async()=>{})};
  const client={role:'owner',status:vi.fn(async(scope:{id:string})=>({project:{id:scope.id}}))} as unknown as CompanyReader;
  const journal=new CompanyManagerJournal(store,manager),app=await buildCompanyServer({port:4319,client,...(configured?{manager:journal}:{})});
  owned.push({app,store,dir});
  const bootstrap=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4319'}});
  const headers={host:'127.0.0.1:4319',cookie:bootstrap.headers['set-cookie']!.toString().split(';')[0],'x-harness-csrf':bootstrap.json().csrfToken};
  return {app,headers,manager,client};
}
it('keeps default manager inference unavailable without trusted host composition',async()=>{
  const {app,headers,manager}=await setup(false);
  expect((await app.inject({url:'/api/company/manager/availability',headers})).json()).toMatchObject({configured:false,mode:'shadow_proposals',dispatchAuthorized:false,durableCompanyStorage:false});
  expect((await app.inject({method:'POST',url:'/api/company/manager/propose',headers,payload:input})).statusCode).toBe(503);
  expect(manager.propose).not.toHaveBeenCalled();
});
it('checks authenticated owner project scope for every draft action and never passes the owner client to the manager',async()=>{
  const {app,headers,manager,client}=await setup();
  const response=await app.inject({method:'POST',url:'/api/company/manager/propose',headers,payload:input});
  expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({status:'draft_ready',scope:'local_ui_interaction',companyReceipt:null,draft:{dispatchAuthorized:false}});
  expect(client.status).toHaveBeenCalledExactlyOnceWith({kind:'project',id:'alpha'});
  expect(manager.propose).toHaveBeenCalledExactlyOnceWith(input);
  const fetched=await app.inject({method:'POST',url:'/api/company/manager/request',headers,payload:{projectId:'alpha',requestId:'req-1'}});
  expect(fetched.json().draft.id).toBe(response.json().draft.id);
  const replay=await app.inject({method:'POST',url:'/api/company/manager/propose',headers,payload:input});
  expect(replay.json().draft.id).toBe(response.json().draft.id);expect(manager.propose).toHaveBeenCalledTimes(1);
});
it('rejects revoked scope, extra permit flags and stale local CSRF before manager work',async()=>{
  const {app,headers,client,manager}=await setup();
  expect((await app.inject({method:'POST',url:'/api/company/manager/propose',headers,payload:{...input,permit:{enabled:true}}})).statusCode).toBe(400);
  expect((await app.inject({method:'POST',url:'/api/company/manager/propose',headers:{...headers,'x-harness-csrf':'bad'},payload:input})).statusCode).toBe(403);
  vi.mocked(client.status).mockRejectedValue(new Error('private service credential'));
  const denied=await app.inject({method:'POST',url:'/api/company/manager/propose',headers,payload:input});
  expect(denied.statusCode).toBe(503);expect(denied.body).not.toContain('private service credential');expect(manager.propose).not.toHaveBeenCalled();
});
