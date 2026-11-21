import {expect,it,vi} from 'vitest';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import type {RuntimeAdapter,RuntimeCallbacks,RuntimeEvent,StartRun} from '../packages/contracts/index.ts';
import type {MemoryCheckpointAckV1,MemoryCheckpointRequestV1} from '../packages/contracts/memory-checkpoint.ts';
import {NATIVE_COMPACTION_CAPABILITY,nativeCompactionPlanSchema,type NativeCompactionOwnerV1,type NativeCompactionPlanV1,type NativeCompactionEnvelopeV1,type NativeCompactionReceiptV1,type NativeCompactionAckV1} from '../packages/contracts/native-compaction.ts';
import {createHermesRuntime,type HermesRuntimeOptions,type HermesSourceClient} from '../packages/runtime-hermes/index.ts';
import type {HermesClient,HermesEvent} from '../packages/runtime-hermes/client.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import {encodeInput} from '../packages/runtime-pi/input-envelope.ts';
import {createHash} from 'node:crypto';
import {projectContextGrantDigest} from '../packages/core/approved-project-context.ts';
import {REPOSITORY_MAP} from '../packages/core/repository-map-tool.ts';
import {PROGRAM_TOOLS} from '../packages/core/tool-program-tools.ts';

it('passes host-selected bounded program tools to Hermes while keeping its native transport model-only',async()=>{
 const f=await fixture();try{await f.runtime.start(run({programTools:[...PROGRAM_TOOLS]}));
 expect((f.start().hostTools as {name:string}[]).map(tool=>tool.name)).toEqual(['host_task',...PROGRAM_TOOLS.map(tool=>tool.name)]);
 f.event('model_request',{sequence:1,inputIds:['input']});
 const response=fetch(f.start().brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+f.start().jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'acp',modelId:'openai/model',prompt:'Program aggregation transcript'})});
 await vi.waitFor(()=>expect(f.natives[0]?.input).toBeDefined());const n=f.natives[0];expect(n.input.programTools).toBeUndefined();n.callbacks.onEvent({...n.input,type:'assistant.message',content:'text'});n.callbacks.onEvent({...n.input,type:'settled'});expect((await response).status).toBe(200);await f.settle();
}finally{await f.runtime.dispose();}
});

it('passes owned project instruction bytes only through the native system prefix and rejects changed active-turn instructions',async()=>{
 const f=await fixture({systemPrompt:'Host policy'}),input=run(),text='\nApproved project instructions: preserve the API.';
 const context=(value:string):NonNullable<StartRun['approvedProjectContext']>=>({version:1,owner:{threadId:input.threadId,runId:input.runId,epoch:input.epoch,modelId:input.modelId,accountId:null},grantDigest:projectContextGrantDigest(input.resources),instructionText:value,instructionDigest:createHash('sha256').update(value).digest('hex'),instructions:{entries:[],duplicates:[],overlaps:[],exclusions:[],omittedRoots:0,precedence:'fixture'}});
 try{
  const approvedProjectContext=context(text);await f.runtime.start({...input,approvedProjectContext});
  expect(f.start().systemPrompt).toBe('Host policy'+text);expect(f.start().prompt).not.toContain(text);
  await f.runtime.followUp({...input,inputId:'next',approvedProjectContext});
  const before=f.source().calls.filter(call=>call.method==='agent.followUp').length;
  await expect(f.runtime.followUp({...input,inputId:'changed',approvedProjectContext:context(text+' Changed.')})).rejects.toMatchObject({code:'STALE_REQUEST_CONTEXT'});
  await expect(f.runtime.followUp({...input,inputId:'forged',approvedProjectContext:{...approvedProjectContext,instructionText:'Replaced without a digest'}})).rejects.toMatchObject({code:'STALE_REQUEST_CONTEXT'});
  expect(f.source().calls.filter(call=>call.method==='agent.followUp')).toHaveLength(before);await f.settle();
 }finally{await f.runtime.dispose();}
});

it('keeps private completed-write metadata off the default/company path and model envelope',async()=>{
 const f=await fixture(),input=run({completedWrites:[{operationId:'op',revision:1,inputId:'operation-result:op',origin:{threadId:'thread',runId:'before',epoch:0,sessionPath:'not-admitted',modelId:'openai/model',accountId:null,projectId:'project',workspaceId:'worktree',projectRoot:'C:/private-project'},path:'C:/private-project/App.tsx',sha256:'a'.repeat(64),bytes:1}]});
 try{await f.runtime.start(input);expect(f.start()).not.toHaveProperty('completedWrites');expect(f.start().prompt).not.toContain('private-project');await expect(f.runtime.followUp({...input,inputId:'next'})).rejects.toMatchObject({code:'HERMES_INPUT_INVALID'});await f.settle();}finally{await f.runtime.dispose();}
});
it('passes only a matching idle receipt through the optional host channel and rejects stale delivery',async()=>{
 const f=await fixture({approvedWriteHooks:true,projectRoot:'C:/private-project'});
 try{
 await f.runtime.start(run());const session=f.start().sessionPath as string;await f.settle();
 const input=run({runId:'after',epoch:2,inputId:'operation-result:op',sessionPath:session}),receipt={operationId:'op',revision:1,inputId:input.inputId,origin:{threadId:input.threadId,runId:'run',epoch:1,modelId:input.modelId,accountId:null,sessionPath:session,projectId:'project',workspaceId:'workspace',projectRoot:'C:/private-project'},delivery:{threadId:input.threadId,runId:input.runId,epoch:input.epoch},path:'C:/private-project/App.tsx',sha256:'a'.repeat(64),bytes:1};
 await f.runtime.start({...input,completedWrites:[receipt]});expect(f.start().completedWrites).toEqual([receipt]);expect(f.start().prompt).not.toContain('private-project');await f.settle();
 await f.runtime.start({...input,runId:'changed',epoch:3,inputId:'operation-result:op',completedWrites:[receipt]});expect(f.start().completedWrites).toEqual([]);expect(f.events).toContainEqual(expect.objectContaining({type:'write.hook',diagnostic:expect.objectContaining({status:'stale'})}));await f.settle();
 }finally{await f.runtime.dispose();}
});

