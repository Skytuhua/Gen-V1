import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,realpathSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {AttentionRepository} from '../packages/core/attention.ts';
import type {InputRequest,Operation,RunContext,RuntimeAdapter,RuntimeCallbacks,RuntimeEvent,StartRun,Thread} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function setup(startFails=false){
 const base=realpathSync(tmpdir()),directory=mkdtempSync(join(base,'gen-attention-lifecycle-')),store=new Store(directory);
 let callbacks!:RuntimeCallbacks,input:StartRun|undefined,maintenance:RunContext|undefined,closed=false;
 const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[{id:'test/model',provider:'test',name:'Synthetic model'}],start:async value=>{input=value;if(startFails)throw Error('Synthetic start failure');},followUp:async value=>{input=value;},cancel:async()=>{},compact:async value=>{maintenance=value;},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime),attention=new AttentionRepository(store);
 attention.read();const unwatch=attention.watch();
 const close=async()=>{if(closed)return;unwatch();await service.dispose();store.close();closed=true;};
 cleanups.push(async()=>{await close();if(dirname(directory)!==base||realpathSync(directory)!==resolve(directory)||lstatSync(directory).isSymbolicLink())throw Error('Unsafe fixture cleanup');rmSync(directory,{recursive:true,force:true});});
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:crypto.randomUUID(),type,payload,threadId});
 const thread=(await send('thread.create')).result as Thread;
 await send('message.send',{content:'Synthetic attention task',modelId:'test/model'},thread.id);
 await vi.waitFor(()=>expect(input).toBeDefined());
 const ctx=():RunContext=>({threadId:thread.id,runId:input!.runId,epoch:input!.epoch});
 return {store,service,attention,send,directory,close,unwatch,id:thread.id,ctx,maintenance:()=>maintenance!,event:(value:Partial<RuntimeEvent>,owner=ctx())=>callbacks.onEvent({...owner,type:'error',message:'Synthetic provider failure',...value})};
}
const failures=(attention:AttentionRepository)=>attention.read().items.filter(item=>item.kind==='thread-failed');

it('publishes a genuine runtime failure with its exact committed run identity',async()=>{
 const x=await setup(),owner=x.ctx();x.event({});
 expect(x.store.get<Thread>('thread',x.id)).toMatchObject({status:'interrupted',runId:null});
 expect(failures(x.attention)).toMatchObject([{id:`thread:${x.id}:${owner.runId}:failed`,state:'failed',read:false,actionable:false,destination:{threadId:x.id}}]);
 expect(x.store.eventsAfter(0).find(event=>event.type==='run.failed')).toMatchObject({threadId:x.id,payload:{result:{runId:owner.runId}}});
 expect(x.store.get('runFailure',owner.runId)).toEqual({...owner,projectId:null,occurredAt:x.store.get<Thread>('thread',x.id)!.updatedAt});
 expect(x.attention.claimDelivery().items).toHaveLength(1);
 expect(x.attention.claimDelivery().items).toEqual([]);
});

it('publishes a rejected runtime start through the same canonical failure path',async()=>{
 const x=await setup(true);
 await vi.waitFor(()=>expect(failures(x.attention)).toHaveLength(1));
 expect(failures(x.attention)[0]!.id).toBe(`thread:${x.id}:${x.ctx().runId}:failed`);
 expect(x.attention.claimDelivery().items).toHaveLength(1);
});

it('preserves read, dismissal and claimed delivery when the same failure is reread or reopened',async()=>{
 const x=await setup();x.event({});const first=x.attention.claimDelivery().items[0];expect(first).toBeDefined();
 x.attention.command({id:'read-failure',eventId:first!.id,type:'read'});
 x.attention.command({id:'dismiss-failure',eventId:first!.id,type:'dismiss-popup'});
 await x.send('thread.rename',{title:'Renamed failed task'},x.id);x.event({message:'Late repeated error'});
 const reopened=new AttentionRepository(x.store);
 expect(failures(reopened)).toMatchObject([{id:first!.id,createdAt:first!.createdAt,read:true,popupDismissed:true}]);
 expect(reopened.claimDelivery().items).toEqual([]);
});

