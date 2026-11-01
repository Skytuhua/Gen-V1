import {expect,it,vi} from 'vitest';
import {join,resolve} from 'node:path';
import {createRuntime} from '../packages/runtime/index.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {SUBSCRIPTION_CONNECTIONS} from '../packages/contracts/connections.ts';

const root=resolve('.harness-runtime-router-fixture');
const input=(modelId='openai/model'):StartRun=>({threadId:'thread',runId:'run',epoch:1,modelId,sessionPath:null,inputId:'input',prompt:'A supplied task',resources:[]});
function adapter(){
 let callbacks:RuntimeCallbacks;
 const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:vi.fn(async()=>[]),start:vi.fn(async()=>{}),followUp:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),compact:vi.fn(async()=>{}),history:vi.fn(async()=>[]),dispose:vi.fn(async()=>{})};
 return {runtime,event:(type:string)=>callbacks.onEvent({...input(),type}),tool:()=>callbacks.onTool({name:'ui_inspect',args:{}},input())};
}
function fixture(){
 const pi=adapter(),official=adapter(),callbacks:RuntimeCallbacks={onEvent:vi.fn(),onTool:vi.fn(async()=>({ok:true}))};
 const runtime=createRuntime({dataDir:root},{pi:()=>pi.runtime,official:()=>official.runtime});runtime.configure(callbacks);
 return {runtime,pi,official,callbacks};
}

it('merges available runtime models without hiding a signed-in provider behind another auth failure',async()=>{
 const f=fixture();vi.mocked(f.pi.runtime.models).mockRejectedValue(Error('No Pi subscription'));vi.mocked(f.official.runtime.models).mockResolvedValue([{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}]);
 expect(await f.runtime.models()).toEqual([{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}]);
 vi.mocked(f.official.runtime.models).mockRejectedValue(Error('No official subscription'));await expect(f.runtime.models()).rejects.toMatchObject({code:'AI_AUTH_REQUIRED'});
});

it('routes the requested model and rejects a session belonging to a different runtime before startup',async()=>{
 const f=fixture();await f.runtime.start(input('claude-code/sonnet'));expect(f.official.runtime.start).toHaveBeenCalledOnce();expect(f.pi.runtime.start).not.toHaveBeenCalled();await f.runtime.cancel(input());
 await expect(f.runtime.start({...input(),sessionPath:join(root,'official','claude-code','tasks','thread','session.json')})).rejects.toMatchObject({code:'RUNTIME_SESSION_MISMATCH'});
 expect(f.pi.runtime.start).not.toHaveBeenCalled();
});

it('revokes callbacks before cancelling an in-flight startup and rejects late tool calls',async()=>{
 const f=fixture();let release!:()=>void;vi.mocked(f.official.runtime.start).mockImplementation(()=>new Promise<void>(done=>{release=done;}));
 const started=f.runtime.start(input('gemini-cli/pro'));await f.runtime.cancel(input());
 f.official.event('assistant.delta');expect(f.callbacks.onEvent).not.toHaveBeenCalled();
 await expect(f.official.tool()).rejects.toMatchObject({code:'STALE_RUN'});expect(f.callbacks.onTool).not.toHaveBeenCalled();release();await started;
});

it('retains cancellation ownership after an error and revokes a settled run before follow-up',async()=>{
 const f=fixture();await f.runtime.start(input());f.pi.event('error');await f.runtime.cancel(input());expect(f.pi.runtime.cancel).toHaveBeenCalledWith(input());
 await f.runtime.start(input());f.pi.event('settled');await expect(f.runtime.followUp(input())).rejects.toMatchObject({code:'STALE_RUN'});expect(f.pi.runtime.followUp).not.toHaveBeenCalled();
});
it('cancels the original adapter if startup rejects after acquiring a worker',async()=>{
 const f=fixture();vi.mocked(f.official.runtime.start).mockRejectedValue(Error('Initialization failed'));
 await expect(f.runtime.start(input('claude-code/sonnet'))).rejects.toThrow('Initialization failed');
 expect(f.official.runtime.cancel).toHaveBeenCalledWith(input('claude-code/sonnet'));
 await expect(f.official.tool()).rejects.toMatchObject({code:'STALE_RUN'});
});

