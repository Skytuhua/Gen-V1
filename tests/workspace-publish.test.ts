import Fastify from 'fastify';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ZodError} from 'zod';
import {Store} from '../packages/storage/store.ts';
import {HarnessError, type Thread} from '../packages/contracts/index.ts';
import type {Service} from '../packages/core/service.ts';
import type {GitStatus, ProjectTools} from '../packages/workspace/tools.ts';
import type {TerminalHost} from '../packages/workspace/terminal.ts';
import type {GitHubTools} from '../packages/workspace/github.ts';
import type {WorkspaceActionOutcomes} from '../packages/workspace/action-outcomes.ts';
import {PublishService} from '../packages/workspace/publish.ts';
import {publishDraftV1Schema,publishOperationV1Schema,publishRequestV1Schema} from '../packages/contracts/workspace-publish.ts';
import {planDataId} from '../packages/contracts/planning.ts';
import {registerWorkspaceHost} from '../apps/server/workspace-host.ts';
import {registerWorkspaceRoutes} from '../apps/server/workspace-routes.ts';
import {buildServer} from '../apps/server/server.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const head='a'.repeat(40),revision='c'.repeat(64),next='b'.repeat(40),nextRevision='d'.repeat(64);
const file=(path:string,extra:Partial<GitStatus['files'][number]>={})=>({path,index:' ',worktree:'M',staged:false,untracked:false,binary:false,added:10,removed:2,...extra});
const status=(overrides:Partial<GitStatus>={}):GitStatus=>({head,branch:'gen/review',revision,files:[file('src/app.ts'),file('notes.txt',{index:'?',untracked:true,added:null,removed:null})],diff:'',stagedDiff:'',truncated:false,mode:'managed',gitWrite:true,untrackedIncluded:true,...overrides});
const validRequest={id:'publish-1',threadId:'thread',head,revision,selectedPaths:['src/app.ts','notes.txt'],commitMessage:'Publish reviewed changes',title:'Publish reviewed changes',body:'Reviewed body',base:'main'};
const confirmedReceipt=(commandId:string,result:unknown={})=>({state:'confirmed' as const,receipt:{commandId,eventSeq:1,result}});
const createdPull={url:'https://github.com/example/fixture/pull/12',head:next,revision:nextRevision,repo:'example/fixture'};

