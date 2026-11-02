import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {buildServer} from '../apps/server/server.ts';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import type {HostCommand,RuntimeAdapter,StartRun,Thread} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const operation={action:'create',name:'verify-http-receipt',baseRevision:0,description:'Check exact release receipts.',content:'UNIQUE-SKILL-BODY: compare Δ source hashes before accepting the release.'};
async function fixture(){
 const temporaryRoot=await realpath(tmpdir()),directory=await mkdtemp(join(temporaryRoot,'harness-skills-http-')),starts:StartRun[]=[];
 const store=new Store(directory),runtime:RuntimeAdapter={configure:()=>{},models:async()=>[{id:'openai/http-fixture',provider:'openai',name:'Synthetic HTTP model'}],start:async input=>{starts.push(input);},followUp:async input=>{starts.push(input);},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime);await service.recover();const app=await buildServer(service,{port:4317,dev:false});
 cleanups.push(async()=>{try{await app.close();await service.dispose();}finally{store.close();if(await realpath(directory)!==resolve(directory)||!resolve(directory).startsWith(temporaryRoot+sep)||(await lstat(directory)).isSymbolicLink())throw Error('Unsafe skills HTTP fixture cleanup');await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:100});}});
 const host={host:'127.0.0.1:4317'},boot=await app.inject({url:'/api/bootstrap',headers:host}),headers={...host,cookie:String(boot.headers['set-cookie']).split(';')[0],'x-harness-csrf':boot.json().csrfToken as string};
 const command=(type:string,payload:Record<string,unknown>={},threadId?:string,id=crypto.randomUUID())=>app.inject({method:'POST',url:'/api/commands',headers,payload:{id,type,payload,...(threadId?{threadId}:{})} satisfies HostCommand});
 const start=async()=>{const created=await command('thread.create'),thread=created.json().result as Thread;expect((await command('message.send',{content:'Review this procedure.',modelId:'openai/http-fixture'},thread.id)).statusCode).toBe(200);await vi.waitFor(()=>expect(starts.at(-1)?.threadId).toBe(thread.id));return starts.at(-1)!;};
 return{app,store,service,host,headers,command,start,get:(url:string)=>app.inject({url,headers})};
}

it('authenticates private skill/proposal reads, validates selectors and excludes bodies from snapshots',async()=>{
 const x=await fixture();expect((await x.command('skill.manage',{operations:[operation]})).statusCode).toBe(200);
 for(const url of ['/api/skills/'+operation.name,'/api/skill-proposals/not-public'])expect((await x.app.inject({url,headers:x.host})).statusCode).toBe(401);
 const detail=await x.get('/api/skills/'+operation.name);expect(detail.statusCode).toBe(200);expect(detail.headers['cache-control']).toBe('no-store');expect(detail.headers['content-type']).toContain('application/json');expect(detail.json()).toMatchObject({skill:{name:operation.name,revision:1},content:operation.content,document:expect.stringContaining('name: "verify-http-receipt"')});
 for(const query of ['?revision=0','?revision=bad','?revision=1&revision=2','?path=..%2Fprivate','?path=C%3A%2Fprivate','?path=','?includeInactive=1','?unexpected=true'])expect((await x.get('/api/skills/'+operation.name+query)).statusCode,query).toBe(400);
 expect((await x.get('/api/skills/'+operation.name+'?revision=2')).statusCode).toBe(404);
 await x.command('settings.update',{preferences:{learningApproval:true}});const input=await x.start();const pending=await x.service.tool({name:'skill_manage',args:{operations:[{action:'patch',name:operation.name,baseRevision:1,content:'UNIQUE-PROPOSAL-BODY: pending user review only.'}]}},input) as {proposalId:string};
 const proposal=await x.get('/api/skill-proposals/'+pending.proposalId);expect(proposal.statusCode).toBe(200);expect(proposal.headers['cache-control']).toBe('no-store');expect(proposal.json()).toMatchObject({status:'pending',operations:[{content:'UNIQUE-PROPOSAL-BODY: pending user review only.'}]});
 const snapshot=(await x.get('/api/snapshot')).json();expect(snapshot.skills).toEqual([expect.objectContaining({name:operation.name,revision:1})]);expect(snapshot.skillProposals).toEqual([expect.objectContaining({id:pending.proposalId,status:'pending'})]);expect(JSON.stringify(snapshot.skills)).not.toContain('UNIQUE-SKILL-BODY');expect(JSON.stringify(snapshot.skillProposals)).not.toContain('UNIQUE-PROPOSAL-BODY');
 expect(x.store.snapshot().resources).toEqual([]);expect(x.store.snapshot().operations).toEqual([]);
});

