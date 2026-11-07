import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service,type ServiceOptions} from '../packages/core/service.ts';
import type {Operation,RuntimeAdapter,RuntimeCallbacks,StartRun,Thread} from '../packages/contracts';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
function adapter(){
 let callbacks!:RuntimeCallbacks;const starts:StartRun[]=[];
 const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[{id:'openai/test',provider:'openai',name:'Synthetic model'}],start:async input=>{starts.push(input);},followUp:async input=>{starts.push(input);},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 return{runtime,starts,get callbacks(){return callbacks;}};
}
function setup(options:ServiceOptions={}){
 const dir=mkdtempSync(join(tmpdir(),'gen-update-idle-')),store=new Store(dir),primary=adapter(),service=new Service(store,primary.runtime,options);
 cleanup.push(async()=>{try{await service.dispose();}finally{store.close();rmSync(dir,{recursive:true,force:true});}});
 const command=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:crypto.randomUUID(),type,payload,threadId});
 const start=async(threadId?:string)=>{threadId??=((await command('thread.create')).result as Thread).id;await command('message.send',{content:'Check the authored fixture.',modelId:'openai/test'},threadId);await vi.waitFor(()=>expect(primary.starts.at(-1)?.threadId).toBe(threadId));return primary.starts.at(-1)!;};
 const answer=(run:StartRun)=>{const replyId=crypto.randomUUID();primary.callbacks.onEvent({...run,type:'input.processing',inputIds:run.inputIds});primary.callbacks.onEvent({...run,type:'assistant.message',messageId:replyId,content:'Checked.',inputIds:run.inputIds});return{threadId:run.threadId,replyId,modelId:run.modelId};};
 const settle=(run:StartRun)=>{const input=answer(run);primary.callbacks.onEvent({...run,type:'settled'});return input;};
 const drain=async(threadId:string)=>{await service.deliverOutbox(threadId);await turn();};
 return{service,store,primary,command,start,answer,settle,drain};
}
it('completed task returns to update idle after settlement and delivery drain',async()=>{
 const x=setup();expect(x.service.isUpdateIdle()).toBe(true);const run=await x.start();expect(x.service.isUpdateIdle()).toBe(false);
 x.answer(run);await x.service.tool({name:'task_finish',args:{summary:'Checked.'}},run);
 x.primary.callbacks.onEvent({...run,type:'settled'});await x.drain(run.threadId);
 expect(x.store.get<Thread>('thread',run.threadId)?.status).toBe('completed');
 expect(x.store.all('outbox',run.threadId)).toEqual([expect.objectContaining({status:'handled'})]);
 expect(x.service.isUpdateIdle()).toBe(true);
});
it('a second run returns to idle and ignores stale first-run settlement',async()=>{
 const x=setup(),first=await x.start();x.settle(first);await x.drain(first.threadId);
 const second=await x.start(first.threadId);expect(second.runId).not.toBe(first.runId);
 x.primary.callbacks.onEvent({...first,type:'settled'});expect(x.service.isUpdateIdle()).toBe(false);
 expect(x.store.get<Thread>('thread',first.threadId)?.runId).toBe(second.runId);
 x.settle(second);await x.drain(second.threadId);expect(x.service.isUpdateIdle()).toBe(true);
});
it('settlement waits for the runtime start call to drain',async()=>{
 const x=setup(),gate=deferred(),start=x.primary.runtime.start;
 x.primary.runtime.start=async input=>{await start(input);await gate.promise;};
 try{const run=await x.start();x.settle(run);await turn();expect(x.service.isUpdateIdle()).toBe(false);gate.resolve();await x.drain(run.threadId);expect(x.service.isUpdateIdle()).toBe(true);}finally{gate.resolve();}
});
it('completed operation-only dispatch releases its cancellation owner',async()=>{
 const x=setup(),thread=(await x.command('thread.create')).result as Thread;
 // Replaying a durable success must not repeat its effect or leave a live owner.
 const operation:Operation={id:'recorded-success',threadId:thread.id,revision:1,kind:'fixture.check',description:'Authored receipt',args:{},resourceIds:[],preconditions:{},status:'succeeded',approved:true,createdAt:new Date().toISOString(),result:{verified:true}};
 x.store.internal('fixture.receipt',thread.id,()=>x.store.put('operation',operation.id,thread.id,operation));
 const work=x.service.dispatchOperation(operation.id);expect(x.service.isUpdateIdle()).toBe(false);
 expect(await work).toMatchObject({id:operation.id,status:'succeeded'});expect(x.service.isUpdateIdle()).toBe(true);
});
it('held native cancellation stays non-idle until confirmed after foreground settlement',async()=>{
 const x=setup(),gate=deferred(),entered=deferred(),starting=deferred(),start=x.primary.runtime.start;
 x.primary.runtime.start=async input=>{await start(input);await starting.promise;};
 x.primary.runtime.cancel=async()=>{entered.resolve();await gate.promise;};
 const run=await x.start();x.settle(run);
 const stopping=x.command('run.stop',{},run.threadId);
 try{await entered.promise;starting.resolve();await x.drain(run.threadId);x.primary.callbacks.onEvent({...run,type:'settled'});expect(x.service.isUpdateIdle()).toBe(false);gate.resolve();await stopping;await turn();expect(x.service.isUpdateIdle()).toBe(true);}finally{starting.resolve();gate.resolve();await stopping;}
});
it('rejected native cancellation retains its readiness hold after stale settlement',async()=>{
 const x=setup(),starting=deferred(),start=x.primary.runtime.start;
 x.primary.runtime.start=async input=>{await start(input);await starting.promise;};
 const run=await x.start();x.settle(run);
 x.primary.runtime.cancel=async()=>{throw Error('Native close unconfirmed');};
 try{await expect(x.command('run.stop',{},run.threadId)).rejects.toThrow('Native close unconfirmed');starting.resolve();await x.drain(run.threadId);
 x.primary.callbacks.onEvent({...run,type:'settled'});await turn();expect(x.service.isUpdateIdle()).toBe(false);}finally{starting.resolve();}
});
it('unacknowledged durable input remains non-idle after runtime settlement',async()=>{
 const x=setup(),run=await x.start();x.primary.callbacks.onEvent({...run,type:'settled'});await x.drain(run.threadId);
 expect(x.store.all('outbox',run.threadId)).toEqual([expect.objectContaining({status:'processing'})]);expect(x.service.isUpdateIdle()).toBe(false);
});
it.each(['sourceBusy','reviewBusy'] as const)('%s remains a readiness hold after foreground settlement',async field=>{
 const runtime={sourceBusy:false,reviewBusy:false,cancelBackground:async()=>{},sourceRequest:async()=>{throw Error('Unused source request');}};
 const x=setup({source:{runtime,library:{initialize:async()=>({migrated:0}),command:async()=>{throw Error('Unused library command');},view:async()=>{throw Error('Unused library view');},proposal:async()=>{throw Error('Unused library proposal');},refresh:async()=>{}}}}),run=await x.start();
 runtime[field]=true;x.settle(run);await x.drain(run.threadId);expect(x.service.isUpdateIdle()).toBe(false);
 runtime[field]=false;expect(x.service.isUpdateIdle()).toBe(true);
});
it('prediction cleanup remains a readiness hold after foreground settlement',async()=>{
 const prediction=adapter(),gate=deferred();prediction.runtime.dispose=()=>gate.promise;
 const x=setup({predictionRuntimeFactory:()=>prediction.runtime});await x.command('settings.update',{preferences:{composerPredictions:true,learningEnabled:false}});
 const run=await x.start(),input=x.settle(run);await x.drain(run.threadId);const result=x.service.composerPrediction(input);
 try{await vi.waitFor(()=>expect(prediction.starts).toHaveLength(1));expect(x.service.isUpdateIdle()).toBe(false);prediction.callbacks.onEvent({...prediction.starts[0],type:'settled'});await turn();expect(x.service.isUpdateIdle()).toBe(false);gate.resolve();await result;await vi.waitFor(()=>expect(x.service.isUpdateIdle()).toBe(true));}finally{gate.resolve();await result;}
});
it('blocks updates for unresolved native operations and durable input',()=>{
 const {service,store}=setup();expect(service.isUpdateIdle()).toBe(true);
 store.internal('fixture',null,()=>store.put('operation','operation',null,{id:'operation',status:'unknown'}));expect(service.isUpdateIdle()).toBe(false);
 store.internal('fixture',null,()=>{store.put('operation','operation',null,{id:'operation',status:'succeeded'});store.put('outbox','input',null,{id:'input',status:'persisted'});});expect(service.isUpdateIdle()).toBe(false);
});
it('closes admission before reporting update readiness',async()=>{
 const {service}=setup();expect(service.freezeForUpdate()).toBe(true);
 await expect(service.command({id:'late-create',type:'thread.create',payload:{}})).rejects.toThrow(/closing/i);
});
