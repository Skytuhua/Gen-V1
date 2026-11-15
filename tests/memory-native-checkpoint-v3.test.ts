import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {createHostResourceLoader} from '../packages/runtime-pi/tool-definitions.ts';
import {encodeInput} from '../packages/runtime-pi/input-envelope.ts';
import {CheckpointBridge} from '../packages/runtime-pi/ipc.ts';
import {createRuntime} from '../packages/runtime/index.ts';
import {createHermesEngine,type HermesSourceClient} from '../packages/runtime-hermes/index.ts';
import type {HermesClient} from '../packages/runtime-hermes/client.ts';

const requirement={apiVersion:2,required:true} as const;
const ctx={threadId:'checkpoint-thread',runId:'checkpoint-run',epoch:3};
const binding={ctx,sessionPath:'/owned/checkpoint/session.jsonl',modelId:'openai/model',accountId:null};
const ack=(request:{requestId:string})=>({apiVersion:2 as const,requestId:request.requestId,checkpointId:'saved-checkpoint',digest:'a'.repeat(64),persisted:true as const});
const temporary:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const barrier=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(done=>{resolve=done;});return{promise,resolve};};

function piFixture(request:(value:any,signal?:AbortSignal)=>Promise<any>,extra:Record<string,unknown>={}){
 const failures:unknown[]=[],loader=createHostResourceLoader(sdk,undefined,false,undefined,{requirement,binding:()=>binding,request,onFailure:error=>failures.push(error),...extra});
 const extensions=loader.getExtensions(),manager=sdk.SessionManager.inMemory();
 for(let n=0;n<4;n++)manager.appendMessage({role:'user',content:'Native transcript '+n+' '+('x'.repeat(300)),timestamp:n+1});
 const runner=new sdk.ExtensionRunner(extensions.extensions,extensions.runtime,process.cwd(),manager,{} as never);
 const events:any[]=[],summary=vi.fn(async()=>{throw Error('summary-boundary');});
 const native=Object.create(sdk.AgentSession.prototype);
 Object.defineProperty(native,'model',{value:{id:'model',provider:'openai'}});
 Object.assign(native,{sessionManager:manager,settingsManager:{getCompactionSettings:()=>({enabled:true,reserveTokens:1,keepRecentTokens:1})},_extensionRunner:runner,abort:async()=>{},_emit:(event:any)=>events.push(event),_runDefaultCompaction:summary,_clearManualCompactionState:()=>{},_emitSessionCompactFailed:async()=>{},_resolveIdleWaitIfIdle:()=>{}});
 return{loader,runner,native,events,summary,failures,manager};
}