const run=(extra:Partial<StartRun>={}):StartRun=>({threadId:'thread',runId:'run',epoch:1,inputId:'input',modelId:'openai/model',accountId:null,sessionPath:null,prompt:'Original user prompt',resources:[],...extra});
const automaticRequirement={apiVersion:1,required:true} as const;
const automaticCapability={apiVersion:1,strategy:'REFUSE_UNPROTECTED_FOREGROUND'} as const;
it.each([undefined,{apiVersion:1,strategy:'OTHER'},{apiVersion:2,strategy:'REFUSE_UNPROTECTED_FOREGROUND'}])('rejects required automatic compaction containment without the exact worker capability %j',async capability=>{
 const f=await fixture({},undefined,undefined,undefined,capability);
 try{
  await expect(f.runtime.start(run({automaticCompactionProtection:automaticRequirement}))).rejects.toMatchObject({code:'HERMES_AUTOMATIC_COMPACTION_UNSUPPORTED'});
  expect(f.source().calls.some(call=>call.method==='agent.start')).toBe(false);
  expect(f.accounts.claimUse).not.toHaveBeenCalled();
 }finally{await f.runtime.dispose();}
});
it('routes the captured automatic compaction requirement privately and rejects changed active-turn policy',async()=>{
 const f=await fixture({},undefined,undefined,undefined,automaticCapability),input=run({automaticCompactionProtection:automaticRequirement});
 try{
  await f.runtime.start(input);
  expect(f.start().automaticCompactionProtection).toEqual(automaticRequirement);
  expect(f.start().prompt).toBe(encodeInput(run()));
  await expect(f.runtime.followUp(run({inputId:'changed',prompt:'Follow up'}))).rejects.toMatchObject({code:'HERMES_AUTOMATIC_COMPACTION_OWNER'});
  expect(f.source().calls.some(call=>call.method==='agent.followUp')).toBe(false);
  await f.runtime.followUp({...input,inputId:'admitted',prompt:'Follow up',automaticCompactionProtection:{required:true,apiVersion:1}});
  expect(f.source().calls.filter(call=>call.method==='agent.followUp')).toHaveLength(1);
  await f.settle();
 }finally{await f.runtime.dispose();}
});
it('reports only an owned automatic compaction refusal without publishing applied progress',async()=>{
 const f=await fixture({},undefined,undefined,undefined,automaticCapability),input=run({automaticCompactionProtection:automaticRequirement});
 try{
  await f.runtime.start(input);
  const refusal={version:1,status:'REFUSED',reason:'AUTOMATIC_PROTECTION_UNAVAILABLE',method:'compress',trigger:'pre_api',
   owner:{ctx:{threadId:input.threadId,runId:input.runId,epoch:input.epoch},sessionPath:f.start().sessionPath,modelId:input.modelId,accountId:null}};
  f.event('compaction_refused',refusal);
  expect(f.events.filter(value=>value.type==='context.compaction.refused')).toEqual([expect.objectContaining({refusal})]);
  expect(f.events.some(value=>value.type==='activity'&&String(value.message).includes('Automatic compaction was refused'))).toBe(true);
  for(const malformed of [{...refusal,status:'APPLIED'},{...refusal,owner:{...refusal.owner,sessionPath:'another-source'}},{...refusal,owner:{...refusal.owner,ctx:{...refusal.owner.ctx,runId:'other'}}}])f.event('compaction_refused',malformed);
  f.event('compaction_refused',refusal,'background_review');
  expect(f.events.filter(value=>value.type==='context.compaction.refused')).toHaveLength(1);
  expect(f.events.some(value=>value.type==='compaction.start'||value.type==='compaction.end')).toBe(false);
  await f.settle();
 }finally{await f.runtime.dispose();}
});
it('leaves automatic compaction policy absent when the host did not require it',async()=>{
 const f=await fixture();try{await f.runtime.start(run());expect(f.start()).not.toHaveProperty('automaticCompactionProtection');await f.settle();}finally{await f.runtime.dispose();}
});
it('awaits the current host owner at actual foreground dispatch and refuses a late admission after settlement',async()=>{
 __setCapabilityFlagForTests('context.compilerV1',true);
 const f=await fixture();let release!:()=>void;const admit=vi.fn(()=>new Promise<void>(done=>{release=done;}));
 f.runtime.configure({onEvent:event=>f.events.push(event),onTool:async()=>({}),onBeforeInference:admit});
 try{
  await f.runtime.start(run());expect(admit).not.toHaveBeenCalled();
  f.event('model_request',{sequence:1,inputIds:['input']});expect(admit).not.toHaveBeenCalled();
  const response=fetch(f.start().brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+f.start().jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'acp',modelId:'openai/model',prompt:'Actual flattened request'})});
  await vi.waitFor(()=>expect(admit).toHaveBeenCalledExactlyOnceWith({ctx:{threadId:'thread',runId:'run',epoch:1},modelId:'openai/model',accountId:null,thinkingLevel:null,sequence:1,inputIds:['input']}));
  expect(f.natives).toHaveLength(0);f.event('foreground_settled',{text:'Owner completed'});release();
  expect((await response).status).toBe(400);expect(f.natives).toHaveLength(0);await f.settle();
 }finally{release?.();__setCapabilityFlagForTests('context.compilerV1',undefined);await f.runtime.dispose();}
});
it('requires the host admission callback when foreground context coordination is enabled',async()=>{
 __setCapabilityFlagForTests('context.compilerV1',true);const f=await fixture();
 f.runtime.configure({onEvent:event=>f.events.push(event),onTool:async()=>({})});
 try{
  await f.runtime.start(run());f.event('model_request',{sequence:1,inputIds:['input']});let status:number|undefined;
  const response=fetch(f.start().brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+f.start().jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'acp',modelId:'openai/model',prompt:'Actual flattened request'})}).then(value=>{status=value.status;return value;});
  await vi.waitFor(()=>expect(status!==undefined||f.natives[0]?.input!==undefined).toBe(true));
  if(f.natives[0]?.input)f.natives[0].callbacks.onEvent({...f.natives[0].input,type:'settled'});
  expect((await response).status).toBe(400);expect(f.natives).toHaveLength(0);await f.settle();
 }finally{__setCapabilityFlagForTests('context.compilerV1',undefined);await f.runtime.dispose();}
});
it('compiles an owned native source delta only at its real broker request and preserves opaque provider context',async()=>{
 __setCapabilityFlagForTests('context.compilerV1',true);
 const f=await fixture({},undefined,{apiVersion:1,source:'original-acp-messages'}),hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 try{
  await f.runtime.start(run());const capture=f.start().contextCapture as {apiVersion:number;bindingDigest:string};expect(capture.apiVersion).toBe(1);
  const sources=[{sequence:0,id:'native:1:0',revision:1,category:'SYSTEM',utf8Bytes:20,sha256:hash('native system')},{sequence:1,id:'native:1:1',revision:1,category:'USER',utf8Bytes:30,sha256:hash('native user')}],schemaDigest='e'.repeat(64);
  const cut={version:1,status:'AVAILABLE',bindingDigest:capture.bindingDigest,schemaDigest,generation:1,previousDigest:null,revisionDigest:hash([capture.bindingDigest,schemaDigest,1,sources.map(source=>[source.sha256,source.utf8Bytes,source.category])]),sourceCount:2,sourceBytes:50,reusedSources:0,inspectedSources:2,sources,change:'RESET',newToolResults:null,newToolResultBytes:null};
  f.event('model_request',{sequence:1,inputIds:['input'],nativeContextCut:cut});expect(f.events.some(event=>event.type==='context.request')).toBe(false);
  const post=()=>fetch(f.start().brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+f.start().jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'acp',modelId:'openai/model',prompt:'Opaque actual broker input'})});
  const first=post();await vi.waitFor(()=>expect(f.natives[0]?.input).toBeDefined());
  expect(f.events.find(event=>event.type==='context.request')).toMatchObject({sequence:1,promptBytes:26,nativeSources:{source:'ORIGINAL_ACP_MESSAGES',reusedSources:0,compiledSources:2}});
  expect(f.natives[0].input.prompt).toBe('Opaque actual broker input');expect(f.natives[0].input).not.toHaveProperty('nativeContextCut');
  f.natives[0].callbacks.onEvent({...f.natives[0].input,type:'usage',usage:{inputTokens:12,outputTokens:9,cacheReadTokens:80,contextTokens:5000,contextWindow:10000}});
  f.natives[0].callbacks.onEvent({...f.natives[0].input,type:'settled'});expect((await first).status).toBe(200);
  const tool={sequence:2,id:'native:1:2',revision:1,category:'TOOL',utf8Bytes:40,sha256:hash('native tool')},all=[...sources,tool];
  const next={...cut,previousDigest:cut.revisionDigest,revisionDigest:hash([capture.bindingDigest,schemaDigest,1,all.map(source=>[source.sha256,source.utf8Bytes,source.category])]),sourceCount:3,sourceBytes:90,reusedSources:2,inspectedSources:3,sources:[tool],change:'APPEND',newToolResults:1,newToolResultBytes:40};
  f.event('model_request',{sequence:2,inputIds:['input'],nativeContextCut:next});const second=post();await vi.waitFor(()=>expect(f.natives[1]?.input).toBeDefined());
  expect(f.events.filter(event=>event.type==='context.request').at(-1)).toMatchObject({sequence:2,nativeSources:{sourceCount:3,reusedSources:2,compiledSources:1,newToolResultBytes:40}});
  expect(f.events.filter(event=>event.type==='context.budget').at(-1)).toMatchObject({provider:'hermes',budget:{sequence:2,measurement:'BYTE_ONLY',sourceContinuity:'VERIFIED',newSourceBytes:40,newToolResultBytes:40,newToolResults:1,previousRequest:{sequence:1,inputTokens:12,cacheReadTokens:80,reportedContextTokens:5000},normalizedInputTokens:null,reservedOutputTokens:null,requiredTokens:null}});
  f.natives[1].callbacks.onEvent({...f.natives[1].input,type:'settled'});expect((await second).status).toBe(200);
  expect(()=>f.event('model_request',{sequence:3,inputIds:['input'],nativeContextCut:{...next,bindingDigest:'f'.repeat(64)}})).toThrow('native context cut');
  await f.settle();
 }finally{__setCapabilityFlagForTests('context.compilerV1',undefined);await f.runtime.dispose();}
});
async function fixture(extra:Partial<HermesRuntimeOptions>={},checkpointCapability?:unknown,contextCapability?:unknown,compactionCapability?:unknown,automaticCapability?:unknown){
 const dataDir=await mkdtemp(join(tmpdir(),'hermes-runtime-')),events:RuntimeEvent[]=[],sourceEvents:HermesEvent[]=[],sources:{options:ConstructorParameters<typeof HermesClient>[0];calls:{method:string;params:Record<string,unknown>}[];client:HermesSourceClient}[]=[],natives:{callbacks:RuntimeCallbacks;input:StartRun;runtime:RuntimeAdapter}[]=[];
 const accounts={get:()=>null,claimUse:vi.fn(()=>({id:'lease',nonce:'nonce'})),releaseUse:vi.fn()},catalog:RuntimeAdapter={configure(){},models:vi.fn(async()=>[]),start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:vi.fn(async()=>['old-receipt']),dispose:vi.fn(async()=>{})};
 const runtime=createHermesRuntime({dataDir,nativeCatalog:catalog,accounts,hostTools:[{name:'skills_list',description:'old',parameters:{}},{name:'host_task',description:'host',parameters:{type:'object'}}],onSourceEvent:event=>sourceEvents.push(event),...extra},{createClient(options){const entry={options,calls:[] as {method:string;params:Record<string,unknown>}[],client:{} as HermesSourceClient};entry.client={request:vi.fn(async(method:string,params:Record<string,unknown>={})=>{entry.calls.push({method,params});if(method==='hello')return{protocolVersion:1,engineClass:'run_agent.AIAgent',sourceCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7',...(checkpointCapability===undefined?{}:{memoryCheckpoint:checkpointCapability}),...(contextCapability===undefined?{}:{contextCapture:contextCapability}),...(compactionCapability===undefined?{}:{compactionProtection:compactionCapability}),...(automaticCapability===undefined?{}:{automaticCompactionProtection:automaticCapability})} as never;if(method==='agent.start'||method==='agent.followUp'||method==='agent.cancel')return{accepted:true} as never;if(method==='agent.compact')return{compacted:true} as never;return{} as never;}),dispose:vi.fn(async()=>{})};sources.push(entry);return entry.client;},createNativeRuntime(value){expect(value).toMatchObject({dataDir,accounts,modelOnly:true});const entry={} as typeof natives[number];entry.runtime={configure:next=>{entry.callbacks=next;},models:async()=>[],start:vi.fn(async input=>{entry.input=input;}),followUp:async()=>{},cancel:vi.fn(async()=>{}),compact:async()=>{},history:async()=>[],dispose:vi.fn(async()=>{})};natives.push(entry);return entry.runtime;}});
 runtime.configure({onEvent:event=>events.push(event),onTool:vi.fn(async()=>({ok:true})),onBeforeInference:()=>{}});
 const source=()=>sources.at(-1)!,start=()=>source().calls.filter(call=>call.method==='agent.start').at(-1)!.params;
 const event=(name:string,data:Record<string,unknown>={},phase='foreground')=>source().options.onEvent?.({event:name,ctx:{...(start().ctx as Record<string,unknown>),phase},data});
 const settle=async(data:Record<string,unknown>={})=>{event('foreground_settled',data);event('settled',data);await vi.waitFor(()=>expect(runtime.reviewBusy).toBe(false));};
 return{runtime,events,sourceEvents,sources,natives,catalog,accounts,source,start,event,settle,dataDir};
}
it('boots the shared source for library recovery, captures async settings and excludes legacy skill schemas',async()=>{
 const f=await fixture({settings:async()=>({config:{skills:{creation_nudge_interval:7}},skillPolicy:{enabled:true,allowWrites:false},systemPrompt:'captured system'})});try{
 await f.runtime.sourceRequest('skills.list');expect(f.source().calls[0]).toMatchObject({method:'hello',params:{acpCommand:process.execPath,config:{skills:{creation_nudge_interval:7}}}});
 await f.runtime.start(run());expect(f.start()).toMatchObject({prompt:encodeInput(run()),modelId:'openai/model',accountId:null,systemPrompt:'captured system',skillPolicy:{enabled:true,allowWrites:false},hostTools:[{name:'host_task'}]});expect(f.start().jobKey).toMatch(/^[A-Za-z0-9_-]{16,256}$/);expect(f.source().calls[0].params.acpArgs).not.toContain(f.start().jobKey);await f.settle();
 }finally{await f.runtime.dispose();}expect(f.catalog.dispose).toHaveBeenCalledOnce();
});
it('builds the original learn prompt while the foreground keeps its captured source owner',async()=>{
 const f=await fixture();try{await f.runtime.start(run());await expect(f.runtime.sourceRequest('learn.prompt',{request:'the current workflow'})).resolves.toEqual({});expect(f.source().calls).toContainEqual({method:'learn.prompt',params:{request:'the current workflow'}});expect(f.runtime.sourceBusy).toBe(true);await f.settle();}finally{await f.runtime.dispose();}
});
it('closes actual source and catalog owners when a graceful dispose acknowledgement fails',async()=>{
 const f=await fixture();await f.runtime.sourceRequest('skills.list');const source=f.source().client,request=source.request.bind(source);
 source.request=async<T>(method:string,params?:Record<string,unknown>)=>{if(method==='agent.dispose')throw Error('Synthetic worker already exited');return request<T>(method,params);};
 await expect(f.runtime.dispose()).resolves.toBeUndefined();expect(source.dispose).toHaveBeenCalledOnce();expect(f.catalog.dispose).toHaveBeenCalledOnce();
});
it('maps only actual native receipts and returns actual usage to the original source client',async()=>{
 const f=await fixture();try{await f.runtime.start(run());f.event('model_request',{sequence:1,inputIds:['input']});expect(f.events.some(event=>event.type==='input.processing')).toBe(false);
 const response=fetch(f.start().brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+f.start().jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'acp',modelId:'openai/model',prompt:'Original Hermes transcript <tool_call>'})});await vi.waitFor(()=>expect(f.natives).toHaveLength(1));const n=f.natives[0];await vi.waitFor(()=>expect(n.input).toBeDefined());n.callbacks.onEvent({...n.input,type:'input.processing',inputIds:[n.input.inputId]});n.callbacks.onEvent({...n.input,type:'assistant.message',content:'native text'});n.callbacks.onEvent({...n.input,type:'usage',usage:{inputTokens:11,outputTokens:3,cost:null}});n.callbacks.onEvent({...n.input,type:'agent_end'});expect(f.events.some(event=>event.type==='settled')).toBe(false);n.callbacks.onEvent({...n.input,type:'settled'});expect((await response).status).toBe(200);
 expect(f.events.find(event=>event.type==='input.processing')?.inputIds).toEqual(['input']);const actual=await f.source().options.onHostCall?.({id:'usage',name:'$transport.usage',args:{jobKey:f.start().jobKey,sequence:1},ctx:f.start().ctx as Record<string,unknown>});expect(actual).toMatchObject({inputTokens:11,outputTokens:3});
 await writeFile(f.start().sessionPath as string,JSON.stringify({format:'hermes-source-session-v1',sourceCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7',ownership:{threadId:'thread',accountId:null,sessionPath:f.start().sessionPath,sourceCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7'},messages:[]}));expect(await f.runtime.history(f.start().sessionPath as string)).toEqual(['input']);await f.settle({text:'Original Hermes final response'});
 }finally{await f.runtime.dispose();}
});
it('holds the account through the actual review barrier and settles the UI only once',async()=>{
 const f=await fixture();try{await f.runtime.start(run());f.event('foreground_settled',{text:'done'});f.event('review_started');expect(f.runtime.sourceBusy).toBe(false);expect(f.runtime.reviewBusy).toBe(true);expect(f.accounts.releaseUse).not.toHaveBeenCalled();
 let accepted=false;const next=f.runtime.start(run({runId:'second',epoch:2,inputId:'second'})).then(()=>{accepted=true;});await Promise.resolve();expect(accepted).toBe(false);f.event('review_settled');f.event('settled');await next;expect(f.accounts.releaseUse).toHaveBeenCalledOnce();expect(f.events.filter(event=>event.type==='settled'&&event.runId==='run')).toHaveLength(1);await f.settle();
 }finally{await f.runtime.dispose();}
});
it('buffers steering without claiming entry and denies changed account/model ownership',async()=>{
 const f=await fixture();try{await f.runtime.start(run());await f.runtime.followUp(run({inputId:'follow',prompt:'next'}));expect(f.events.some(event=>event.type==='input.processing')).toBe(false);await expect(f.runtime.followUp(run({inputId:'wrong',accountId:'different'}))).rejects.toMatchObject({code:'HERMES_STALE_RUN'});await expect(f.runtime.followUp(run({inputId:'wrong',modelId:'other/model'}))).rejects.toMatchObject({code:'HERMES_STALE_RUN'});await f.settle({unconsumedInputIds:['follow']});}finally{await f.runtime.dispose();}
});
it('does not release ownership on a cancellation acknowledgement before actual source settlement',async()=>{
 const f=await fixture();try{await f.runtime.start(run());let finished=false;const cancelling=f.runtime.cancel(run()).then(()=>{finished=true;});await vi.waitFor(()=>expect(f.source().calls.some(call=>call.method==='agent.cancelBackground')).toBe(true));expect(finished).toBe(false);expect(f.accounts.releaseUse).not.toHaveBeenCalled();f.event('settled',{cancelled:true});await cancelling;expect(f.accounts.releaseUse).toHaveBeenCalledOnce();}finally{await f.runtime.dispose();}
});
it('rejects compaction of a different retained task, account or model',async()=>{
 const f=await fixture();try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();for(const value of [run({threadId:'different'}),run({accountId:'different'}),run({modelId:'other/model'})])await expect(f.runtime.compact(value,path,value.modelId,value.accountId)).rejects.toMatchObject({code:'HERMES_SESSION_INVALID'});expect(f.source().calls.some(call=>call.method==='agent.compact')).toBe(false);
 await f.runtime.compact(run({runId:'compact',epoch:2}),path,'openai/model',null);expect(f.source().calls.filter(call=>call.method==='agent.compact')).toHaveLength(1);
 }finally{await f.runtime.dispose();}
});
it.each([undefined,'d'.repeat(64)])('does not publish successful compaction when the native source reports no change (digest %s)',async expectedHistorySha256=>{
 const f=await fixture();try{
  await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();
  const source=f.source(),request=source.client.request.bind(source.client);
  source.client.request=async<T>(method:string,params:Record<string,unknown>={})=>method==='agent.compact'?{compacted:false,messages:[]} as T:request<T>(method,params);
  const ctx=run({runId:'compact-no-change',epoch:2});
  await expect(f.runtime.compact(ctx,path,'openai/model',null,undefined,expectedHistorySha256)).rejects.toMatchObject({code:'HERMES_COMPACTION_UNCONFIRMED'});
  expect(f.events.filter(event=>event.runId===ctx.runId&&['compaction.end','settled'].includes(event.type))).toEqual([]);
 }finally{await f.runtime.dispose();}
});
const requiredCheckpoint={apiVersion:2,required:true} as const;
const checkpointAck=(request:MemoryCheckpointRequestV1):MemoryCheckpointAckV1=>({apiVersion:2,requestId:request.requestId,checkpointId:'pool-checkpoint',digest:'a'.repeat(64),persisted:true});
function manualCheckpointSource(f:Awaited<ReturnType<typeof fixture>>){
 const previous=f.source().client.request.bind(f.source().client),history=['Retained native source history'],calls:Record<string,unknown>[]=[];
 f.source().client.request=async<T>(method:string,params:Record<string,unknown>={})=>{
  if(method==='agent.compact'){
   calls.push(params);
   if(params.memoryCheckpoint){
    const source=f.start(),ctx=source.ctx as Pick<StartRun,'threadId'|'runId'|'epoch'>;
    await f.source().options.onHostCall!({id:'pool-checkpoint-call',name:'$memory.checkpoint',args:{apiVersion:2,requestId:'pool-manual-checkpoint',adapterId:'hermes',ctx:{threadId:ctx.threadId,runId:ctx.runId,epoch:ctx.epoch},sessionPath:source.sessionPath,modelId:source.modelId,accountId:source.accountId,reason:'manual'},ctx:source.ctx as Record<string,unknown>});
   }
   history.splice(0,history.length,'Compacted native source history');
  }
  return previous<T>(method,params);
 };
 return{history,calls};
}
it('production pool forwards required manual checkpoints and waits for host persistence before source compaction',async()=>{
 const f=await fixture({},{apiVersion:2,hostOwned:true});let release!:(value:MemoryCheckpointAckV1)=>void;
 const held=new Promise<MemoryCheckpointAckV1>(done=>{release=done;}),persist=vi.fn((_request:MemoryCheckpointRequestV1)=>held),maintenance={threadId:'thread',runId:'pool-maintenance',epoch:2};let work:Promise<void>|undefined;
 f.runtime.configure({onEvent:event=>f.events.push(event),onTool:async()=>({}),onMemoryCheckpoint:persist});
 try{
  await f.runtime.start(run({memoryCheckpoint:requiredCheckpoint}));const source=f.start();await f.settle();const scripted=manualCheckpointSource(f);
  work=f.runtime.compact(maintenance,source.sessionPath as string,'openai/model',null,requiredCheckpoint);void work.catch(()=>{});
  await vi.waitFor(()=>expect(persist).toHaveBeenCalledOnce());
  expect(scripted.calls).toEqual([expect.objectContaining({memoryCheckpoint:requiredCheckpoint,ctx:source.ctx,modelId:'openai/model',accountId:null})]);
  expect(persist.mock.calls[0][0]).toMatchObject({ctx:{threadId:maintenance.threadId,runId:maintenance.runId,epoch:maintenance.epoch},sessionPath:source.sessionPath,reason:'manual'});
  expect(scripted.history).toEqual(['Retained native source history']);expect(f.events.some(event=>event.type==='compaction.end')).toBe(false);
  release(checkpointAck(persist.mock.calls[0][0]));await work;
  expect(scripted.history).toEqual(['Compacted native source history']);expect(f.events).toContainEqual(expect.objectContaining({type:'compaction.end',runId:maintenance.runId,epoch:maintenance.epoch,aborted:false}));
 }finally{release({apiVersion:2,requestId:'pool-manual-checkpoint',checkpointId:'pool-checkpoint',digest:'a'.repeat(64),persisted:true});await work?.catch(()=>{});await f.runtime.dispose();}
});
it.each(['missing host callback','unsupported source capability'])('production pool blocks required manual compaction with %s',async reason=>{
 const f=await fixture({},reason==='unsupported source capability'?undefined:{apiVersion:2,hostOwned:true}),persist=vi.fn(async(request:MemoryCheckpointRequestV1)=>checkpointAck(request));
 if(reason!=='missing host callback')f.runtime.configure({onEvent:event=>f.events.push(event),onTool:async()=>({}),onMemoryCheckpoint:persist});
 try{
  await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const scripted=manualCheckpointSource(f);
  await expect(f.runtime.compact({threadId:'thread',runId:'pool-maintenance',epoch:2},path,'openai/model',null,requiredCheckpoint)).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_UNSUPPORTED'});
  expect(scripted.calls).toEqual([]);expect(scripted.history).toEqual(['Retained native source history']);expect(persist).not.toHaveBeenCalled();
 }finally{await f.runtime.dispose();}
});
it.each(['rejected','unconfirmed'])('production pool preserves retained source history after a %s required checkpoint',async outcome=>{
 const f=await fixture({},{apiVersion:2,hostOwned:true}),persist=vi.fn(async(request:MemoryCheckpointRequestV1)=>{if(outcome==='rejected')throw Error('Synthetic checkpoint persistence failed');return{...checkpointAck(request),persisted:false} as unknown as MemoryCheckpointAckV1;});
 f.runtime.configure({onEvent:event=>f.events.push(event),onTool:async()=>({}),onMemoryCheckpoint:persist});
 try{
  await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const scripted=manualCheckpointSource(f),work=f.runtime.compact({threadId:'thread',runId:'pool-maintenance',epoch:2},path,'openai/model',null,requiredCheckpoint);
  if(outcome==='rejected')await expect(work).rejects.toThrow('Synthetic checkpoint persistence failed');else await expect(work).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_UNCONFIRMED'});
  expect(persist).toHaveBeenCalledOnce();expect(scripted.history).toEqual(['Retained native source history']);expect(f.events.some(event=>event.type==='compaction.end')).toBe(false);
 }finally{await f.runtime.dispose();}
});
it.each(['main pool','borrowed task engine'])('production pool routes account catalog invalidation through the %s only to its shared catalog',async surface=>{
 const f=await fixture(),models=new Map([['account-a',[{id:'openai/a',provider:'openai',name:'A'}]],['account-b',[{id:'openai/b',provider:'openai',name:'B'}]]]);
 vi.mocked(f.catalog.models).mockImplementation(async query=>models.get(query?.accountId??'')??[]);
 f.catalog.invalidateModels=vi.fn(async query=>{if(query?.accountId===undefined)models.clear();else models.delete(query.accountId??'');});
 const owner=surface==='main pool'?f.runtime:f.runtime.createTaskRuntime();
 try{
  expect(await owner.models({accountId:'account-a'})).toHaveLength(1);expect(await f.runtime.models({accountId:'account-b'})).toHaveLength(1);
  await owner.invalidateModels?.({accountId:'account-a'});
  expect(f.catalog.invalidateModels).toHaveBeenCalledExactlyOnceWith({accountId:'account-a'});expect(await owner.models({accountId:'account-a'})).toEqual([]);expect(await f.runtime.models({accountId:'account-b'})).toEqual([{id:'openai/b',provider:'openai',name:'B'}]);
  expect(f.natives).toEqual([]);expect(f.sources).toEqual([]);
 }finally{if(owner!==f.runtime)await owner.dispose();await f.runtime.dispose();}
});
it('requires explicit canonical transcript migration for a legacy native session',async()=>{
 const canonical=[{role:'user',content:'Earlier canonical message'}],migration=vi.fn(async()=>canonical),f=await fixture({initialHistory:migration});try{await f.runtime.start(run({sessionPath:join(f.dataDir,'legacy-native.json')}));expect(migration).toHaveBeenCalledOnce();expect(f.start().history).toEqual(canonical);expect(f.events.find(event=>event.type==='session')?.migrated).toBe(true);await f.settle();}finally{await f.runtime.dispose();}
 const rejected=await fixture();try{await expect(rejected.runtime.start(run({sessionPath:join(rejected.dataDir,'legacy-native.json')}))).rejects.toMatchObject({code:'HERMES_SESSION_INVALID'});}finally{await rejected.runtime.dispose();}
});
it('deduplicates the original interim callback when foreground completion repeats its text',async()=>{
 const f=await fixture();try{await f.runtime.start(run());f.event('assistant',{args:['The same final response']});await f.settle({text:'The same final response'});expect(f.events.filter(event=>event.type==='assistant.message')).toHaveLength(1);}finally{await f.runtime.dispose();}
});
it('keeps all durable IDs attached to one original steering ticket and expands withdrawn batches',async()=>{
 const f=await fixture();try{await f.runtime.start(run());await f.runtime.followUp(run({inputId:'batch-a',inputIds:['batch-a','batch-b'],prompt:'batched message'}));await f.runtime.followUp(run({inputId:'unused-a',inputIds:['unused-a','unused-b'],prompt:'not drained'}));f.event('model_request',{sequence:1,inputIds:['input','batch-a']});
 const response=fetch(f.start().brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+f.start().jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'acp',modelId:'openai/model',prompt:'Transcript with the drained steering batch'} )});await vi.waitFor(()=>expect(f.natives[0]?.input).toBeDefined());const n=f.natives[0];n.callbacks.onEvent({...n.input,type:'input.processing',inputIds:[n.input.inputId]});n.callbacks.onEvent({...n.input,type:'settled'});await response;
 expect(f.events.find(event=>event.type==='input.processing')?.inputIds).toEqual(['input','batch-a','batch-b']);await f.settle({unconsumedInputIds:['unused-a']});expect((f.sourceEvents.findLast(event=>event.event==='settled')?.data as {unconsumedInputIds?:unknown})?.unconsumedInputIds).toEqual(['unused-a','unused-b']);
 }finally{await f.runtime.dispose();}
});
it('keeps captured frozen settings during an active library read and restarts explicitly when idle',async()=>{
 let interval=7;const f=await fixture({settings:async input=>({config:{skills:{creation_nudge_interval:input?7:interval}}})});try{await f.runtime.start(run());interval=11;await f.runtime.sourceRequest('skills.list');expect(f.sources).toHaveLength(1);await f.settle();await f.runtime.sourceRequest('skills.list');expect(f.sources).toHaveLength(2);expect(f.sources[0].client.dispose).toHaveBeenCalledOnce();expect(f.sourceEvents.some(event=>event.event==='configuration_restarted')).toBe(true);}finally{await f.runtime.dispose();}
});
it.each(['agent.compact','skills.curate'])('owns a fresh authenticated broker for the original %s maintenance RPC',async method=>{
 const f=await fixture({config:{model:{provider:'harness',default:'openai/model'}}});try{await f.runtime.start(run());const originalJob=f.start();await f.settle();const previous=vi.mocked(f.source().client.request).getMockImplementation()!;let captured:Record<string,unknown>|undefined;
 vi.spyOn(f.source().client,'request').mockImplementation(async(name,params={})=>{if(name!==method)return previous(name,params);captured=params;f.event('model_request',{sequence:42,inputIds:[]});const response=fetch(params.brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+params.jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'maintenance',modelId:params.modelId,prompt:'Original maintenance prompt'})});await vi.waitFor(()=>expect(f.natives[0]?.input).toBeDefined());const n=f.natives[0];n.callbacks.onEvent({...n.input,type:'input.processing',inputIds:[n.input.inputId]});n.callbacks.onEvent({...n.input,type:'assistant.message',content:'Original maintenance model text'});n.callbacks.onEvent({...n.input,type:'usage',usage:{inputTokens:31,outputTokens:4}});n.callbacks.onEvent({...n.input,type:'settled'});expect((await response).status).toBe(200);return{compacted:true,summary:'source curator result'} as never;});
 if(method==='agent.compact')await f.runtime.compact(run({runId:'maintenance',epoch:2}),originalJob.sessionPath as string,'openai/model',null);else expect(await f.runtime.sourceRequest('skills.curate',{consolidate:true})).toMatchObject({summary:'source curator result'});
 expect(captured).toMatchObject({modelId:'openai/model',accountId:null,sessionPath:originalJob.sessionPath});expect(captured?.jobKey).not.toBe(originalJob.jobKey);expect(f.events.filter(event=>event.type==='input.processing')).toHaveLength(0);expect(f.accounts.claimUse).toHaveBeenCalledTimes(2);expect(f.accounts.releaseUse).toHaveBeenCalledTimes(2);expect(f.source().options.timeoutMs).toBe(240_000);
 // The native source retains its original session owner. Host observations
 // must instead match the newly admitted maintenance run or Service rejects them.
 expect(captured?.ctx).toEqual(originalJob.ctx);
 const observationOwner={threadId:'thread',runId:method==='agent.compact'?'maintenance':'run',epoch:method==='agent.compact'?2:1};
 const observations=f.events.filter(event=>event.type==='model.observation');expect(observations).toHaveLength(2);
 for(const observation of observations)expect(observation).toMatchObject({...observationOwner,observation:{owner:{...observationOwner,sequence:42,inputIds:[],phase:'foreground'},binding:{providerId:'openai',modelId:'openai/model',accountId:null},usage:{inputTokens:31,outputTokens:4}}});
 }finally{await f.runtime.dispose();}
});
it('keeps deterministic curation available and refuses LLM curation without a selected retained owner',async()=>{
 const f=await fixture();try{await f.runtime.sourceRequest('skills.curate',{consolidate:false});await expect(f.runtime.sourceRequest('skills.curate',{consolidate:true})).rejects.toMatchObject({code:'HERMES_CURATOR_OWNER_REQUIRED'});}finally{await f.runtime.dispose();}
});
it('waits for pending admission before disposal and never starts work after disposal',async()=>{
 let release!:()=>void;const settings=new Promise<{}>(done=>{release=()=>done({});}),f=await fixture({settings:()=>settings});const starting=f.runtime.start(run()).catch(error=>error),disposing=f.runtime.dispose();release();expect(await starting).toMatchObject({code:'HERMES_DISPOSED'});await disposing;expect(f.sources).toHaveLength(0);expect(f.accounts.claimUse).not.toHaveBeenCalled();
});
it('revokes a reserved startup while settings are pending before any source start or account claim',async()=>{
 let release!:()=>void;const settings=new Promise<{}>(done=>{release=()=>done({});}),f=await fixture({settings:()=>settings});try{const starting=f.runtime.start(run()).catch(error=>error),cancelling=f.runtime.cancel(run());release();expect(await starting).toMatchObject({code:'HERMES_RUN_ABORTED'});await cancelling;expect(f.sources.every(source=>source.calls.every(call=>call.method!=='agent.start'))).toBe(true);expect(f.accounts.claimUse).not.toHaveBeenCalled();}finally{await f.runtime.dispose();}
});
it('waits for Plan admission before a concurrent library read and retains its captured settings',async()=>{
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),f=await fixture({settings:async input=>{if(input)await gate;return{config:{skills:{creation_nudge_interval:input?0:7}}};}});try{const starting=f.runtime.start(run()),reading=f.runtime.sourceRequest('skills.list');release();await starting;await reading;expect(f.sources).toHaveLength(1);expect(f.source().calls[0]).toMatchObject({method:'hello',params:{config:{skills:{creation_nudge_interval:0}}}});expect(f.source().client.dispose).not.toHaveBeenCalled();await f.settle();}finally{await f.runtime.dispose();}
});
it('revokes a maintenance admission before it acquires a new account lease or source RPC',async()=>{
 const f=await fixture();try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const compacting=f.runtime.compact(run({runId:'compact',epoch:2}),path,'openai/model',null).catch(error=>error),cancelling=f.runtime.cancel(run({runId:'compact',epoch:2}));expect(await compacting).toMatchObject({code:'HERMES_RUN_ABORTED'});await cancelling;expect(f.source().calls.some(call=>call.method==='agent.compact')).toBe(false);expect(f.accounts.claimUse).toHaveBeenCalledOnce();}finally{await f.runtime.dispose();}
});
it('confirms actual source cleanup before an idle reconfiguration even when the graceful acknowledgement fails',async()=>{
 let interval=7;const f=await fixture({settings:()=>({config:{skills:{creation_nudge_interval:interval}}})});try{await f.runtime.sourceRequest('skills.list');const first=f.source().client,request=first.request.bind(first);first.request=async<T>(method:string,params?:Record<string,unknown>)=>{if(method==='agent.dispose')throw Error('Synthetic exited worker');return request<T>(method,params);};interval=9;await f.runtime.sourceRequest('skills.list');expect(first.dispose).toHaveBeenCalledOnce();expect(f.sources).toHaveLength(2);}finally{await f.runtime.dispose();}
});
it('attempts forced source and catalog cleanup when active graceful cancellation fails',async()=>{
 const f=await fixture();await f.runtime.start(run());const source=f.source().client,request=source.request.bind(source);source.request=async<T>(method:string,params?:Record<string,unknown>)=>{if(['agent.cancel','agent.cancelBackground','agent.dispose'].includes(method))throw Error('Synthetic exited worker');return request<T>(method,params);};await expect(f.runtime.dispose()).resolves.toBeUndefined();expect(source.dispose).toHaveBeenCalledOnce();expect(f.catalog.dispose).toHaveBeenCalledOnce();expect(f.accounts.releaseUse).toHaveBeenCalledOnce();
});
it('aggregates actual source/catalog cleanup failures and retains an unconfirmed active account lease',async()=>{
 const f=await fixture();await f.runtime.start(run());vi.mocked(f.source().client.dispose).mockRejectedValue(Error('Synthetic actual source teardown failure'));vi.mocked(f.catalog.dispose).mockRejectedValue(Error('Synthetic actual catalog teardown failure'));const failure=await f.runtime.dispose().catch(error=>error);expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors).toHaveLength(2);expect(f.source().client.dispose).toHaveBeenCalledOnce();expect(f.catalog.dispose).toHaveBeenCalledOnce();expect(f.accounts.releaseUse).not.toHaveBeenCalled();
});
it('captures current approval policy for curator maintenance after an idle settings change',async()=>{
 let approval=false;const f=await fixture({settings:async()=>({config:{model:{provider:'harness',default:'openai/model'},skills:{write_approval:approval}},skillPolicy:{enabled:true,allowWrites:true}})});try{await f.runtime.start(run());const initial=f.start();await f.settle();approval=true;await f.runtime.sourceRequest('skills.curate',{consolidate:true});expect(f.sources).toHaveLength(2);const hello=f.source().calls.find(call=>call.method==='hello')!,curate=f.source().calls.find(call=>call.method==='skills.curate')!;expect(hello.params.config).toMatchObject({skills:{write_approval:true},model:{provider:'harness',default:'openai/model'}});expect(curate.params).toMatchObject({modelId:initial.modelId,accountId:initial.accountId,sessionPath:initial.sessionPath,ctx:initial.ctx,skillPolicy:{enabled:true,allowWrites:true}});expect(f.accounts.releaseUse).toHaveBeenCalledTimes(2);await expect(f.runtime.compact(run(),initial.sessionPath as string,'openai/model',null)).rejects.toMatchObject({code:'HERMES_SESSION_INVALID'});}finally{await f.runtime.dispose();}
});
it('supports captured read-only bulk snapshots during an active Plan turn',async()=>{
 const f=await fixture({settings:input=>({config:{skills:{creation_nudge_interval:input?0:7}}})});try{await f.runtime.start(run());await f.runtime.sourceRequest('skills.snapshot');expect(f.sources).toHaveLength(1);expect(f.source().calls.some(call=>call.method==='skills.snapshot')).toBe(true);await f.settle();}finally{await f.runtime.dispose();}
});
it('cancels pending curator admission through the background cancellation boundary',async()=>{
 let block=false,release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),f=await fixture({settings:async()=>{if(block)await gate;return{config:{model:{provider:'harness',default:'openai/model'}}};}});try{await f.runtime.start(run());await f.settle();block=true;const curating=f.runtime.sourceRequest('skills.curate',{consolidate:true}).catch(error=>error),cancelling=f.runtime.cancelBackground();release();expect(await curating).toMatchObject({code:'HERMES_RUN_ABORTED'});await cancelling;expect(f.accounts.claimUse).toHaveBeenCalledOnce();expect(f.source().calls.some(call=>call.method==='skills.curate')).toBe(false);}finally{await f.runtime.dispose();}
});
it('launches the actual ACP server with an absolute loader from an isolated working directory',async()=>{
 const f=await fixture();let child:ReturnType<typeof spawn>|undefined;try{await f.runtime.sourceRequest('skills.list');const hello=f.source().calls.find(call=>call.method==='hello')!.params;expect((hello.acpArgs as string[])[1]).toMatch(/^file:/);child=spawn(hello.acpCommand as string,hello.acpArgs as string[],{cwd:f.dataDir,env:{...process.env,HARNESS_HERMES_BROKER_URL:'http://127.0.0.1:1/model',HARNESS_HERMES_JOB_KEY:'isolated-test-job-1234567890'},stdio:['pipe','pipe','pipe'],windowsHide:true});const messages:{result?:{protocolVersion?:number}}[]=[];let output='';child.stdout!.setEncoding('utf8');child.stdout!.on('data',chunk=>{output+=chunk;let newline:number;while((newline=output.indexOf('\n'))>=0){messages.push(JSON.parse(output.slice(0,newline)));output=output.slice(newline+1);}});child.stderr!.resume();const exited=new Promise<number|null>(done=>child!.once('exit',done));child.stdin!.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:1}})+'\n');await vi.waitFor(()=>expect(messages[0]?.result?.protocolVersion).toBe(1),{timeout:10000});child.stdin!.end();expect(await exited).toBe(0);}finally{child?.kill();await f.runtime.dispose();}
});
it('preserves original skill tools and avoids the built-in session_search collision in default host metadata',async()=>{
 const f=await fixture({hostTools:undefined});try{await f.runtime.start(run());const names=(f.start().hostTools as {name:string}[]).map(tool=>tool.name);expect(names).toContain('harness_session_search');expect(names).not.toContain('session_search');expect(names).not.toContain('skills_list');expect(names).not.toContain('skill_view');expect(names).not.toContain('skill_manage');await f.settle();}finally{await f.runtime.dispose();}
});