it('retains failure history during a resumed run and delivers a distinct new failure once',async()=>{
 const x=await setup(),firstOwner=x.ctx();x.event({});const first=x.attention.claimDelivery().items[0];expect(first).toBeDefined();
 await x.send('run.stop',{},x.id);await x.send('run.resume',{},x.id);
 await vi.waitFor(()=>expect(x.ctx().runId).not.toBe(firstOwner.runId));
 expect(failures(x.attention).map(item=>item.id)).toEqual([first!.id]);expect(x.attention.claimDelivery().items).toEqual([]);
 x.event({message:'Second genuine failure'});
 expect(new Set(failures(x.attention).map(item=>item.id)).size).toBe(2);
 expect(x.attention.claimDelivery().items.map(item=>item.id)).toEqual([`thread:${x.id}:${x.ctx().runId}:failed`]);
});

it('does not turn Stop or a stale post-Stop error into failed attention',async()=>{
 const x=await setup(),old=x.ctx();await x.send('run.stop',{},x.id);x.event({},old);
 expect(x.store.get<Thread>('thread',x.id)).toMatchObject({status:'stopped'});
 expect(x.store.eventsAfter(0).filter(event=>event.type==='run.failed')).toEqual([]);
 expect(failures(x.attention)).toEqual([]);expect(x.attention.claimDelivery().items).toEqual([]);
});

for(const transition of ['unresolved settlement','runtime abort','restart recovery'] as const)it(`does not infer failed attention from ${transition}`,async()=>{
 const x=await setup();
 if(transition==='restart recovery')await x.service.recover();else x.event({type:'settled',aborted:transition==='runtime abort'});
 expect(x.store.get<Thread>('thread',x.id)?.status).toBe(transition==='runtime abort'?'stopped':'interrupted');
 expect(failures(x.attention)).toEqual([]);expect(x.attention.claimDelivery().items).toEqual([]);
});

it('does not notify a failed maintenance compaction as a failed agent task',async()=>{
 const x=await setup();x.event({type:'session',sessionPath:'synthetic-session'});await x.send('run.stop',{},x.id);
 await x.send('run.compact',{},x.id);x.event({},x.maintenance());
 expect(x.store.eventsAfter(0).filter(event=>event.type==='run.failed')).toHaveLength(1);
 expect(failures(x.attention)).toEqual([]);expect(x.attention.claimDelivery().items).toEqual([]);
});

it('rejects an old run error after a different run has been admitted',async()=>{
 const x=await setup(),old=x.ctx();await x.send('run.stop',{},x.id);await x.send('run.resume',{},x.id);
 await vi.waitFor(()=>expect(x.ctx().runId).not.toBe(old.runId));x.event({},old);
 expect(x.store.get<Thread>('thread',x.id)?.runId).toBe(x.ctx().runId);
 expect(failures(x.attention)).toEqual([]);expect(x.attention.claimDelivery().items).toEqual([]);
});

it('never approves or resolves existing work by recording, reading or dismissing a failed run',async()=>{
 const x=await setup();
 const question:InputRequest={id:'pending-question',threadId:x.id,artifactId:null,revision:1,title:'Review destination',prompt:'Which destination?',responseSchema:{type:'string'},basis:[],status:'pending'};
 const operation:Operation={id:'pending-operation',threadId:x.id,revision:1,kind:'write',description:'Synthetic pending write',args:{},resourceIds:[],preconditions:{},status:'prepared',approved:false,createdAt:new Date().toISOString()};
 x.store.internal('fixture.pending',x.id,()=>{x.store.put('request',question.id,x.id,question);x.store.put('operation',operation.id,x.id,operation);});
 x.event({});const item=failures(x.attention)[0];expect(item).toBeDefined();
 x.attention.command({id:'read-with-pending',eventId:item!.id,type:'read'});x.attention.command({id:'dismiss-with-pending',eventId:item!.id,type:'dismiss-popup'});
 expect(x.store.get('request',question.id)).toEqual(question);expect(x.store.get('operation',operation.id)).toEqual(operation);
});

