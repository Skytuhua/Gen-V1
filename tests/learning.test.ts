import {afterEach,expect,it,vi} from 'vitest';
import type {RunContext,RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{await Promise.allSettled(cleanups.splice(0).map(close=>close()));vi.useRealTimers();});
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
class ReviewRuntime implements RuntimeAdapter {
 callbacks!:RuntimeCallbacks;inputs:StartRun[]=[];cancels:RunContext[]=[];disposed=0;startGate?:Promise<void>;disposeGate?:Promise<void>;
 configure(callbacks:RuntimeCallbacks){this.callbacks=callbacks;}
 async models(){return [];}
 async start(input:StartRun){this.inputs.push(input);await this.startGate;}
 async followUp(){throw Error('Learning must not continue a main session.');}
 async history():Promise<string[]>{throw Error('Learning must not recover native history.');}
 async compact(){throw Error('Learning must not compact a main session.');}
 async cancel(context:RunContext){this.cancels.push(context);}
 async dispose(){this.disposed++;await this.disposeGate;}
 event(type:string,value:Record<string,unknown>={}){this.callbacks.onEvent({...this.inputs[0],type,...value});}
}
const job=()=>({source:{threadId:'source-thread',runId:'source-run',epoch:4},modelId:'openai/model',accountId:'account-a',prompt:'Quoted successful conversation and evidence.'});
async function setup(options:{runtime?:ReviewRuntime;factory?:()=>RuntimeAdapter|Promise<RuntimeAdapter>;tool?:(...args:any[])=>any;result?:(...args:any[])=>any}={}){
 const {LearningCoordinator}=await import('../packages/core/learning.ts');
 const runtime=options.runtime??new ReviewRuntime(),factory=vi.fn(options.factory??(()=>runtime)),tool=vi.fn(options.tool??(()=>({value:{skills:[]}}))),result=vi.fn(options.result??(()=>{}));
 const coordinator=new LearningCoordinator({factory,tool,result});cleanups.push(()=>coordinator.dispose());
 return {coordinator,runtime,factory,tool,result};
}