it('runs two same-account original source parents and cancels only the matching worker',async()=>{
 const f=await fixture();try{
  const first=run(),second=run({threadId:'other-thread',runId:'other-run',inputId:'other-input'});
  await f.runtime.start(first);await f.runtime.start(second);expect(f.sources).toHaveLength(2);
  const owner=f.sources[0],params=owner.calls.find(call=>call.method==='agent.start')!.params;
  const cancelling=f.runtime.cancel(first);await vi.waitFor(()=>expect(owner.calls.some(call=>call.method==='agent.cancel')).toBe(true));
  expect(f.sources[1].calls.some(call=>call.method==='agent.cancel')).toBe(false);
  owner.options.onEvent?.({event:'settled',ctx:params.ctx as Record<string,unknown>,data:{cancelled:true}});await cancelling;
  owner.options.onEvent?.({event:'assistant',ctx:params.ctx as Record<string,unknown>,data:{args:['stale']}});
  expect(f.events.some(event=>event.content==='stale')).toBe(false);expect(f.runtime.sourceBusy).toBe(true);await f.settle();
 }finally{await f.runtime.dispose();}
});

it('admits three main engines plus independent read-only readers through the canonical library',async()=>{
 const f=await fixture({skillPolicy:{enabled:true,allowWrites:true}}),reader=f.runtime.createTaskRuntime();reader.configure({onEvent(){},onTool:async()=>({})});
 try{
  for(let i=0;i<3;i++)await f.runtime.start(run({threadId:'main-'+i,runId:'main-run-'+i,inputId:'input-'+i}));
  await expect(f.runtime.start(run({threadId:'fourth',runId:'fourth'}))).rejects.toMatchObject({code:'HERMES_SOURCE_BUSY'});
  await reader.start(run({threadId:'reader',runId:'reader-run',inputId:'reader-input'}));
  const source=f.source(),params=f.start();expect(params.skillPolicy).toMatchObject({allowWrites:false,backgroundReview:false});expect(source.calls[0].params.sharedLibrary).toBe(true);
  await source.options.onHostCall?.({id:'skill',name:'$library.tool',args:{name:'skill_view',args:{name:'source-procedure'},kw:{}},ctx:params.ctx as Record<string,unknown>});
  expect(f.sources[0].calls.find(call=>call.method==='skills.tool')?.params).toMatchObject({name:'skill_view',policy:{allowWrites:false},ctx:{threadId:'reader',runId:'reader-run'}});
 }finally{await reader.dispose();await f.runtime.dispose();}
});

