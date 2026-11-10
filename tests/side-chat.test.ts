import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import type {RunContext,RuntimeAdapter,RuntimeCallbacks,StartRun,Thread} from '../packages/contracts/index.ts';
import {createRuntime} from '../packages/runtime/index.ts';
import {accountResolver,beginAccountLogin} from '../packages/core/accounts.ts';

class ScriptedRuntime implements RuntimeAdapter {
 callbacks!:RuntimeCallbacks;starts:StartRun[]=[];cancels:RunContext[]=[];disposed=0;failure?:Error;
 startGate?:Promise<void>;
 configure(callbacks:RuntimeCallbacks){this.callbacks=callbacks;}
 async models(){return [{id:'fixture/side',provider:'fixture',name:'Scripted subscription'}];}
 async start(input:StartRun){this.starts.push(input);if(this.failure)throw this.failure;await this.startGate;}
 async followUp(input:StartRun){this.starts.push(input);}
 async cancel(ctx:RunContext){this.cancels.push(ctx);}
 async compact(){}
 async history(){return [];}
 async dispose(){this.disposed++;}
 event(input:StartRun,type:string,fields:Record<string,unknown>={}){this.callbacks.onEvent({...input,type,...fields});}
 finish(input=this.starts.at(-1)!){this.event(input,'session',{sessionPath:`C:/fixture/${input.threadId}.jsonl`});this.event(input,'input.processing',{inputIds:input.inputIds});this.event(input,'assistant.message',{messageId:crypto.randomUUID(),content:'A separate explanation.',inputIds:input.inputIds});this.event(input,'settled');}
}
const cleanups:(()=>Promise<void>)[]=[];
it('awaits adapter cleanup already started by normal side settlement',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),adapter=new ScriptedRuntime();adapter.dispose=async()=>{adapter.disposed++;await gate;};const x=await setup(()=>adapter),side=await x.createSide();await x.ask(side.id);await vi.waitFor(()=>expect(adapter.starts).toHaveLength(1));adapter.finish();await vi.waitFor(()=>expect(adapter.disposed).toBe(1));let done=false;const closing=x.service.dispose().then(()=>{done=true;});
 try{await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);}finally{release();await closing;}
 expect(done).toBe(true);expect(adapter.disposed).toBe(1);
});
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
it('retains side account use until its native cancellation has completed',async()=>{
 let x!:Awaited<ReturnType<typeof setup>>,release!:()=>void;const native=new ScriptedRuntime();native.cancel=async ctx=>{native.cancels.push(ctx);await new Promise<void>(done=>{release=done;});};
 x=await setup(()=>createRuntime({dataDir:x.store.dataDir,accounts:accountResolver(x.store)},{pi:()=>native,official:()=>new ScriptedRuntime()}));x.main.models=async()=>[{id:'openai/model',provider:'openai',name:'OpenAI'}];
 const side=await x.createSide();await x.send('message.send',{content:'Side',modelId:'openai/model'},side.id);await vi.waitFor(()=>expect(native.starts).toHaveLength(1));let stopped=false;const stopping=x.send('run.stop',{},side.id).then(result=>{stopped=true;return result;});await vi.waitFor(()=>expect(native.cancels).toHaveLength(1));
 try{expect(stopped).toBe(false);expect(x.service.thread(side.id).runId).toBeNull();expect(()=>beginAccountLogin(x.store,'openai',null)).toThrow(expect.objectContaining({code:'ACCOUNT_BUSY'}));}finally{release();await stopping;}
 await vi.waitFor(()=>expect(x.store.all('accountUse')).toHaveLength(0));
});
async function setup(factory?:()=>RuntimeAdapter|Promise<RuntimeAdapter>){
 const root=mkdtempSync(join(tmpdir(),'harness-side-')),store=new Store(root),main=new ScriptedRuntime(),sides:ScriptedRuntime[]=[];
 const service=new Service(store,main,{sideRuntimeFactory:factory??(()=>{const side=new ScriptedRuntime();sides.push(side);return side;})});await service.recover();
 let closed=false;const close=async()=>{if(closed)return;closed=true;try{await service.dispose();}finally{store.close();rmSync(root,{recursive:true,force:true});}};cleanups.push(close);
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string,id=crypto.randomUUID())=>service.command({id,type,payload,threadId});
 const parent=(await send('thread.create',{title:'Main task'})).result as Thread;
 const createSide=async()=>((await send('thread.create',{sideParentId:parent.id,title:'Side question'})).result as Thread);
 const ask=(id:string,content='Why did this assertion fail?')=>send('message.send',{content,modelId:'fixture/side'},id);
 return {store,main,sides,service,send,parent,createSide,ask,close};
}
it('holds the stopped side thread and its capacity until native teardown completes',async()=>{
 const x=await setup(),first=await x.createSide(),second=await x.createSide(),third=await x.createSide();await x.ask(first.id);await x.ask(second.id);await vi.waitFor(()=>expect(x.sides).toHaveLength(2));
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});x.sides[0].cancel=async ctx=>{x.sides[0].cancels.push(ctx);await gate;};
 const stopping=x.send('run.stop',{},first.id);await vi.waitFor(()=>expect(x.sides[0].cancels).toHaveLength(1));
 try{
  await expect(x.send('run.resume',{},first.id)).rejects.toMatchObject({code:'RUN_BUSY'});await expect(x.ask(third.id)).rejects.toMatchObject({code:'SIDE_CHAT_LIMIT'});expect(x.sides).toHaveLength(2);
  release();await stopping;await x.send('run.resume',{},first.id);await vi.waitFor(()=>expect(x.sides[2]?.starts).toHaveLength(1));expect(x.sides).toHaveLength(3);
 }finally{release();await stopping;}
});
it('retains failed side teardown admission and capacity holds',async()=>{
 const x=await setup(),first=await x.createSide(),second=await x.createSide(),third=await x.createSide();await x.ask(first.id);await x.ask(second.id);await vi.waitFor(()=>expect(x.sides).toHaveLength(2));
 x.sides[0].cancel=async ctx=>{x.sides[0].cancels.push(ctx);throw Error('Side cancellation was not confirmed.');};
 await expect(x.send('run.stop',{},first.id)).rejects.toThrow('Side cancellation was not confirmed');
 await expect(x.send('run.resume',{},first.id)).rejects.toMatchObject({code:'RUN_BUSY'});await expect(x.ask(third.id)).rejects.toMatchObject({code:'SIDE_CHAT_LIMIT'});expect(x.sides).toHaveLength(2);
 await expect(x.close()).rejects.toThrow('Could not close every workspace runtime');
});
it('runs a bounded independent side session without stealing main authority or grants',async()=>{
 const x=await setup();await x.ask(x.parent.id,'Investigate the build.');const main=x.main.starts[0];
 x.store.internal('fixture',x.parent.id,()=>x.store.put('resource','private',x.parent.id,{id:'private',threadId:x.parent.id,path:'C:/private',kind:'project',writable:true}));
 const side=await x.createSide();expect(side).toMatchObject({sideParentId:x.parent.id,mode:'plan'});await x.ask(side.id);
 await vi.waitFor(()=>expect(x.sides[0]?.starts).toHaveLength(1));const input=x.sides[0].starts[0];
 expect(input.resources).toEqual([]);expect(input.prompt).toContain('Investigate the build.');expect(input.prompt).toContain(x.parent.id);expect(input.prompt).toContain('quoted');
 expect(x.store.snapshot().activeThreadId).toBe(x.parent.id);expect(x.service.thread(x.parent.id).runId).toBe(main.runId);
 const other=(await x.send('thread.create',{title:'Another main'})).result as Thread;await x.ask(other.id);await vi.waitFor(()=>expect(x.main.starts).toHaveLength(2));expect(x.main.starts[1].threadId).toBe(other.id);expect(x.sides[0].starts).toHaveLength(1);
 await x.send('run.stop',{},side.id);await vi.waitFor(()=>expect(x.sides[0].cancels).toHaveLength(1));expect(x.main.cancels).toHaveLength(0);
 x.sides[0].event(input,'assistant.message',{content:'Late',messageId:'late'});expect(x.store.get('message','late')).toBeNull();
});
it('keeps side authority read-only and rejects resource inheritance, mutations and children',async()=>{
 const x=await setup(),side=await x.createSide();await x.ask(side.id);await vi.waitFor(()=>expect(x.sides[0]?.starts).toHaveLength(1));const input=x.sides[0].starts[0];
 for(const name of ['ui_present','file_replace_prepare','task_delegate','plan_update','task_memory'])await expect(x.sides[0].callbacks.onTool({name,args:{}},input)).rejects.toMatchObject({code:'SIDE_CHAT_READ_ONLY'});
 await expect(x.send('thread.mode',{mode:'build'},side.id)).rejects.toMatchObject({code:'SIDE_CHAT_READ_ONLY'});
 await expect(x.send('resource.grant',{path:'C:/irrelevant',kind:'file'},side.id)).rejects.toMatchObject({code:'SIDE_CHAT_READ_ONLY'});
 await expect(x.send('resource.upload',{name:'x',base64:'YQ=='},side.id)).rejects.toMatchObject({code:'SIDE_CHAT_READ_ONLY'});
 await expect(x.send('thread.create',{sideParentId:side.id})).rejects.toMatchObject({code:'INVALID_INPUT'});
});
it('cancels startup before an asynchronous factory returns and disposes its late adapter',async()=>{
 let resolve!:(value:RuntimeAdapter)=>void;const creating=new Promise<RuntimeAdapter>(done=>{resolve=done;}),late=new ScriptedRuntime(),x=await setup(()=>creating),side=await x.createSide();
 await x.ask(side.id);await vi.waitFor(()=>expect(x.service.thread(side.id).runId).not.toBeNull());await x.send('run.stop',{},side.id);resolve(late);
 await vi.waitFor(()=>expect(late.disposed).toBe(1));expect(late.starts).toHaveLength(0);expect(x.service.thread(side.id).status).toBe('stopped');
});
it('continues the saved side session without quoting parent context again',async()=>{
 const x=await setup();await x.ask(x.parent.id,'Main context.');const side=await x.createSide();await x.ask(side.id);await vi.waitFor(()=>expect(x.sides[0]?.starts).toHaveLength(1));x.sides[0].finish();
 await vi.waitFor(()=>expect(x.service.thread(side.id).runId).toBeNull());await x.ask(side.id,'Explain the second point.');await vi.waitFor(()=>expect(x.sides[1]?.starts).toHaveLength(1));
 expect(x.sides[1].starts[0].sessionPath).toContain(side.id);expect(x.sides[1].starts[0].prompt).not.toContain('Main context.');
 await x.send('run.stop',{},x.parent.id);expect(x.main.cancels).toHaveLength(1);expect(x.sides[1].cancels).toHaveLength(0);expect(x.service.thread(side.id).runId).not.toBeNull();
});
it('bounds active side sessions, preserves retry receipts and refuses busy side follow-ups',async()=>{
 const x=await setup(),first=await x.createSide(),second=await x.createSide(),third=await x.createSide();
 const id=crypto.randomUUID();await x.send('message.send',{content:'A question',modelId:'fixture/side'},first.id,id);await x.send('message.send',{content:'A question',modelId:'fixture/side'},first.id,id);
 await x.ask(second.id);await vi.waitFor(()=>expect(x.sides).toHaveLength(2));await expect(x.ask(first.id)).rejects.toMatchObject({code:'RUN_BUSY'});await expect(x.ask(third.id)).rejects.toMatchObject({code:'SIDE_CHAT_LIMIT'});
 expect(x.store.all('message',third.id)).toHaveLength(0);expect(x.store.all('message',first.id)).toHaveLength(1);
});
it('cancels a failing side runtime without cancelling the parent',async()=>{
 const failing=new ScriptedRuntime();failing.failure=new Error('Scripted startup error');const x=await setup(()=>failing);await x.ask(x.parent.id);const side=await x.createSide();await x.ask(side.id);
 await vi.waitFor(()=>expect(x.service.thread(side.id).status).toBe('interrupted'));expect(failing.cancels).toHaveLength(1);expect(x.main.cancels).toHaveLength(0);expect(x.service.thread(x.parent.id).runId).not.toBeNull();
});
it('waits for a stopped factory cleanup on shutdown and never starts its late adapter',async()=>{
 let resolve!:(value:RuntimeAdapter)=>void;const creating=new Promise<RuntimeAdapter>(done=>{resolve=done;}),late=new ScriptedRuntime(),x=await setup(()=>creating),side=await x.createSide();
 await x.ask(side.id);await vi.waitFor(()=>expect(x.service.thread(side.id).runId).not.toBeNull());
 let disposed=false;const closing=x.service.dispose().then(()=>{disposed=true;});await Promise.resolve();expect(disposed).toBe(false);resolve(late);await closing;expect(late.disposed).toBe(1);expect(late.starts).toHaveLength(0);
});
it('revokes the old side owner before settlement so it cannot mutate a later run',async()=>{
 const x=await setup(),side=await x.createSide();await x.ask(side.id);await vi.waitFor(()=>expect(x.sides[0]?.starts).toHaveLength(1));const old=x.sides[0].starts[0];x.sides[0].finish();
 await x.ask(side.id,'New question');await vi.waitFor(()=>expect(x.sides[1]?.starts).toHaveLength(1));const current=x.service.thread(side.id).runId;
 x.sides[0].event(old,'settled',{aborted:true});x.sides[0].event(old,'assistant.message',{messageId:'stale-after-followup',content:'Stale'});
 await expect(x.sides[0].callbacks.onTool({name:'task_finish',args:{}},old)).rejects.toMatchObject({code:'CANCELLED_RUN'});expect(x.service.thread(side.id).runId).toBe(current);expect(x.store.get('message','stale-after-followup')).toBeNull();
});
it('keeps side context bounded, quoted once, and does not inherit later parent edits',async()=>{
 const x=await setup();for(let index=0;index<15;index++)x.store.internal('fixture',x.parent.id,()=>x.store.put('message','parent-'+index,x.parent.id,{id:'parent-'+index,threadId:x.parent.id,role:'user',content:'x'.repeat(9000),createdAt:new Date().toISOString(),runId:null}));
 const side=await x.createSide();x.store.internal('fixture',x.parent.id,()=>x.store.put('message','late-parent',x.parent.id,{id:'late-parent',threadId:x.parent.id,role:'user',content:'LATER_PARENT_SECRET',createdAt:new Date().toISOString(),runId:null}));await x.ask(side.id);await vi.waitFor(()=>expect(x.sides[0]?.starts).toHaveLength(1));
 const input=x.sides[0].starts[0];expect(Buffer.byteLength(input.prompt)).toBeLessThan(17000);expect(input.prompt).not.toContain('LATER_PARENT_SECRET');expect(input.resources).toEqual([]);
});
it('releases pending side work when Stop arrives before the adapter startup acknowledgment',async()=>{
 let acknowledge!:()=>void;const blocked=new ScriptedRuntime();blocked.startGate=new Promise<void>(done=>{acknowledge=done;});const x=await setup(()=>blocked),side=await x.createSide();await x.ask(side.id);await vi.waitFor(()=>expect(blocked.starts).toHaveLength(1));
 await x.send('run.stop',{},side.id);let disposed=false;const cleanup=x.service.dispose().then(()=>{disposed=true;});
 try{await vi.waitFor(()=>expect(disposed).toBe(true),{timeout:200});}finally{acknowledge();await cleanup;}
 expect(blocked.cancels).toHaveLength(1);expect(blocked.disposed).toBe(1);
});
it('keeps an active side conversation reachable when the idle parent is archived',async()=>{
 const x=await setup(),side=await x.createSide();await x.ask(side.id);await vi.waitFor(()=>expect(x.sides[0]?.starts).toHaveLength(1));
 await expect(x.send('thread.archive',{},x.parent.id)).rejects.toMatchObject({code:'RUN_BUSY'});
 expect(x.store.snapshot().threads.some(thread=>thread.id===x.parent.id)).toBe(true);expect(x.service.thread(side.id).runId).not.toBeNull();expect(x.sides[0].cancels).toHaveLength(0);
 await x.send('run.stop',{},side.id);await expect(x.send('thread.archive',{},x.parent.id)).resolves.toMatchObject({result:{archived:true}});
});
