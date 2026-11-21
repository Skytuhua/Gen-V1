import {expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {createRuntime} from '../packages/runtime/index.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {SUBSCRIPTION_PROVIDER_IDS,OFFICIAL_RUNTIME_PROVIDER_IDS} from '../packages/contracts/connections.ts';

const input=(modelId:string,prompt='Rewrite the draft.'):StartRun=>({threadId:'enhance',runId:'enhance-run',epoch:1,modelId,sessionPath:null,inputId:'input',prompt,resources:[]});
function adapter(){let callbacks!:RuntimeCallbacks;const value:RuntimeAdapter={configure:next=>{callbacks=next;},models:async()=>[],start:vi.fn(async()=>{}),followUp:async()=>{},cancel:vi.fn(async()=>{}),compact:async()=>{},history:async()=>[],dispose:async()=>{}};return{value,tool:()=>callbacks.onTool({name:'skill_manage',args:{operations:[]}},input('openai/model')),event:(event:Record<string,unknown>)=>callbacks.onEvent({...input('openai/model'),type:'assistant.message',...event})};}

it.each([...SUBSCRIPTION_PROVIDER_IDS])('routes %s as a bounded enhancement transport without host tools',async provider=>{
 const pi=adapter(),official=adapter(),factories={pi:vi.fn(()=>pi.value),official:vi.fn(()=>official.value)},callbacks={onEvent:vi.fn(),onTool:vi.fn(async()=>({mustNotRun:true}))};
 const runtime=createRuntime({dataDir:resolve('.harness-enhance-router'),modelOnly:true,purpose:'composer-enhance'},factories);runtime.configure(callbacks);
 try{await runtime.start(input(provider+'/model'));expect(factories.pi).toHaveBeenCalledWith({dataDir:resolve('.harness-enhance-router'),modelOnly:true,purpose:'composer-enhance'});expect(official.value.start).not.toHaveBeenCalled();
  await expect(pi.tool()).rejects.toMatchObject({code:'MODEL_ONLY_TOOL_DENIED'});expect(callbacks.onTool).not.toHaveBeenCalled();
  pi.event({content:'{"draft":"x"}'});expect(callbacks.onEvent).toHaveBeenLastCalledWith(expect.objectContaining({content:'{"draft":"x"}'}));
 }finally{await runtime.dispose();}
});

it.each([...OFFICIAL_RUNTIME_PROVIDER_IDS,'other'])('rejects enhancement on non-subscription provider %s before reserving an adapter',async provider=>{
 const pi=adapter(),official=adapter(),runtime=createRuntime({dataDir:resolve('.harness-enhance-router'),modelOnly:true,purpose:'composer-enhance'},{pi:()=>pi.value,official:()=>official.value});
 try{await expect(runtime.start(input(provider+'/model'))).rejects.toMatchObject({code:'ENHANCE_UNSUPPORTED'});}finally{await runtime.dispose();}
});

it('rejects session-bearing, resourced or oversized enhancement inputs',async()=>{
 const pi=adapter(),runtime=createRuntime({dataDir:resolve('.harness-enhance-router'),modelOnly:true,purpose:'composer-enhance'},{pi:()=>pi.value,official:()=>pi.value});
 const base=input('openai/model');
 try{
  for(const bad of [{...base,sessionPath:'native/session'},{...base,resources:[{id:'r'} as never]},{...base,memory:'x' as never},{...base,memoryCheckpoint:{} as never},{...base,prompt:'x'.repeat(45*1024)}])
   await expect(runtime.start(bad)).rejects.toMatchObject({code:'ENHANCE_INPUT_INVALID'});
 }finally{await runtime.dispose();}
});

it('cannot continue, compact or read a conversation and caps model output',async()=>{
 const pi=adapter(),callbacks={onEvent:vi.fn(),onTool:vi.fn(async()=>({}))},runtime=createRuntime({dataDir:resolve('.harness-enhance-router'),modelOnly:true,purpose:'composer-enhance'},{pi:()=>pi.value,official:()=>pi.value});
 runtime.configure(callbacks);const run=input('openai/model');
 try{await runtime.start(run);
  await expect(runtime.followUp({...run,prompt:'more'})).rejects.toMatchObject({code:'ENHANCE_SESSION_UNSUPPORTED'});
  await expect(runtime.compact(run,'native/session','openai/model',null)).rejects.toMatchObject({code:'ENHANCE_SESSION_UNSUPPORTED'});
  await expect(runtime.history('native/session')).rejects.toMatchObject({code:'ENHANCE_SESSION_UNSUPPORTED'});
  pi.event({content:'x'.repeat(25*1024)});
  expect(callbacks.onEvent).toHaveBeenCalledWith(expect.objectContaining({code:'ENHANCE_OUTPUT_LIMIT'}));
 }finally{await runtime.dispose();}
});
