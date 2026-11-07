import Fastify from 'fastify';
import {buildServer} from '../apps/server/server.ts';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ZodError} from 'zod';
import {Store} from '../packages/storage/store.ts';
import {HarnessError} from '../packages/contracts/index.ts';
import type {Service} from '../packages/core/service.ts';
import type {ProjectTools} from '../packages/workspace/tools.ts';
import type {TerminalHost} from '../packages/workspace/terminal.ts';
import type {GitHubTools} from '../packages/workspace/github.ts';
import {registerWorkspaceHost} from '../apps/server/workspace-host.ts';
import {registerWorkspaceRoutes} from '../apps/server/workspace-routes.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'gen-pr-links-')),store=new Store(join(root,'data')),service={store} as Service,app=Fastify();
 cleanup.push(async()=>{await app.close();store.close();if(!root.startsWith(join(tmpdir(),'gen-pr-links-')))throw Error('Unexpected fixture cleanup path');await rm(root,{recursive:true,force:true,maxRetries:5});});
 const repos:Record<string,string>={project:'example/fixture',other:'example/other'},owners:Record<string,string>={alpha:'project',beta:'project',gamma:'other'};
 const binding=vi.fn(async(projectId:string,threadId?:string)=>{if(!repos[projectId]||threadId&&owners[threadId]!==projectId)throw new HarnessError('PROJECT_SCOPE','Project/thread scope denied');return{path:root};});
 const item=(number:number,title='Saved '+number,repo='example/fixture')=>({number,title,url:'https://github.com/'+repo+'/pull/'+number,state:'OPEN',headRefOid:'a'.repeat(40)});
 const details=vi.fn(async(projectId:string,_threadId:string|undefined,number:number)=>({repo:repos[projectId],item:item(number,undefined,repos[projectId]),head:'a'.repeat(40),revision:'c'.repeat(64),canReview:true}));
 const list=vi.fn(async(projectId:string)=>({repo:repos[projectId],items:[item(99,'Repository-wide fixture',repos[projectId])]}));
 const repo=vi.fn(async(projectId:string)=>({path:root,repo:repos[projectId]}));
 const projects={store,binding,workspace:{migrateProjects:vi.fn()},dispose:async()=>{}} as unknown as ProjectTools,terminals={dispose:async()=>{}} as TerminalHost;
 const auth={start:vi.fn(async()=>({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',userCode:'ABCD-EFGH'})),poll:vi.fn(async()=>({status:'pending'})),cancel:vi.fn(async()=>({status:'cancelled'}))};
 registerWorkspaceHost(service,{projects,terminals,github:{details,list,repo,auth} as unknown as GitHubTools});
 app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof ZodError?400:error instanceof HarnessError?403:500).send({error:{code:error instanceof HarnessError?error.code:'INVALID_INPUT'}}));
 registerWorkspaceRoutes(app,service);
 const link=(id:string,threadId:string|undefined,number=12,projectId='project')=>app.inject({method:'POST',url:'/api/projects/'+projectId+'/actions',payload:{id,type:'link-pr',payload:{number},...(threadId?{threadId}:{})}});
 const linked=(threadId?:string,projectId='project')=>app.inject('/api/projects/'+projectId+'/pull-requests?linked=1'+(threadId?'&threadId='+threadId:''));
 return{app,store,repos,binding,details,list,repo,item,link,linked,auth,service};
}
it('keeps the default repository list separate from saved linked associations',async()=>{
 const{app,link,linked,list}=await fixture();await link('link-alpha','alpha');
 const saved=await linked('alpha');expect(saved.statusCode).toBe(200);expect(saved.json().items.map((item:{number:number})=>item.number)).toEqual([12]);expect(list).not.toHaveBeenCalled();
 const all=await app.inject('/api/projects/project/pull-requests?threadId=alpha');expect(all.json().items[0].number).toBe(99);expect(list).toHaveBeenCalledWith('project','alpha');
});
it('stores independent thread links to the same PR without overwriting either owner',async()=>{
 const{store,link,linked}=await fixture();await link('link-alpha','alpha');await link('link-beta','beta');
 expect(store.all('linkedPullRequest')).toHaveLength(2);for(const thread of ['alpha','beta'])expect((await linked(thread)).json().items.map((item:{number:number})=>item.number)).toEqual([12]);
 expect(store.get('linkedPullRequest',JSON.stringify(['project','alpha','example/fixture',12]))).toMatchObject({threadId:'alpha'});
 expect(store.get('linkedPullRequest',JSON.stringify(['project','beta','example/fixture',12]))).toMatchObject({threadId:'beta'});
});
it('keeps duplicate link commands idempotent and repeated links singular',async()=>{
 const{store,details,link,linked}=await fixture();const first=await link('same-command','alpha');const duplicate=await link('same-command','alpha');
 expect(duplicate.json()).toEqual(first.json());expect(details).toHaveBeenCalledTimes(1);await link('new-command','alpha');
 expect(store.all('linkedPullRequest')).toHaveLength(1);expect((await linked('alpha')).json().items).toHaveLength(1);
});
it('reads legacy links by body scope and prefers a new link without deleting history',async()=>{
 const{store,item,details,link,linked}=await fixture();store.internal('fixture.legacy',null,()=>store.put('linkedPullRequest','project:12','alpha',{projectId:'project',threadId:'alpha',repo:'example/fixture',item:item(12,'Old saved title')}));
 expect((await linked('alpha')).json().items[0].title).toBe('Old saved title');expect((await linked('beta')).json().items).toEqual([]);
 details.mockResolvedValueOnce({repo:'example/fixture',item:item(12,'New saved title'),head:'a'.repeat(40),revision:'c'.repeat(64),canReview:true});await link('fresh-alpha','alpha');
 expect((await linked('alpha')).json().items.map((item:{title:string})=>item.title)).toEqual(['New saved title']);expect(store.get('linkedPullRequest','project:12')).toMatchObject({item:{title:'Old saved title'}});expect(store.all('linkedPullRequest')).toHaveLength(2);
});
it('isolates project, thread and current repository, including an unbound owner',async()=>{
 const{repos,link,linked}=await fixture();await link('alpha','alpha');await link('gamma','gamma',12,'other');await link('unbound',undefined,13);
 expect((await linked('beta')).json().items).toEqual([]);expect((await linked('gamma','other')).json().items).toMatchObject([{number:12,url:'https://github.com/example/other/pull/12'}]);expect((await linked()).json().items.map((item:{number:number})=>item.number)).toEqual([13]);
 repos.project='example/replacement';expect((await linked('alpha')).json().items).toEqual([]);await link('new-repo','alpha');expect((await linked('alpha')).json().repo).toBe('example/replacement');expect((await linked('alpha')).json().items).toMatchObject([{number:12,url:'https://github.com/example/replacement/pull/12'}]);
});
it('checks authoritative binding before reading cached links or repository metadata',async()=>{
 const{store,item,linked,binding,repo,list}=await fixture();store.internal('fixture.denied',null,()=>store.put('linkedPullRequest','project:12','gamma',{projectId:'project',threadId:'gamma',repo:'example/fixture',item:item(12)}));
 const response=await linked('gamma');expect(response.statusCode).toBe(403);expect(response.json().error.code).toBe('PROJECT_SCOPE');expect(binding).toHaveBeenCalledWith('project','gamma');expect(repo).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
});
it.each(['0','true','2'])('rejects unsupported linked query value %s without falling back to repository-wide data',async(value)=>{
 const{app,list,repo}=await fixture();const response=await app.inject('/api/projects/project/pull-requests?threadId=alpha&linked='+value);expect(response.statusCode).toBe(400);expect(list).not.toHaveBeenCalled();expect(repo).not.toHaveBeenCalled();
});

it('starts, polls and cancels profile sign-in without resolving a project or thread',async()=>{
 const{app,auth,binding}=await fixture();const start=await app.inject({method:'POST',url:'/api/github/auth/start',payload:{}});expect(start.statusCode).toBe(200);expect(start.headers['cache-control']).toBe('no-store');
 const flowId=start.json().id;for(const action of ['poll','cancel']){const response=await app.inject({method:'POST',url:'/api/github/auth/'+action,payload:{flowId}});expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');}
 expect(auth.start).toHaveBeenCalledTimes(1);expect(auth.poll).toHaveBeenCalledWith(flowId);expect(auth.cancel).toHaveBeenCalledWith(flowId);expect(binding).not.toHaveBeenCalled();
});
it('rejects project and thread fields on profile auth while keeping project actions gated',async()=>{
 const{app,auth,binding}=await fixture();for(const payload of [{projectId:'missing'},{threadId:'gamma'}])expect((await app.inject({method:'POST',url:'/api/github/auth/start',payload})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:'/api/github/auth/poll',payload:{flowId:'bad'}})).statusCode).toBe(400);expect(auth.start).not.toHaveBeenCalled();
 for(const type of ['github-login','github-login-status','create-pr','review-pr','link-pr'])expect((await app.inject({method:'POST',url:'/api/projects/missing/actions',payload:{id:'denied-'+type,type,payload:{}}})).statusCode).toBe(403);
 expect(binding).toHaveBeenCalled();expect(auth.start).not.toHaveBeenCalled();
});

it('keeps profile auth beneath real host, origin, session cookie and CSRF hooks',async()=>{
 const{service,auth}=await fixture(),app=await buildServer(service,{port:4317,dev:false});cleanup.push(()=>app.close());const url='/api/github/auth/start',send=(headers:Record<string,string>,payload={})=>app.inject({method:'POST',url,headers,payload});
 expect((await send({host:'evil.example'})).json().error.code).toBe('INVALID_HOST');expect((await send({host:'127.0.0.1:4317',origin:'https://evil.example'})).json().error.code).toBe('INVALID_ORIGIN');expect((await send({host:'127.0.0.1:4317'})).json().error.code).toBe('AUTH_REQUIRED');
 const bootstrap=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4317'}}),cookie=String(bootstrap.headers['set-cookie']).split(';')[0],headers={host:'127.0.0.1:4317',origin:'http://127.0.0.1:4317',cookie};
 expect((await send(headers)).json().error.code).toBe('CSRF_REQUIRED');expect(auth.start).not.toHaveBeenCalled();expect((await send({...headers,'x-harness-csrf':bootstrap.json().csrfToken})).statusCode).toBe(200);expect(auth.start).toHaveBeenCalledTimes(1);
});
