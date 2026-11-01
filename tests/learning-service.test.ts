import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun,Thread} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const operation={action:'create',name:'verify-release',description:'Verify a local release using its actual receipts.',content:'Inspect the current build receipt. Run the focused checks and preserve any unverified gates.',baseRevision:0};
function adapter(){let callbacks!:RuntimeCallbacks;const starts:StartRun[]=[];const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[{id:'openai/learning-test',provider:'openai',name:'Synthetic learning model'}],start:async value=>{starts.push(value);},followUp:async value=>{starts.push(value);},cancel:vi.fn(async()=>{}),compact:async()=>{},history:async()=>[],dispose:vi.fn(async()=>{})};return{runtime,starts,get callbacks(){return callbacks;}};}
async function fixture(){
 const directory=await mkdtemp(join(await realpath(tmpdir()),'harness-learning-service-')),primary=adapter(),reviews:ReturnType<typeof adapter>[]=[];
 let store=new Store(directory),service!:Service,expectedCleanupFailure=false;
 const open=async()=>{service=new Service(store,primary.runtime,{learningRuntimeFactory:()=>{const next=adapter();reviews.push(next);return next.runtime;}});await service.recover();};
 await open();cleanups.push(async()=>{try{await service.dispose();}catch(error){if(!expectedCleanupFailure)throw error;}finally{store.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}});
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:crypto.randomUUID(),type,payload,threadId});
 const start=async(mode:'plan'|'build'='build')=>{const thread=(await send('thread.create',{})).result as Thread;if(mode==='plan')await send('thread.mode',{mode},thread.id);await send('message.send',{content:'Verify the release. Use evidence rather than assumptions.',modelId:'openai/learning-test'},thread.id);await vi.waitFor(()=>expect(primary.starts.at(-1)?.threadId).toBe(thread.id));return primary.starts.at(-1)!;};
 const settle=(run:StartRun,content='The source checks passed; native inference remains unverified.')=>{primary.callbacks.onEvent({...run,type:'input.processing',inputIds:run.inputIds});primary.callbacks.onEvent({...run,type:'assistant.message',messageId:crypto.randomUUID(),content,inputIds:run.inputIds});primary.callbacks.onEvent({...run,type:'settled'});};
 return{send,start,settle,reviews,primary,expectCleanupFailure:()=>{expectedCleanupFailure=true;},get service(){return service;},get store(){return store;},reopen:async()=>{await service.dispose();store.close();store=new Store(directory);await open();}};
}