it('reserves a separate account-pinned learning session and publishes only after settlement cleanup',async()=>{
 const x=await setup(),source=job();expect(await x.coordinator.start(source)).toBe(true);
 const input=x.runtime.inputs[0];expect(input).toMatchObject({modelId:source.modelId,accountId:source.accountId,resources:[],sessionPath:null});
 expect(input.threadId).not.toBe(source.source.threadId);expect(input.runId).not.toBe(source.source.runId);expect(input.prompt).toContain(source.prompt);expect(input.prompt).toContain('quoted');
 expect(x.coordinator.busy).toBe(true);expect(x.result).not.toHaveBeenCalled();
 x.runtime.event('settled');await vi.waitFor(()=>expect(x.result).toHaveBeenCalledOnce());expect(x.runtime.disposed).toBe(1);expect(x.coordinator.busy).toBe(false);
 expect(x.result.mock.calls[0][1]).toMatchObject({status:'completed',toolCalls:0,appliedChanges:0});
});
it('does not create a runtime for disabled or oversized review input',async()=>{
 const x=await setup();expect(await x.coordinator.start({...job(),enabled:false})).toBe(false);
 await expect(x.coordinator.start({...job(),prompt:'x'.repeat(64*1024)})).rejects.toMatchObject({code:'LEARNING_INPUT_LIMIT'});expect(x.factory).not.toHaveBeenCalled();expect(x.coordinator.busy).toBe(false);
});
it('captures routing inputs before an asynchronous factory can observe caller changes',async()=>{
 const gate=deferred<RuntimeAdapter>(),runtime=new ReviewRuntime(),x=await setup({factory:()=>gate.promise}),source=job();
 const starting=x.coordinator.start(source);source.accountId='different';source.modelId='xai/other';source.source.epoch=99;gate.resolve(runtime);await starting;
 expect(runtime.inputs[0]).toMatchObject({accountId:'account-a',modelId:'openai/model'});runtime.event('settled');await x.coordinator.dispose();
});
it('keeps single-job ownership through cancelled asynchronous factory cleanup',async()=>{
 const gate=deferred<RuntimeAdapter>(),runtime=new ReviewRuntime(),x=await setup({factory:()=>gate.promise}),starting=x.coordinator.start(job());
 await Promise.resolve();expect(await x.coordinator.start(job())).toBe(false);
 let done=false;const cancel=x.coordinator.cancel().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);expect(x.coordinator.busy).toBe(true);expect(x.result).not.toHaveBeenCalled();
 gate.resolve(runtime);await Promise.all([starting,cancel]);expect(runtime.inputs).toHaveLength(0);expect(runtime.disposed).toBe(1);expect(x.coordinator.busy).toBe(false);expect(x.result.mock.calls[0][1].status).toBe('cancelled');
});
it('waits for normal disposal before reporting success or admitting another review',async()=>{
 const gate=deferred(),runtime=new ReviewRuntime();runtime.disposeGate=gate.promise;const x=await setup({runtime});await x.coordinator.start(job());runtime.event('settled');
 await vi.waitFor(()=>expect(runtime.disposed).toBe(1));expect(x.result).not.toHaveBeenCalled();expect(x.coordinator.busy).toBe(true);expect(await x.coordinator.start(job())).toBe(false);
 gate.resolve();await vi.waitFor(()=>expect(x.result).toHaveBeenCalledOnce());expect(x.coordinator.busy).toBe(false);
});
it('denies mutation and delegation tools before dispatch and does not leak raw runtime errors',async()=>{
 const x=await setup();await x.coordinator.start(job());
 await expect(x.runtime.callbacks.onTool({name:'operation_execute',args:{}},x.runtime.inputs[0])).rejects.toMatchObject({code:'LEARNING_TOOL_DENIED'});
 await vi.waitFor(()=>expect(x.result).toHaveBeenCalledOnce());expect(x.tool).not.toHaveBeenCalled();expect(x.runtime.cancels).toHaveLength(1);expect(x.result.mock.calls[0][1].status).toBe('failed');
 const y=await setup();await y.coordinator.start(job());y.runtime.event('error',{message:'PRIVATE native credential path'});await vi.waitFor(()=>expect(y.result).toHaveBeenCalledOnce());expect(JSON.stringify(y.result.mock.calls[0][1])).not.toContain('PRIVATE');
});
it('rejects a stale context without granting access to the current review',async()=>{
 const x=await setup();await x.coordinator.start(job());const input=x.runtime.inputs[0];
 await expect(x.runtime.callbacks.onTool({name:'skills_list',args:{}},{...input,epoch:input.epoch+1})).rejects.toMatchObject({code:'CANCELLED_RUN'});
 expect(x.tool).not.toHaveBeenCalled();expect(x.coordinator.busy).toBe(true);
});
it('allows sixteen bounded skill calls and stops before dispatching a seventeenth',async()=>{
 const x=await setup();await x.coordinator.start(job());const input=x.runtime.inputs[0];
 for(let i=0;i<16;i++)expect(await x.runtime.callbacks.onTool({name:'skills_list',args:{}},input)).toEqual({skills:[]});
 await expect(x.runtime.callbacks.onTool({name:'skills_list',args:{}},input)).rejects.toMatchObject({code:'LEARNING_LIMIT'});
 await vi.waitFor(()=>expect(x.result).toHaveBeenCalledOnce());expect(x.tool).toHaveBeenCalledTimes(16);expect(x.result.mock.calls[0][1]).toMatchObject({status:'limit',toolCalls:16});
});
it('bounds cumulative host tool text without passing an oversized response to the model',async()=>{
 const x=await setup({tool:()=>({value:{text:'x'.repeat(64*1024)}})});await x.coordinator.start(job());
 await expect(x.runtime.callbacks.onTool({name:'skill_view',args:{name:'example'}},x.runtime.inputs[0])).rejects.toMatchObject({code:'LEARNING_LIMIT'});
 await vi.waitFor(()=>expect(x.result).toHaveBeenCalledOnce());expect(x.result.mock.calls[0][1].status).toBe('limit');expect(x.result.mock.calls[0][1].inputBytes).toBeLessThanOrEqual(64*1024);
});
it('counts only trusted applied changes and reported usage without forwarding private runtime events',async()=>{
 const x=await setup({tool:()=>({value:{staged:true},appliedChanges:0})});await x.coordinator.start(job());const input=x.runtime.inputs[0];
 await x.runtime.callbacks.onTool({name:'skill_manage',args:{}},input);x.tool.mockImplementationOnce(()=>({value:{changes:['saved']},appliedChanges:1}));await x.runtime.callbacks.onTool({name:'skill_manage',args:{}},input);
 x.runtime.event('usage',{usage:{inputTokens:12,outputTokens:4,cost:null,contextTokens:-5,private:'not recorded'}});x.runtime.event('session',{sessionPath:'PRIVATE profile'});x.runtime.event('assistant.message',{content:'PRIVATE review prose'});x.runtime.event('settled');
 await vi.waitFor(()=>expect(x.result).toHaveBeenCalledOnce());expect(x.result.mock.calls[0][1]).toMatchObject({status:'completed',appliedChanges:1,usage:{inputTokens:12,outputTokens:4,cost:null}});expect(JSON.stringify(x.result.mock.calls[0][1])).not.toContain('PRIVATE');expect(x.result.mock.calls[0][1].usage).not.toHaveProperty('contextTokens');
});
it('cancels generation on its deadline and closes the owned adapter',async()=>{
 vi.useFakeTimers();const x=await setup();await x.coordinator.start(job());await vi.advanceTimersByTimeAsync(60_000);
 expect(x.runtime.cancels).toHaveLength(1);expect(x.runtime.disposed).toBe(1);expect(x.result.mock.calls[0][1].status).toBe('timeout');expect(x.coordinator.busy).toBe(false);
});
it('revokes pending tool work before cancellation and waits before reporting its result',async()=>{
 const gate=deferred();let writes=0;const x=await setup({tool:async(_call,review)=>{await gate.promise;x.coordinator.assertCurrent(review);writes++;return {value:{},appliedChanges:1};}});await x.coordinator.start(job());
 const tool=x.runtime.callbacks.onTool({name:'skill_manage',args:{}},x.runtime.inputs[0]);const rejected=expect(tool).rejects.toMatchObject({code:'CANCELLED_RUN'});
 let closed=false;const closing=x.coordinator.cancel().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);expect(x.result).not.toHaveBeenCalled();
 gate.resolve();await Promise.all([rejected,closing]);expect(writes).toBe(0);expect(x.result.mock.calls[0][1]).toMatchObject({status:'cancelled',appliedChanges:0});
});
it('guards result observer failures and rejects late work without reviving a newer review',async()=>{
 const first=new ReviewRuntime(),second=new ReviewRuntime();let next=0;const x=await setup({factory:()=>next++?second:first,result:()=>{throw Error('Observer failed');}});await x.coordinator.start(job());const old=first.inputs[0];first.event('settled');await vi.waitFor(()=>expect(x.coordinator.busy).toBe(false));
 expect(await x.coordinator.start(job())).toBe(true);first.event('settled');await expect(first.callbacks.onTool({name:'skill_manage',args:{}},old)).rejects.toMatchObject({code:'CANCELLED_RUN'});expect(x.coordinator.busy).toBe(true);second.event('settled');await vi.waitFor(()=>expect(x.coordinator.busy).toBe(false));
});
it('does not declare the owner idle when runtime disposal fails',async()=>{
 const runtime=new ReviewRuntime();runtime.dispose=async()=>{throw Error('PRIVATE cleanup failure');};const x=await setup({runtime});await x.coordinator.start(job());runtime.event('settled');
 await vi.waitFor(()=>expect(x.result).toHaveBeenCalledOnce());expect(x.coordinator.busy).toBe(true);expect(await x.coordinator.start(job())).toBe(false);expect(x.result.mock.calls[0][1].status).toBe('failed');expect(JSON.stringify(x.result.mock.calls[0][1])).not.toContain('PRIVATE');await expect(x.coordinator.dispose()).rejects.toThrow('Learning runtime cleanup did not finish');
});
it('still disposes the adapter when cancellation throws before returning a promise',async()=>{
 const runtime=new ReviewRuntime();runtime.cancel=()=>{throw Error('PRIVATE cancellation failure');};const x=await setup({runtime});await x.coordinator.start(job());await x.coordinator.cancel();
 expect(runtime.disposed).toBe(1);expect(x.coordinator.busy).toBe(false);expect(x.result.mock.calls[0][1].status).toBe('cancelled');
});
it('counts its own completion acknowledgement in the host-text budget',async()=>{
 const first=await setup();await first.coordinator.start({...job(),prompt:''});const prefixBytes=Buffer.byteLength(first.runtime.inputs[0].prompt);await first.coordinator.cancel();
 const x=await setup();await x.coordinator.start({...job(),prompt:'x'.repeat(64*1024-prefixBytes)});
 await expect(x.runtime.callbacks.onTool({name:'task_finish',args:{}},x.runtime.inputs[0])).rejects.toMatchObject({code:'LEARNING_LIMIT'});
 await vi.waitFor(()=>expect(x.result).toHaveBeenCalledOnce());expect(x.result.mock.calls[0][1].status).toBe('limit');
});
it('waits for in-flight startup even after adapter disposal returns',async()=>{
 const gate=deferred(),runtime=new ReviewRuntime();runtime.startGate=gate.promise;const x=await setup({runtime});const starting=x.coordinator.start(job());
 await vi.waitFor(()=>expect(runtime.inputs).toHaveLength(1));let done=false;const closing=x.coordinator.dispose().then(()=>{done=true;});
 try{await vi.waitFor(()=>expect(runtime.disposed).toBe(1));expect(done).toBe(false);expect(x.result).not.toHaveBeenCalled();}finally{gate.resolve();await Promise.all([starting,closing]);}
 expect(x.result.mock.calls[0][1].status).toBe('cancelled');expect(x.coordinator.busy).toBe(false);
});
it('waits for an asynchronous result notification when the host closes',async()=>{
 const gate=deferred(),x=await setup({result:()=>gate.promise});await x.coordinator.start(job());x.runtime.event('settled');
 await vi.waitFor(()=>expect(x.result).toHaveBeenCalledOnce());let done=false;const closing=x.coordinator.dispose().then(()=>{done=true;});
 try{await new Promise<void>(done=>setImmediate(done));expect(done).toBe(false);}finally{gate.resolve();await closing;}
 expect(x.coordinator.busy).toBe(false);
});