it('keeps skill mutations behind CSRF, idempotent receipts and exact revision checks',async()=>{
 const x=await fixture(),id=crypto.randomUUID(),payload:HostCommand={id,type:'skill.manage',payload:{operations:[operation]}};
 expect((await x.app.inject({method:'POST',url:'/api/commands',headers:{host:x.headers.host,cookie:x.headers.cookie},payload})).statusCode).toBe(403);expect(x.store.snapshot().skills).toEqual([]);
 const first=await x.command(payload.type,payload.payload,undefined,id),repeated=await x.command(payload.type,payload.payload,undefined,id);expect(first.statusCode).toBe(200);expect(repeated.json()).toEqual(first.json());
 const changed=await x.command(payload.type,{operations:[{...operation,content:'Different body under the same request ID.'}]},undefined,id);expect(changed.statusCode).toBe(400);expect(changed.json().error.code).toBe('DUPLICATE_COMMAND');
 const stale=await x.command('skill.manage',{operations:[{action:'patch',name:operation.name,baseRevision:0,content:'Stale overwrite.'}]});expect(stale.statusCode).toBe(400);expect(stale.json().error.code).toBe('STALE_SKILL');
 expect((await x.command('skill.manage',{operations:[{action:'patch',name:operation.name,baseRevision:1,content:'Accepted replacement: retain exact source custody.'}]})).statusCode).toBe(200);
 expect((await x.get('/api/skills/'+operation.name+'?revision=1')).json().content).toBe(operation.content);expect((await x.get('/api/skills/'+operation.name)).json()).toMatchObject({skill:{revision:2},content:'Accepted replacement: retain exact source custody.'});
 expect((await x.command('skill.flags',{name:operation.name,baseRevision:2,enabled:false})).statusCode).toBe(200);expect((await x.get('/api/skills/'+operation.name)).json().error.code).toBe('SKILL_DISABLED');expect((await x.get('/api/skills/'+operation.name+'?includeInactive=true')).json().skill.enabled).toBe(false);
});

it('preserves a stale staged proposal for inspection and explicit rejection after concurrent user edits',async()=>{
 const x=await fixture();await x.command('skill.manage',{operations:[operation]});await x.command('settings.update',{preferences:{learningApproval:true}});const input=await x.start();
 const pending=await x.service.tool({name:'skill_manage',args:{operations:[{action:'patch',name:operation.name,baseRevision:1,content:'Pending model proposal.'}]}},input) as {proposalId:string};
 await x.command('skill.manage',{operations:[{action:'patch',name:operation.name,baseRevision:1,content:'Newer user-maintained procedure.'}]});const rejectedApproval=await x.command('skill.decide',{proposalId:pending.proposalId,approve:true});expect(rejectedApproval.statusCode).toBe(400);expect(rejectedApproval.json().error.code).toBe('STALE_SKILL');
 expect((await x.get('/api/skill-proposals/'+pending.proposalId)).json()).toMatchObject({status:'pending',operations:[{content:'Pending model proposal.'}]});expect((await x.get('/api/skills/'+operation.name)).json().content).toBe('Newer user-maintained procedure.');
 expect((await x.command('skill.decide',{proposalId:pending.proposalId,approve:false})).statusCode).toBe(200);expect((await x.get('/api/skill-proposals/'+pending.proposalId)).json().status).toBe('rejected');expect((await x.get('/api/snapshot')).json().skillProposals).toEqual([]);
});
