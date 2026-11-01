import {expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {createRuntime} from '../packages/runtime/index.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {SUBSCRIPTION_PROVIDER_IDS,OFFICIAL_RUNTIME_PROVIDER_IDS} from '../packages/contracts/connections.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHostResourceLoader} from '../packages/runtime-pi/tool-definitions.ts';
import {MODEL_ONLY_SYSTEM_PROMPT} from '../packages/runtime/model-only.ts';

const input=(modelId:string,prompt='Return the supplied model text.'):StartRun=>({threadId:'transport',runId:'transport-run',epoch:1,modelId,sessionPath:null,inputId:'input',prompt,resources:[]});
function adapter(){let callbacks!:RuntimeCallbacks;const value:RuntimeAdapter={configure:next=>{callbacks=next;},models:async()=>[],start:vi.fn(async()=>{}),followUp:async()=>{},cancel:vi.fn(async()=>{}),compact:async()=>{},history:async()=>[],dispose:async()=>{}};return{value,tool:()=>callbacks.onTool({name:'skill_manage',args:{operations:[]}},input('openai/model')),event:(event:Record<string,unknown>)=>callbacks.onEvent({...input('openai/model'),type:'assistant.message',...event})};}
it.each([...SUBSCRIPTION_PROVIDER_IDS,...OFFICIAL_RUNTIME_PROVIDER_IDS])('routes %s as a model-only backend without exposing host tools',async provider=>{
 const pi=adapter(),official=adapter(),factories={pi:vi.fn(()=>pi.value),official:vi.fn(()=>official.value)},callbacks={onEvent:vi.fn(),onTool:vi.fn(async()=>({mustNotRun:true}))};
 const runtime=createRuntime({dataDir:resolve('.harness-model-only-router'),modelOnly:true},factories);runtime.configure(callbacks);
 try{await runtime.start(input(provider+'/model'));for(const factory of Object.values(factories))expect(factory).toHaveBeenCalledWith({dataDir:resolve('.harness-model-only-router'),modelOnly:true});
  const selected=OFFICIAL_RUNTIME_PROVIDER_IDS.includes(provider as any)?official:pi;await expect(selected.tool()).rejects.toMatchObject({code:'MODEL_ONLY_TOOL_DENIED'});expect(callbacks.onTool).not.toHaveBeenCalled();
  const content='<tool_call>{"name":"skill_manage","arguments":{"action":"create"}}</tool_call>\nFull-width text: 日本語';selected.event({content});expect(callbacks.onEvent).toHaveBeenLastCalledWith(expect.objectContaining({content}));
 }finally{await runtime.dispose();}
});
it('keeps the existing default factory option shape unchanged',async()=>{
 const pi=adapter(),official=adapter(),factories={pi:vi.fn(()=>pi.value),official:vi.fn(()=>official.value)};const runtime=createRuntime({dataDir:resolve('.harness-model-only-router')},factories);
 try{for(const factory of Object.values(factories))expect(factory).toHaveBeenCalledWith({dataDir:resolve('.harness-model-only-router')});}finally{await runtime.dispose();}
});
it('bounds the larger model-only prompt before native startup without truncating it',async()=>{
 const pi=adapter(),official=adapter(),runtime=createRuntime({dataDir:resolve('.harness-model-only-router'),modelOnly:true},{pi:()=>pi.value,official:()=>official.value});runtime.configure({onEvent:()=>{},onTool:async()=>null});
 try{await expect(runtime.start(input('openai/model','x'.repeat(16*1024*1024+1)))).rejects.toMatchObject({code:'MODEL_ONLY_INPUT_LIMIT'});await expect(runtime.start(input('openai/model','\u0000'.repeat(6*1024*1024)))).rejects.toMatchObject({code:'MODEL_ONLY_INPUT_LIMIT'});expect(pi.value.start).not.toHaveBeenCalled();
 const prompt='x'.repeat(3*1024*1024);await runtime.start(input('openai/model',prompt));expect(pi.value.start).toHaveBeenCalledWith(expect.objectContaining({prompt}));}finally{await runtime.dispose();}
});
it('configures the installed Pi SDK as a text model with no ambient or host tools',async()=>{
 const sdk=await import('@earendil-works/pi-coding-agent'),directory=await mkdtemp(join(tmpdir(),'hermes-model-only-sdk-'));
 const modelRuntime=await sdk.ModelRuntime.create({authPath:join(directory,'empty-auth.json'),modelsPath:null,refreshOnCreate:false}),model=modelRuntime.getModels('openai')[0]!;
 const {session}=await sdk.createAgentSession({cwd:directory,agentDir:directory,modelRuntime,model,noTools:'all',tools:[],customTools:[],resourceLoader:createHostResourceLoader(sdk,'private host notes',true),sessionManager:sdk.SessionManager.inMemory(directory),settingsManager:sdk.SettingsManager.inMemory({cacheWarming:'off'})});
 try{expect(session.getActiveToolNames()).toEqual([]);expect(session.getCallableToolNames()).toEqual([]);expect(session.resourceLoader.getSystemPrompt()).toBe(MODEL_ONLY_SYSTEM_PROMPT);expect(session.resourceLoader.getAppendSystemPrompt()).toEqual([]);expect(session.resourceLoader.getSkills().skills).toEqual([]);}finally{session.dispose();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
