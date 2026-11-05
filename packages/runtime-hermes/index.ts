import {createHash,randomUUID} from 'node:crypto';
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
import {HermesClient,type HermesEvent,type HermesHostCall} from './client.ts';
import {createHermesBroker,type HermesBroker} from './broker.ts';
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
 sourceRequest<T=unknown>(method:string,params?:Record<string,unknown>):Promise<T>;
 cancelBackground():Promise<void>;readonly sourceBusy:boolean;readonly reviewBusy:boolean;
 sourceTool(params:Record<string,unknown>,authority?:HermesLibraryAuthority):Promise<unknown>;
 refreshIntegrations(disabledIds:IntegrationId[]):Promise<void>;
}
export interface HermesRuntime extends HermesEngine {createTaskRuntime():RuntimeAdapter}
export interface HermesEngineOptions extends HermesRuntimeOptions {readOnly?:boolean;sharedLibrary?:(params:Record<string,unknown>,authority:HermesLibraryAuthority)=>Promise<unknown>}
type Owner={input:StartRun;source:HermesSourceClient;settings:HermesSettings;tools:Set<string>;path:string;broker:HermesBroker;known:Set<string>;tickets:Map<string,string[]>;entered:Set<string>;lease?:AccountUseLease;done:Promise<void>;finish:()=>void;foreground:boolean;review:boolean;uiSettled:boolean;closing?:Promise<void>;writes:Promise<void>;failure?:unknown;usage:RuntimeUsage[];maintenance?:RunContext;lastMessage?:string;reviewAbort?:AbortController;reviewRelease?:()=>void;libraryRevoked?:boolean;libraryCalls:Set<Promise<unknown>>};
type Admission={input:StartRun;maintenance:boolean;revoked:boolean;controller:AbortController;done:Promise<void>;finish():void};
const same=(ctx:Record<string,unknown>|RunContext|undefined,input:StartRun)=>!!ctx&&ctx.threadId===input.threadId&&ctx.runId===input.runId&&ctx.epoch===input.epoch&&(!Object.hasOwn(ctx,'accountId')||('accountId' in ctx?ctx.accountId:null)===(input.accountId??null));
const error=(code:string,message:string)=>new HarnessError(code,message);
const sourceNames=new Set(['skills_list','skill_view','skill_manage']);