it('serializes original reviews across workers and cancels a queued review admission',async()=>{
 const f=await fixture();try{
  await f.runtime.start(run());await f.runtime.start(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));
  const [first,second]=f.sources,firstCtx=first.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>,secondCtx=second.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>;
  expect(await first.options.onHostCall?.({id:'review-1',name:'$background.acquire',args:{},ctx:firstCtx})).toEqual({acquired:true});
  let granted=false;const queued=second.options.onHostCall!({id:'review-2',name:'$background.acquire',args:{},ctx:secondCtx}).then(()=>{granted=true;}).catch(error=>error);
  await Promise.resolve();expect(granted).toBe(false);const cancelling=f.runtime.cancel({threadId:'peer',runId:'peer-run',epoch:1});
  expect(await queued).toMatchObject({code:'MODEL_REQUEST_CANCELLED'});second.options.onEvent?.({event:'settled',ctx:secondCtx,data:{cancelled:true}});await cancelling;
  first.options.onEvent?.({event:'foreground_settled',ctx:firstCtx,data:{}});first.options.onEvent?.({event:'settled',ctx:firstCtx,data:{}});
 }finally{await f.runtime.dispose();}
});

it('revokes only requested integrations from each captured worker profile',async()=>{
 const f=await fixture({settings:input=>({integrations:{enabled:input?.threadId==='peer'?['graphify']:['humanizer','impeccable'],ponytailMode:'full'}})});
 try{
  await f.runtime.start(run());await f.runtime.start(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));await f.runtime.refreshIntegrations(['humanizer']);
  expect(f.sources[0].calls.findLast(call=>call.method==='integrations.refresh')?.params).toMatchObject({config:{enabled:['impeccable'],ponytailMode:'full'}});
  expect(f.sources[1].calls.findLast(call=>call.method==='integrations.refresh')?.params).toMatchObject({config:{enabled:['graphify'],ponytailMode:'full'}});
 }finally{await f.runtime.dispose();}
});

