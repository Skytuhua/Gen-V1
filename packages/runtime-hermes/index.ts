import {requiresMemoryCheckpoint,routeMemoryCheckpoint,sameMemoryCheckpointRequirement,validateMemoryCheckpointRequest} from '../runtime/memory-checkpoint.ts';
import {createHash,randomUUID} from 'node:crypto';
import {AUTOMATIC_COMPACTION_CAPABILITY,automaticCompactionRequirementSchema,automaticCompactionRefusalSchema,NATIVE_COMPACTION_CAPABILITY,nativeCompactionEnvelopeSchema,nativeCompactionCommitSchema,nativeCompactionAckSchema,nativeCompactionReceiptSchema,type NativeCompactionEnvelopeV1,type NativeCompactionReceiptV1} from '../contracts/native-compaction.ts';
import {capabilityEnabled} from '../core/capability-flags.ts';
import {CONTEXT_RESULT_READ} from '../core/context-result-tool.ts';
import {createProgressiveToolSession} from '../core/context-tool-discovery.ts';
import {CONTEXT_DISCOVER_TOOLS,CONTEXT_DESCRIBE_TOOL,contextDiscoverArgs,contextDescribeArgs,hermesContextExposure,isBoundedContextRead} from '../core/context-progressive-tools.ts';
import {GENERATED_APPS_ENABLED} from '../core/widgets.ts';
import {appendFile,lstat,readFile,realpath} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {EMPTY_USAGE,HarnessError,type CompletedWriteReceipt,type RunContext,type RuntimeAdapter,type RuntimeCallbacks,type RuntimeUsage,type StartRun} from '../contracts/index.ts';
import type {AccountUseLease,RuntimeAccountResolver} from '../contracts/accounts.ts';
import {isConnectionProviderId} from '../contracts/connections.ts';
import {createRuntime} from '../runtime/index.ts';
import {secureDirectory,within} from '../runtime-official/manifest.ts';
import {createHostTools,hostSystemPrompt,loadDomainTools} from '../runtime-pi/tool-definitions.ts';
import {encodeInput} from '../runtime-pi/input-envelope.ts';
import {assertModelOnlyInput,MODEL_ONLY_MAX_WIRE_BYTES} from '../runtime/model-only.ts';
import {projectContextSystemPrompt} from '../runtime/project-context.ts';
import {HermesClient,type HermesEvent,type HermesHostCall} from './client.ts';
import {createHermesBroker,type HermesBroker,type ModelRequest} from './broker.ts';
import type {InferenceBudgetAnchor} from './context-budget.ts';
import {createNativeContextCompiler,nativeContextBinding,type NativeContextBinding} from './context.ts';
import {hydrateGeneration,parseSessionFile,sessionFileName,turnCutId,validateSessionGeneration} from './turn-cut.ts';
import {hermesReviewCapacity} from '../runtime/model-capacity.ts';
import {createHermesTaskPool} from './task-pool.ts';
import type {IntegrationId} from '../contracts/integrations.ts';

export interface HermesIntegrationConfig {enabled:IntegrationId[];ponytailMode:'off'|'lite'|'full'|'ultra'}
export interface HermesSettings {config?:Record<string,unknown>;skillPolicy?:Record<string,unknown>;systemPrompt?:string;hostTools?:{name:string;description:string;parameters:Record<string,unknown>}[];integrations?:HermesIntegrationConfig;projectRoot?:string}
export interface HermesRuntimeOptions extends HermesSettings {
 approvedWriteHooks?:boolean;
 dataDir:string;home?:string;accounts?:RuntimeAccountResolver;nativeCatalog?:RuntimeAdapter;dependencyRoot?:string;
 settings?:(input?:StartRun)=>HermesSettings|Promise<HermesSettings>;initialHistory?:(input:StartRun)=>Promise<unknown[]>;onSourceEvent?:(event:HermesEvent)=>void;
}
export interface HermesSourceClient {request<T=unknown>(method:string,params?:Record<string,unknown>):Promise<T>;dispose():Promise<void>}
export interface HermesLibraryAuthority {check():void;track(work:Promise<unknown>):void}
export interface HermesRuntimeDependencies {
 createNativeRuntime?:(options:Parameters<typeof createRuntime>[0])=>RuntimeAdapter;
 createClient?:(options:ConstructorParameters<typeof HermesClient>[0])=>HermesSourceClient;
}
export interface HermesEngine extends RuntimeAdapter {
 captureTurnCut?(sessionPath:string):Promise<{cutId:string;path:string}>;
 hydrateSessionGeneration?(cutPath:string,input:StartRun):Promise<string>;
 sourceRequest<T=unknown>(method:string,params?:Record<string,unknown>):Promise<T>;
 cancelBackground():Promise<void>;readonly sourceBusy:boolean;readonly reviewBusy:boolean;
 sourceTool(params:Record<string,unknown>,authority?:HermesLibraryAuthority):Promise<unknown>;
 refreshIntegrations(disabledIds:IntegrationId[]):Promise<void>;
}
export interface HermesRuntime extends HermesEngine {createTaskRuntime():RuntimeAdapter}
export interface HermesEngineOptions extends HermesRuntimeOptions {readOnly?:boolean;sharedLibrary?:(params:Record<string,unknown>,authority:HermesLibraryAuthority)=>Promise<unknown>}
type Owner={automaticRefusalReported?:boolean;contextBinding?:NativeContextBinding;contextRequested?:boolean;contextReads?:number;toolSnapshot?:{sequence:number;count:number;schemaBytes:number;digest:string};progressiveTools?:ReturnType<typeof createProgressiveToolSession>;input:StartRun;source:HermesSourceClient;settings:HermesSettings;tools:Set<string>;path:string;broker:HermesBroker;known:Set<string>;tickets:Map<string,string[]>;entered:Set<string>;lease?:AccountUseLease;done:Promise<void>;finish:()=>void;foreground:boolean;review:boolean;uiSettled:boolean;closing?:Promise<void>;writes:Promise<void>;failure?:unknown;usage:RuntimeUsage[];maintenance?:RunContext;lastMessage?:string;reviewAbort?:AbortController;reviewRelease?:()=>void;libraryRevoked?:boolean;libraryCalls:Set<Promise<unknown>>;memoryCheckpoint?:StartRun['memoryCheckpoint'];checkpointWork?:Promise<unknown>;compactionProtection?:NativeCompactionEnvelopeV1;compactionCommitAttempted?:boolean;compactionCommitAccepted?:boolean};
type Admission={input:StartRun;maintenance:boolean;revoked:boolean;controller:AbortController;done:Promise<void>;finish():void};
const same=(ctx:Record<string,unknown>|RunContext|undefined,input:StartRun)=>!!ctx&&ctx.threadId===input.threadId&&ctx.runId===input.runId&&ctx.epoch===input.epoch&&(!Object.hasOwn(ctx,'accountId')||('accountId' in ctx?ctx.accountId:null)===(input.accountId??null));
const error=(code:string,message:string)=>new HarnessError(code,message);
const stageActivity:Record<string,RuntimeUsage['activity']>={queued:'queued',acquired:'starting',runtimeReady:'starting',requestSent:'generating',settled:'cleanup'};
const sourceNames=new Set(['skills_list','skill_view','skill_manage']);

function captureCompactionProtection(value:NativeCompactionEnvelopeV1,ctx:RunContext,modelId:string,accountId:string|null):NativeCompactionEnvelopeV1 {
 let captured:NativeCompactionEnvelopeV1;
 try{captured=structuredClone(value);nativeCompactionEnvelopeSchema.parse(captured);}catch{throw error('HERMES_COMPACTION_INVALID','The protected compaction envelope is invalid.');}
 const owner=captured.plan.owner;
 if(owner.threadId!==ctx.threadId||owner.runId!==ctx.runId||owner.epoch!==ctx.epoch||owner.modelId!==modelId||owner.accountId!==accountId)
  throw error('HERMES_COMPACTION_OWNER','The protection plan belongs to another maintenance owner.');
 if(createHash('sha256').update(JSON.stringify(captured.plan)).digest('hex')!==captured.planDigest)
  throw error('HERMES_COMPACTION_INVALID','The protection plan digest differs.');
 const freeze=(item:unknown)=>{if(item&&typeof item==='object'){for(const child of Object.values(item))freeze(child);Object.freeze(item);}};
 freeze(captured);return captured;
}