describe('pinned native Pi checkpoint boundary',()=>{
 it.each(['manual','threshold','overflow'] as const)('waits for a persistence receipt before the actual %s summary entrypoint',async reason=>{
  const hold=barrier(),request=vi.fn((_request:any)=>hold.promise),f=piFixture(request),before=JSON.stringify(f.manager.getEntries());
  const work=reason==='manual'?sdk.AgentSession.prototype.compact.call(f.native).catch(error=>error):(f.native as any)._runAutoCompaction(reason,false);
  await vi.waitFor(()=>expect(request).toHaveBeenCalledOnce());expect(f.summary).not.toHaveBeenCalled();expect(JSON.stringify(f.manager.getEntries())).toBe(before);
  expect(request.mock.calls[0][0]).toMatchObject({...binding,adapterId:'pi',apiVersion:2,reason});
  hold.resolve(ack(request.mock.calls[0][0]));await work;expect(f.summary).toHaveBeenCalledOnce();expect(f.failures).toEqual([]);
 });
 it.each(['manual','threshold','overflow'] as const)('cancels %s compaction through the actual SDK runner when persistence rejects',async reason=>{
  const f=piFixture(async()=>{throw Error('persistence rejected');}),before=JSON.stringify(f.manager.getEntries());
  if(reason==='manual')await expect(sdk.AgentSession.prototype.compact.call(f.native)).rejects.toThrow('Compaction cancelled');else expect(await f.native._runAutoCompaction(reason,false)).toBe(false);
  expect(f.summary).not.toHaveBeenCalled();expect(JSON.stringify(f.manager.getEntries())).toBe(before);expect(f.events).toContainEqual(expect.objectContaining({type:'compaction_end',aborted:true}));expect(f.failures).toHaveLength(1);
 });
 it.each([{}, {persisted:false}, {apiVersion:1}, {requestId:'foreign'}, {digest:'invalid'}])('does not let an invalid host receipt reach native compaction: %j',async patch=>{
  const f=piFixture(async request=>Object.keys(patch).length?{...ack(request),...patch}:{});
  await expect(sdk.AgentSession.prototype.compact.call(f.native)).rejects.toThrow('Compaction cancelled');expect(f.summary).not.toHaveBeenCalled();
 });
 it('revalidates local authority after an awaited receipt and never supplies native replacement history',async()=>{
  const hold=barrier();let current=true;const request=vi.fn((_request:any)=>hold.promise),f=piFixture(request,{assertCurrent:()=>{if(!current)throw Error('revoked');}});
  const work=sdk.AgentSession.prototype.compact.call(f.native).catch(error=>error);
  await vi.waitFor(()=>expect(request).toHaveBeenCalledOnce());current=false;hold.resolve(ack(request.mock.calls[0][0]));expect(await work).toMatchObject({message:'Compaction cancelled'});expect(f.summary).not.toHaveBeenCalled();
  expect(JSON.stringify(request.mock.calls[0][0])).not.toContain('Native transcript');
 });
 it('rejects required unsupported SDK versions and keeps unopted resources unchanged',()=>{
  expect(()=>createHostResourceLoader({...sdk,VERSION:'unverified'},undefined,false,undefined,{requirement,binding:()=>binding,request:async value=>ack(value)})).toThrow(/checkpoint|version/i);
  expect(createHostResourceLoader(sdk).getExtensions().extensions).toEqual([]);
  expect(()=>createHostResourceLoader(sdk,undefined,true,undefined,{requirement,binding:()=>binding,request:async value=>ack(value)})).toThrow(/checkpoint|model/i);
 });
 it('does not serialize checkpoint controls or accepted-memory receipts into user envelopes',()=>{
  const input:StartRun={...ctx,modelId:binding.modelId,accountId:null,sessionPath:null,prompt:'request',inputId:'input',resources:[],memoryCheckpoint:requirement};
  expect(encodeInput(input)).not.toContain('memoryCheckpoint');expect(encodeInput(input)).not.toContain('apiVersion');
 });
});

describe('bounded private Pi checkpoint IPC',()=>{
 const request={...binding,apiVersion:2 as const,adapterId:'pi' as const,requestId:'attempt',reason:'manual' as const};
 it('requires the exact request and run receipt and allows only one pending attempt',async()=>{
  const send=vi.fn(),bridge=new CheckpointBridge(ctx,send),work=bridge.call(request);let resolved=false;void work.then(()=>{resolved=true;});
  await expect(bridge.call({...request,requestId:'second'})).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_BLOCKED'});
  bridge.receive({type:'memory.checkpoint.result',ctx:{...ctx,epoch:4},requestId:request.requestId,value:ack(request)});
  bridge.receive({type:'memory.checkpoint.result',ctx,requestId:'foreign',value:ack(request)});await Promise.resolve();expect(resolved).toBe(false);
  bridge.receive({type:'memory.checkpoint.result',ctx,requestId:request.requestId,value:ack(request)});await expect(work).resolves.toEqual(ack(request));expect(send).toHaveBeenCalledOnce();bridge.close();
 });
 it.each(['deadline','abort','disconnect'] as const)('blocks %s and discards late receipts with timers detached',async cause=>{
  vi.useFakeTimers();const bridge=new CheckpointBridge(ctx,()=>{},100),controller=new AbortController(),work=bridge.call(request,controller.signal),result=work.catch(error=>error);
  if(cause==='deadline')await vi.advanceTimersByTimeAsync(100);else if(cause==='abort')controller.abort();else bridge.close();
  expect(await result).toMatchObject({code:'MEMORY_CHECKPOINT_BLOCKED'});expect(vi.getTimerCount()).toBe(0);
  bridge.receive({type:'memory.checkpoint.result',ctx,requestId:request.requestId,value:ack(request)});bridge.close();
 });
});

