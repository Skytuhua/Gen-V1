import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,realpathSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {PLAN_RUNTIME_GUIDANCE} from '../packages/core/planning-tools.ts';
import type {Thread,RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
const closes:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of closes.splice(0))await close();});
async function setup(){
 const base=realpathSync(tmpdir()),dir=mkdtempSync(join(base,'plan-lifecycle-')),store=new Store(dir);let callbacks!:RuntimeCallbacks,input!:StartRun;
 const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[{id:'test/model',provider:'test',name:'Test'}],start:async value=>{input=value;},followUp:async value=>{input=value;},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime);closes.push(async()=>{await service.dispose();store.close();if(realpathSync(dir)!==resolve(dir)||!dir.startsWith(base+sep)||lstatSync(dir).isSymbolicLink())throw Error('Unsafe fixture cleanup');rmSync(dir,{recursive:true,force:true});});
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:crypto.randomUUID(),type,payload,threadId});
 const thread=(await send('thread.create')).result as Thread;await send('message.send',{content:'Inspect actual source',modelId:'test/model'},thread.id);
 const ctx=()=>({threadId:thread.id,runId:input.runId,epoch:input.epoch});
 await service.tool({name:'plan_update',args:{title:'Task',steps:[{id:'read',title:'Read',status:'working',requirements:[]}]}},ctx());
 return {store,service,send,id:thread.id,ctx,prompt:()=>input.prompt,event:(extra:Record<string,unknown>)=>callbacks.onEvent({...ctx(),type:'settled',...extra})};
}
it('commits stopped timeline state atomically with the actual run.stop receipt',async()=>{
 const x=await setup();let observed:unknown;
 x.store.subscribe(event=>{if(event.type==='run.stop')observed=x.service.planning.inspect(x.id)!.value.steps[0].state;});
 await x.send('run.stop',{},x.id);expect(observed).toBe('cancelled');
});
it('records actual settled-but-unhandled work as interrupted rather than leaving a running plan',async()=>{
 const x=await setup();x.event({aborted:false});expect(x.service.planning.inspect(x.id)!.value.steps[0].state).toBe('interrupted');
});
it('records failure before cancellation teardown and keeps the failure outcome',async()=>{
 const x=await setup();x.event({type:'error',message:'Synthetic provider failure'});await Promise.resolve();
 expect(x.service.planning.inspect(x.id)!.value.steps[0].state).toBe('failed');expect(x.service.planning.inspect(x.id)!.value.runState).toBe('failed');
});
it('records explicit runtime abort as cancelled even without delegated jobs',async()=>{
 const x=await setup();x.event({aborted:true});expect(x.service.planning.inspect(x.id)!.value.steps[0].state).toBe('cancelled');
});
it('passes truthful plan guidance and the current revision to a new runtime run',async()=>{
 const x=await setup();await x.send('run.stop',{},x.id);await x.send('run.resume',{},x.id);
 const plan=x.service.planning.inspect(x.id)!;
 expect(plan.value.run).toEqual({runId:x.ctx().runId,epoch:x.ctx().epoch});
 expect(x.prompt()).toContain(PLAN_RUNTIME_GUIDANCE);
 expect(x.prompt()).toContain('Current plan revision: '+plan.revision+'\n');
});
