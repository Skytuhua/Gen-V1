import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Service,type ServiceOptions} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import type {RunContext,RuntimeAdapter,StartRun,Thread} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
function fixture(options:(store:Store)=>ServiceOptions=()=>({})){
 const directory=mkdtempSync(join(tmpdir(),'workspace-admission-')),store=new Store(directory),starts:StartRun[]=[];
 const runtime:RuntimeAdapter={configure(){},models:async()=>[{id:'test/model',provider:'test',name:'Test'}],start:vi.fn(async input=>{starts.push(input);}),followUp:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime,options(store));let closed=false;const close=async()=>{if(closed)return;closed=true;try{await service.dispose();}finally{store.close();rmSync(directory,{recursive:true,force:true});}};cleanups.push(close);
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:crypto.randomUUID(),type,payload,threadId});
 const create=async(payload:Record<string,unknown>={})=>(await send('thread.create',payload)).result as Thread;
 const message=(threadId:string,content='Assigned work')=>send('message.send',{content,modelId:'test/model'},threadId);
 return{store,runtime,service,starts,send,create,message,close};
}

function reader(cancel:RuntimeAdapter['cancel'],dispose:RuntimeAdapter['dispose']=async()=>{}){
 const starts:StartRun[]=[],runtime:RuntimeAdapter={configure(){},models:async()=>[],start:async input=>{starts.push(input);},followUp:async()=>{},cancel,compact:async()=>{},history:async()=>[],dispose};
 return{starts,runtime};
}
const delegatedTask={id:'reader',name:'Reader',task:'Inspect the saved evidence',prompt:'Read only and report evidence.',requirements:[{id:'read',label:'Read evidence'}]};

it.each(['run.stop','Stop All'])('%s drains the abort-started delegated cancellation and disposal before acknowledging',async mode=>{
 let releaseCancel!:()=>void,releaseDispose!:()=>void;const cancelGate=new Promise<void>(done=>{releaseCancel=done;}),disposeGate=new Promise<void>(done=>{releaseDispose=done;}),cancel=vi.fn(async(_ctx:RunContext)=>{await cancelGate;}),dispose=vi.fn(async()=>{await disposeGate;}),child=reader(cancel,dispose);
 const f=fixture(()=>({planningRuntimeFactory:()=>child.runtime})),thread=await f.create();await f.message(thread.id);
 const delegated=f.service.tool({name:'task_delegate',args:{commandId:'delegate-stop-'+mode.replace(/\W/g,'-'),tasks:[delegatedTask]}},f.starts[0]);await vi.waitFor(()=>expect(child.starts).toHaveLength(1));
 let acknowledged=false;const stopping=(mode==='run.stop'?f.send('run.stop',{},thread.id):f.service.stopAll()).then(value=>{acknowledged=true;return value;});
 try{
  await vi.waitFor(()=>expect(cancel).toHaveBeenCalledOnce());await new Promise(resolve=>setTimeout(resolve,10));expect(acknowledged).toBe(false);expect(f.store.get<Thread>('thread',thread.id)).toMatchObject({status:'stopped',runId:null});
  await expect(f.send('run.resume',{},thread.id)).rejects.toMatchObject({code:'RUN_BUSY'});
  releaseCancel();await vi.waitFor(()=>expect(dispose).toHaveBeenCalledOnce());expect(acknowledged).toBe(false);
  releaseDispose();await stopping;await delegated;expect(cancel).toHaveBeenCalledWith({threadId:child.starts[0].threadId,runId:child.starts[0].runId,epoch:child.starts[0].epoch});
  await f.send('run.resume',{},thread.id);expect(f.starts).toHaveLength(2);
 }finally{releaseCancel();releaseDispose();await Promise.allSettled([stopping,delegated]);}
});