it('applies explicit integration revocation to settings captured by a pending startup',async()=>{
 let release!:()=>void;const pending=new Promise<void>(done=>{release=done;}),f=await fixture({settings:async()=>{await pending;return{integrations:{enabled:['humanizer'],ponytailMode:'full'}};}});
 try{const starting=f.runtime.start(run());await f.runtime.refreshIntegrations(['humanizer']);release();await starting;expect(f.start().integrations).toMatchObject({enabled:[]});await f.settle();}finally{release?.();await f.runtime.dispose();}
});

it('sends explicit revocations and captured revisions while agent.start is already in flight',async()=>{
 const f=await fixture({settings:input=>({integrations:{enabled:input?['humanizer']:[],ponytailMode:'full'}})});let release!:()=>void;
 try{
  await f.runtime.sourceRequest('skills.list');const source=f.source(),previous=source.client.request.bind(source.client),gate=new Promise<void>(done=>{release=done;});
  source.client.request=async<T>(method:string,params:Record<string,unknown>={})=>{const reply=await previous<T>(method,params);if(method==='agent.start')await gate;return reply;};
  const starting=f.runtime.start(run());await vi.waitFor(()=>expect(source.calls.some(call=>call.method==='agent.start')).toBe(true));await f.runtime.refreshIntegrations(['humanizer']);
  const start=source.calls.find(call=>call.method==='agent.start')!.params,refresh=source.calls.findLast(call=>call.method==='integrations.refresh')!.params;
  release();await starting;await f.settle();
  expect(start).toMatchObject({integrationRevision:0,integrations:{enabled:['humanizer']}});
  expect(refresh).toMatchObject({integrationRevision:1,disabledIds:['humanizer'],config:{enabled:[]}});
  await f.runtime.start(run({runId:'later',epoch:2,inputId:'later'}));expect(f.start()).toMatchObject({integrationRevision:1,integrations:{enabled:['humanizer']}});await f.settle();
 }finally{release?.();await f.runtime.dispose();}
});