function thread(title='Publish reviewed changes'):Thread{return{id:'thread',kind:'main',projectId:'project',title,projectName:'Fixture',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',status:'ready',epoch:0,runId:null,modelId:null,sessionPath:null};}

async function serviceFixture(options:{enabled?:boolean;status?:GitStatus[]|GitStatus}={}){
 const root=await mkdtemp(join(tmpdir(),'gen-publish-')),store=new Store(join(root,'data'));
 cleanup.push(async()=>{store.close();if(!root.startsWith(join(tmpdir(),'gen-publish-')))throw Error('Unexpected fixture cleanup path');await rm(root,{recursive:true,force:true,maxRetries:5});});
 store.internal('test.seed',null,()=>store.put('thread','thread','thread',thread()));
 const statuses=Array.isArray(options.status)?options.status:options.status?[options.status]:[status()];let index=0;
 const gitStatus=vi.fn(async()=>statuses[Math.min(index++,statuses.length-1)]!),projects={store,binding:vi.fn(async()=>({path:root})),gitStatus} as unknown as ProjectTools;
 const details=vi.fn(async()=>({repo:'example/fixture',item:{number:12,title:'Publish reviewed changes',url:createdPull.url,state:'OPEN'},head:next,revision:nextRevision,canReview:true}));
 const github={defaultBranch:vi.fn(async()=>({base:'main',note:undefined})),details} as unknown as GitHubTools;
 const outcomes={execute:vi.fn(async()=>confirmedReceipt('outcome'))} as unknown as WorkspaceActionOutcomes;
 const enabled=options.enabled??true,publish=new PublishService(projects,github,outcomes,()=>enabled);
 return{store,projects,github,outcomes,publish,gitStatus,details};
}

// T03 contract shapes
it('accepts valid draft, request and operation values',()=>{
 const draft=publishDraftV1Schema.parse({version:1,projectId:'project',threadId:'thread',branch:'gen/review',head,revision,base:'main',files:[{path:'src/app.ts',added:10,removed:2,untracked:false},{path:'notes.txt',added:null,removed:null,untracked:true}],commitMessage:'Publish change',title:'Publish change',body:'Body'});
 expect(draft.files).toHaveLength(2);
 const request=publishRequestV1Schema.parse(validRequest);expect(request.selectedPaths).toEqual(['src/app.ts','notes.txt']);
 const operation=publishOperationV1Schema.parse({id:'publish-1',owner:{projectId:'project',threadId:'thread'},createdAt:'2026-01-01T00:00:00.000Z',request:validRequest,steps:{commit:{state:'confirmed'},push:{state:'confirmed'},pr:{state:'confirmed'},link:{state:'not-started'}},result:{url:createdPull.url,number:12,head:next,repo:'example/fixture'}});
 expect(operation.steps.pr.state).toBe('confirmed');
});
it.each([
 ['commitMessage NUL',{commitMessage:'has\0nul'}],
 ['commitMessage lone surrogate',{commitMessage:'lone\ud800surrogate'}],
 ['title over limit',{title:'x'.repeat(201)}],
 ['body over limit',{body:'x'.repeat(64001)}],
 ['commit message over limit',{commitMessage:'x'.repeat(4001)}],
 ['blank title',{title:'   '}],
])('rejects %s',(_name,change)=>{
 expect(()=>publishRequestV1Schema.parse({...validRequest,...change})).toThrow();
});
it.each([
 ['request id',{id:'bad id!'}],
 ['head',{head:'z'.repeat(40)}],
 ['revision',{revision:'g'.repeat(64)}],
 ['base',{base:'-leading-dash'}],
 ['threadId',{threadId:''}],
])('rejects an invalid %s',(_name,change)=>{
 expect(()=>publishRequestV1Schema.parse({...validRequest,...change})).toThrow();
});

// T04 draft
it('refuses drafts while workspace.publishV1 is off',async()=>{
 const{publish,projects}=await serviceFixture({enabled:false});
 await expect(publish.draft('project','thread')).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 expect(projects.gitStatus).not.toHaveBeenCalled();
});
it.each([{gitWrite:false},{mode:'legacy' as const,gitWrite:false}] as const)('refuses drafts on a read-only working copy',async(access)=>{
 const{publish}=await serviceFixture({status:status({files:[],...access})});
 await expect(publish.draft('project','thread')).rejects.toMatchObject({code:'PROJECT_READ_ONLY'});
});
it('builds a deterministic draft from status, thread title and plan items',async()=>{
 const{publish,store}=await serviceFixture();
 store.internal('test.plan',null,()=>store.put('data',planDataId('thread'),'thread',{id:planDataId('thread'),threadId:'thread',revision:1,provenance:'plan',createdAt:'2026-01-01T00:00:00.000Z',value:{version:1,title:'Plan',agents:[],steps:[{id:'s1',title:'Implement publish',status:'completed',requirements:[]}]}}));
 const draft=await publish.draft('project','thread');
 expect(draft).toMatchObject({version:1,projectId:'project',threadId:'thread',branch:'gen/review',head,revision,base:'main',commitMessage:'Publish reviewed changes',title:'Publish reviewed changes'});
 expect(draft.files.map(item=>item.path)).toEqual(['src/app.ts','notes.txt']);
 expect(draft.body).toContain('Created from Gen V1 thread Publish reviewed changes');
 expect(draft.body).toContain('`src/app.ts` (+10/-2)');
 expect(draft.body).toContain('completed: Implement publish');
});
it('truncates the subject at 72 characters and surfaces the fallback base note',async()=>{
 const{publish,store,github}=await serviceFixture();
 store.internal('test.title',null,()=>store.put('thread','thread','thread',thread('A very long thread title that keeps going well beyond the seventy two character subject limit')));
 vi.mocked(github.defaultBranch).mockResolvedValueOnce({base:'main',note:'The GitHub default branch could not be read, so the draft uses main as the base.'});
 const result=await publish.draft('project','thread');
 expect(result.commitMessage.length).toBeLessThanOrEqual(72);
 expect(result.title).toBe(result.commitMessage);
 expect(result.base).toBe('main');
 expect(result.baseNote).toContain('could not be read');
});

// T05 execute
async function runFixture(kind:'clean'|'dirty'='dirty'){
 const statuses=kind==='clean'
  ?[status({files:[]}),status({files:[],head:next,revision:nextRevision})]
  :[status(),status({files:[file('src/app.ts',{index:'M',worktree:' ',staged:true}),file('notes.txt',{index:'A',worktree:' ',staged:true})]}),status({files:[],head:next,revision:nextRevision})];
 const fixture=await serviceFixture({status:statuses});
 const execute=vi.mocked(fixture.outcomes.execute);
 execute.mockImplementation(async(_project:string,input:unknown)=>{
  const id=(input as {id:string}).id;
  return confirmedReceipt(id,id.endsWith(':pr')?createdPull:{});
 });
 return fixture;
}
it('commits, pushes and links a confirmed draft pull request',async()=>{
 const{publish,outcomes,store}=await runFixture();
 const operation=await publish.execute('project',validRequest);
 expect(publishOperationV1Schema.parse(operation).steps).toMatchObject({commit:{state:'confirmed'},push:{state:'confirmed'},pr:{state:'confirmed'},link:{state:'confirmed'}});
 expect(operation.result).toMatchObject({url:createdPull.url,number:12,head:next,repo:'example/fixture'});
 expect(vi.mocked(outcomes.execute).mock.calls.map(([,input])=>(input as {id:string}).id)).toEqual(['publish-1:stage','publish-1:commit','publish-1:pr']);
 expect(store.get('linkedPullRequest',JSON.stringify(['project','thread','example/fixture',12]))).toMatchObject({threadId:'thread',repo:'example/fixture'});
 expect(await publish.read('project','thread')).toMatchObject({id:'publish-1'});
});
it('skips the commit step on a clean tree and never retries an uncertain outcome',async()=>{
 const{publish,outcomes}=await runFixture('clean');
 const execute=vi.mocked(outcomes.execute);
 execute.mockImplementation(async()=>({state:'uncertain' as const}));
 const operation=await publish.execute('project',validRequest);
 expect(operation.steps).toMatchObject({commit:{state:'not-applied'},push:{state:'uncertain'},pr:{state:'uncertain'},link:{state:'not-started'}});
 const calls=execute.mock.calls.length;
 expect(await publish.execute('project',validRequest)).toMatchObject({id:'publish-1',steps:{push:{state:'uncertain'}}});
 expect(execute.mock.calls.length).toBe(calls);
});
it('rejects a changed revision before any write step or operation record',async()=>{
 const{publish,outcomes,store}=await serviceFixture({status:status({revision:'e'.repeat(64)})});
 await expect(publish.execute('project',validRequest)).rejects.toMatchObject({code:'REVISION_CHANGED'});
 expect(outcomes.execute).not.toHaveBeenCalled();expect(store.all('workspacePublish')).toHaveLength(0);
});
it('rejects duplicate request IDs carrying different content',async()=>{
 const{publish}=await runFixture();
 await publish.execute('project',validRequest);
 await expect(publish.execute('project',{...validRequest,title:'Other title'})).rejects.toMatchObject({code:'DUPLICATE_COMMAND'});
});
it('refuses execute while the flag is off and on a read-only working copy',async()=>{
 const{publish}=await serviceFixture({enabled:false});
 await expect(publish.execute('project',validRequest)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 const writable=await serviceFixture({status:status({gitWrite:false})});
 await expect(writable.publish.execute('project',validRequest)).rejects.toMatchObject({code:'PROJECT_READ_ONLY'});
});
it('records a failed link step without hiding the confirmed pull request',async()=>{
 const{publish,details}=await runFixture();
 details.mockRejectedValueOnce(new HarnessError('GITHUB_CLI_FAILED','fixture'));
 const operation=await publish.execute('project',validRequest);
 expect(operation.steps).toMatchObject({push:{state:'confirmed'},pr:{state:'confirmed'},link:{state:'uncertain'}});
 expect(operation.result?.url).toBe(createdPull.url);
});

// T05 route plumbing
async function routeFixture(){
 const root=await mkdtemp(join(tmpdir(),'gen-publish-route-')),store=new Store(join(root,'data')),service={store} as Service,app=Fastify();
 cleanup.push(async()=>{await app.close();store.close();if(!root.startsWith(join(tmpdir(),'gen-publish-route-')))throw Error('Unexpected fixture cleanup path');await rm(root,{recursive:true,force:true,maxRetries:5});});
 const projects={store,binding:vi.fn(async()=>({path:root})),gitStatus:vi.fn(async()=>status()),workspace:{migrateProjects:vi.fn()},dispose:async()=>{}} as unknown as ProjectTools;
 const github={auth:{start:vi.fn(),poll:vi.fn(),cancel:vi.fn()},details:vi.fn(),list:vi.fn(),repo:vi.fn(async()=>({path:root,repo:'example/fixture'})),comparison:vi.fn(),comparisonFile:vi.fn(),defaultBranch:vi.fn(async()=>({base:'main',note:undefined}))} as unknown as GitHubTools;
 registerWorkspaceHost(service,{projects,terminals:{dispose:async()=>{}} as TerminalHost,github});
 app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof ZodError?400:error instanceof HarnessError?403:500).send({error:{code:error instanceof HarnessError?error.code:'INVALID_INPUT'}}));
 registerWorkspaceRoutes(app,service);
 return{app,store,service};
}
it('returns CAPABILITY_DENIED on all publish routes while the flag is off',async()=>{
 const{app}=await routeFixture();
 for(const response of [
  await app.inject('/api/projects/project/publish/draft?threadId=thread'),
  await app.inject({method:'POST',url:'/api/projects/project/publish',payload:validRequest}),
  await app.inject('/api/projects/project/publish?threadId=thread'),
 ]){expect(response.statusCode).toBe(403);expect(response.json().error.code).toBe('CAPABILITY_DENIED');expect(response.headers['cache-control']).toBe('no-store');}
});
it('keeps publish routes beneath the real host, origin, cookie and CSRF hooks',async()=>{
 const{service}=await routeFixture(),app=await buildServer(service,{port:4481,dev:false});cleanup.push(()=>app.close());
 const url='/api/projects/project/publish';
 expect((await app.inject({method:'POST',url,headers:{host:'evil.example'},payload:validRequest})).json().error.code).toBe('INVALID_HOST');
 expect((await app.inject({method:'POST',url,headers:{host:'127.0.0.1:4481',origin:'https://foreign.invalid'},payload:validRequest})).json().error.code).toBe('INVALID_ORIGIN');
 expect((await app.inject({method:'POST',url,headers:{host:'127.0.0.1:4481'},payload:validRequest})).json().error.code).toBe('AUTH_REQUIRED');
 const boot=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4481'}}),cookie=String(boot.headers['set-cookie']).split(';')[0],headers={host:'127.0.0.1:4481',origin:'http://127.0.0.1:4481',cookie};
 expect((await app.inject({method:'POST',url,headers,payload:validRequest})).json().error.code).toBe('CSRF_REQUIRED');
 expect((await app.inject({method:'POST',url,headers:{...headers,'x-harness-csrf':boot.json().csrfToken},payload:validRequest})).json().error.code).toBe('CAPABILITY_DENIED');
});