it.each(['run.stop','Stop All'])('%s reports a delegated cancellation failure only after the parent cancellation drains',async mode=>{
 let releaseParent!:()=>void;const parentGate=new Promise<void>(done=>{releaseParent=done;}),cancel=vi.fn(async()=>{throw Error('Reader cancellation was not confirmed.');}),child=reader(cancel),f=fixture(()=>({planningRuntimeFactory:()=>child.runtime})),thread=await f.create();
 await f.message(thread.id);vi.mocked(f.runtime.cancel).mockImplementation(()=>parentGate);
 const delegated=f.service.tool({name:'task_delegate',args:{commandId:'delegate-failed-stop-'+mode.replace(/\W/g,'-'),tasks:[delegatedTask]}},f.starts[0]);await vi.waitFor(()=>expect(child.starts).toHaveLength(1));
 let acknowledged=false;const stopping=(mode==='run.stop'?f.send('run.stop',{},thread.id):f.service.stopAll()).then(value=>{acknowledged=true;return{value};},error=>{acknowledged=true;return{error};});
 try{
  await vi.waitFor(()=>expect(cancel).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(f.runtime.cancel).toHaveBeenCalledOnce());await new Promise(resolve=>setTimeout(resolve,10));expect(acknowledged).toBe(false);
  releaseParent();const result=await stopping;
  if(mode==='run.stop')expect(result).toMatchObject({error:expect.objectContaining({message:expect.stringContaining('Reader cancellation was not confirmed')})});
  else expect(result).toMatchObject({value:{stopped:1,errors:[expect.stringContaining('Reader cancellation was not confirmed')]}});
  await delegated;await expect(f.send('run.resume',{},thread.id)).rejects.toMatchObject({code:'RUN_BUSY'});await expect(f.close()).rejects.toThrow('Could not close every workspace runtime');
 }finally{releaseParent();await Promise.allSettled([stopping,delegated]);await f.close().catch(()=>{});}
});

it('reserves three main admissions before asynchronous workspace preparation and captures granted resources once',async()=>{
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),prepare=vi.fn();
 const f=fixture(store=>({prepareWorkspace:async thread=>{prepare(thread.id);await gate;store.internal('fixture.grant',thread.id,()=>store.put('resource','grant-'+thread.id,thread.id,{id:'grant-'+thread.id,threadId:thread.id,kind:'project',path:store.dataDir,label:'Owned project',writable:true,createdAt:'now'}));}}));
 const threads=await Promise.all(Array.from({length:4},()=>f.create()));
 try{
  await Promise.all(threads.slice(0,3).map(thread=>f.message(thread.id)));expect(prepare).toHaveBeenCalledTimes(3);expect(f.starts).toEqual([]);
  await expect(f.message(threads[3].id,'Keep this draft')).rejects.toMatchObject({code:'RUN_BUSY'});expect(f.store.all('outbox',threads[3].id)).toEqual([]);
  await f.message(threads[0].id,'A second assignment while preparing');release();
  await vi.waitFor(()=>expect(f.starts).toHaveLength(3));expect(prepare).toHaveBeenCalledTimes(3);
  const first=f.starts.find(input=>input.threadId===threads[0].id)!;expect(first.resources).toHaveLength(1);expect(first.prompt).toContain('A second assignment while preparing');expect(f.runtime.followUp).not.toHaveBeenCalled();
 }finally{release();}
});

it('keeps accepted input saved and reports workspace preparation failure without starting a model',async()=>{
 const f=fixture(()=>({prepareWorkspace:async()=>{throw Error('Workspace cannot be prepared');}})),thread=await f.create();await f.message(thread.id);
 await vi.waitFor(()=>expect(f.store.get<Thread>('thread',thread.id)).toMatchObject({status:'interrupted',error:'Workspace cannot be prepared'}));
 expect(f.store.all('outbox',thread.id)).toEqual([expect.objectContaining({status:'persisted',content:'Assigned work'})]);expect(f.runtime.start).not.toHaveBeenCalled();
});

it.each(['models','history'] as const)('rechecks resume admission after asynchronous %s preparation',async phase=>{
 const f=fixture(),target=await f.create();await f.message(target.id);await f.send('run.stop',{},target.id);
 let release!:()=>void,enter!:()=>void;
 const gate=new Promise<void>(done=>{release=done;}),entered=new Promise<void>(done=>{enter=done;});
 if(phase==='models')vi.spyOn(f.runtime,'models').mockImplementationOnce(async()=>{enter();await gate;return[{id:'test/model',provider:'test',name:'Test'}];});
 else{
  f.store.internal('fixture.session',target.id,()=>f.store.put('thread',target.id,target.id,{...f.store.get<Thread>('thread',target.id)!,sessionPath:join(f.store.dataDir,'session.jsonl')}));
  vi.spyOn(f.runtime,'history').mockImplementationOnce(async()=>{enter();await gate;return[];});
 }
 const resuming=f.send('run.resume',{},target.id).then(value=>({value}),error=>({error}));
 try{
  await entered;const active:Thread[]=[];
  for(let i=0;i<3;i++){const thread=await f.create();active.push(thread);await f.message(thread.id);}
  expect(f.store.all<Thread>('thread').filter(thread=>thread.runId)).toHaveLength(3);
  release();expect(await resuming).toMatchObject({error:{code:'RUN_BUSY'}});
  expect(f.store.get<Thread>('thread',target.id)?.status).toBe('stopped');
  expect(f.starts).toHaveLength(4);
  await f.send('run.stop',{},active[0].id);await f.send('run.resume',{},target.id);
  expect(f.starts).toHaveLength(5);expect(f.starts.at(-1)?.threadId).toBe(target.id);
 }finally{release();await resuming;}
});