it.each(['queue','admission'])('never dispatches a cancelled secondary library write after the canonical %s wait',async wait=>{
 let holdSettings=false,release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),f=await fixture({settings:async input=>{if(holdSettings&&input?.threadId==='thread')await gate;return{};}});
 try{
  await f.runtime.start(run());await f.runtime.start(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));
  const canonical=f.sources[0],peer=f.sources[1],ctx=peer.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>,previous=canonical.client.request.bind(canonical.client),dispatched:string[]=[];
  canonical.client.request=async<T>(method:string,params:Record<string,unknown>={})=>{if(method==='skills.tool'){dispatched.push(String(params.name));if(params.name==='skills_list')await gate;}return previous<T>(method,params);};
  let blocker:Promise<unknown>;
  if(wait==='queue'){blocker=f.runtime.sourceTool({name:'skills_list'});await vi.waitFor(()=>expect(dispatched).toEqual(['skills_list']));}
  else{canonical.options.onEvent?.({event:'settled',ctx:canonical.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>,data:{}});await vi.waitFor(()=>expect(f.runtime.sourceBusy).toBe(true));holdSettings=true;blocker=f.runtime.start(run({runId:'next',epoch:2,inputId:'next'}));}
  const writing=peer.options.onHostCall!({id:'queued-write',name:'$library.tool',args:{name:'skill_manage',args:{action:'create',name:'cancelled'}},ctx}).catch(error=>error);
  const cancelling=f.runtime.cancel(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));peer.options.onEvent?.({event:'settled',ctx,data:{cancelled:true}});await cancelling;
  expect(dispatched).not.toContain('skill_manage');release();await blocker;expect(await writing).toMatchObject({code:'HERMES_STALE_TOOL'});expect(dispatched).not.toContain('skill_manage');
 }finally{release?.();await f.runtime.dispose();}
});

it('waits for an already dispatched shared write before confirming cancellation',async()=>{
 const f=await fixture();let release!:()=>void;
 try{
  await f.runtime.start(run());await f.runtime.start(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));const canonical=f.sources[0],peer=f.sources[1],ctx=peer.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>,previous=canonical.client.request.bind(canonical.client),gate=new Promise<void>(done=>{release=done;});let dispatched=false,completed=false,cancelled=false;
  canonical.client.request=async<T>(method:string,params:Record<string,unknown>={})=>{if(method==='skills.tool'&&params.name==='skill_manage'){dispatched=true;await gate;completed=true;}return previous<T>(method,params);};
  const writing=peer.options.onHostCall!({id:'active-write',name:'$library.tool',args:{name:'skill_manage',args:{action:'create',name:'owned'}},ctx}).catch(error=>error);await vi.waitFor(()=>expect(dispatched).toBe(true));
  const cancelling=f.runtime.cancel(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'})).then(()=>{cancelled=true;});peer.options.onEvent?.({event:'settled',ctx,data:{cancelled:true}});
  await new Promise<void>(done=>setImmediate(done));const acknowledgedBeforeWriteCompleted=cancelled;release();await cancelling;expect(acknowledgedBeforeWriteCompleted).toBe(false);expect(completed).toBe(true);expect(await writing).toMatchObject({code:'HERMES_STALE_TOOL'});
 }finally{release?.();await f.runtime.dispose();}
});