it('recovers a missed failure after the actual Store closes and reopens, then never replays its delivery',async()=>{
 const x=await setup(),owner=x.ctx();x.unwatch();x.event({});
 expect(x.store.eventsAfter(0).filter(event=>event.type==='run.failed')).toHaveLength(1);
 expect(x.store.all('attentionItem')).toEqual([]);await x.close();
 const reopened=new Store(x.directory);
 try{
  const attention=new AttentionRepository(reopened);expect(failures(attention).map(item=>item.id)).toEqual([`thread:${x.id}:${owner.runId}:failed`]);
  expect(attention.claimDelivery().items).toHaveLength(1);
 }finally{reopened.close();}
 const again=new Store(x.directory);
 try{expect(new AttentionRepository(again).claimDelivery().items).toEqual([]);}finally{again.close();}
});

it('recovers from a throwing projection observer without losing the committed failure',async()=>{
 const x=await setup(),internal=x.store.internal.bind(x.store);
 const blocked=vi.spyOn(x.store,'internal').mockImplementation((type,threadId,apply)=>{if(type==='attention.projected')throw Error('Synthetic projection failure');return internal(type,threadId,apply);});
 try{x.event({});expect(x.store.all('attentionItem')).toEqual([]);}finally{blocked.mockRestore();}
 expect(failures(new AttentionRepository(x.store))).toHaveLength(1);
});

it('recovers the original run and epoch even when a new run starts before its first projection',async()=>{
 const x=await setup(),old=x.ctx();x.unwatch();x.event({});await x.send('run.stop',{},x.id);await x.send('run.resume',{},x.id);
 await vi.waitFor(()=>expect(x.ctx().runId).not.toBe(old.runId));
 expect(x.attention.claimDelivery().items.map(item=>item.id)).toEqual([`thread:${x.id}:${old.runId}:failed`]);
 expect(x.store.all<{epoch:number}>('attentionItem')[0]!.epoch).toBe(old.epoch);
 x.event({message:'New run also failed'});
 expect(x.attention.claimDelivery().items.map(item=>item.id)).toEqual([`thread:${x.id}:${x.ctx().runId}:failed`]);
 expect(failures(x.attention)).toHaveLength(2);
});

for(const changed of ['project','archive'] as const)it(`does not retarget a missed failure after its owning ${changed} changes`,async()=>{
 const x=await setup();x.unwatch();
 const original=x.store.get<Thread>('thread',x.id)!;
 x.store.internal('fixture.project',x.id,()=>x.store.put('thread',x.id,x.id,{...original,projectId:'original-project'}));x.event({});
 x.store.internal('fixture.owner-change',x.id,()=>changed==='project'?x.store.put('thread',x.id,x.id,{...x.store.get<Thread>('thread',x.id)!,projectId:'different-project'}):x.store.put('archivedThread',x.id,null,true));
 expect(failures(new AttentionRepository(x.store))).toEqual([]);expect(x.attention.claimDelivery().items).toEqual([]);
});

it('keeps a missed old failure as history without making its popup fresh at recovery time',async()=>{
 const x=await setup();x.unwatch();x.event({});
 const delayed=new AttentionRepository(x.store,()=>new Date(Date.now()+6*60_000));
 expect(failures(delayed)).toHaveLength(1);expect(delayed.claimDelivery().items).toEqual([]);
});

it('seeds historical failures without popup delivery on first attention initialization',async()=>{
 const x=await setup();x.unwatch();x.event({});
 x.store.internal('fixture.first-attention',null,()=>x.store.remove('attentionMeta','initialized'));
 const initial=new AttentionRepository(x.store);expect(failures(initial)).toHaveLength(1);expect(initial.claimDelivery().items).toEqual([]);
});