it('does not start a workspace-prepared run after Stop revokes its epoch',async()=>{
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),f=fixture(()=>({prepareWorkspace:()=>gate})),thread=await f.create();
 try{await f.message(thread.id);await f.send('run.stop',{},thread.id);release();await f.service.deliverOutbox(thread.id);expect(f.runtime.start).not.toHaveBeenCalled();expect(f.store.get<Thread>('thread',thread.id)?.status).toBe('stopped');}finally{release();}
});

it('binds new threads only to registered local project identities',async()=>{
 const f=fixture();f.store.internal('fixture.projects',null,()=>{for(const [id,kind]of [['local','local'],['company','company']])f.store.put('workspaceProject',id,null,{id,name:'Registered '+id,authority:{kind}});});
 expect(await f.create({projectId:'local',projectName:'Forged label'})).toMatchObject({projectId:'local',projectName:'Registered local',kind:'main'});
 for(const projectId of ['company','missing'])await expect(f.create({projectId})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
});

it('routes only named managed integration tools and rejects results after the task loses ownership',async()=>{
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),hook=vi.fn(async()=>{await gate;return{answer:'Scoped result'};}),f=fixture(()=>({additionalTool:hook})),thread=await f.create();
 try{
  await f.message(thread.id);const ctx=f.starts[0],pending=f.service.tool({name:'integration_call',args:{id:'graphify'}},ctx);
  expect(hook).toHaveBeenCalledOnce();await f.send('run.stop',{},thread.id);release();await expect(pending).rejects.toMatchObject({code:'CANCELLED_RUN'});
  expect(hook).toHaveBeenCalledWith({name:'integration_call',args:{id:'graphify'}},expect.objectContaining({threadId:thread.id,runId:ctx.runId,epoch:ctx.epoch}));
 }finally{release();}
});

it('Stop All waits for actual native cancellation and keeps the host available',async()=>{
 const f=fixture(),first=await f.create(),second=await f.create();await f.message(first.id);await f.message(second.id);
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});vi.mocked(f.runtime.cancel).mockImplementation(()=>gate);
 let finished=false;const stopping=f.service.stopAll().then(result=>{finished=true;return result;});
 try{
  await vi.waitFor(()=>expect(f.runtime.cancel).toHaveBeenCalledTimes(2));expect(finished).toBe(false);
  expect(f.store.get<Thread>('thread',first.id)?.status).toBe('stopped');release();expect(await stopping).toEqual({stopped:2});
  const third=await f.create();await f.message(third.id);expect(f.starts).toHaveLength(3);
 }finally{release();await stopping;}
});
it('replaying Stop waits for the same native teardown instead of acknowledging it early',async()=>{
 const f=fixture(),thread=await f.create();await f.message(thread.id);let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});vi.mocked(f.runtime.cancel).mockImplementation(()=>gate);
 const command={id:'stop-replay',type:'run.stop',threadId:thread.id,payload:{}};let replayed=false;
 const first=f.service.command(command);await vi.waitFor(()=>expect(f.runtime.cancel).toHaveBeenCalledOnce());const second=f.service.command(command).then(result=>{replayed=true;return result;});
 try{await new Promise(resolve=>setTimeout(resolve,10));expect(replayed).toBe(false);release();expect(await second).toEqual(await first);}finally{release();await Promise.allSettled([first,second]);}
});
it('replaying a failed Stop retains its unconfirmed teardown outcome',async()=>{
 const f=fixture(),thread=await f.create();await f.message(thread.id);vi.mocked(f.runtime.cancel).mockRejectedValue(Error('Native cancellation was not confirmed.'));const command={id:'failed-stop-replay',type:'run.stop',threadId:thread.id,payload:{}};
 await expect(f.service.command(command)).rejects.toThrow(/not confirmed/);await expect(f.service.command(command)).rejects.toThrow(/not confirmed/);
 await expect(f.message(thread.id)).rejects.toMatchObject({code:'RUN_BUSY'});
});
