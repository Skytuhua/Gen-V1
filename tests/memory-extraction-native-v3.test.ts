import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTaskSession} from '../packages/runtime-pi/session.ts';
import {createRuntime} from '../packages/runtime/index.ts';
import {createOfficialRuntime} from '../packages/runtime-official/index.ts';
import {createHostResourceLoader} from '../packages/runtime-pi/tool-definitions.ts';
import {OFFICIAL_RUNTIME_PROVIDER_IDS} from '../packages/contracts/connections.ts';
import * as purpose from '../packages/runtime/model-only.ts';
import type {RuntimeAdapter,StartRun} from '../packages/contracts/index.ts';

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const input:StartRun={threadId:'memory-extraction:fixture',runId:'fixture',epoch:0,modelId:'openai/model',accountId:null,sessionPath:null,inputId:'input',resources:[],prompt:'Declared synthetic auxiliary source cut; never retain a native session copy.'};
async function directory(){const path=await mkdtemp(join(tmpdir(),'memory-ephemeral-'));roots.push(path);return path;}
function native(){const runtime:RuntimeAdapter={configure:()=>{},models:async()=>[],start:vi.fn(async()=>{}),followUp:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),compact:vi.fn(async()=>{}),history:vi.fn(async()=>[]),dispose:vi.fn(async()=>{})};return runtime;}

it('keeps the actual native extraction transcript in memory with no session artifact',async()=>{
 const root=await directory(),session=await openTaskSession(root,input,'memory-extraction');
 session.appendMessage({role:'user',content:input.prompt,timestamp:1});
 session.appendMessage({role:'assistant',content:[{type:'text',text:'[]'}],api:'openai-responses',provider:'openai',model:'model',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:2});
 expect(session.isPersisted()).toBe(false);expect(session.getSessionFile()).toBeUndefined();
 expect(session.getEntries()).toHaveLength(2);expect(await readdir(root,{recursive:true})).toEqual([]);
 await expect(openTaskSession(root,{...input,sessionPath:join(root,'old-session.jsonl')},'memory-extraction')).rejects.toMatchObject({code:'MEMORY_EXTRACTION_SESSION_UNSUPPORTED'});
});

it('constructs the actual pinned SDK extraction session with no native tools, ambient notes, or history file',async()=>{
 const root=await directory(),sdk=await import('@earendil-works/pi-coding-agent');
 const modelRuntime=await sdk.ModelRuntime.create({authPath:join(root,'empty-auth.json'),modelsPath:null,refreshOnCreate:false}),model=modelRuntime.getModels('openai')[0]!;
 const {session}=await sdk.createAgentSession({cwd:root,agentDir:root,modelRuntime,model,noTools:'all',tools:[],customTools:[],resourceLoader:createHostResourceLoader(sdk,'excluded source-external notes',true,'memory-extraction'),sessionManager:await openTaskSession(root,input,'memory-extraction'),settingsManager:sdk.SettingsManager.inMemory({cacheWarming:'off',retry:{enabled:false},compaction:{enabled:false}})});
 try{
  expect(session.getActiveToolNames()).toEqual([]);expect(session.getCallableToolNames()).toEqual([]);expect(session.sessionFile).toBeUndefined();
  expect(session.resourceLoader.getSystemPrompt()).toBe(purpose.MEMORY_EXTRACTION_SYSTEM_PROMPT);expect(session.resourceLoader.getAppendSystemPrompt()).toEqual([]);expect(session.resourceLoader.getSkills().skills).toEqual([]);
 }finally{session.dispose();}
});

it.each(OFFICIAL_RUNTIME_PROVIDER_IDS)('rejects direct %s extraction before opening a native artifact or provider',async provider=>{
 const root=await directory(),query=vi.fn(),spawn=vi.fn(),runtime=createOfficialRuntime({dataDir:root,purpose:'memory-extraction'},{claudeSdk:{query} as never,spawn:spawn as unknown as typeof spawn});
 runtime.configure({onEvent:()=>{},onTool:async()=>{}});
 try{
  await expect(runtime.start({...input,modelId:provider+'/model'})).rejects.toMatchObject({code:'MEMORY_EXTRACTION_UNSUPPORTED'});
  expect(query).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled();expect(await readdir(root,{recursive:true})).toEqual([]);
 }finally{await runtime.dispose();}
});

it('adopts only the explicit ephemeral Pi purpose and rejects external source dispatch',async()=>{
 const root=await directory(),pi=native(),official=native(),factories={pi:vi.fn(()=>pi),official:vi.fn(()=>official)};
 const runtime=createRuntime({dataDir:root,purpose:'memory-extraction'},factories);runtime.configure({onEvent:()=>{},onTool:async()=>{throw Error('No extraction tools');}});
 try{
  for(const factory of Object.values(factories))expect(factory).toHaveBeenCalledWith({dataDir:root,modelOnly:true,purpose:'memory-extraction'});
  await expect(runtime.start({...input,modelId:'claude-code/model'})).rejects.toMatchObject({code:'MEMORY_EXTRACTION_UNSUPPORTED'});expect(official.start).not.toHaveBeenCalled();
  await runtime.start(input);expect(pi.start).toHaveBeenCalledOnce();await runtime.cancel(input);
  await expect(runtime.followUp(input)).rejects.toMatchObject({code:'MEMORY_EXTRACTION_SESSION_UNSUPPORTED'});
  await expect(runtime.compact(input,join(root,'old-session'),'openai/model')).rejects.toMatchObject({code:'MEMORY_EXTRACTION_SESSION_UNSUPPORTED'});
  await expect(runtime.history(join(root,'old-session'))).rejects.toMatchObject({code:'MEMORY_EXTRACTION_SESSION_UNSUPPORTED'});
 }finally{await runtime.dispose();}
});

it('offers admission before the auxiliary factory can claim a model call',()=>{
 const check=(purpose as {assertMemoryExtractionModel:(modelId:string)=>void}).assertMemoryExtractionModel;
 expect(typeof check).toBe('function');expect(()=>check('openai/model')).not.toThrow();
 for(const modelId of ['claude-code/model','gemini-cli/model','cursor-sdk/model','unregistered/model'])expect(()=>check(modelId)).toThrow(expect.objectContaining({code:'MEMORY_EXTRACTION_UNSUPPORTED'}));
});

it('bounds the fresh extraction input and uses extraction instructions without native tool delegation',()=>{
 expect(()=>purpose.assertModelOnlyInput(input,'memory-extraction')).not.toThrow();
 for(const changed of [{sessionPath:'/old/history'},{memory:'old notes'},{prompt:'x'.repeat(70*1024)},{resources:[{id:'grant'}]}])expect(()=>purpose.assertModelOnlyInput({...input,...changed} as StartRun,'memory-extraction')).toThrow();
 expect(purpose.modelOnlySystemPrompt('memory-extraction')).toMatch(/JSON/);expect(purpose.modelOnlySystemPrompt('memory-extraction')).not.toContain('<tool_call>');
});