/** Original Hermes owns conversations and skills; native adapters supply model text only. */
export function createHermesEngine(options:HermesEngineOptions,dependencies:HermesRuntimeDependencies={}):HermesEngine {
 const root=resolve(options.dataDir),home=resolve(options.home??join(root,'hermes')),sessions=join(home,'sessions');
 if(!within(root,home))throw error('HERMES_HOME_INVALID','Hermes must use an app-owned profile directory.');
 const nativeFactory=dependencies.createNativeRuntime??createRuntime,nativeOptions={dataDir:root,accounts:options.accounts,modelOnly:true};
 const catalog=options.nativeCatalog??nativeFactory(nativeOptions),makeClient=dependencies.createClient??(value=>new HermesClient(value));
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
 function forget(source:HermesSourceClient){if(client===source){client=undefined;ready=undefined;frozen=undefined;retained=undefined;}}
 function closeSource(source:HermesSourceClient):Promise<void>{let closing=sourceClosings.get(source);if(!closing){closing=(async()=>{try{await source.request('agent.dispose');}catch{/* Actual process/host-call teardown below is the cleanup authority. */}await source.dispose();forget(source);})();sourceClosings.set(source,closing);void closing.catch(()=>sourceClosings.delete(source));}return closing;}
 const emit=(owner:Owner,type:string,value:Record<string,unknown>={})=>{try{const ctx=owner.maintenance??owner.input;callbacks?.onEvent({...value,threadId:ctx.threadId,runId:ctx.runId,epoch:ctx.epoch,type});}catch{/* An observer cannot release a live source/native owner. */}};
 function usage(owner:Owner,value:RuntimeUsage){owner.usage.push(value);const result={...EMPTY_USAGE,...value};for(const key of ['inputTokens','outputTokens','cost'] as const)result[key]=owner.usage.every(item=>item[key]!==null)?owner.usage.reduce((sum,item)=>sum+item[key]!,0):null;emit(owner,'usage',{usage:result});}
 function assistant(owner:Owner,text:string){if(text&&text!==owner.lastMessage){owner.lastMessage=text;emit(owner,'assistant.message',{messageId:randomUUID(),content:text,inputIds:[...owner.entered]});}}
 async function settings(input?:StartRun):Promise<HermesSettings>{const revision=integrationRevision,captured=await options.settings?.(input);const value=structuredClone({config:captured?.config??options.config,skillPolicy:captured?.skillPolicy??options.skillPolicy,systemPrompt:captured?.systemPrompt??options.systemPrompt,hostTools:captured?.hostTools??options.hostTools,integrations:captured?.integrations??options.integrations,projectRoot:captured?.projectRoot??options.projectRoot});settingsRevisions.set(value,revision);revokeCaptured(value);if(options.readOnly){value.skillPolicy={...value.skillPolicy,allowWrites:false,backgroundReview:false};value.integrations={enabled:[],ponytailMode:'off'};}return value;}
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
   if(event.event==='model_request'){
    const ids=Array.isArray(data.inputIds)?data.inputIds:[];if(ids.some(id=>typeof id!=='string'||!owner.known.has(id)))throw error('HERMES_INPUT_MISMATCH','The source requested an input outside its owner.');
    owner.broker.expect({sequence:data.sequence as number,inputIds:[...new Set((ids as string[]).flatMap(id=>owner.tickets.get(id)??[id]))],phase:event.ctx?.phase==='background_review'?'background_review':'foreground'});
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
  if(call.name==='$transport.usage'){if(call.args.jobKey!==owner.broker.key||!Number.isSafeInteger(call.args.sequence))throw error('HERMES_USAGE_MISMATCH','Usage belongs to another model job.');return owner.broker.usage(call.args.sequence as number)??{};}
  if(!owner.foreground||call.ctx?.phase==='background_review'||!owner.known.size||sourceNames.has(call.name))throw error('HERMES_TOOL_DENIED','This source phase cannot execute a host workflow tool.');
  if(!owner.tools.has(call.name)||!callbacks)throw error('HERMES_TOOL_DENIED','This source tool is not available to its captured run.');
  const result=await callbacks.onTool({name:call.name,args:call.args},owner.input);if(active!==owner)throw error('HERMES_STALE_TOOL','This source call lost its owner.');return result;
 }
 async function ensureSource(captured:HermesSettings):Promise<HermesSourceClient>{
  activeSource();revokeCaptured(captured);const config=JSON.stringify(captured.config??{});
  if(ready&&frozen!==config){if(active)throw error('HERMES_CONFIG_BUSY','Frozen source settings can change after the current review has settled.');const previous=await ready,selection=retained;await closeSource(previous);retained=selection;activeSource();try{options.onSourceEvent?.({event:'configuration_restarted',data:{reason:'frozen_config_changed'}});}catch{}}
  if(!ready){frozen=config;integrationConfig=structuredClone(captured.integrations??{enabled:[],ponytailMode:'off'});integrationProject=captured.projectRoot;client=makeClient({home,timeoutMs:240_000,onEvent:sourceEvent,onHostCall:hostCall,onFailure:failure=>{const owner=active,failed=client;if(owner){owner.failure=failure;owner.reviewAbort?.abort();void(async()=>{const outcomes=await Promise.allSettled([owner.broker.close(),failed?closeSource(failed):Promise.resolve()]);if(outcomes.some(result=>result.status==='rejected'))return;await finish(owner,{error:true});})().catch(()=>{});}}});const source=client;
   ready=(async()=>{await secureDirectory(root,home);const reply=await source.request<Record<string,unknown>>('hello',{home,sharedLibrary:!!options.sharedLibrary,managedReview:true,integrations:integrationConfig,projectRoot:integrationProject,acpCommand:process.execPath,acpArgs:['--import',pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,fileURLToPath(new URL('./acp-server.ts',import.meta.url))],dependencyRoot:options.dependencyRoot,config:captured.config??{}});if(reply.protocolVersion!==1||reply.engineClass!=='run_agent.AIAgent'||reply.sourceCommit!=='c627ec84664d43e0b18b95d9d86d8963747d56c7')throw error('HERMES_SOURCE_MISMATCH','The original pinned Hermes engine did not initialize.');return source;})().catch(async failure=>{await closeSource(source);throw failure;});
  }return ready;
 }
 const ensure=(captured:HermesSettings)=>exclusive(()=>ensureSource(captured));
 async function toolsFor(captured:HermesSettings){const tools=captured.hostTools??createHostTools(await loadDomainTools(),async()=>{throw error('HERMES_TOOL_DENIED','Metadata cannot execute a host tool.');}).map(({name,description,parameters})=>({name,description,parameters:parameters as Record<string,unknown>}));return tools.filter(tool=>!sourceNames.has(tool.name)).map(tool=>tool.name==='session_search'?{...tool,name:'harness_session_search'}:tool);}
 const pathFor=(input:Pick<StartRun,'threadId'|'accountId'>)=>join(sessions,createHash('sha256').update(input.threadId).digest('hex')+'.json');
 function sessionOwner(saved:any,path:string,accountId:string|null,threadId?:string){const legacy=saved.ownership?undefined:JSON.parse(saved.identity??'{}'),value=saved.ownership??{threadId:legacy.threadId,accountId:legacy.accountId??null,sessionPath:legacy.sessionPath,sourceCommit:saved.sourceCommit};if(saved.format!=='hermes-source-session-v1'||saved.sourceCommit!=='c627ec84664d43e0b18b95d9d86d8963747d56c7'||value.sourceCommit!==saved.sourceCommit||typeof value.threadId!=='string'||!value.threadId||value.accountId!==accountId||value.sessionPath!==path||pathFor(value)!==path||threadId!==undefined&&value.threadId!==threadId)throw error('HERMES_SESSION_INVALID','The source session belongs to a different task, account or engine.');return value;}
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
  try{const captured=currentPolicy?await settings(previous.input):previous.settings;admitted(ticket);if(method==='skills.curate')reviewRelease=await hermesReviewCapacity.acquire('review',null,ticket.controller.signal);admitted(ticket);const source=await ensure(captured);admitted(ticket);lease=options.accounts?.claimUse?.(previous.input.modelId.split('/')[0] as Parameters<NonNullable<RuntimeAccountResolver['claimUse']>>[0],previous.input.accountId??null);let release!:()=>void;const done=new Promise<void>(resolve=>{release=resolve;}),broker=await createHermesBroker({input:previous.input,createRuntime:()=>nativeFactory(nativeOptions),onUsage:value=>{if(owner)usage(owner,value);}});try{admitted(ticket);}catch(failure){await broker.close();throw failure;}
   owner=active={...previous,source,settings:captured,broker,known:new Set(previous.known),tickets:new Map(previous.tickets),entered:new Set(),tools:new Set(),lease,done,finish:release,foreground:false,review:true,uiSettled:true,closing:undefined,writes:Promise.resolve(),usage:[],maintenance:ctx,lastMessage:undefined,reviewAbort:undefined,reviewRelease,libraryRevoked:false,libraryCalls:new Set()};
   try{admitted(ticket);const result=await source.request<T>(method,{...params,brokerURL:broker.url,jobKey:broker.key,modelId:previous.input.modelId,accountId:previous.input.accountId??null,sessionPath:previous.path,skillPolicy:captured.skillPolicy??{enabled:true,allowWrites:false},ctx:{threadId:previous.input.threadId,runId:previous.input.runId,epoch:previous.input.epoch,accountId:previous.input.accountId??null}});admitted(ticket);await finish(owner,{});return result;}catch(failure){if(owner.failure||ticket.revoked||disposed)await forceOwner(owner,source);else await finish(owner,{error:true});throw failure;}
  }catch(failure){if(!owner){reviewRelease?.();if(lease)options.accounts?.releaseUse?.(lease);}throw failure;}finally{ticket.finish();}
 }
 async function history(path:string,accountId?:string|null):Promise<string[]>{
  const file=resolve(path);if(!within(sessions,file)){if(options.nativeCatalog)return options.nativeCatalog.history(path,accountId);throw error('HERMES_SESSION_INVALID','This is not an app-owned Hermes source session.');}
  await safeFile(file);const text=await readFile(file,'utf8');if(Buffer.byteLength(text)>MODEL_ONLY_MAX_WIRE_BYTES)throw error('HERMES_SESSION_LIMIT','The source session exceeds its bounded reader limit.');const saved=JSON.parse(text);sessionOwner(saved,file,accountId??null);
  const receiptPath=file+'.inputs.jsonl';await safeFile(receiptPath);let lines:string;try{lines=await readFile(receiptPath,'utf8');}catch(failure){if((failure as NodeJS.ErrnoException).code==='ENOENT')return[];throw failure;}if(Buffer.byteLength(lines)>MODEL_ONLY_MAX_WIRE_BYTES)throw error('HERMES_SESSION_LIMIT','The source receipts exceed their bounded reader limit.');
  const ids=new Set<string>();for(const line of lines.split('\n')){if(!line.trim())continue;const value=JSON.parse(line);if((value.accountId??null)!==(accountId??null)||pathFor(value)!==file||!Array.isArray(value.inputIds)||value.inputIds.some((id:unknown)=>typeof id!=='string'||!id))throw error('HERMES_SESSION_INVALID','The source input receipt is invalid.');for(const id of value.inputIds)ids.add(id);}return[...ids];
 }
 const runtime:HermesEngine={
  configure(value){callbacks=value;},models(value){activeSource();return catalog.models(value);},
  get sourceBusy(){return!!admission||!!active?.foreground;},get reviewBusy(){return!!active?.review||!!active&&!active.foreground;},
  async sourceTool(params,authority){activeSource();authority?.check();while(admission){await admission.done;activeSource();authority?.check();}const captured=active?.settings??await settings();authority?.check();return exclusive(async()=>{authority?.check();const source=await ensureSource(active?.settings??captured);authority?.check();const work=source.request(params.releaseOwner===true?'skills.releaseOwner':'skills.tool',params);authority?.track(work);return work;});},
  async refreshIntegrations(disabledIds){const revision=++integrationRevision;for(const id of disabledIds)revokedIntegrations.set(id,revision);integrationConfig={...integrationConfig,enabled:integrationConfig.enabled.filter(id=>!disabledIds.includes(id))};if(active?.settings.integrations)active.settings.integrations={...active.settings.integrations,enabled:active.settings.integrations.enabled.filter(id=>!disabledIds.includes(id))};const config=structuredClone(integrationConfig),projectRoot=integrationProject;if(ready){const source=await ready;await source.request('integrations.refresh',{config,projectRoot,disabledIds,integrationRevision:revision});}},
  async sourceRequest<T>(method:string,params:Record<string,unknown>={}){activeSource();if(!method.startsWith('skills.')&&method!=='learn.prompt')throw error('HERMES_SOURCE_METHOD','This source method is not a library operation.');while(admission)await admission.done;activeSource();if(method==='skills.curate'&&params.consolidate===true){if(active?.foreground)throw error('HERMES_SOURCE_BUSY','Wait for the current foreground before LLM curation.');if(active)await active.done;if(!retained)throw error('HERMES_CURATOR_OWNER_REQUIRED','Select and run a task model/account before LLM curation.');return maintenance<T>(retained,retained.input,method,params,true);}if(active&&!['learn.prompt','skills.snapshot','skills.list','skills.inspect','skills.view','skills.versions','skills.proposals'].includes(method))throw error('HERMES_SOURCE_BUSY','Wait for the current source review before changing its library.');const captured=active?.settings??await settings();if(admission)return runtime.sourceRequest<T>(method,params);return exclusive(async()=>{const source=await ensureSource(active?.settings??captured);return source.request<T>(method,params);});},
  async start(value){activeSource();if(!callbacks)throw error('HERMES_NOT_CONFIGURED','Configure Hermes callbacks before starting.');if(admission||active?.foreground)throw error('HERMES_SOURCE_BUSY','The original Hermes source worker already owns a foreground conversation.');const input=structuredClone(value),ticket=reserve(input);
   try{const captured=await settings(input);admitted(ticket);assertModelOnlyInput(input);if(active)await active.done;admitted(ticket);const source=await ensure(captured);admitted(ticket);const path=pathFor(input);let migrated:unknown[]|undefined;if(input.sessionPath&&resolve(input.sessionPath)!==path){if(within(sessions,resolve(input.sessionPath))||!options.initialHistory)throw error('HERMES_SESSION_INVALID','A native session requires explicit canonical transcript migration.');migrated=await options.initialHistory(input);admitted(ticket);if(!Array.isArray(migrated)||!migrated.length)throw error('HERMES_MIGRATION_EMPTY','The legacy conversation could not be migrated from canonical messages.');}await safeFile(path);admitted(ticket);await safeFile(path+'.inputs.jsonl');admitted(ticket);try{const text=await readFile(path,'utf8');admitted(ticket);sessionOwner(JSON.parse(text),path,input.accountId??null,input.threadId);}catch(failure){if((failure as NodeJS.ErrnoException).code!=='ENOENT')throw failure;}admitted(ticket);
    const tools=await toolsFor(captured);admitted(ticket);const known=new Set(input.inputIds??[input.inputId]);if(!known.size||!known.has(input.inputId)||[...known].some(id=>typeof id!=='string'||!id))throw error('HERMES_INPUT_INVALID','The source input identifiers are invalid.');
    const provider=input.modelId.split('/')[0];if(!isConnectionProviderId(provider))throw error('HERMES_MODEL_INVALID','Select a supported native connection model.');if(input.accountId){const account=options.accounts?.get(input.accountId);if(!account||!account.enabled||account.providerId!==provider)throw error('HERMES_ACCOUNT_INVALID','The selected saved account does not match this model.');}if(options.accounts?.isSigningIn?.(provider,input.accountId??null))throw error('ACCOUNT_SIGNING_IN','Wait for account sign-in to finish.');const lease=options.accounts?.claimUse?.(provider,input.accountId??null);
    let release!:()=>void;const done=new Promise<void>(resolve=>{release=resolve;});let owner!:Owner;
    try{const broker=await createHermesBroker({input,createRuntime:()=>nativeFactory(nativeOptions),onInput:async ids=>{if(active!==owner)return;const fresh=ids.filter(id=>!owner.entered.has(id));if(!fresh.length)return;owner.writes=owner.writes.then(async()=>{await safeFile(path+'.inputs.jsonl');await appendFile(path+'.inputs.jsonl',JSON.stringify({threadId:input.threadId,accountId:input.accountId??null,inputIds:fresh})+'\n',{mode:0o600});for(const id of fresh)owner.entered.add(id);emit(owner,'input.processing',{inputIds:fresh});});await owner.writes;},onUsage:(value,metadata)=>{if(metadata.phase==='foreground')usage(owner,value);}});
     try{admitted(ticket);}catch(failure){await broker.close();throw failure;}owner=active={input,source,settings:captured,tools:new Set(tools.map(tool=>tool.name)),path,broker,known,tickets:new Map(),entered:new Set(),lease,done,finish:release,foreground:true,review:false,uiSettled:false,writes:Promise.resolve(),usage:[],libraryCalls:new Set()};
     revokeCaptured(captured);integrationConfig=structuredClone(captured.integrations??{enabled:[],ponytailMode:'off'});integrationProject=captured.projectRoot;admitted(ticket);const result=await source.request<{accepted?:boolean}>('agent.start',{ctx:{threadId:input.threadId,runId:input.runId,epoch:input.epoch,accountId:input.accountId??null},modelId:input.modelId,accountId:input.accountId??null,prompt:encodeInput(input),...(options.approvedWriteHooks&&!options.readOnly?{completedWrites:completedWrites(input,captured)}:{}),inputIds:[...known],...(migrated?{history:migrated}:{}),integrations:integrationConfig,integrationRevision:settingsRevisions.get(captured)??integrationRevision,projectRoot:integrationProject,sessionId:input.threadId,sessionPath:path,thinkingLevel:input.thinkingLevel,systemPrompt:captured.systemPrompt??hostSystemPrompt(input.memory),hostTools:tools,skillPolicy:captured.skillPolicy??{enabled:true,allowWrites:false},brokerURL:broker.url,jobKey:broker.key});admitted(ticket);if(result.accepted!==true)throw error('HERMES_SOURCE_REJECTED','The original source did not accept its conversation.');emit(owner,'session',{sessionPath:path,...(migrated?{migrated:true}:{})});
    }catch(failure){if(owner){owner.failure=failure;await forceOwner(owner,source);}else if(lease)options.accounts?.releaseUse?.(lease);throw failure;}
   }finally{ticket.finish();}
  },
  async followUp(value){activeSource();if(value.completedWrites?.length)throw error('HERMES_INPUT_INVALID','Completed writes require an idle source turn.');const owner=active;if(!owner||!owner.foreground||!same(value,owner.input)||value.modelId!==owner.input.modelId||(value.accountId??null)!==(owner.input.accountId??null))throw error('HERMES_STALE_RUN','This follow-up does not belong to the active Hermes run.');assertModelOnlyInput(value);const ids=value.inputIds??[value.inputId];if(!ids.length||ids[0]!==value.inputId||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id||owner.known.has(id)))throw error('HERMES_INPUT_INVALID','A source steering ticket must identify new inputs.');for(const id of ids)owner.known.add(id);owner.tickets.set(value.inputId,[...ids]);try{const result=await(await ensure(owner.settings)).request<{accepted?:boolean}>('agent.followUp',{prompt:encodeInput(value),inputId:value.inputId});if(result.accepted!==true)throw error('HERMES_STEER_REJECTED','The original source did not accept this follow-up.');}catch(failure){for(const id of ids)owner.known.delete(id);owner.tickets.delete(value.inputId);throw failure;}},
  async cancel(ctx){const ticket=admission&&same(ctx,admission.input)?admission:undefined;if(ticket){ticket.revoked=true;ticket.controller.abort();}const owner=active;if(owner&&same(ctx,{...owner.input,...owner.maintenance}))await cancelOwner(owner);if(ticket)await ticket.done;},
  async cancelBackground(){if(admission?.maintenance){await runtime.cancel(admission.input);return;}if(!active)return;active.reviewAbort?.abort();await client?.request('agent.cancelBackground');if(active&&!active.foreground)await active.done;},
  async compact(ctx,path,modelId,accountId){activeSource();if(admission||active?.foreground)throw error('HERMES_SOURCE_BUSY','Wait for the foreground conversation before compacting.');if(active)await active.done;const previous=retained;if(!previous||previous.source!==client||resolve(path)!==previous.path||ctx.threadId!==previous.input.threadId||modelId!==previous.input.modelId||(accountId??null)!==(previous.input.accountId??null))throw error('HERMES_SESSION_INVALID','Compaction requires the exact retained live thread, model, account and source session.');const display={...previous,maintenance:ctx};emit(display,'compaction.start',{reason:'manual'});const result=await maintenance<{compacted?:boolean}>(previous,ctx,'agent.compact',{});if(result.compacted!==true)throw error('HERMES_COMPACTION_UNCONFIRMED','The original source did not compact its conversation.');emit(display,'compaction.end',{reason:'manual',aborted:false});emit(display,'settled',{aborted:false});},
  history,
  dispose(){return disposing??=(async()=>{disposed=true;const ticket=admission;if(ticket){ticket.revoked=true;ticket.controller.abort();}const owner=active,source=client;owner?.reviewAbort?.abort();const outcomes=await Promise.allSettled([owner?forceOwner(owner,source):source?closeSource(source):Promise.resolve(),catalog.dispose()]);if(ticket)await ticket.done;await transitions;const late=client&&client!==source?await Promise.allSettled([closeSource(client)]):[];const failures=[...outcomes,...late].flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,'Hermes cleanup could not be confirmed.');})();},
 };return runtime;
}

/** Each personal task has its own original engine; only the library and request gates are shared. */
export function createHermesRuntime(options:HermesRuntimeOptions,dependencies:HermesRuntimeDependencies={}):HermesRuntime{return createHermesTaskPool(options,dependencies,createHermesEngine);}