it('cannot redirect an active follow-up to another provider and keeps single-run ownership',async()=>{
 const f=fixture();await f.runtime.start(input());await expect(f.runtime.followUp(input('gemini-cli/pro'))).rejects.toMatchObject({code:'RUNTIME_MODEL_MISMATCH'});
 await expect(f.runtime.start({...input('claude-code/sonnet'),runId:'other'})).rejects.toMatchObject({code:'RUNTIME_BUSY'});
 expect(f.official.runtime.start).not.toHaveBeenCalled();
});

it('routes compaction and history without passing official manifests to Pi or allowing outside sessions',async()=>{
 const f=fixture(),session=join(root,'official','gemini-cli','tasks','thread','session.json');
 await f.runtime.compact(input(),session,'gemini-cli/pro');expect(f.official.runtime.compact).toHaveBeenCalledWith(input(),session,'gemini-cli/pro');
 await f.runtime.history(session);expect(f.official.runtime.history).toHaveBeenCalledWith(session);expect(f.pi.runtime.history).not.toHaveBeenCalled();
 await expect(f.runtime.history(resolve(root,'..','outside.json'))).rejects.toMatchObject({code:'RUNTIME_SESSION_INVALID'});
});

it('disposes both adapters and rejects new work after disposal',async()=>{
 const f=fixture();await f.runtime.dispose();expect(f.pi.runtime.dispose).toHaveBeenCalledOnce();expect(f.official.runtime.dispose).toHaveBeenCalledOnce();
 await expect(f.runtime.start(input())).rejects.toMatchObject({code:'RUNTIME_DISPOSED'});
});

it('keeps pending Cursor models out of public discovery and rejects task admission before adapter startup',async()=>{
 const row=SUBSCRIPTION_CONNECTIONS.find(value=>value.id==='cursor-sdk')!,status=row.status;row.status='runtime-pending';
 try{
 const f=fixture();vi.mocked(f.official.runtime.models).mockResolvedValue([{id:'cursor-sdk/model',provider:'cursor-sdk',name:'Cursor model'},{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}]);
 expect(await f.runtime.models()).toEqual([{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}]);
 await expect(f.runtime.start(input('cursor-sdk/model'))).rejects.toMatchObject({code:'RUNTIME_PROVIDER_UNAVAILABLE'});
 await expect(f.runtime.compact(input(),join(root,'official','cursor-sdk','tasks','thread','session.json'),'cursor-sdk/model')).rejects.toMatchObject({code:'RUNTIME_PROVIDER_UNAVAILABLE'});
 expect(f.pi.runtime.start).not.toHaveBeenCalled();expect(f.official.runtime.start).not.toHaveBeenCalled();expect(f.official.runtime.compact).not.toHaveBeenCalled();
 }finally{row.status=status;}
});

it('routes admitted Cursor discovery and work to its official adapter without a Pi fallback',async()=>{
 const f=fixture(),model={id:'cursor-sdk/model',provider:'cursor-sdk',name:'Cursor model'};
 vi.mocked(f.official.runtime.models).mockResolvedValue([model]);expect(await f.runtime.models()).toEqual([model]);
 await f.runtime.start(input(model.id));expect(f.official.runtime.start).toHaveBeenCalledWith(input(model.id));expect(f.pi.runtime.start).not.toHaveBeenCalled();
 await f.runtime.cancel(input(model.id));expect(f.official.runtime.cancel).toHaveBeenCalledWith(input(model.id));
});

it('routes private Cursor history to the official adapter and rejects cross-provider resume',async()=>{
 const f=fixture(),session=join(root,'official','cursor-sdk','tasks','thread','session.json');
 await f.runtime.history(session);expect(f.official.runtime.history).toHaveBeenCalledWith(session);expect(f.pi.runtime.history).not.toHaveBeenCalled();
 await expect(f.runtime.start({...input('claude-code/sonnet'),sessionPath:session})).rejects.toMatchObject({code:'RUNTIME_SESSION_MISMATCH'});
 expect(f.official.runtime.start).not.toHaveBeenCalled();
});