/** Original Hermes owns conversations and skills; native adapters supply model text only. */
export function createHermesEngine(options:HermesEngineOptions,dependencies:HermesRuntimeDependencies={}):HermesEngine {
 const root=resolve(options.dataDir),home=resolve(options.home??join(root,'hermes')),sessions=join(home,'sessions');
 if(!within(root,home))throw error('HERMES_HOME_INVALID','Hermes must use an app-owned profile directory.');
 const nativeFactory=dependencies.createNativeRuntime??createRuntime,nativeOptions={dataDir:root,accounts:options.accounts,modelOnly:true};
 const catalog=options.nativeCatalog??nativeFactory(nativeOptions),makeClient=dependencies.createClient??(value=>new HermesClient(value));
 const checkpointCapabilities=new WeakMap<HermesSourceClient,boolean>();
 const compactionCapabilities=new WeakMap<HermesSourceClient,boolean>();
 const automaticCompactionCapabilities=new WeakMap<HermesSourceClient,boolean>();
 const contextCapabilities=new WeakMap<HermesSourceClient,boolean>(),nativeCompiler=createNativeContextCompiler();
 let lastBudgetAnchor:InferenceBudgetAnchor|undefined;
 const sourceClosings=new WeakMap<HermesSourceClient,Promise<void>>();
 let callbacks:RuntimeCallbacks|undefined,client:HermesSourceClient|undefined,ready:Promise<HermesSourceClient>|undefined,frozen:string|undefined,active:Owner|undefined,retained:Owner|undefined,disposed=false,disposing:Promise<void>|undefined,admission:Admission|undefined,transitions:Promise<unknown>=Promise.resolve();
 let integrationConfig:HermesIntegrationConfig={enabled:[],ponytailMode:'off'},integrationProject:string|undefined,integrationRevision=0;
 const revokedIntegrations=new Map<IntegrationId,number>();
 const settingsRevisions=new WeakMap<HermesSettings,number>();
 function revokeCaptured(value:HermesSettings):HermesSettings{const revision=settingsRevisions.get(value)??integrationRevision;if(value.integrations)value.integrations.enabled=value.integrations.enabled.filter(id=>(revokedIntegrations.get(id)??0)<=revision);return value;}
 const activeSource=()=>{if(disposed)throw error('HERMES_DISPOSED','The Hermes runtime has closed.');};
 function reserve(input:StartRun,maintenance=false):Admission{activeSource();if(admission)throw error('HERMES_SOURCE_BUSY','The original source is already admitting work.');let finish!:()=>void;const current:Admission={input,maintenance,revoked:false,controller:new AbortController(),done:new Promise<void>(done=>{finish=done;}),finish(){if(admission===current)admission=undefined;finish();}};admission=current;return current;}
 function admitted(current:Admission){activeSource();if(admission!==current||current.revoked)throw error('HERMES_RUN_ABORTED','The source admission was cancelled before it could execute.');}
 function exclusive<T>(operation:()=>Promise<T>):Promise<T>{const work=transitions.then(operation);transitions=work.then(()=>{},()=>{});return work;}
 function forget(source:HermesSourceClient){if(client===source){client=undefined;ready=undefined;frozen=undefined;retained=undefined;nativeCompiler.clear();lastBudgetAnchor=undefined;}}
 function closeSource(source:HermesSourceClient):Promise<void>{let closing=sourceClosings.get(source);if(!closing){closing=(async()=>{try{await source.request('agent.dispose');}catch{/* Actual process/host-call teardown below is the cleanup authority. */}await source.dispose();forget(source);})();sourceClosings.set(source,closing);void closing.catch(()=>sourceClosings.delete(source));}return closing;}
 const emit=(owner:Owner,type:string,value:Record<string,unknown>={})=>{try{const ctx=owner.maintenance??owner.input;callbacks?.onEvent({...value,threadId:ctx.threadId,runId:ctx.runId,epoch:ctx.epoch,type});}catch{/* An observer cannot release a live source/native owner. */}};
 function usage(owner:Owner,value:RuntimeUsage){owner.usage.push(value);const result={...EMPTY_USAGE,...value};for(const key of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','cost'] as const)result[key]=owner.usage.every(item=>item[key]!=null)?owner.usage.reduce((sum,item)=>sum+item[key]!,0):null;emit(owner,'usage',{usage:result});}
 function assistant(owner:Owner,text:string){if(text&&text!==owner.lastMessage){owner.lastMessage=text;emit(owner,'assistant.message',{messageId:randomUUID(),content:text,inputIds:[...owner.entered]});}}
 async function settings(input?:StartRun):Promise<HermesSettings>{const revision=integrationRevision,captured=await options.settings?.(input);const value=structuredClone({config:captured?.config??options.config,skillPolicy:captured?.skillPolicy??options.skillPolicy,systemPrompt:captured?.systemPrompt??options.systemPrompt,hostTools:captured?.hostTools??options.hostTools,integrations:captured?.integrations??options.integrations,projectRoot:captured?.projectRoot??options.projectRoot});if(progressiveEnabled()){const old=value.config??{},toolConfig=old.tools;value.config={...old,tools:{...(toolConfig&&typeof toolConfig==='object'&&!Array.isArray(toolConfig)?toolConfig:{}),tool_search:{enabled:'off'}}};}settingsRevisions.set(value,revision);revokeCaptured(value);if(options.readOnly){value.skillPolicy={...value.skillPolicy,allowWrites:false,backgroundReview:false};value.integrations={enabled:[],ponytailMode:'off'};}return value;}
 function completedWrites(input:StartRun,captured:HermesSettings):CompletedWriteReceipt[]{
  if(!options.approvedWriteHooks||options.readOnly)return[];
  const batch=input.completedWrites??[];if(!Array.isArray(batch)||batch.length>32)throw error('HERMES_INPUT_INVALID','The completed-write batch exceeds its bound.');
  const ids=new Set<string>(),known=new Set(input.inputIds??[input.inputId]);
  return batch.filter(receipt=>{
   const o=receipt?.origin,d=receipt?.delivery;
   const valid=receipt&&typeof receipt.operationId==='string'&&receipt.operationId.length<=200&&!ids.has(receipt.operationId)&&receipt.inputId==='operation-result:'+receipt.operationId&&known.has(receipt.inputId)&&Number.isSafeInteger(receipt.revision)&&receipt.revision>0&&typeof receipt.path==='string'&&receipt.path.length<=32768&&/^[a-f0-9]{64}$/.test(receipt.sha256)&&Number.isSafeInteger(receipt.bytes)&&receipt.bytes>=0&&receipt.bytes<=32*1024*1024&&o&&d&&same(d,input)&&o.threadId===input.threadId&&o.epoch+1===input.epoch&&o.runId!==input.runId&&o.sessionPath===input.sessionPath&&o.modelId===input.modelId&&o.accountId===(input.accountId??null)&&typeof o.projectId==='string'&&typeof o.workspaceId==='string'&&typeof o.projectRoot==='string'&&captured.projectRoot!==undefined&&resolve(o.projectRoot)===resolve(captured.projectRoot)&&within(resolve(o.projectRoot),resolve(receipt.path));
   if(valid)ids.add(receipt.operationId);
   else callbacks?.onEvent({type:'write.hook',threadId:input.threadId,runId:input.runId,epoch:input.epoch,diagnostic:{operationId:receipt?.operationId,revision:receipt?.revision,inputId:receipt?.inputId,status:captured.projectRoot?'stale':'no_project',message:'Completed-write custody does not match source admission.'}});
   return !!valid;
  });
 }
 function sourceEvent(event:HermesEvent){
  const owner=active;if(owner&&same(event.ctx,owner.input)){
   const data=event.data&&typeof event.data==='object'?event.data as Record<string,unknown>:{};
   if(event.event==='compaction_refused'&&owner.foreground&&event.ctx?.phase!=='background_review'&&!owner.libraryRevoked&&!owner.failure&&owner.input.automaticCompactionProtection&&automaticCompactionCapabilities.get(owner.source)===true){
    const parsed=automaticCompactionRefusalSchema.safeParse(data),binding=parsed.success?parsed.data.owner:undefined;
    if(parsed.success&&binding&&same(binding.ctx,owner.input)&&binding.sessionPath===owner.path&&binding.modelId===owner.input.modelId&&binding.accountId===(owner.input.accountId??null)){
     emit(owner,'context.compaction.refused',{refusal:parsed.data});
     if(!owner.automaticRefusalReported){owner.automaticRefusalReported=true;emit(owner,'activity',{message:'Automatic compaction was refused because protected automatic compaction is unavailable. Conversation history was retained.'});}
    }
   }
   if(event.event==='model_request'){
    const ids=Array.isArray(data.inputIds)?data.inputIds:[];if(ids.some(id=>typeof id!=='string'||!owner.known.has(id)))throw error('HERMES_INPUT_MISMATCH','The source requested an input outside its owner.');
    const foreground=event.ctx?.phase!=='background_review'&&owner.foreground;
    const nativeContext=foreground&&owner.contextBinding?nativeCompiler.accept(owner.contextBinding,data.nativeContextCut):undefined;
    owner.broker.expect({sequence:data.sequence as number,inputIds:[...new Set((ids as string[]).flatMap(id=>owner.tickets.get(id)??[id]))],phase:event.ctx?.phase==='background_review'?'background_review':'foreground',...(nativeContext?{nativeContext}:{}),...(foreground&&owner.contextRequested&&!owner.contextBinding?{nativeSourcesUnavailable:'UNSUPPORTED_ADAPTER' as const}:{})});
   }
   if(event.event==='assistant'&&!owner.maintenance&&event.ctx?.phase!=='background_review'&&Array.isArray(data.args)&&typeof data.args[0]==='string')assistant(owner,data.args[0]);
   if(event.event==='tool_start'||event.event==='tool_complete')emit(owner,'activity',{message:event.event==='tool_start'?'Hermes is running a host tool.':'Hermes finished a host tool.'});
   if(event.event==='write_hook'&&data.diagnostic)emit(owner,'write.hook',{diagnostic:data.diagnostic});
   if(event.event==='foreground_settled'){
    owner.foreground=false;
    if(typeof data.text==='string')assistant(owner,data.text);
    const result=data.result as Record<string,unknown>|undefined;
    if(data.error||result?.error||result?.failed===true)emit(owner,'error',{message:'The original Hermes conversation could not complete.'});
    if(!owner.uiSettled){owner.uiSettled=true;emit(owner,'settled',{aborted:result?.interrupted===true||data.cancelled===true});}
   }
   if(event.event==='review_started')owner.review=true;
   if(event.event==='review_settled')owner.review=false;
   if(event.event==='settled'){if(Array.isArray(data.unconsumedInputIds))event={...event,data:{...data,unconsumedInputIds:[...new Set(data.unconsumedInputIds.flatMap(id=>typeof id==='string'?owner.tickets.get(id)??[id]:[]))]}};owner.foreground=false;owner.review=false;void finish(owner,data).catch(()=>{});}
  }
  try{options.onSourceEvent?.(event);}catch{/* Projection cannot prevent the source cleanup barrier. */}
 }
 async function hostCall(call:HermesHostCall):Promise<unknown>{
  const owner=active;if(!owner||!same(call.ctx,owner.input))throw error('HERMES_STALE_TOOL','This source call has no active owner.');
  if(call.name==='$context.compaction.commit'){
   const envelope=owner.compactionProtection,callback=callbacks?.onCompactionCommit;
   if(!envelope)throw error('HERMES_COMPACTION_OWNER','No protected maintenance owns this source call.');
   const check=()=>{const ctx=owner.maintenance,expected=envelope.plan.owner;if(disposed||active!==owner||owner.libraryRevoked||owner.failure||!ctx||call.ctx?.phase==='background_review'||compactionCapabilities.get(owner.source)!==true||!callback||callbacks?.onCompactionCommit!==callback||ctx.threadId!==expected.threadId||ctx.runId!==expected.runId||ctx.epoch!==expected.epoch||owner.input.modelId!==expected.modelId||(owner.input.accountId??null)!==expected.accountId)throw error('HERMES_COMPACTION_OWNER','The protected maintenance owner is no longer current.');};
   check();
   const parsed=nativeCompactionCommitSchema.safeParse(call.args);
   if(!parsed.success||parsed.data.candidateId!==envelope.plan.candidateId||parsed.data.planDigest!==envelope.planDigest||parsed.data.sourceSha256!==envelope.plan.sourceSha256||owner.compactionCommitAttempted)
    throw error('HERMES_COMPACTION_OWNER','The native commit request differs or has already been consumed.');
   owner.compactionCommitAttempted=true;
   const work=(async()=>{
    const snapshot=await owner.source.request<{historySha256?:unknown;messages?:unknown}>('agent.history',{});
    check();
    if(snapshot?.historySha256!==envelope.plan.sourceSha256||!Array.isArray(snapshot.messages))
     throw error('HERMES_COMPACTION_MISMATCH','The original native history changed before the commit.');
    // No await follows this private host check: it fences the current host cut
    // after the asynchronous native source read.
    const ack=nativeCompactionAckSchema.safeParse(callback!({...parsed.data,owner:envelope.plan.owner}));
    check();
    if(!ack.success||ack.data.planDigest!==envelope.planDigest)throw error('HERMES_COMPACTION_OWNER','The host did not admit this exact protected commit.');
    owner.compactionCommitAccepted=true;return ack.data;
   })();
   owner.libraryCalls.add(work);
   try{return await work;}finally{owner.libraryCalls.delete(work);}
  }
  if(call.name==='$memory.checkpoint'){
   const check=()=>{if(disposed||active!==owner||owner.libraryRevoked||owner.failure||(!owner.foreground&&!owner.maintenance)||call.ctx?.phase==='background_review'||!requiresMemoryCheckpoint(owner.memoryCheckpoint)||checkpointCapabilities.get(owner.source)!==true)throw error('MEMORY_CHECKPOINT_OWNER','The checkpoint has no current native source owner.');};
   check();if(owner.checkpointWork)throw error('MEMORY_CHECKPOINT_OWNER','A native checkpoint is already pending.');
   const nativeRequest=validateMemoryCheckpointRequest(call.args,{adapterId:'hermes',ctx:owner.input,sessionPath:owner.path,modelId:owner.input.modelId,accountId:owner.input.accountId??null});
   const request={...nativeRequest,ctx:owner.maintenance??nativeRequest.ctx};
   const work=routeMemoryCheckpoint(request,{...request,ctx:owner.maintenance??owner.input},callbacks?.onMemoryCheckpoint,check);
   owner.checkpointWork=work;owner.libraryCalls.add(work);
   try{return await work;}finally{owner.libraryCalls.delete(work);if(owner.checkpointWork===work)owner.checkpointWork=undefined;}
  }
  if(call.name==='$library.tool'){
   if(!options.sharedLibrary||!sourceNames.has(String(call.args.name)))throw error('HERMES_TOOL_DENIED','This worker has no shared library tool authority.');
   const authority:HermesLibraryAuthority={check(){if(active!==owner||owner.libraryRevoked)throw error('HERMES_STALE_TOOL','This library call lost its source owner.');},track(work){owner.libraryCalls.add(work);void work.finally(()=>owner.libraryCalls.delete(work)).catch(()=>{});}};authority.check();
   const result=await options.sharedLibrary({name:call.args.name,args:call.args.args,kw:call.args.kw,policy:owner.settings.skillPolicy??{},ctx:{threadId:owner.input.threadId,runId:owner.input.runId,epoch:owner.input.epoch,accountId:owner.input.accountId??null,reviewToken:call.args.reviewToken,phase:call.ctx?.phase==='background_review'?'background_review':'foreground'}},authority);
   authority.check();return result;
  }
  if(call.name==='$background.acquire'){
   if(options.readOnly||owner.settings.skillPolicy?.backgroundReview===false)throw error('HERMES_TOOL_DENIED','This source role cannot start background reviews.');
   if(!owner.reviewRelease){owner.reviewAbort=new AbortController();owner.review=true;const release=await hermesReviewCapacity.acquire('review',null,owner.reviewAbort.signal);if(active!==owner){release();throw error('HERMES_STALE_TOOL','The review lost its owner.');}owner.reviewRelease=release;}return{acquired:true};
  }
  if(call.name==='$transport.observation'){if(call.args.jobKey!==owner.broker.key||!Number.isSafeInteger(call.args.sequence))throw error('HERMES_USAGE_MISMATCH','Observation belongs to another model job.');return owner.broker.observation(call.args.sequence as number)??{};}
 if(call.name==='$transport.usage'){if(call.args.jobKey!==owner.broker.key||!Number.isSafeInteger(call.args.sequence))throw error('HERMES_USAGE_MISMATCH','Usage belongs to another model job.');return owner.broker.usage(call.args.sequence as number)??{};}
  if(!owner.foreground||call.ctx?.phase==='background_review'||!owner.known.size||sourceNames.has(call.name))throw error('HERMES_TOOL_DENIED','This source phase cannot execute a host workflow tool.');
  if(call.name==='$context.tools.snapshot'){
   if(!owner.progressiveTools||!progressiveEnabled())throw error('HERMES_TOOL_DENIED','Progressive tool disclosure is not admitted for this run.');
   const sequence=call.args.sequence;
   if(typeof sequence!=='number'||!Number.isSafeInteger(sequence)||sequence<1||sequence<=(owner.toolSnapshot?.sequence??0))
    throw error('HERMES_TOOL_DENIED','The request tool snapshot is stale.');
   const snapshot=owner.progressiveTools.capture();
   owner.toolSnapshot={sequence,count:snapshot.tools.length,schemaBytes:snapshot.schemaBytes,digest:snapshot.digest};
   return {names:snapshot.tools.map(tool=>tool.name),digest:snapshot.digest};
  }
  if(owner.progressiveTools&&!owner.progressiveTools.canInvoke(call.name))throw error('HERMES_TOOL_DENIED','This schema is not admitted for the current request.');
  if(owner.progressiveTools&&call.name===CONTEXT_DISCOVER_TOOLS.name)return owner.progressiveTools.discover(contextDiscoverArgs.parse(call.args).query);
  if(owner.progressiveTools&&call.name===CONTEXT_DESCRIBE_TOOL.name)return owner.progressiveTools.describe(contextDescribeArgs.parse(call.args).name);
  if(!owner.tools.has(call.name)||!callbacks)throw error('HERMES_TOOL_DENIED','This source tool is not available to its captured run.');
  const bounded=Boolean(owner.progressiveTools&&isBoundedContextRead(call.name));
  if(bounded){if((owner.contextReads??0)>=4)throw error('CONTEXT_READ_LIMIT','Wait for a context read to finish before requesting another.');owner.contextReads=(owner.contextReads??0)+1;}
  try{const result=await callbacks.onTool({name:call.name,args:call.args},owner.input);if(active!==owner)throw error('HERMES_STALE_TOOL','This source call lost its owner.');return result;}
  finally{if(bounded)owner.contextReads=(owner.contextReads??1)-1;}
 }
 async function ensureSource(captured:HermesSettings):Promise<HermesSourceClient>{
  activeSource();revokeCaptured(captured);const config=JSON.stringify(captured.config??{});
  if(ready&&frozen!==config){if(active)throw error('HERMES_CONFIG_BUSY','Frozen source settings can change after the current review has settled.');const previous=await ready,selection=retained;await closeSource(previous);retained=selection;activeSource();try{options.onSourceEvent?.({event:'configuration_restarted',data:{reason:'frozen_config_changed'}});}catch{}}
  if(!ready){frozen=config;integrationConfig=structuredClone(captured.integrations??{enabled:[],ponytailMode:'off'});integrationProject=captured.projectRoot;client=makeClient({home,timeoutMs:240_000,onEvent:sourceEvent,onHostCall:hostCall,onFailure:failure=>{const owner=active,failed=client;if(owner){owner.failure=failure;owner.reviewAbort?.abort();void(async()=>{const outcomes=await Promise.allSettled([owner.broker.close(),failed?closeSource(failed):Promise.resolve()]);if(outcomes.some(result=>result.status==='rejected'))return;await finish(owner,{error:true});})().catch(()=>{});}}});const source=client;
   ready=(async()=>{await secureDirectory(root,home);const reply=await source.request<Record<string,unknown>>('hello',{home,sharedLibrary:!!options.sharedLibrary,managedReview:true,integrations:integrationConfig,projectRoot:integrationProject,acpCommand:process.execPath,acpArgs:['--import',pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,fileURLToPath(new URL('./acp-server.ts',import.meta.url))],dependencyRoot:options.dependencyRoot,config:captured.config??{}});if(reply.protocolVersion!==1||reply.engineClass!=='run_agent.AIAgent'||reply.sourceCommit!=='c627ec84664d43e0b18b95d9d86d8963747d56c7')throw error('HERMES_SOURCE_MISMATCH','The original pinned Hermes engine did not initialize.');const capability=reply.memoryCheckpoint as {apiVersion?:unknown;hostOwned?:unknown}|undefined;checkpointCapabilities.set(source,capability?.apiVersion===2&&capability?.hostOwned===true);const context=reply.contextCapture as {apiVersion?:unknown;source?:unknown}|undefined;contextCapabilities.set(source,context?.apiVersion===1&&context?.source==='original-acp-messages');const protection=reply.compactionProtection as Partial<typeof NATIVE_COMPACTION_CAPABILITY>|undefined;compactionCapabilities.set(source,protection?.apiVersion===NATIVE_COMPACTION_CAPABILITY.apiVersion&&protection?.strategy===NATIVE_COMPACTION_CAPABILITY.strategy&&protection?.commitBoundary===NATIVE_COMPACTION_CAPABILITY.commitBoundary);const automatic=reply.automaticCompactionProtection as Partial<typeof AUTOMATIC_COMPACTION_CAPABILITY>|undefined;automaticCompactionCapabilities.set(source,automatic?.apiVersion===AUTOMATIC_COMPACTION_CAPABILITY.apiVersion&&automatic?.strategy===AUTOMATIC_COMPACTION_CAPABILITY.strategy);return source;})().catch(async failure=>{await closeSource(source);throw failure;});
  }return ready;
 }
 const ensure=(captured:HermesSettings)=>exclusive(()=>ensureSource(captured));
 function assertCheckpoint(source:HermesSourceClient,requirement:unknown){if(requiresMemoryCheckpoint(requirement)&&(options.readOnly||checkpointCapabilities.get(source)!==true||!callbacks?.onMemoryCheckpoint))throw error('MEMORY_CHECKPOINT_UNSUPPORTED','Required native source checkpoint capability is unavailable.');}
 function assertAutomaticCompaction(source:HermesSourceClient,requirement:unknown){
  if(requirement===undefined)return;
  if(!automaticCompactionRequirementSchema.safeParse(requirement).success)throw error('HERMES_AUTOMATIC_COMPACTION_OWNER','The automatic compaction requirement is invalid.');
  if(options.readOnly||automaticCompactionCapabilities.get(source)!==true)throw error('HERMES_AUTOMATIC_COMPACTION_UNSUPPORTED','Required foreground compaction containment is unavailable.');
 }
 function assertCompaction(source:HermesSourceClient){if(options.readOnly||compactionCapabilities.get(source)!==true||!callbacks?.onCompactionCommit)throw error('HERMES_COMPACTION_UNSUPPORTED','Protected compaction requires the pinned native capability and private host admission.');}
 const progressiveEnabled=()=>!options.readOnly&&capabilityEnabled('context.compilerV1')&&capabilityEnabled('tools.deferredV1');
 const progressiveMetadata=[CONTEXT_RESULT_READ,CONTEXT_DISCOVER_TOOLS,CONTEXT_DESCRIBE_TOOL];
 const progressiveNames=new Set(progressiveMetadata.map(tool=>tool.name));
 async function toolsFor(captured:HermesSettings){const tools=captured.hostTools??createHostTools(await loadDomainTools(),async()=>{throw error('HERMES_TOOL_DENIED','Metadata cannot execute a host tool.');}).map(({name,description,parameters})=>({name,description,parameters:parameters as Record<string,unknown>}));return [...tools.filter(tool=>!sourceNames.has(tool.name)&&!progressiveNames.has(tool.name)),...(progressiveEnabled()?progressiveMetadata:[])].map(tool=>tool.name==='session_search'?{...tool,name:'harness_session_search'}:tool);}
 const pathFor=(input:Pick<StartRun,'threadId'|'accountId'|'sessionGeneration'>)=>join(sessions,sessionFileName({threadId:input.threadId,sessionGeneration:input.sessionGeneration}));
 function sessionOwner(saved:any,path:string,accountId:string|null,threadId?:string,sessionGeneration?:string){const legacy=saved.ownership?undefined:JSON.parse(saved.identity??'{}'),value=saved.ownership??{threadId:legacy.threadId,accountId:legacy.accountId??null,sessionPath:legacy.sessionPath,sourceCommit:saved.sourceCommit};if(saved.format!=='hermes-source-session-v1'||saved.sourceCommit!=='c627ec84664d43e0b18b95d9d86d8963747d56c7'||value.sourceCommit!==saved.sourceCommit||typeof value.threadId!=='string'||!value.threadId||value.accountId!==accountId||value.sessionPath!==path||pathFor(value)!==path||(value.sessionGeneration??null)!==(sessionGeneration??null)||threadId!==undefined&&value.threadId!==threadId)throw error('HERMES_SESSION_INVALID','The source session belongs to a different task, account or engine.');return value;}
 async function safeFile(path:string){await secureDirectory(root,dirname(path));try{const item=await lstat(path);if(!item.isFile()||item.isSymbolicLink()||item.nlink!==1||await realpath(path)!==join(await realpath(dirname(path)),path.slice(dirname(path).length+1)))throw error('HERMES_SESSION_INVALID','The source session must be an app-owned regular file.');if(item.size>MODEL_ONLY_MAX_WIRE_BYTES)throw error('HERMES_SESSION_LIMIT','The source session or receipts exceed their bounded reader limit.');}catch(failure){if((failure as NodeJS.ErrnoException).code!=='ENOENT')throw failure;}}
 async function finish(owner:Owner,data:Record<string,unknown>):Promise<void>{
  owner.libraryRevoked=true;
  // Queued calls lose authority; only dispatched RPCs must drain before this owner is released.
  return owner.closing??=(async()=>{try{await owner.broker.close();await Promise.allSettled([...owner.libraryCalls]);try{await owner.writes;}catch(failure){owner.failure=failure;emit(owner,'error',{message:'Hermes input receipts could not be persisted.'});}owner.reviewRelease?.();owner.reviewRelease=undefined;if(owner.lease)options.accounts?.releaseUse?.(owner.lease);owner.lease=undefined;if(active===owner)active=undefined;if(!owner.maintenance&&!owner.failure)retained=owner;
   if(!owner.uiSettled){owner.uiSettled=true;if(data.error||owner.failure)emit(owner,'error',{message:'The original Hermes conversation could not complete.'});emit(owner,'settled',{aborted:data.cancelled===true});}owner.finish();
  }catch(failure){owner.failure=failure;emit(owner,'error',{message:'Hermes cleanup could not be confirmed. Account sign-in remains blocked.'});throw failure;}})();
 }
 async function forceOwner(owner:Owner,source:HermesSourceClient|undefined):Promise<void>{owner.libraryRevoked=true;const outcomes=await Promise.allSettled([owner.broker.close(),source?closeSource(source):Promise.resolve()]),failures=outcomes.flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,'Hermes owned cleanup could not be confirmed.');await finish(owner,{cancelled:true});retained=undefined;}
 async function cancelOwner(owner:Owner):Promise<void>{owner.libraryRevoked=true;owner.reviewAbort?.abort();const source=client;try{await Promise.all([source?.request('agent.cancel'),owner.broker.close()]);await source?.request('agent.cancelBackground');await owner.done;if(owner.failure)throw owner.failure;}catch{await forceOwner(owner,source);}}
 async function maintenance<T>(previous:Owner,ctx:RunContext,method:string,params:Record<string,unknown>,currentPolicy=false):Promise<T>{
  if(admission||active)throw error('HERMES_SOURCE_BUSY','Wait for the original source and review before maintenance.');const ticket=reserve({...previous.input,...ctx},true);let lease:AccountUseLease|undefined,owner:Owner|undefined;
  let reviewRelease:(()=>void)|undefined;
  try{const captured=currentPolicy?await settings(previous.input):previous.settings;admitted(ticket);if(method==='skills.curate')reviewRelease=await hermesReviewCapacity.acquire('review',null,ticket.controller.signal);admitted(ticket);const source=await ensure(captured);admitted(ticket);assertCheckpoint(source,params.memoryCheckpoint);if(params.compactionProtection!==undefined)assertCompaction(source);lease=options.accounts?.claimUse?.(previous.input.modelId.split('/')[0] as Parameters<NonNullable<RuntimeAccountResolver['claimUse']>>[0],previous.input.accountId??null);let release!:()=>void;const done=new Promise<void>(resolve=>{release=resolve;}),broker=await createHermesBroker({input:{...previous.input,...ctx},createRuntime:()=>nativeFactory(nativeOptions),onUsage:value=>{if(owner)usage(owner,value);},onObservation:value=>{if(owner)emit(owner,'model.observation',{observation:value});}});try{admitted(ticket);}catch(failure){await broker.close();throw failure;}
   owner=active={...previous,source,settings:captured,broker,known:new Set(previous.known),tickets:new Map(previous.tickets),entered:new Set(),tools:new Set(),lease,done,finish:release,foreground:false,review:true,uiSettled:true,closing:undefined,writes:Promise.resolve(),usage:[],maintenance:ctx,lastMessage:undefined,reviewAbort:undefined,reviewRelease,libraryRevoked:false,libraryCalls:new Set(),memoryCheckpoint:params.memoryCheckpoint as StartRun['memoryCheckpoint'],checkpointWork:undefined,compactionProtection:method==='agent.compact'?params.compactionProtection as NativeCompactionEnvelopeV1|undefined:undefined,compactionCommitAttempted:false,compactionCommitAccepted:false};
   try{admitted(ticket);const result=await source.request<T>(method,{...params,...(owner.compactionProtection?{compactionContext:{threadId:ctx.threadId,runId:ctx.runId,epoch:ctx.epoch}}:{}),brokerURL:broker.url,jobKey:broker.key,modelId:previous.input.modelId,accountId:previous.input.accountId??null,sessionPath:previous.path,skillPolicy:captured.skillPolicy??{enabled:true,allowWrites:false},ctx:{threadId:previous.input.threadId,runId:previous.input.runId,epoch:previous.input.epoch,accountId:previous.input.accountId??null}});admitted(ticket);if(owner.compactionProtection&&(result as {compacted?:boolean}|null)?.compacted===true&&owner.compactionCommitAccepted!==true)throw error('HERMES_COMPACTION_UNCONFIRMED','The native source did not obtain protected host admission.');await finish(owner,{});return result;}catch(failure){if(owner.failure||ticket.revoked||disposed)await forceOwner(owner,source);else await finish(owner,{error:true});throw failure;}
  }catch(failure){if(!owner){reviewRelease?.();if(lease)options.accounts?.releaseUse?.(lease);}throw failure;}finally{ticket.finish();}
 }
 async function history(path:string,accountId?:string|null):Promise<string[]>{
  const file=resolve(path);if(!within(sessions,file)){if(options.nativeCatalog)return options.nativeCatalog.history(path,accountId);throw error('HERMES_SESSION_INVALID','This is not an app-owned Hermes source session.');}
  await safeFile(file);const text=await readFile(file,'utf8');if(Buffer.byteLength(text)>MODEL_ONLY_MAX_WIRE_BYTES)throw error('HERMES_SESSION_LIMIT','The source session exceeds its bounded reader limit.');const saved=JSON.parse(text);sessionOwner(saved,file,accountId??null);
  const receiptPath=file+'.inputs.jsonl';await safeFile(receiptPath);let lines:string;try{lines=await readFile(receiptPath,'utf8');}catch(failure){if((failure as NodeJS.ErrnoException).code==='ENOENT')return[];throw failure;}if(Buffer.byteLength(lines)>MODEL_ONLY_MAX_WIRE_BYTES)throw error('HERMES_SESSION_LIMIT','The source receipts exceed their bounded reader limit.');
  const ids=new Set<string>();for(const line of lines.split('\n')){if(!line.trim())continue;const value=JSON.parse(line);if((value.accountId??null)!==(accountId??null)||pathFor(value)!==file||!Array.isArray(value.inputIds)||value.inputIds.some((id:unknown)=>typeof id!=='string'||!id))throw error('HERMES_SESSION_INVALID','The source input receipt is invalid.');for(const id of value.inputIds)ids.add(id);}return[...ids];
 }
 async function compactNative(ctx:RunContext,path:string,modelId:string,accountId:string|null,memoryCheckpoint?:StartRun['memoryCheckpoint'],expectedHistorySha256?:string,protection?:NativeCompactionEnvelopeV1):Promise<NativeCompactionReceiptV1|undefined>{
  activeSource();if(admission||active?.foreground)throw error('HERMES_SOURCE_BUSY','Wait for the foreground conversation before compacting.');if(active)await active.done;
  const previous=retained;
  if(!previous||previous.source!==client||resolve(path)!==previous.path||ctx.threadId!==previous.input.threadId||modelId!==previous.input.modelId||accountId!==(previous.input.accountId??null))
   throw error('HERMES_SESSION_INVALID','Compaction requires the exact retained live thread, model, account and source session.');
  const display={...previous,maintenance:ctx};emit(display,'compaction.start',{reason:'manual'});
  const result=await maintenance<{compacted?:boolean;mismatch?:boolean;protection?:unknown}>(previous,ctx,'agent.compact',{...(memoryCheckpoint?{memoryCheckpoint}:{}),...(expectedHistorySha256?{expectedHistorySha256}:{}),...(protection?{compactionProtection:protection}:{})});
  if(result.mismatch===true)throw error('HERMES_COMPACTION_MISMATCH','The native source history changed after admission; the compaction was not applied.');
  let receipt:NativeCompactionReceiptV1|undefined;
  if(protection){
   const parsed=nativeCompactionReceiptSchema.safeParse(result.protection);
   if(!parsed.success||parsed.data.candidateId!==protection.plan.candidateId||parsed.data.planDigest!==protection.planDigest||parsed.data.sourceSha256!==protection.plan.sourceSha256)
    throw error('HERMES_COMPACTION_UNCONFIRMED','The native protection receipt does not match the admitted plan.');
   receipt=parsed.data;
   if(receipt.status==='REFUSED')throw error('HERMES_COMPACTION_REFUSED','Native protected compaction refused: '+(receipt.reason??'NATIVE_REFUSED'));
   if(receipt.archiveRef!=='native-archive:'+protection.plan.sourceSha256||receipt.archiveSha256!==protection.plan.sourceSha256||receipt.summarySha256===null||receipt.reason!==null||receipt.afterBytes===null||receipt.afterBytes>=receipt.beforeBytes||receipt.retainedBytes<=0||receipt.protectedRecords!==protection.plan.retainedIndices.length||receipt.referenceCount!==protection.plan.references.length)
    throw error('HERMES_COMPACTION_UNCONFIRMED','The native receipt does not prove retention, an original archive, and reduction.');
   receipt=Object.freeze(receipt);
  }
  if(result.compacted!==true)throw error('HERMES_COMPACTION_UNCONFIRMED','The original source did not compact its conversation.');
  lastBudgetAnchor=undefined;emit(display,'compaction.end',{reason:'manual',aborted:false});emit(display,'settled',{aborted:false});return receipt;
 }
 async function captureTurnCut(path:string):Promise<{cutId:string;path:string}>{
  const file=resolve(path);if(!within(sessions,file))throw error('HERMES_SESSION_INVALID','Cuts require an app-owned Hermes source session.');
  await safeFile(file);const text=await readFile(file,'utf8');if(Buffer.byteLength(text)>MODEL_ONLY_MAX_WIRE_BYTES)throw error('HERMES_SESSION_LIMIT','The source session exceeds its bounded reader limit.');
  const saved=parseSessionFile(JSON.parse(text));if(saved.ownership!.sessionPath!==file||sessionFileName({threadId:saved.ownership!.threadId,sessionGeneration:saved.ownership!.sessionGeneration})!==file.slice(file.length-file.split('/').pop()!.length))throw error('HERMES_SESSION_INVALID','The source session does not name its own custody path.');
  const cutId=turnCutId(text),cut=file.slice(0,-5)+'.cut-'+cutId+'.json';await secureDirectory(root,dirname(cut));try{const item=await lstat(cut);if(!item.isFile()||item.isSymbolicLink())throw error('HERMES_SESSION_INVALID','The turn cut path is not an app-owned regular file.');}catch(failure){if((failure as NodeJS.ErrnoException).code!=='ENOENT')throw failure;}
  if(!(await realpath(dirname(cut)).then(()=>true,()=>false)))throw error('HERMES_SESSION_INVALID','The turn cut parent is unavailable.');
  try{const {writeFile,rename}=await import('node:fs/promises');const tmp=cut+'.'+randomUUID()+'.tmp';await writeFile(tmp,text);await rename(tmp,cut);}catch(failure){throw failure instanceof HarnessError?failure:error('HERMES_CUT_WRITE','The immutable turn cut could not be persisted.');}
  return{cutId,path:cut};
 }
 async function hydrateSessionGeneration(cutPath:string,input:StartRun):Promise<string>{
  const cut=resolve(cutPath),generation=input.sessionGeneration;validateSessionGeneration(generation);
  const match=/\.cut-(c[0-9a-f]{16})\.json$/.exec(cut);if(!within(sessions,cut)||!match)throw error('HERMES_SESSION_INVALID','Hydration requires an immutable app-owned turn cut.');
  await safeFile(cut);const text=await readFile(cut,'utf8');if(Buffer.byteLength(text)>MODEL_ONLY_MAX_WIRE_BYTES||turnCutId(text)!==match[1])throw error('HERMES_CUT_INVALID','The turn cut is stale or corrupt.');
  const hydrated=hydrateGeneration(JSON.parse(text),pathFor(input),generation!);
  if(hydrated.ownership!.threadId!==input.threadId||(hydrated.ownership!.accountId??null)!==(input.accountId??null))throw error('HERMES_CUT_OWNER','The turn cut belongs to another thread or account.');
  const target=pathFor(input);await safeFile(target);const{writeFile,rename}=await import('node:fs/promises');await secureDirectory(root,dirname(target));const tmp=target+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(hydrated));await rename(tmp,target);return target;
 }
 const runtime:HermesEngine={
  configure(value){callbacks=value;},
 async captureTurnCut(path){return captureTurnCut(path);},
 async hydrateSessionGeneration(cut,input){activeSource();return hydrateSessionGeneration(cut,input);},models(value){activeSource();return catalog.models(value);},async invalidateModels(value){activeSource();await catalog.invalidateModels?.(value);},
  get sourceBusy(){return!!admission||!!active?.foreground;},get reviewBusy(){return!!active?.review||!!active&&!active.foreground;},
  async sourceTool(params,authority){activeSource();authority?.check();while(admission){await admission.done;activeSource();authority?.check();}const captured=active?.settings??await settings();authority?.check();return exclusive(async()=>{authority?.check();const source=await ensureSource(active?.settings??captured);authority?.check();const work=source.request(params.releaseOwner===true?'skills.releaseOwner':'skills.tool',params);authority?.track(work);return work;});},
  async refreshIntegrations(disabledIds){const revision=++integrationRevision;for(const id of disabledIds)revokedIntegrations.set(id,revision);integrationConfig={...integrationConfig,enabled:integrationConfig.enabled.filter(id=>!disabledIds.includes(id))};if(active?.settings.integrations)active.settings.integrations={...active.settings.integrations,enabled:active.settings.integrations.enabled.filter(id=>!disabledIds.includes(id))};const config=structuredClone(integrationConfig),projectRoot=integrationProject;if(ready){const source=await ready;await source.request('integrations.refresh',{config,projectRoot,disabledIds,integrationRevision:revision});}},
  async sourceRequest<T>(method:string,params:Record<string,unknown>={}){activeSource();if(!method.startsWith('skills.')&&method!=='learn.prompt')throw error('HERMES_SOURCE_METHOD','This source method is not a library operation.');while(admission)await admission.done;activeSource();if(method==='skills.curate'&&params.consolidate===true){if(active?.foreground)throw error('HERMES_SOURCE_BUSY','Wait for the current foreground before LLM curation.');if(active)await active.done;if(!retained)throw error('HERMES_CURATOR_OWNER_REQUIRED','Select and run a task model/account before LLM curation.');return maintenance<T>(retained,retained.input,method,params,true);}if(active&&!['learn.prompt','skills.capture','skills.snapshot','skills.list','skills.inspect','skills.view','skills.versions','skills.proposals'].includes(method))throw error('HERMES_SOURCE_BUSY','Wait for the current source review before changing its library.');const captured=active?.settings??await settings();if(admission)return runtime.sourceRequest<T>(method,params);return exclusive(async()=>{const source=await ensureSource(active?.settings??captured);return source.request<T>(method,params);});},
  async start(value){activeSource();if(!callbacks)throw error('HERMES_NOT_CONFIGURED','Configure Hermes callbacks before starting.');if(admission||active?.foreground)throw error('HERMES_SOURCE_BUSY','The original Hermes source worker already owns a foreground conversation.');const input=structuredClone(value),ticket=reserve(input);
   try{const captured=await settings(input);admitted(ticket);assertModelOnlyInput(input);if(active)await active.done;admitted(ticket);const source=await ensure(captured);admitted(ticket);assertCheckpoint(source,input.memoryCheckpoint);assertAutomaticCompaction(source,input.automaticCompactionProtection);if(input.sessionGeneration!==undefined)validateSessionGeneration(input.sessionGeneration);const path=pathFor(input);let migrated:unknown[]|undefined;if(input.sessionPath&&resolve(input.sessionPath)!==path){if(within(sessions,resolve(input.sessionPath))||!options.initialHistory)throw error('HERMES_SESSION_INVALID','A native session requires explicit canonical transcript migration.');migrated=await options.initialHistory(input);admitted(ticket);if(!Array.isArray(migrated)||!migrated.length)throw error('HERMES_MIGRATION_EMPTY','The legacy conversation could not be migrated from canonical messages.');}await safeFile(path);admitted(ticket);await safeFile(path+'.inputs.jsonl');admitted(ticket);try{const text=await readFile(path,'utf8');admitted(ticket);sessionOwner(JSON.parse(text),path,input.accountId??null,input.threadId,input.sessionGeneration);}catch(failure){if((failure as NodeJS.ErrnoException).code!=='ENOENT')throw failure;}admitted(ticket);
    const tools=(await toolsFor(captured)).filter(tool=>!progressiveEnabled()||hermesContextExposure(tool.name,GENERATED_APPS_ENABLED)!=='HIDDEN');admitted(ticket);const known=new Set(input.inputIds??[input.inputId]);if(!known.size||!known.has(input.inputId)||[...known].some(id=>typeof id!=='string'||!id))throw error('HERMES_INPUT_INVALID','The source input identifiers are invalid.');
    const provider=input.modelId.split('/')[0];if(!isConnectionProviderId(provider))throw error('HERMES_MODEL_INVALID','Select a supported native connection model.');if(input.accountId){const account=options.accounts?.get(input.accountId);if(!account||!account.enabled||account.providerId!==provider)throw error('HERMES_ACCOUNT_INVALID','The selected saved account does not match this model.');}if(options.accounts?.isSigningIn?.(provider,input.accountId??null))throw error('ACCOUNT_SIGNING_IN','Wait for account sign-in to finish.');const lease=options.accounts?.claimUse?.(provider,input.accountId??null);
    const systemPrompt=projectContextSystemPrompt(input,captured.systemPrompt??hostSystemPrompt(input.memory)),contextRequested=!options.readOnly&&capabilityEnabled('context.compilerV1');
    const contextBinding=contextRequested&&contextCapabilities.get(source)===true?nativeContextBinding(input,systemPrompt,tools):undefined;
    let release!:()=>void;const done=new Promise<void>(resolve=>{release=resolve;});let owner!:Owner;
    const beforeInference=async(metadata:ModelRequest)=>{
     if(!contextRequested)return;
     const check=()=>{if(disposed||active!==owner||!owner.foreground||owner.libraryRevoked||owner.failure)throw error('HERMES_STALE_RUN','This inference lost its original source owner.');};
     check();const admit=callbacks?.onBeforeInference;
     if(!admit)throw error('HERMES_INFERENCE_ADMISSION_UNAVAILABLE','This host has no enabled next-inference admission channel.');
     await admit({ctx:{threadId:input.threadId,runId:input.runId,epoch:input.epoch},modelId:input.modelId,accountId:input.accountId??null,thinkingLevel:input.thinkingLevel??null,sequence:metadata.sequence,inputIds:[...metadata.inputIds]});
     check();
    };
    try{const broker=await createHermesBroker({input,createRuntime:()=>nativeFactory(nativeOptions),beforeInference,...(contextRequested?{contextBudget:{scope:contextBinding?.bindingDigest??null,previous:lastBudgetAnchor},onContextBudget:budget=>{if(active===owner&&owner.foreground)emit(owner,'context.budget',{provider:'hermes',budget});},onBudgetAnchor:anchor=>{if(active===owner)lastBudgetAnchor=anchor;}}:{}),onInput:async ids=>{if(active!==owner)return;const fresh=ids.filter(id=>!owner.entered.has(id));if(!fresh.length)return;owner.writes=owner.writes.then(async()=>{await safeFile(path+'.inputs.jsonl');await appendFile(path+'.inputs.jsonl',JSON.stringify({threadId:input.threadId,accountId:input.accountId??null,...(input.sessionGeneration?{sessionGeneration:input.sessionGeneration}:{}),inputIds:fresh})+'\n',{mode:0o600});for(const id of fresh)owner.entered.add(id);emit(owner,'input.processing',{inputIds:fresh});});await owner.writes;},onUsage:(value,metadata)=>{if(metadata.phase==='foreground')usage(owner,value);},onContextRequest:observation=>{if(active===owner&&owner.foreground){const view=owner.toolSnapshot;const {nativeContext,...observed}=observation;emit(owner,'context.request',{...observed,provider:'hermes',...(view?.sequence===observation.sequence?{toolSnapshot:view}:{}),...(nativeContext?.projection?{nativeSources:nativeContext.projection}:{}),...(nativeContext?.unavailableReason?{nativeSourcesUnavailable:nativeContext.unavailableReason}:{})});}},onStage:(stage,metadata)=>{if(active!==owner||metadata.phase!=='foreground')return;const activity=stageActivity[stage];if(activity)emit(owner,'usage',{usage:{activity}});},onObservation:value=>{emit(owner,'model.observation',{observation:value});}});
     try{admitted(ticket);}catch(failure){await broker.close();throw failure;}const admittedTools=new Set(tools.map(tool=>tool.name));
     const progressiveTools=progressiveEnabled()?createProgressiveToolSession(tools.map(tool=>({name:tool.name,description:tool.description,schema:tool.parameters,exposure:hermesContextExposure(tool.name,GENERATED_APPS_ENABLED)})),name=>progressiveEnabled()&&admittedTools.has(name)):undefined;
     owner=active={contextRequested,contextBinding,progressiveTools,input,source,settings:captured,tools:admittedTools,path,broker,known,tickets:new Map(),entered:new Set(),lease,done,finish:release,foreground:true,review:false,uiSettled:false,writes:Promise.resolve(),usage:[],libraryCalls:new Set(),memoryCheckpoint:input.memoryCheckpoint};
     revokeCaptured(captured);integrationConfig=structuredClone(captured.integrations??{enabled:[],ponytailMode:'off'});integrationProject=captured.projectRoot;admitted(ticket);const result=await source.request<{accepted?:boolean}>('agent.start',{ctx:{threadId:input.threadId,runId:input.runId,epoch:input.epoch,accountId:input.accountId??null},modelId:input.modelId,accountId:input.accountId??null,...(input.memoryCheckpoint?{memoryCheckpoint:input.memoryCheckpoint}:{}),...(input.automaticCompactionProtection?{automaticCompactionProtection:input.automaticCompactionProtection}:{}),prompt:encodeInput(input),...(options.approvedWriteHooks&&!options.readOnly?{completedWrites:completedWrites(input,captured)}:{}),inputIds:[...known],...(migrated?{history:migrated}:{}),integrations:integrationConfig,integrationRevision:settingsRevisions.get(captured)??integrationRevision,projectRoot:integrationProject,sessionId:input.threadId,sessionPath:path,...(input.sessionGeneration?{sessionGeneration:input.sessionGeneration}:{}),thinkingLevel:input.thinkingLevel,systemPrompt,hostTools:tools,...(contextBinding?{contextCapture:{apiVersion:1,bindingDigest:contextBinding.bindingDigest}}:{}),...(progressiveTools?{progressiveTools:true}:{}),skillPolicy:captured.skillPolicy??{enabled:true,allowWrites:false},brokerURL:broker.url,jobKey:broker.key});admitted(ticket);if(result.accepted!==true)throw error('HERMES_SOURCE_REJECTED','The original source did not accept its conversation.');emit(owner,'session',{sessionPath:path,...(migrated?{migrated:true}:{})});
    }catch(failure){if(owner){owner.failure=failure;await forceOwner(owner,source);}else if(lease)options.accounts?.releaseUse?.(lease);throw failure;}
   }finally{ticket.finish();}
  },
  async followUp(value){activeSource();if(value.completedWrites?.length)throw error('HERMES_INPUT_INVALID','Completed writes require an idle source turn.');const owner=active;if(!owner||!owner.foreground||!same(value,owner.input)||value.modelId!==owner.input.modelId||(value.accountId??null)!==(owner.input.accountId??null))throw error('HERMES_STALE_RUN','This follow-up does not belong to the active Hermes run.');projectContextSystemPrompt(value,'');if((value.approvedProjectContext?.instructionDigest??null)!==(owner.input.approvedProjectContext?.instructionDigest??null)||(value.approvedProjectContext?.grantDigest??null)!==(owner.input.approvedProjectContext?.grantDigest??null))throw error('STALE_REQUEST_CONTEXT','Project instructions changed during the active native turn; resume in a new turn.');if(!sameMemoryCheckpointRequirement(value.memoryCheckpoint,owner.memoryCheckpoint))throw error('MEMORY_CHECKPOINT_OWNER','Follow-up changed the captured checkpoint requirement.');if((value.automaticCompactionProtection===undefined)!==(owner.input.automaticCompactionProtection===undefined)||value.automaticCompactionProtection!==undefined&&!automaticCompactionRequirementSchema.safeParse(value.automaticCompactionProtection).success)throw error('HERMES_AUTOMATIC_COMPACTION_OWNER','Follow-up changed the captured automatic compaction requirement.');assertModelOnlyInput(value);const ids=value.inputIds??[value.inputId];if(!ids.length||ids[0]!==value.inputId||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id||owner.known.has(id)))throw error('HERMES_INPUT_INVALID','A source steering ticket must identify new inputs.');for(const id of ids)owner.known.add(id);owner.tickets.set(value.inputId,[...ids]);try{const result=await(await ensure(owner.settings)).request<{accepted?:boolean}>('agent.followUp',{prompt:encodeInput(value),inputId:value.inputId});if(result.accepted!==true)throw error('HERMES_STEER_REJECTED','The original source did not accept this follow-up.');}catch(failure){for(const id of ids)owner.known.delete(id);owner.tickets.delete(value.inputId);throw failure;}},
  async cancel(ctx){const ticket=admission&&same(ctx,admission.input)?admission:undefined;if(ticket){ticket.revoked=true;ticket.controller.abort();}const owner=active;if(owner&&same(ctx,{...owner.input,...owner.maintenance}))await cancelOwner(owner);if(ticket)await ticket.done;},
  async cancelBackground(){if(admission?.maintenance){await runtime.cancel(admission.input);return;}if(!active)return;active.reviewAbort?.abort();await client?.request('agent.cancelBackground');if(active&&!active.foreground)await active.done;},
  async compact(ctx,path,modelId,accountId,memoryCheckpoint,expectedHistorySha256){await compactNative(ctx,path,modelId,accountId??null,memoryCheckpoint,expectedHistorySha256);},
  async compactProtected(ctx,path,modelId,accountId,protection,memoryCheckpoint){
   const maintenanceContext=Object.freeze({threadId:ctx.threadId,runId:ctx.runId,epoch:ctx.epoch});
   const captured=captureCompactionProtection(protection,maintenanceContext,modelId,accountId);
   const receipt=await compactNative(maintenanceContext,path,modelId,accountId,memoryCheckpoint,captured.plan.sourceSha256,captured);
   if(!receipt)throw error('HERMES_COMPACTION_UNCONFIRMED','The native protection receipt is unavailable.');
   return receipt;
  },
  async nativeHistoryDigest(ctx,path,accountId){activeSource();const previous=retained;if(!previous||previous.source!==client||resolve(path)!==previous.path||ctx.threadId!==previous.input.threadId||(accountId??null)!==(previous.input.accountId??null))return null;const result=await maintenance<{messages?:unknown[];historySha256?:string}>(previous,ctx,'agent.history',{});return typeof result.historySha256==='string'&&Array.isArray(result.messages)?{sha256:result.historySha256,messages:result.messages}:null;},
  history,
  dispose(){return disposing??=(async()=>{disposed=true;const ticket=admission;if(ticket){ticket.revoked=true;ticket.controller.abort();}const owner=active,source=client;owner?.reviewAbort?.abort();const outcomes=await Promise.allSettled([owner?forceOwner(owner,source):source?closeSource(source):Promise.resolve(),catalog.dispose()]);if(ticket)await ticket.done;await transitions;const late=client&&client!==source?await Promise.allSettled([closeSource(client)]):[];const failures=[...outcomes,...late].flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,'Hermes cleanup could not be confirmed.');})();},
 };return runtime;
}

/** Each personal task has its own original engine; only the library and request gates are shared. */
export function createHermesRuntime(options:HermesRuntimeOptions,dependencies:HermesRuntimeDependencies={}):HermesRuntime{return createHermesTaskPool(options,dependencies,createHermesEngine);}