it('admits fenced capture during active source work while refusing mutation',async()=>{
 const f=await fixture();try{await f.runtime.start(run());await expect(f.runtime.sourceRequest('skills.capture',{name:'procedure',expected:{procedure:{}}})).resolves.toBeDefined();await expect(f.runtime.sourceRequest('skills.manage',{name:'procedure',action:'delete'})).rejects.toMatchObject({code:'HERMES_SOURCE_BUSY'});await f.settle();}finally{await f.runtime.dispose();}
});


it('uses one owned snapshot for progressive discovery and denies premature and hidden calls',async()=>{
 const f=await fixture({hostTools:[
  {name:'repository_status',description:'Read tracked file status',parameters:{type:'object'}},
  {name:'codemode',description:'Unavailable widget',parameters:{type:'object'}},
  {name:'host_task',description:'Direct tool',parameters:{type:'object'}},
 ]});
 __setCapabilityFlagForTests('context.compilerV1',true);
 __setCapabilityFlagForTests('tools.deferredV1',true);
 try{
  await f.runtime.start(run());const ctx=f.start().ctx as Record<string,unknown>;
  const call=(name:string,args:Record<string,unknown>={},scope=ctx)=>f.source().options.onHostCall!({id:name,name,args,ctx:scope});
  expect(f.source().calls[0].params.config).toMatchObject({tools:{tool_search:{enabled:'off'}}});
  expect(f.start().progressiveTools).toBe(true);
  expect((f.start().hostTools as {name:string}[]).map(tool=>tool.name)).not.toContain('codemode');
  const initial=await call('$context.tools.snapshot',{sequence:1}) as {names:string[];digest:string};
  expect(initial.names).toContain('context_describe_tool');
  expect(initial.names).not.toContain('repository_status');
  await expect(call('repository_status')).rejects.toMatchObject({code:'HERMES_TOOL_DENIED'});
  expect(await call('context_describe_tool',{name:'repository_status'})).toMatchObject({name:'repository_status',schema:{type:'object'}});
  expect(await call('context_describe_tool',{name:'codemode'})).toBeNull();
  await expect(call('repository_status')).rejects.toMatchObject({code:'HERMES_TOOL_DENIED'});
  await expect(call('$context.tools.snapshot',{sequence:1})).rejects.toMatchObject({code:'HERMES_TOOL_DENIED'});
  const next=await call('$context.tools.snapshot',{sequence:2}) as {names:string[];digest:string};
  expect(next.names).toContain('repository_status');expect(next.digest).not.toBe(initial.digest);
  await expect(call('repository_status')).resolves.toEqual({ok:true});
  const release: Array<() => void> = [];
  f.runtime.configure({onEvent:event=>f.events.push(event),onTool:async()=>new Promise(resolve=>release.push(()=>resolve({ok:true})))});
  const reads=Array.from({length:4},()=>call('repository_status'));
  try{
   await vi.waitFor(()=>expect(release).toHaveLength(4));
   await expect(call('repository_status')).rejects.toMatchObject({code:'CONTEXT_READ_LIMIT'});
  }finally{for(const done of release)done();await Promise.all(reads);}

  await expect(call('repository_status',{}, {...ctx,epoch:99})).rejects.toMatchObject({code:'HERMES_STALE_TOOL'});
  await f.settle();
 }finally{
  __setCapabilityFlagForTests('context.compilerV1',undefined);
  __setCapabilityFlagForTests('tools.deferredV1',undefined);
  await f.runtime.dispose();
 }
});

it('admits the real repository-map schema only at the next frozen native request and dispatches its owned host call',async()=>{
 const f=await fixture({hostTools:[REPOSITORY_MAP]});
 const onTool=vi.fn(async()=>({files:[{path:'main.ts',mode:'PARSED',sha256:'a'.repeat(64),exports:[{name:'render',line:2}]}]}));
 f.runtime.configure({onEvent:event=>f.events.push(event),onTool});
 __setCapabilityFlagForTests('context.compilerV1',true);__setCapabilityFlagForTests('tools.deferredV1',true);
 try{
  await f.runtime.start(run());const ctx=f.start().ctx as Record<string,unknown>,args={resourceId:'project',paths:['main.ts']};
  const call=(name:string,args:Record<string,unknown>)=>f.source().options.onHostCall!({id:name,name,args,ctx});
  const before=await call('$context.tools.snapshot',{sequence:1}) as {names:string[];digest:string};
  expect(before.names).not.toContain('repository_map');
  expect(await call('context_discover_tools',{query:'repository_map'})).toEqual(expect.arrayContaining([expect.objectContaining({name:'repository_map'})]));
  expect(await call('context_describe_tool',{name:'repository_map'})).toMatchObject({name:'repository_map',schema:REPOSITORY_MAP.parameters});
  await expect(call('repository_map',args)).rejects.toMatchObject({code:'HERMES_TOOL_DENIED'});
  const after=await call('$context.tools.snapshot',{sequence:2}) as {names:string[];digest:string};
  expect(after.names).toContain('repository_map');expect(after.digest).not.toBe(before.digest);
  await expect(call('repository_map',args)).resolves.toMatchObject({files:[{path:'main.ts',sha256:'a'.repeat(64)}]});
  expect(onTool).toHaveBeenCalledWith({name:'repository_map',args},expect.objectContaining({threadId:'thread',runId:'run',epoch:1}));
  await f.settle();
 }finally{__setCapabilityFlagForTests('context.compilerV1',undefined);__setCapabilityFlagForTests('tools.deferredV1',undefined);await f.runtime.dispose();}
});