function mockAdapter(){let callbacks!:RuntimeCallbacks;const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[],start:vi.fn(async()=>{}),followUp:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),compact:vi.fn(async()=>{}),history:async()=>[],dispose:async()=>{}};return{runtime,get callbacks(){return callbacks;}};}
describe('native checkpoint owner routing',()=>{
 it('rechecks the captured owner after persistence and rejects receipts arriving after cancellation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'memory-checkpoint-router-'));temporary.push(root);const pi=mockAdapter(),official=mockAdapter(),hold=barrier(),callback=vi.fn(()=>hold.promise),runtime=createRuntime({dataDir:root},{pi:()=>pi.runtime,official:()=>official.runtime});
  runtime.configure({onEvent:()=>{},onTool:async()=>{},onMemoryCheckpoint:callback});const input={...ctx,modelId:binding.modelId,accountId:null,sessionPath:null,prompt:'request',inputId:'input',resources:[],memoryCheckpoint:requirement};
  try{await runtime.start(input);const request={...binding,sessionPath:join(root,'tasks','session.jsonl'),apiVersion:2 as const,adapterId:'pi' as const,requestId:'request',reason:'manual' as const};const work=pi.callbacks.onMemoryCheckpoint!(request);const rejected=expect(work).rejects.toMatchObject({code:'STALE_RUN'});await vi.waitFor(()=>expect(callback).toHaveBeenCalledOnce());await runtime.cancel(ctx);hold.resolve(ack(request));await rejected;}finally{await runtime.dispose();}
 });
 it('forwards manual account and requirement but blocks a required unsupported external adapter',async()=>{
  const root=await mkdtemp(join(tmpdir(),'memory-checkpoint-router-'));temporary.push(root);const pi=mockAdapter(),official=mockAdapter(),runtime=createRuntime({dataDir:root},{pi:()=>pi.runtime,official:()=>official.runtime});runtime.configure({onEvent:()=>{},onTool:async()=>{},onMemoryCheckpoint:async request=>ack(request)});
  try{const path=join(root,'task','session.jsonl');await runtime.compact(ctx,path,'openai/model',null,requirement);expect(pi.runtime.compact).toHaveBeenCalledWith(ctx,path,'openai/model',null,requirement);
   await expect(runtime.compact({...ctx,runId:'official'},join(root,'official','claude-code','session.json'),'claude-code/model',null,requirement)).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_UNSUPPORTED'});expect(official.runtime.compact).not.toHaveBeenCalled();
  }finally{await runtime.dispose();}
 });
});

