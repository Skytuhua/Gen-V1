import {afterEach,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {ProjectTools} from '../packages/workspace/tools.ts';
import {GitHubTools} from '../packages/workspace/github.ts';
import type {TerminalHost} from '../packages/workspace/terminal.ts';
import {WorkspaceActionOutcomes} from '../packages/workspace/action-outcomes.ts';
import type {WorkspaceActionEnvelope,WorkspaceActionOperation} from '../packages/contracts/workspace-action-outcomes.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'gen-action-outcome-')),path=join(root,'repo'),data=join(root,'data');await mkdir(path);
 const git=(...args:string[])=>execFileSync('git',['-C',path,...args],{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');await writeFile(join(path,'one.txt'),'first\n');git('add','.');git('commit','-m','Initial');git('remote','add','origin','https://github.com/example/fixture.git');
 let store=new Store(data),projects=new ProjectTools(store,{git:process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git'});
 const connected=await projects.connect({id:randomUUID(),type:'workspace.project.connect',payload:{name:'Fixture',path}}),projectId=(connected.result as {projects:{id:string}[]}).projects[0]!.id;
 const thread={id:'main',title:'Main',projectId,projectName:'Fixture',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready' as const,epoch:0,runId:null,modelId:null,sessionPath:null,kind:'main' as const};
 store.internal('fixture',null,()=>store.put('thread',thread.id,thread.id,thread));await projects.prepareWorkspace(thread);
 const binding=await projects.binding(projectId,thread.id);await mkdir(join(data,'github'),{recursive:true});await writeFile(join(data,'github','credentials.json'),JSON.stringify({version:1,token:'synthetic-profile-token',login:'fixture'}));
 let github=new GitHubTools(projects,{} as TerminalHost),outcomes=new WorkspaceActionOutcomes(projects,github);
 cleanup.push(async()=>{await projects.dispose();store.close();if(!root.startsWith(join(tmpdir(),'gen-action-outcome-')))throw Error('Unexpected fixture path');await rm(root,{recursive:true,force:true,maxRetries:5});});
 return{root,path,data,projectId,thread,binding,get store(){return store;},get projects(){return projects;},get github(){return github;},get outcomes(){return outcomes;},
  async restart(){await projects.dispose();store.close();store=new Store(data);projects=new ProjectTools(store,{git:process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git'});github=new GitHubTools(projects,{} as TerminalHost);outcomes=new WorkspaceActionOutcomes(projects,github);},
  async operation(type:WorkspaceActionEnvelope['type']='stage'){
   const status=await projects.gitStatus(projectId,thread.id),comparison=await projects.gitComparison(projectId,thread.id,{scope:type==='commit'?'staged':'worktree'});
   if(comparison.state!=='ready'&&comparison.state!=='empty')throw Error('Fixture comparison failed');
   const payload=type==='review-pr'?{number:12,event:'COMMENT' as const,body:'private review text',head:status.head,revision:status.revision}:type==='commit'?{message:'private commit message',expectedHead:status.head,revision:status.revision}:{paths:['one.txt'],expectedHead:status.head,revision:status.revision};
   const operation:WorkspaceActionOperation={operationId:randomUUID(),operation:type,selection:{owner:{authority:{kind:'local'},projectId,threadId:thread.id},target:type==='review-pr'?{kind:'pull-request',repo:'example/fixture',number:12}:{kind:'local',scope:type==='commit'?'staged':'worktree'}},comparison:type==='review-pr'?{kind:'pull-request',id:'e'.repeat(64),repo:'example/fixture',number:12,pullRequestId:'PR_fixture',baseOid:status.head,headOid:status.head,mergeBaseOid:status.head,baseRef:'main',headRef:status.branch,semantics:'merge-base'}:comparison.value.identity,action:{head:status.head,revision:status.revision,branch:status.branch},payload};
   const input:WorkspaceActionEnvelope={id:operation.operationId,type,payload,threadId:thread.id};
   return{operation,input,status};
  },
 };
}

// Only the external CLI edge is simulated; tool validation and private input handling stay real.
function remote(f:Awaited<ReturnType<typeof fixture>>,post:(body:unknown)=>Promise<unknown>){
 const run=vi.fn(async(_path:string,args:string[])=>{
  if(args.includes('POST'))return JSON.stringify(await post(JSON.parse(await readFile(args[args.indexOf('--input')+1]!, 'utf8'))));
  if(args[0]==='pr'&&args[1]==='view'){const status=await f.projects.gitStatus(f.projectId,f.thread.id);return JSON.stringify({number:12,headRefOid:status.head,headRefName:status.branch});}
  throw Error('Unexpected external CLI call');
 });
 (f.github as unknown as {run:typeof run}).run=run;return run;
}


import Fastify from 'fastify';
import {registerWorkspaceRoutes} from '../apps/server/workspace-routes.ts';
import {registerWorkspaceHost} from '../apps/server/workspace-host.ts';
import type {Service} from '../packages/core/service.ts';
it('routes supported writes through durable identity and keeps inspection read-only',async()=>{
 const f=await fixture(),{input,operation}=await f.operation('review-pr'),app=Fastify(),service={store:f.store} as Service;let writes=0;
 remote(f,async()=>{writes++;return{id:77,body:'private remote response'};});
 registerWorkspaceHost(service,{projects:f.projects,github:f.github,terminals:{dispose:async()=>{}} as TerminalHost});
 registerWorkspaceRoutes(app,service);cleanup.push(()=>app.close());
 const url='/api/projects/'+f.projectId+'/actions';
 const first=await app.inject({method:'POST',url,payload:input});expect(first.statusCode).toBe(200);expect(first.headers['cache-control']).toBe('no-store');
 expect(first.json()).toMatchObject({commandId:input.id,result:{state:'confirmed',operation:'review-pr'}});
 const duplicate=await app.inject({method:'POST',url,payload:input});expect(duplicate.json()).toEqual(first.json());expect(writes).toBe(1);
 const seq=f.store.sequence,inspect=await app.inject({method:'POST',url:'/api/projects/'+f.projectId+'/action-outcomes/inspect',payload:operation});
 expect(inspect.statusCode).toBe(200);expect(inspect.headers['cache-control']).toBe('no-store');expect(inspect.json()).toEqual({state:'confirmed'});expect(f.store.sequence).toBe(seq);expect(writes).toBe(1);
 const changed=await app.inject({method:'POST',url,payload:{...input,payload:{...input.payload,body:'changed'}}});expect(changed.statusCode).toBeGreaterThanOrEqual(400);expect(writes).toBe(1);
 expect(JSON.stringify([first.json(),inspect.json()])).not.toContain('private');
},60000);


it.each(['head','worktree'])('an exact local stale-%s preflight is not-applied before entering a mutation',async(change)=>{
 const f=await fixture(),{input,operation}=await f.operation();
 await writeFile(join(f.binding.path,'one.txt'),'advance the managed head\n');
 if(change==='head'){
  let status=await f.projects.gitStatus(f.projectId,f.thread.id);
  await f.projects.gitAction(f.projectId,f.thread.id,{type:'stage',revision:status.revision,paths:['one.txt']});
  status=await f.projects.gitStatus(f.projectId,f.thread.id);
  await f.projects.gitAction(f.projectId,f.thread.id,{type:'commit',revision:status.revision,message:'Advance before stale request'});
 }
 const mutation=vi.spyOn(f.projects,'gitAction');
 expect(await f.outcomes.execute(f.projectId,input)).toEqual({state:'not-applied'});
 expect(mutation).not.toHaveBeenCalled();expect(await f.outcomes.inspect(operation)).toEqual({state:'not-applied'});
},60000);

it('valid Unicode review text fits submission and exact read-only inspection',async()=>{
 const f=await fixture(),{input,operation}=await f.operation('review-pr'),app=Fastify(),service={store:f.store} as Service;
 const body='\u754c'.repeat(45000);expect(Buffer.byteLength(body)).toBe(135000);input.payload={...input.payload,body};operation.payload={...operation.payload,body} as WorkspaceActionOperation['payload'];let writes=0;
 remote(f,async()=>{writes++;return{id:77};});registerWorkspaceHost(service,{projects:f.projects,github:f.github,terminals:{dispose:async()=>{}} as TerminalHost});registerWorkspaceRoutes(app,service);cleanup.push(()=>app.close());
 const response=await app.inject({method:'POST',url:'/api/projects/'+f.projectId+'/actions',payload:input});expect(response.statusCode).toBe(200);
 const inspect=await app.inject({method:'POST',url:'/api/projects/'+f.projectId+'/action-outcomes/inspect',payload:operation});expect(inspect.statusCode).toBe(200);expect(inspect.json()).toEqual({state:'confirmed'});expect(writes).toBe(1);
},60000);

it('returns an unsuccessful response for an unconfirmed action so existing controls retain their draft',async()=>{
 const f=await fixture(),{input}=await f.operation(),app=Fastify(),service={store:f.store} as Service;
 await writeFile(join(f.binding.path,'one.txt'),'changed after the reviewed revision\n');
 registerWorkspaceHost(service,{projects:f.projects,github:f.github,terminals:{dispose:async()=>{}} as TerminalHost});registerWorkspaceRoutes(app,service);cleanup.push(()=>app.close());
 const mutation=vi.spyOn(f.projects,'gitAction'),response=await app.inject({method:'POST',url:'/api/projects/'+f.projectId+'/actions',payload:input});
 expect(response.statusCode).toBe(409);expect(response.json()).toMatchObject({state:'not-applied',error:{code:'REVISION_CHANGED'}});expect(mutation).not.toHaveBeenCalled();
},60000);
