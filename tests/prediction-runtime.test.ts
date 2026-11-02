import {expect,it,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRuntime} from '../packages/runtime/index.ts';
import {SUBSCRIPTION_PROVIDER_IDS,OFFICIAL_RUNTIME_PROVIDER_IDS} from '../packages/contracts/connections.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {PREDICTION_SYSTEM_PROMPT,PREDICTION_MAX_PROMPT_BYTES} from '../packages/runtime/model-only.ts';
import {createHostResourceLoader} from '../packages/runtime-pi/tool-definitions.ts';
import {createOfficialRuntime} from '../packages/runtime-official/index.ts';
import {openManifest,saveManifest} from '../packages/runtime-official/manifest.ts';

const input=(provider='openai'):StartRun=>({threadId:'prediction-owned',runId:'prediction-run',epoch:1,modelId:provider+'/model',sessionPath:null,inputId:'prediction-input',prompt:'Predict the next user message.',resources:[]});
function native(){let cb!:RuntimeCallbacks;const value:RuntimeAdapter={configure:next=>{cb=next;},models:async()=>[],start:vi.fn(async()=>{}),followUp:vi.fn(async()=>{}),compact:vi.fn(async()=>{}),history:vi.fn(async()=>[]),cancel:vi.fn(async()=>{}),dispose:vi.fn(async()=>{})};return{value,event:(ctx:StartRun,type:string,content:string)=>cb.onEvent({...ctx,type,content}),tool:(ctx:StartRun)=>cb.onTool({name:'read',args:{}},ctx)};}

it.each([...SUBSCRIPTION_PROVIDER_IDS,...OFFICIAL_RUNTIME_PROVIDER_IDS])('forces prediction tool denial for %s without changing the selected route',async provider=>{
 const pi=native(),official=native(),factories={pi:vi.fn(()=>pi.value),official:vi.fn(()=>official.value)},runtime=createRuntime({dataDir:resolve('.harness-prediction-runtime'),purpose:'prediction'},factories),onTool=vi.fn(async()=>null);
 runtime.configure({onEvent:()=>{},onTool});
 try{await runtime.start(input(provider));for(const factory of Object.values(factories))expect(factory).toHaveBeenCalledWith({dataDir:resolve('.harness-prediction-runtime'),modelOnly:true,purpose:'prediction'});const selected=OFFICIAL_RUNTIME_PROVIDER_IDS.includes(provider as any)?official:pi;await expect(selected.tool(input(provider))).rejects.toMatchObject({code:'MODEL_ONLY_TOOL_DENIED'});expect(onTool).not.toHaveBeenCalled();}finally{await runtime.dispose();}
});

it('rejects main-session reuse, memory and oversized prediction context before native submission',async()=>{
 const pi=native(),official=native(),runtime=createRuntime({dataDir:resolve('.harness-prediction-runtime'),purpose:'prediction'},{pi:()=>pi.value,official:()=>official.value});runtime.configure({onEvent:()=>{},onTool:async()=>null});
 try{for(const patch of [{sessionPath:resolve('main-session.json')},{memory:'private task notes'},{prompt:'x'.repeat(PREDICTION_MAX_PROMPT_BYTES+1)}])await expect(runtime.start({...input(),...patch})).rejects.toMatchObject({code:'PREDICTION_INPUT_INVALID'});expect(pi.value.start).not.toHaveBeenCalled();await expect(runtime.history(resolve('main-session.json'))).rejects.toMatchObject({code:'PREDICTION_SESSION_UNSUPPORTED'});expect(pi.value.history).not.toHaveBeenCalled();}finally{await runtime.dispose();}
});

it('rejects oversized prediction output and closes its native owner',async()=>{
 const pi=native(),official=native(),events:unknown[]=[],runtime=createRuntime({dataDir:resolve('.harness-prediction-runtime'),purpose:'prediction'},{pi:()=>pi.value,official:()=>official.value});runtime.configure({onEvent:event=>events.push(event),onTool:async()=>null});
 try{await runtime.start(input());pi.event(input(),'assistant.message','x'.repeat(4097));await vi.waitFor(()=>expect(pi.value.cancel).toHaveBeenCalled());expect(events).toContainEqual(expect.objectContaining({type:'error',code:'PREDICTION_OUTPUT_LIMIT'}));expect(events).not.toContainEqual(expect.objectContaining({type:'assistant.message'}));}finally{await runtime.dispose();}
});

it('uses the real SDK prediction prompt with no tools, resources or persistent conversation',async()=>{
 const sdk=await import('@earendil-works/pi-coding-agent'),dir=await mkdtemp(join(tmpdir(),'prediction-sdk-'));
 const runtime=await sdk.ModelRuntime.create({authPath:join(dir,'empty-auth.json'),modelsPath:null,refreshOnCreate:false}),model=runtime.getModels('openai')[0]!;
 const {session}=await sdk.createAgentSession({cwd:dir,agentDir:dir,modelRuntime:runtime,model,noTools:'all',tools:[],customTools:[],resourceLoader:createHostResourceLoader(sdk,'excluded memory',true,'prediction'),sessionManager:sdk.SessionManager.inMemory(dir),settingsManager:sdk.SettingsManager.inMemory({cacheWarming:'off',retry:{enabled:false},compaction:{enabled:false}})});
 try{expect(session.getActiveToolNames()).toEqual([]);expect(session.getCallableToolNames()).toEqual([]);expect(session.sessionFile).toBeUndefined();expect(session.resourceLoader.getSystemPrompt()).toBe(PREDICTION_SYSTEM_PROMPT);expect(session.resourceLoader.getAppendSystemPrompt()).toEqual([]);expect(session.resourceLoader.getSkills().skills).toEqual([]);}finally{session.dispose();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});
it.each(OFFICIAL_RUNTIME_PROVIDER_IDS)('cannot reopen an existing %s manifest even when sessionPath is null',async provider=>{
 const dir=await mkdtemp(join(tmpdir(),'prediction-fresh-')),manifest=await openManifest(dir,provider,'prediction-owned',null);manifest.value.sessionId='main-session-native-id';await saveManifest(manifest);const before=await readFile(manifest.path,'utf8'),query=vi.fn(),spawn=vi.fn(),runtime=createOfficialRuntime({dataDir:dir,purpose:'prediction'},{claudeSdk:{query} as any,spawn:spawn as any});runtime.configure({onEvent:()=>{},onTool:async()=>null});
 try{await expect(runtime.start(input(provider))).rejects.toMatchObject({code:'PREDICTION_SESSION_UNSUPPORTED'});expect(query).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled();expect(await readFile(manifest.path,'utf8')).toBe(before);}finally{await runtime.dispose();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});