it('exposes a versioned library globally without putting full skill bodies in snapshots',async()=>{
 const x=await fixture();expect((await x.send('skill.manage',{operations:[operation]})).result).toMatchObject({status:'applied'});
 const snapshot=x.store.snapshot() as unknown as {skills:{name:string;revision:number}[]};expect(snapshot.skills).toEqual([expect.objectContaining({name:'verify-release',revision:1})]);expect(JSON.stringify(snapshot.skills)).not.toContain(operation.content);
});
it('learns through real Service tools, reopens storage and reuses the new revision in another thread',async()=>{
 const x=await fixture(),first=await x.start();await x.service.tool({name:'skill_manage',args:{operations:[operation]}},first);
 expect(await x.service.tool({name:'skills_list',args:{}},first)).toMatchObject({skills:[expect.objectContaining({name:'verify-release',revision:1})]});
 const beforeView=x.store.sequence,loaded=await x.service.tool({name:'skill_view',args:{name:operation.name}},first) as {content:string};expect(loaded.content).toBe(operation.content);expect(JSON.stringify(x.store.eventsAfter(beforeView))).not.toContain(operation.content);
 await x.service.tool({name:'skill_manage',args:{operations:[{action:'patch',name:operation.name,baseRevision:1,oldText:'focused checks',newText:'focused checks before packaging'}]}},first);x.settle(first);await x.reopen();
 const next=await x.start();expect(next.prompt).toContain('verify-release');expect(next.prompt).not.toContain(operation.content);
 expect(await x.service.tool({name:'skill_view',args:{name:operation.name}},next)).toMatchObject({skill:{revision:2},content:expect.stringContaining('before packaging')});
 expect(x.store.snapshot().resources).toEqual([]);expect(x.store.snapshot().operations).toEqual([]);
});
it('rejects late skill writes after task settlement and keeps Plan mode read only',async()=>{
 const x=await fixture(),run=await x.start();x.settle(run);await expect(x.service.tool({name:'skill_manage',args:{operations:[operation]}},run)).rejects.toMatchObject({code:'CANCELLED_RUN'});
 const plan=await x.start('plan');await expect(x.service.tool({name:'skill_manage',args:{operations:[operation]}},plan)).rejects.toMatchObject({code:'PLAN_MODE_READ_ONLY'});
});
it('stages all automatic writes when approval is enabled and activates only the approved batch',async()=>{
 const x=await fixture();await x.send('settings.update',{preferences:{learningApproval:true}});const run=await x.start();
 const proposal=await x.service.tool({name:'skill_manage',args:{operations:[operation]}},run) as {status:string;proposalId:string};expect(proposal.status).toBe('pending');
 expect((x.store.snapshot() as unknown as {skills:unknown[]}).skills).toEqual([]);
 await x.send('skill.decide',{proposalId:proposal.proposalId,approve:true});expect((x.store.snapshot() as unknown as {skills:unknown[]}).skills).toHaveLength(1);
});
it('runs a separate review after ten foreground tool calls and requires review-local reads for updates',async()=>{
 const x=await fixture(),run=await x.start();await x.send('skill.manage',{operations:[operation]});
 for(let i=0;i<10;i++)await x.service.tool({name:'ui_discover',args:{}},run);x.settle(run);
 await vi.waitFor(()=>expect(x.reviews[0]?.starts).toHaveLength(1));const reviewer=x.reviews[0],review=reviewer.starts[0];
 expect(review).toMatchObject({modelId:run.modelId,accountId:run.accountId,sessionPath:null,resources:[]});expect(review.threadId).not.toBe(run.threadId);
 expect(await reviewer.callbacks.onTool({name:'skill_manage',args:{operations:[{action:'patch',name:operation.name,baseRevision:1,content:'A stronger verified procedure.'}]}},review)).toMatchObject({error:{code:'SKILL_READ_REQUIRED'}});
 await reviewer.callbacks.onTool({name:'skill_view',args:{name:operation.name}},review);
 await reviewer.callbacks.onTool({name:'skill_manage',args:{operations:[{action:'patch',name:operation.name,baseRevision:1,content:'A stronger verified procedure.'}]}},review);
 reviewer.callbacks.onEvent({...review,type:'settled'});await vi.waitFor(()=>expect(reviewer.runtime.dispose).toHaveBeenCalled());
 expect((x.store.snapshot() as unknown as {learning:{lastReview:{appliedChanges:number}}}).learning.lastReview.appliedChanges).toBe(1);expect(x.reviews).toHaveLength(1);
});
it('does not start paid review work on recovery or when learning is disabled',async()=>{
 const x=await fixture();await x.send('settings.update',{preferences:{learningEnabled:false}});const run=await x.start();for(let i=0;i<12;i++)await x.service.tool({name:'ui_discover',args:{}},run);x.settle(run);await x.reopen();expect(x.reviews).toEqual([]);
});
it('counts a retried review write once while returning the original command receipt',async()=>{
 const x=await fixture(),run=await x.start();for(let i=0;i<10;i++)await x.service.tool({name:'ui_discover',args:{}},run);x.settle(run);await vi.waitFor(()=>expect(x.reviews[0]?.starts).toHaveLength(1));
 const reviewer=x.reviews[0],review=reviewer.starts[0],call={name:'skill_manage',args:{commandId:'learning-retry',operations:[operation]}};
 const first=await reviewer.callbacks.onTool(call,review);expect(await reviewer.callbacks.onTool(call,review)).toEqual(first);
 reviewer.callbacks.onEvent({...review,type:'settled'});await vi.waitFor(()=>expect(x.store.snapshot().learning?.lastReview?.status).toBe('completed'));
 expect(x.store.snapshot().skills?.[0].revision).toBe(1);expect(x.store.snapshot().learning?.lastReview?.appliedChanges).toBe(1);
});
it('cancels review before new foreground work and denies old review callbacks',async()=>{
 const x=await fixture(),run=await x.start();for(let i=0;i<10;i++)await x.service.tool({name:'ui_discover',args:{}},run);x.settle(run);await vi.waitFor(()=>expect(x.reviews[0]?.starts).toHaveLength(1));
 const reviewer=x.reviews[0],old=reviewer.starts[0];await x.send('message.send',{content:'Continue the actual task now.',modelId:run.modelId},run.threadId);
 expect(reviewer.runtime.cancel).toHaveBeenCalledWith(expect.objectContaining({threadId:old.threadId,runId:old.runId}));await expect(reviewer.callbacks.onTool({name:'skill_manage',args:{operations:[operation]}},old)).rejects.toMatchObject({code:'CANCELLED_RUN'});
});
it('ends a review that requests a forbidden tool without changing task grants or skill state',async()=>{
 const x=await fixture(),run=await x.start();for(let i=0;i<10;i++)await x.service.tool({name:'ui_discover',args:{}},run);x.settle(run);await vi.waitFor(()=>expect(x.reviews[0]?.starts).toHaveLength(1));const reviewer=x.reviews[0],review=reviewer.starts[0];
 await expect(reviewer.callbacks.onTool({name:'resource.grant',args:{}},review)).rejects.toMatchObject({code:'LEARNING_TOOL_DENIED'});await vi.waitFor(()=>expect(reviewer.runtime.dispose).toHaveBeenCalled());expect(x.store.snapshot().resources).toEqual([]);expect(x.store.snapshot().skills).toEqual([]);
});
it('captures the intended account before awaiting learning cleanup and rejects a changed default',async()=>{
 const x=await fixture(),a=(await x.send('account.create',{providerId:'openai',label:'Intended account'})).result as {id:string},b=(await x.send('account.create',{providerId:'openai',label:'Later account'})).result as {id:string};await x.send('account.select',{providerId:'openai',accountId:a.id});
 const run=await x.start();for(let i=0;i<10;i++)await x.service.tool({name:'ui_discover',args:{}},run);x.settle(run);await vi.waitFor(()=>expect(x.reviews[0]?.starts).toHaveLength(1));
 const next=(await x.send('thread.create',{})).result as Thread;let release!:()=>void;vi.mocked(x.reviews[0].runtime.dispose).mockImplementationOnce(()=>new Promise<void>(done=>{release=done;}));
 const pending=x.send('message.send',{content:'Start the next task.',modelId:run.modelId},next.id).then(value=>value,error=>error);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 x.store.internal('fixture.changed-default',null,()=>{const settings=x.store.snapshot().settings;x.store.put('settings','global',null,{...settings,selectedAccounts:{...settings.selectedAccounts,openai:b.id}});});release();
 expect(await pending).toMatchObject({code:'ACCOUNT_SELECTION_CHANGED'});expect(x.store.all('message',next.id)).toEqual([]);
});
it.each(['message.send','run.resume'])('preempts a review started during %s preparation before admitting foreground work',async(type)=>{
 const x=await fixture(),source=await x.start(),next=(await x.send('thread.create',{})).result as Thread;
 if(type==='run.resume')x.store.internal('fixture.interrupted',next.id,()=>{x.store.put('thread',next.id,next.id,{...next,status:'interrupted',modelId:source.modelId,sessionPath:'synthetic-history'});});
 let release!:()=>void;
 if(type==='message.send')vi.spyOn(x.primary.runtime,'models').mockImplementationOnce(()=>new Promise(done=>{release=()=>done([{id:source.modelId,provider:'openai',name:'Synthetic learning model'}]);}));
 else vi.spyOn(x.primary.runtime,'history').mockImplementationOnce(()=>new Promise(done=>{release=()=>done([]);}));
 for(let i=0;i<10;i++)await x.service.tool({name:'ui_discover',args:{}},source);x.settle(source);
 const preparing=x.send(type,{modelId:source.modelId,...(type==='message.send'?{content:'Start the next task.'}:{})},next.id);
 await vi.waitFor(()=>{expect(release).toBeTypeOf('function');expect(x.reviews[0]?.starts).toHaveLength(1);});const reviewer=x.reviews[0];expect(x.primary.starts.at(-1)?.threadId).toBe(source.threadId);
 release();await preparing;expect(reviewer.runtime.cancel).toHaveBeenCalled();expect(reviewer.runtime.dispose).toHaveBeenCalled();await vi.waitFor(()=>expect(x.primary.starts.at(-1)?.threadId).toBe(next.id));
});
it('bounds session recall and returns source identities without granting files or replaying actions',async()=>{
 const x=await fixture(),first=await x.start();x.settle(first,'The release receipt must be checked before packaging.');const second=await x.start();
 const recall=await x.service.tool({name:'session_search',args:{query:'receipt',limit:2}},second) as {matches:{threadId:string;messageId:string;content:string}[]};expect(recall.matches).toHaveLength(1);expect(recall.matches[0]).toMatchObject({threadId:first.threadId,messageId:expect.any(String)});expect(recall.matches[0].content).toContain('receipt');expect(x.store.snapshot().resources).toEqual([]);
});
it('waits for review teardown even when another runtime rejects workspace disposal',async()=>{
 const x=await fixture(),run=await x.start();for(let i=0;i<10;i++)await x.service.tool({name:'ui_discover',args:{}},run);x.settle(run);await vi.waitFor(()=>expect(x.reviews[0]?.starts).toHaveLength(1));
 const reviewer=x.reviews[0];let release!:()=>void;vi.mocked(reviewer.runtime.dispose).mockImplementationOnce(()=>new Promise<void>(done=>{release=done;}));vi.mocked(x.primary.runtime.dispose).mockRejectedValueOnce(new Error('Synthetic primary cleanup failure'));
 let finished=false;const closing=x.service.dispose().catch(()=>{}).then(()=>{finished=true;});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));try{expect(finished).toBe(false);}finally{release();await closing;}expect(finished).toBe(true);
});
it('curates managed skills weekly after idle time without starting inference',async()=>{
 vi.useFakeTimers();let x:Awaited<ReturnType<typeof fixture>>|undefined;
 try{
  x=await fixture();const run=await x.start();await x.service.tool({name:'skill_manage',args:{operations:[operation]}},run);x.settle(run);const start=Date.now();
  vi.setSystemTime(start+15*24*60*60*1000);await vi.advanceTimersByTimeAsync(60_000);expect(x.store.snapshot().skills?.[0].state).toBe('stale');
  vi.setSystemTime(start+31*24*60*60*1000);await vi.advanceTimersByTimeAsync(60_000);expect(x.store.snapshot().skills?.[0].state).toBe('archived');expect(x.reviews).toEqual([]);
 }finally{await x?.service.dispose();vi.useRealTimers();}
});
it('reports blocked ownership when review cleanup cannot be confirmed',async()=>{
 const x=await fixture(),run=await x.start();for(let i=0;i<10;i++)await x.service.tool({name:'ui_discover',args:{}},run);x.settle(run);await vi.waitFor(()=>expect(x.reviews[0]?.starts).toHaveLength(1));const reviewer=x.reviews[0];x.expectCleanupFailure();vi.mocked(reviewer.runtime.dispose).mockRejectedValueOnce(new Error('Synthetic unconfirmed cleanup'));
 reviewer.callbacks.onEvent({...reviewer.starts[0],type:'settled'});await vi.waitFor(()=>expect(x.store.snapshot().learning?.lastReview?.status).toBe('failed'));
 expect(x.service.learning.busy).toBe(true);expect(x.store.snapshot().learning).toMatchObject({status:'blocked',lastReview:{cleanupConfirmed:false}});
 await expect(x.send('message.send',{content:'Continue',modelId:run.modelId},run.threadId)).rejects.toMatchObject({code:'LEARNING_CLEANUP_FAILED'});
});
