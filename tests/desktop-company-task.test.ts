import {describe,expect,it} from 'vitest';
import {desktopSurfaceKey,parseDesktopSurface,type DesktopSurface} from '../packages/desktop-contract/index.ts';
import {authorizeCompanyTaskSurface} from '../apps/desktop/company-task-policy.ts';

const task={kind:'company-task',companyId:'leo-company',projectId:'alpha',resourceId:'work-order-alpha'} as const;
const binding={companyId:'leo-company',projectId:'alpha',instructionId:'instruction-alpha',planRef:{kind:'work_plan',id:'plan-alpha',project_id:'alpha',revision:1,digest:'a'.repeat(64)},workOrderId:'work-order-alpha',authorizationDigest:'b'.repeat(64),authorizationExpiresAt:1};
function status(){const observation={status:'unavailable',observed_at:null,expires_at:null,evidence_scope:'unavailable'},project={id:'alpha',name:'Alpha',state:'planning_only',scheduler_paused:false,task_counts:{},occupied_synthetic_slots:0};return {
 evidence_scope:'synthetic_only',live_ready:false,company_accepted:false,planning_mode:'planning_only',native_chat_planner:'capability_missing',targets:{employees:32,departments:16,hermes:18,codex:14},actual_live:{employees:0,hermes:0,codex:0},employees:[],
 runtime_requirements:{source:'trusted_host_configuration',hermes:{mode:null,repository:null,commit:null,compatibility_evidence:null,image_digest:null},codex:{mode:null,package:null,version:null,external_auth_candidate_status:null,image_digest:null}},configured_requirements_digest:'c'.repeat(64),configured_company_digest:'d'.repeat(64),native_limits:{task_timeout_seconds:600,hermes_iteration_cap:50,codex_turn_cap:null,max_child_processes_per_attempt:8,effective_limits:null},auth:observation,budget:observation,project,projects:[project],blockers:[],
};}
function host(options:{binding?:unknown;status?:unknown;denied?:boolean}={}){
 const calls:{url:string;options:RequestInit}[]=[];
 const fetcher=async(input:RequestInfo|URL,init:RequestInit={})=>{
  const url=String(input);calls.push({url,options:init});
  if(url.endsWith('/api/bootstrap'))return new Response(JSON.stringify({mode:'company',csrfToken:'c'.repeat(64)}),{headers:{'set-cookie':'company_session='+ 's'.repeat(32)+'; HttpOnly; SameSite=Strict'}});
  if(url.endsWith('/api/company/workflow'))return Response.json({approvedJob:options.binding??binding});
  if(url.endsWith('/api/company/status'))return options.denied?new Response('private credential text',{status:403}):Response.json({source:'company_service',protocol:'company-service.v1-draft1',data:options.status??status()});
  throw Error('Unexpected native authority route');
 };
 return {calls,fetcher:fetcher as typeof fetch};
}
describe('company native task identity',()=>{
 it('has one exact company/project/WorkOrder surface without a personal thread or destination',()=>{
  expect(parseDesktopSurface(task)).toEqual(task);expect(desktopSurfaceKey(task)).not.toBe(desktopSurfaceKey({...task,resourceId:'work-order-beta'}));
 });
 it.each([{...task,companyId:'other-company'},{...task,projectId:'../private'},{...task,resourceId:''},{...task,threadId:'personal'},{...task,url:'https://example.com'},{...task,projectId:'company-ops'}])('rejects invalid/foreign shape: %j',value=>expect(()=>parseDesktopSurface(value)).toThrow());
});
describe('trusted native company task selection',()=>{
 it('uses only fixed local host reads and the current owner project; an expired approval remains a read-only object',async()=>{
  const fixture=host();expect(await authorizeCompanyTaskSurface(task,'http://127.0.0.1:4319',fixture.fetcher)).toEqual(task);
  expect(fixture.calls.map(call=>new URL(call.url).pathname)).toEqual(['/api/bootstrap','/api/company/workflow','/api/company/status']);
  expect(JSON.parse(fixture.calls[2].options.body as string)).toEqual({scope:{kind:'project',id:'alpha'}});
  for(const call of fixture.calls)expect(call.options.redirect).toBe('error');
 });
 it.each([{...task,resourceId:'foreign-work-order'},{...task,projectId:'beta'}])('rejects a valid-shaped but unselected object before reading another project: %j',async value=>{
  const fixture=host();await expect(authorizeCompanyTaskSurface(value as DesktopSurface,'http://127.0.0.1:4319',fixture.fetcher)).rejects.toThrow();expect(fixture.calls).toHaveLength(2);
 });
 it('refuses an unavailable or malformed full host binding',async()=>{
  const fixture=host({binding:{...binding,authorizationDigest:'bad'}});await expect(authorizeCompanyTaskSurface(task,'http://127.0.0.1:4319',fixture.fetcher)).rejects.toThrow();expect(fixture.calls).toHaveLength(2);
 });
 it('refuses current owner denial without exposing response text',async()=>{
  const fixture=host({denied:true});await expect(authorizeCompanyTaskSurface(task,'http://127.0.0.1:4319',fixture.fetcher)).rejects.toThrow('Company task selection is unavailable');
 });
 it('refuses a project absent from the current status snapshot',async()=>{
  const fixture=host({status:{...status(),projects:[]}});await expect(authorizeCompanyTaskSurface(task,'http://127.0.0.1:4319',fixture.fetcher)).rejects.toThrow();
 });
 it.each([undefined,{...status().project,id:'beta'}])('requires the exact project projection, not just membership in a larger list',async project=>{
  const fixture=host({status:{...status(),project}});await expect(authorizeCompanyTaskSurface(task,'http://127.0.0.1:4319',fixture.fetcher)).rejects.toThrow();
 });
 it.each(['oversized','invalid-utf8','redirect','wrong-protocol'])('fails closed on %s host responses',async fault=>{
  const fixture=host(),fetcher:typeof fetch=async(input,init)=>{
   if(String(input).endsWith('/api/company/workflow')){
    if(fault==='oversized')return new Response(' '.repeat(32769));
    if(fault==='invalid-utf8')return new Response(new Uint8Array([0xc3,0x28]));
    if(fault==='redirect')return new Response(null,{status:302,headers:{location:'https://example.com'}});
   }
   if(fault==='wrong-protocol'&&String(input).endsWith('/api/company/status'))return Response.json({source:'company_service',protocol:'unknown',data:status()});
   return fixture.fetcher(input,init);
  };
  await expect(authorizeCompanyTaskSurface(task,'http://127.0.0.1:4319',fetcher)).rejects.toThrow('Company task selection is unavailable');
 });
 it.each(['https://example.com','http://localhost:4319','http://127.0.0.1:4319/path','http://127.0.0.1:4319/','http://user@127.0.0.1:4319'])('rejects an arbitrary destination before any request: %s',async origin=>{
  const fixture=host();await expect(authorizeCompanyTaskSurface(task,origin,fixture.fetcher)).rejects.toThrow();expect(fixture.calls).toHaveLength(0);
 });
});