const protectedMaintenance={threadId:'thread',runId:'protected-maintenance',epoch:2};
function protectedEnvelope(owner:Partial<NativeCompactionOwnerV1>={}):NativeCompactionEnvelopeV1 {
 const plan:NativeCompactionPlanV1={version:1,candidateId:'protected-candidate',owner:{...protectedMaintenance,workspaceId:'workspace',modelId:'openai/model',accountId:null,generation:1,instructionDigest:'b'.repeat(64),toolRegistryDigest:'c'.repeat(64),...owner},
  sourceSha256:'d'.repeat(64),retainedIndices:[0,1],references:[],maxRetainedBytes:65536};
 return{plan,planDigest:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
function protectedReceipt(envelope:NativeCompactionEnvelopeV1):NativeCompactionReceiptV1 {
 return{version:1,candidateId:envelope.plan.candidateId,planDigest:envelope.planDigest,sourceSha256:envelope.plan.sourceSha256,status:'APPLIED',
  archiveRef:'native-archive:'+envelope.plan.sourceSha256,archiveSha256:envelope.plan.sourceSha256,retainedBytes:256,protectedRecords:envelope.plan.retainedIndices.length,
  referenceCount:envelope.plan.references.length,toolPairs:0,beforeBytes:10000,afterBytes:1000,summarySha256:'e'.repeat(64),reason:null};
}
function protectedSource(f:Awaited<ReturnType<typeof fixture>>,envelope:NativeCompactionEnvelopeV1,options:{
 historySha256?:string;waitForHistory?:()=>Promise<void>;commitPatch?:Record<string,unknown>;receipt?:Partial<NativeCompactionReceiptV1>;skipCommit?:boolean;
}={}){
 const previous=f.source().client.request.bind(f.source().client),state={calls:[] as Record<string,unknown>[],historyReads:0,applied:0};
 f.source().client.request=async<T>(method:string,params:Record<string,unknown>={})=>{
  if(method==='agent.history'){
   state.historyReads++;await options.waitForHistory?.();
   return{historySha256:options.historySha256??envelope.plan.sourceSha256,messages:[{role:'user',content:'required'},{role:'assistant',content:'tail'}]} as T;
  }
  if(method==='agent.compact'){
   state.calls.push(params);const captured=params.compactionProtection as NativeCompactionEnvelopeV1;
   if(!options.skipCommit)await f.source().options.onHostCall!({id:'protected-commit',name:'$context.compaction.commit',args:{version:1,candidateId:captured.plan.candidateId,planDigest:captured.planDigest,sourceSha256:captured.plan.sourceSha256,...options.commitPatch},ctx:f.start().ctx as Record<string,unknown>});
   const receipt={...protectedReceipt(captured),...options.receipt},compacted=receipt.status==='APPLIED';
   if(compacted)state.applied++;
   return{compacted,protection:receipt} as T;
  }
  return previous<T>(method,params);
 };
 return state;
}
const admitProtection=(request:Parameters<NonNullable<RuntimeCallbacks['onCompactionCommit']>>[0]):NativeCompactionAckV1=>({version:1,accepted:true,planDigest:request.planDigest});
function protectedCallbacks(f:Awaited<ReturnType<typeof fixture>>,admit:NonNullable<RuntimeCallbacks['onCompactionCommit']>=admitProtection){
 const onTool=vi.fn(async()=>({}));f.runtime.configure({onEvent:event=>f.events.push(event),onTool,onCompactionCommit:admit});return onTool;
}
it('routes protected compaction through the production pool with distinct source and maintenance identities',async()=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope(),admit=vi.fn(admitProtection),onTool=protectedCallbacks(f,admit);
 try{
  await f.runtime.start(run());const source=f.start();await f.settle();const scripted=protectedSource(f,envelope);
  const receipt=await f.runtime.compactProtected!(protectedMaintenance,source.sessionPath as string,'openai/model',null,envelope);
  expect(scripted.calls).toEqual([expect.objectContaining({ctx:source.ctx,compactionContext:protectedMaintenance,compactionProtection:envelope,expectedHistorySha256:envelope.plan.sourceSha256})]);
  expect(scripted.historyReads).toBe(1);expect(scripted.applied).toBe(1);expect(admit).toHaveBeenCalledOnce();expect(onTool).not.toHaveBeenCalled();
  expect(admit.mock.calls[0][0]).toEqual({version:1,candidateId:envelope.plan.candidateId,planDigest:envelope.planDigest,sourceSha256:envelope.plan.sourceSha256,owner:envelope.plan.owner});
  expect(receipt).toEqual(protectedReceipt(envelope));
  expect(f.events).toContainEqual(expect.objectContaining({type:'compaction.end',runId:protectedMaintenance.runId,epoch:protectedMaintenance.epoch,aborted:false}));
 }finally{await f.runtime.dispose();}
});
it.each([undefined,{...NATIVE_COMPACTION_CAPABILITY,apiVersion:2}])('rejects protected compaction with unavailable native capability %j before native dispatch',async capability=>{
 const f=await fixture({},undefined,undefined,capability),envelope=protectedEnvelope(),admit=vi.fn(admitProtection);protectedCallbacks(f,admit);
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();
  await expect(f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,envelope)).rejects.toMatchObject({code:'HERMES_COMPACTION_UNSUPPORTED'});
  expect(f.source().calls.some(call=>call.method==='agent.compact')).toBe(false);expect(admit).not.toHaveBeenCalled();expect(f.accounts.claimUse).toHaveBeenCalledOnce();
 }finally{await f.runtime.dispose();}
});
it('requires private host admission even when the source advertises protection',async()=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY);
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();
  await expect(f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,protectedEnvelope())).rejects.toMatchObject({code:'HERMES_COMPACTION_UNSUPPORTED'});
  expect(f.source().calls.some(call=>call.method==='agent.compact')).toBe(false);
 }finally{await f.runtime.dispose();}
});
it.each([{threadId:'other'},{runId:'other'},{epoch:3},{modelId:'other/model'},{accountId:'other'}] satisfies Partial<NativeCompactionOwnerV1>[])('rejects a protected plan with the wrong admitted owner %j',async owner=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY);protectedCallbacks(f);
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();
  await expect(f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,protectedEnvelope(owner))).rejects.toMatchObject({code:'HERMES_COMPACTION_OWNER'});
  expect(f.source().calls.some(call=>call.method==='agent.compact')).toBe(false);
 }finally{await f.runtime.dispose();}
});
it('captures the protected plan and maintenance context before asynchronous admission',async()=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope(),expected=structuredClone(envelope),ctx={...protectedMaintenance},admit=vi.fn(admitProtection);protectedCallbacks(f,admit);
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const scripted=protectedSource(f,envelope);
  const work=f.runtime.compactProtected!(ctx,path,'openai/model',null,envelope);
  envelope.plan.owner.workspaceId='changed';envelope.plan.owner.runId='changed';envelope.planDigest='f'.repeat(64);ctx.runId='changed';
  expect(await work).toEqual(protectedReceipt(expected));expect(scripted.calls[0].compactionProtection).toEqual(expected);
  expect(scripted.calls[0].compactionContext).toEqual(protectedMaintenance);expect(admit.mock.calls[0][0].owner).toEqual(expected.plan.owner);
 }finally{await f.runtime.dispose();}
});
it.each([{candidateId:'other'},{planDigest:'f'.repeat(64)},{sourceSha256:'f'.repeat(64)}])('rejects a mismatched private native commit %j before host admission',async commitPatch=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope(),admit=vi.fn(admitProtection);protectedCallbacks(f,admit);
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const scripted=protectedSource(f,envelope,{commitPatch});
  await expect(f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,envelope)).rejects.toMatchObject({code:'HERMES_COMPACTION_OWNER'});
  expect(scripted.historyReads).toBe(0);expect(scripted.applied).toBe(0);expect(admit).not.toHaveBeenCalled();
 }finally{await f.runtime.dispose();}
});
it('rechecks the original native history digest at the commit boundary',async()=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope(),admit=vi.fn(admitProtection);protectedCallbacks(f,admit);
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const scripted=protectedSource(f,envelope,{historySha256:'f'.repeat(64)});
  await expect(f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,envelope)).rejects.toMatchObject({code:'HERMES_COMPACTION_MISMATCH'});
  expect(scripted.applied).toBe(0);expect(admit).not.toHaveBeenCalled();expect(f.events.some(event=>event.type==='compaction.end')).toBe(false);
 }finally{await f.runtime.dispose();}
});
it.each(['rejected','unconfirmed'])('keeps native history unchanged after %s host commit admission',async outcome=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope();
 protectedCallbacks(f,request=>{if(outcome==='rejected')throw Error('Host source references changed');return{...admitProtection(request),accepted:false} as unknown as NativeCompactionAckV1;});
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const scripted=protectedSource(f,envelope);
  await expect(f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,envelope)).rejects.toThrow();
  expect(scripted.applied).toBe(0);expect(f.events.some(event=>event.type==='compaction.end')).toBe(false);
 }finally{await f.runtime.dispose();}
});
it.each(['ARCHIVE_FAILED','NO_REDUCTION'] as const)('preserves the explicit native refusal %s without successful settlement',async reason=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope(),admit=vi.fn(admitProtection);protectedCallbacks(f,admit);
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const scripted=protectedSource(f,envelope,{skipCommit:true,receipt:{status:'REFUSED',archiveRef:null,archiveSha256:null,afterBytes:null,summarySha256:null,reason}});
  await expect(f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,envelope)).rejects.toThrow(reason);
  expect(scripted.applied).toBe(0);expect(admit).not.toHaveBeenCalled();expect(f.events.some(event=>event.type==='compaction.end')).toBe(false);
 }finally{await f.runtime.dispose();}
});
it.each([{archiveRef:null},{archiveSha256:null},{afterBytes:10000},{protectedRecords:1},{summarySha256:null}] satisfies Partial<NativeCompactionReceiptV1>[])('does not report application from an invalid native proof %j',async receipt=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope();protectedCallbacks(f);
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();protectedSource(f,envelope,{receipt});
  await expect(f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,envelope)).rejects.toMatchObject({code:'HERMES_COMPACTION_UNCONFIRMED'});
  expect(f.events.some(event=>event.type==='compaction.end'||event.type==='settled'&&event.runId===protectedMaintenance.runId)).toBe(false);
 }finally{await f.runtime.dispose();}
});
it('does not accept a successful source result that bypassed the private commit callback',async()=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope(),admit=vi.fn(admitProtection);protectedCallbacks(f,admit);
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();protectedSource(f,envelope,{skipCommit:true});
  await expect(f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,envelope)).rejects.toMatchObject({code:'HERMES_COMPACTION_UNCONFIRMED'});
  expect(admit).not.toHaveBeenCalled();expect(f.events.some(event=>event.type==='compaction.end')).toBe(false);
 }finally{await f.runtime.dispose();}
});
it('revokes protected admission when cancelled during the native source recheck',async()=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope(),admit=vi.fn(admitProtection);protectedCallbacks(f,admit);
 let release!:()=>void,reading=false;const held=new Promise<void>(done=>{release=done;});let work:Promise<NativeCompactionReceiptV1>|undefined,cancelling:Promise<void>|undefined;
 try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const scripted=protectedSource(f,envelope,{waitForHistory:async()=>{reading=true;await held;}});
  work=f.runtime.compactProtected!(protectedMaintenance,path,'openai/model',null,envelope);void work.catch(()=>{});
  await vi.waitFor(()=>expect(reading).toBe(true));cancelling=f.runtime.cancel(protectedMaintenance);release();
  await expect(work).rejects.toThrow();await cancelling;
  expect(scripted.applied).toBe(0);expect(admit).not.toHaveBeenCalled();expect(f.events.some(event=>event.type==='compaction.end')).toBe(false);
 }finally{release();await work?.catch(()=>{});await cancelling?.catch(()=>{});await f.runtime.dispose();}
});

it('does not grant private compaction admission to a foreground source tool call',async()=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),envelope=protectedEnvelope(),admit=vi.fn(admitProtection),onTool=protectedCallbacks(f,admit);
 try{await f.runtime.start(run());const source=f.start();
  await expect(f.source().options.onHostCall!({id:'forged-protected-call',name:'$context.compaction.commit',args:{version:1,candidateId:envelope.plan.candidateId,planDigest:envelope.planDigest,sourceSha256:envelope.plan.sourceSha256},ctx:source.ctx as Record<string,unknown>})).rejects.toMatchObject({code:'HERMES_COMPACTION_OWNER'});
  expect(admit).not.toHaveBeenCalled();expect(onTool).not.toHaveBeenCalled();await f.settle();
 }finally{await f.runtime.dispose();}
});
it('keeps protected native compaction unavailable to a read-only task engine',async()=>{
 const f=await fixture({},undefined,undefined,NATIVE_COMPACTION_CAPABILITY),child=f.runtime.createTaskRuntime(),admit=vi.fn(admitProtection);
 child.configure({onEvent:event=>f.events.push(event),onTool:async()=>({}),onCompactionCommit:admit});
 try{await child.start(run());const source=f.start();await f.settle();
  await expect(child.compactProtected!(protectedMaintenance,source.sessionPath as string,'openai/model',null,protectedEnvelope())).rejects.toMatchObject({code:'HERMES_COMPACTION_UNSUPPORTED'});
  expect(f.source().calls.some(call=>call.method==='agent.compact')).toBe(false);expect(admit).not.toHaveBeenCalled();
 }finally{await child.dispose();await f.runtime.dispose();}
});

it('preserves opaque source evidence revisions while approvals still require integer revisions',()=>{
 const plan=protectedEnvelope().plan;
 plan.references=[{kind:'SOURCE_EVIDENCE',id:'capture:source',revision:'captured-file-revision-7',digest:'e'.repeat(64)}];
 expect(nativeCompactionPlanSchema.parse(plan).references).toEqual(plan.references);
 expect(nativeCompactionPlanSchema.safeParse({...plan,references:[{...plan.references[0],kind:'PENDING_APPROVAL'}]}).success).toBe(false);
 expect(nativeCompactionPlanSchema.safeParse({...plan,references:[{...plan.references[0],revision:'x'.repeat(201)}]}).success).toBe(false);
});