async function hermesFixture(capability:unknown={apiVersion:2,hostOwned:true},callback:(request:any)=>Promise<any>=async request=>ack(request)){
 const dataDir=await mkdtemp(join(tmpdir(),'memory-checkpoint-hermes-'));temporary.push(dataDir);let options!:ConstructorParameters<typeof HermesClient>[0];const calls:{method:string;params:any}[]=[],catalog=mockAdapter();
 const source:HermesSourceClient={async request<T>(method:string,params={}){calls.push({method,params});if(method==='hello')return{protocolVersion:1,engineClass:'run_agent.AIAgent',sourceCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7',memoryCheckpoint:capability} as T;if(method==='agent.start'||method==='agent.followUp')return{accepted:true} as T;if(method==='agent.compact')return{compacted:true} as T;return{} as T;},dispose:async()=>{}};
 const runtime=createHermesEngine({dataDir,nativeCatalog:catalog.runtime,hostTools:[]},{createClient:value=>{options=value;return source;},createNativeRuntime:()=>mockAdapter().runtime});runtime.configure({onEvent:()=>{},onTool:async()=>{},onMemoryCheckpoint:callback});
 const input:StartRun={...ctx,modelId:'openai/model',sessionPath:null,accountId:null,prompt:'request',inputId:'input',resources:[],memoryCheckpoint:requirement};
 const start=()=>calls.find(call=>call.method==='agent.start')!.params;
 const settle=async()=>{options.onEvent!({event:'foreground_settled',ctx:start().ctx,data:{}});options.onEvent!({event:'settled',ctx:start().ctx,data:{}});await vi.waitFor(()=>expect(runtime.reviewBusy).toBe(false));};
 const request=(patch:Record<string,unknown>={})=>({apiVersion:2,requestId:'checkpoint',adapterId:'hermes',ctx:{...ctx},sessionPath:start().sessionPath,modelId:input.modelId,accountId:null,reason:'automatic',...patch});
 return{runtime,input,calls,start,settle,request,source,foregroundSettled:()=>options.onEvent!({event:'foreground_settled',ctx:start().ctx,data:{}}),host:(args:Record<string,unknown>,context=start().ctx)=>options.onHostCall!({id:'host-call',name:'$memory.checkpoint',args,ctx:context})};
}
describe('pinned Hermes checkpoint capability and authority',()=>{
 it.each([undefined,{apiVersion:1,hostOwned:true},{apiVersion:2,hostOwned:false}])('fails closed for required unsupported source capability %j',async capability=>{
  const f=await hermesFixture(capability??null);try{await expect(f.runtime.start(f.input)).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_UNSUPPORTED'});expect(f.calls.some(call=>call.method==='agent.start')).toBe(false);}finally{await f.runtime.dispose();}
 });
 it('passes the requirement through the private channel and binds the checkpoint to the captured source',async()=>{
  const callback=vi.fn(async request=>ack(request)),f=await hermesFixture(undefined,callback);try{await f.runtime.start(f.input);expect(f.start().memoryCheckpoint).toEqual(requirement);expect(f.start().prompt).not.toContain('memoryCheckpoint');const request=f.request();await expect(f.host(request)).resolves.toEqual(ack(request));expect(callback).toHaveBeenCalledWith(request);
   await expect(f.host(f.request({accountId:'foreign'}))).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_OWNER'});await expect(f.host(f.request(),{...f.start().ctx,phase:'background_review'})).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_OWNER'});await f.settle();
  }finally{await f.runtime.dispose();}
 });
 it('refuses a late foreground checkpoint after the source has handed off to background review',async()=>{
  const callback=vi.fn(async request=>ack(request)),f=await hermesFixture(undefined,callback);
  try{await f.runtime.start(f.input);f.foregroundSettled();await expect(f.host(f.request())).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_OWNER'});expect(callback).not.toHaveBeenCalled();await f.settle();}finally{await f.runtime.dispose();}
 });
 it('binds manual checkpoint persistence to the new maintenance owner while preserving the native source context',async()=>{
  const callback=vi.fn(async request=>ack(request)),f=await hermesFixture(undefined,callback),maintenance={...ctx,runId:'maintenance',epoch:4};
  try{await f.runtime.start(f.input);await f.settle();const original=f.source.request.bind(f.source);f.source.request=async<T>(method:string,params={})=>{
   if(method==='agent.compact'){expect(params).toMatchObject({memoryCheckpoint:requirement,ctx:f.start().ctx,accountId:null});const request=f.request({reason:'manual'});expect(await f.host(request)).toEqual(ack(request));}
   return original<T>(method,params);
  };
   await f.runtime.compact(maintenance,f.start().sessionPath,f.input.modelId,null,requirement);expect(callback).toHaveBeenCalledWith(expect.objectContaining({ctx:maintenance,reason:'manual'}));
  }finally{await f.runtime.dispose();}
 });
});
