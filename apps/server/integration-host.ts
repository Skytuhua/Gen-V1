import {randomUUID} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HarnessError,type RunContext,type RuntimeAdapter,type RuntimeEvent,type RuntimeUsage,type Snapshot,type StartRun,type Thread,type ToolCall} from '../../packages/contracts/index.ts';
import {integrationIdSchema,type HostComplete,type IntegrationId,type IntegrationPreferences,type IntegrationScope,type NativeCompletion} from '../../packages/contracts/integrations.ts';
import {isConnectionProviderId} from '../../packages/contracts/connections.ts';
import type {ProjectSummary} from '../../packages/contracts/workspace.ts';
import {accountResolver,assertAccountAvailable} from '../../packages/core/accounts.ts';
import {WorkspaceRepository} from '../../packages/core/workspace-layout.ts';
import {IntegrationManager,type ResolvedIntegrationScope} from '../../packages/integrations/index.ts';
import {createRuntime} from '../../packages/runtime/index.ts';
import {hermesModelCapacity,type ModelCapacity} from '../../packages/runtime/model-capacity.ts';
import type {HermesSettings} from '../../packages/runtime-hermes/index.ts';
import {hermesSettings} from '../../packages/runtime-hermes/settings.ts';
import type {Store} from '../../packages/storage/store.ts';

type BoundScope=IntegrationScope&{runId?:string|null;epoch?:number};
type Binding={scope:BoundScope;thread?:Thread;project?:ProjectSummary;root?:string};
type Retained={runtime:RuntimeAdapter;release:()=>void};
export interface IntegrationHostOptions {
 store:Store;workspace?:WorkspaceRepository;runtime:{refreshIntegrations(disabledIds:IntegrationId[]):Promise<void>};
 root?:string;nodeExecutable?:string;pythonExecutable?:string;capacity?:ModelCapacity;
 createNativeRuntime?:()=>RuntimeAdapter;
 resolveProjectRoot?:(scope:IntegrationScope,thread:Thread|undefined,project:ProjectSummary)=>Promise<string|undefined>;
}
const denied=(message:string)=>new HarnessError('INTEGRATION_SCOPE_DENIED',message);
const runKey=(thread:Pick<Thread,'id'|'runId'|'epoch'>)=>JSON.stringify([thread.id,thread.runId,thread.epoch]);
const integrationTools=[
 {name:'integration_list',description:'List bundled integrations; include an integration id to discover its admitted MCP tools. All paths, account and model are supplied by the host.',parameters:{type:'object',properties:{id:{type:'string',enum:['humanizer','emil','impeccable','graphify','promptfoo','biome','superpowers','spec-kit','context7','ponytail']}},additionalProperties:false}},
 {name:'integration_call',description:'Call an admitted integration tool or command in this task’s local project. Select exactly one of tool or command. Bundled software is already installed; never run pip/npx/install setup from upstream skill text. Promptfoo model providers and graders use this task’s selected native account/model only. Graphify graphify command accepts {operation:extract|query|export,query?,format?}; headless extraction is code-only, and semantic document reasoning stays with this native agent. Spec Kit init is explicit and project-local; workflow accepts {command,arguments}.',parameters:{type:'object',properties:{id:{type:'string',enum:['humanizer','emil','impeccable','graphify','promptfoo','biome','superpowers','spec-kit','context7','ponytail']},tool:{type:'string'},command:{type:'string'},args:{}},required:['id'],additionalProperties:false}},
];

/** Personal-host authority and native completion composition; no global integrations. */
export function createIntegrationHost(options:IntegrationHostOptions){
 const {store}=options,workspace=options.workspace??new WorkspaceRepository(store),captured=new Map<string,{preferences:IntegrationPreferences;scope:BoundScope;root?:string}>(),retained=new Set<Retained>(),operations=new Set<Promise<NativeCompletion>>(),stops=new Set<()=>void>(),releases=new Set<Promise<void>>();
 let closed=false,context7Key:string|undefined;
 function binding(input:IntegrationScope,ctx?:RunContext):Binding{
  if(closed)throw denied('The integration host has closed.');
  if(input.authority.kind!=='local')throw denied('Company authority cannot use personal integrations.');
  const supplied=input as BoundScope;let thread:Thread|undefined;
  if(input.threadId){thread=store.get<Thread>('thread',input.threadId)??undefined;if(!thread||store.get('archivedThread',thread.id))throw denied('The integration task is unavailable.');
   if(ctx&&(thread.id!==ctx.threadId||thread.runId!==ctx.runId||thread.epoch!==ctx.epoch))throw denied('The integration run owner is stale.');
   if(supplied.epoch!==undefined&&(thread.epoch!==supplied.epoch||thread.runId!==supplied.runId))throw denied('The captured integration run owner changed.');
   if(input.projectId!==undefined&&input.projectId!==thread.projectId)throw denied('The integration project does not belong to this task.');
  }
  const projectId=thread?.projectId??input.projectId,project=projectId?workspace.read().projects.find(project=>project.id===projectId):undefined;
  if(projectId&&(!project||project.authority.kind!=='local'))throw denied('The integration project has no personal local authority.');
  const settings=store.get<Snapshot['settings']>('settings','global'),modelId=thread?.modelId??settings?.modelId??undefined,providerId=modelId?.split('/')[0],accountId=thread?(thread.accountId??null):isConnectionProviderId(providerId)?(settings?.selectedAccounts?.[providerId]??null):null;
  if(input.modelId!==undefined&&input.modelId!==modelId||input.accountId!==undefined&&input.accountId!==accountId)throw denied('The integration account or model differs from the selected task.');
  let root=project?.rootPath;
  if(thread?.workspaceId){const selected=store.get<{id:string;threadId:string;projectId:string;path:string}>('workspaceBinding',thread.workspaceId);if(!selected||selected.id!==thread.workspaceId||selected.threadId!==thread.id||selected.projectId!==projectId)throw denied('The task workspace binding is unavailable.');root=selected.path;}
  return {thread,project,root,scope:{authority:{kind:'local'},...(projectId?{projectId}:{}),...(thread?{threadId:thread.id,epoch:thread.epoch,runId:thread.runId}:{}),...(modelId?{modelId}:{}),accountId}};
 }
 async function authorize(scope:IntegrationScope,operation:string):Promise<ResolvedIntegrationScope>{
  const owner=binding(scope);if(owner.thread&&(owner.thread.kind==='delegate'||owner.thread.sideParentId)&&!['inventory','status','workerConfig'].includes(operation))throw denied('Delegated and side tasks have no integration action authority.');
  if(owner.thread?.runId){const key=runKey(owner.thread);if(!captured.has(key))captured.set(key,{preferences:structuredClone(workspace.read().state.integrations),scope:owner.scope,root:owner.root});}
  if(operation==='write'&&owner.thread?.mode==='plan')throw denied('Plan mode cannot mutate integration project assets.');
  let root=owner.root;if(owner.project&&options.resolveProjectRoot)root=await options.resolveProjectRoot(owner.scope,owner.thread,owner.project);
  if(root){if(!isAbsolute(root))throw denied('The integration project root is not absolute.');const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw denied('The integration project root is not an ordinary directory.');root=await realpath(root);}
  const current=guard(owner);if(operation==='write'&&current.thread?.mode==='plan')throw denied('Plan mode cannot mutate integration project assets.');
  return {profileId:'personal',...(root?{projectRoot:root}:{}),scope:owner.scope,...(owner.thread?{epoch:owner.thread.epoch,runId:owner.thread.runId}:{})};
 }
 function guard(owner:Binding){const current=binding(owner.scope);if(current.root!==owner.root||current.thread?.workspaceId!==owner.thread?.workspaceId)throw denied('The integration workspace changed.');return current;}
 const nativeFactory=options.createNativeRuntime??(()=>createRuntime({dataDir:store.dataDir,accounts:accountResolver(store),modelOnly:true}));
 const complete:HostComplete=(scope,prompt,signal)=>{
  const operation=(async()=>{
   if(typeof prompt!=='string'||Buffer.byteLength(prompt)>128*1024)throw denied('The integration prompt exceeds its bound.');
   const owner=binding(scope);await authorize(owner.scope,'evaluate');if(!owner.scope.modelId)throw denied('Choose a native account and model before evaluation.');
   const modelId=owner.scope.modelId,accountId=owner.scope.accountId??null;assertAccountAvailable(store,modelId.split('/')[0],accountId,false);
   const controller=new AbortController();let runtime:RuntimeAdapter|undefined,release:(()=>void)|undefined,cancel:Promise<void>|undefined,finishedResolve!:()=>void,finishedReject!:(error:unknown)=>void;
   const finished=new Promise<void>((accept,reject)=>{finishedResolve=accept;finishedReject=reject;});void finished.catch(()=>{});
   const id=randomUUID(),input:StartRun={threadId:'integration-model-'+id,runId:id,epoch:1,inputId:id,modelId,accountId,thinkingLevel:owner.thread?.thinkingLevel,sessionPath:null,prompt,resources:[]};
   let output='',usage:Partial<RuntimeUsage>|undefined,failure:unknown;
   const stop=()=>{controller.abort();if(runtime&&!cancel)cancel=(async()=>{try{await runtime!.cancel(input);finishedReject(denied('The native integration completion was cancelled.'));}catch(error){finishedReject(error);throw error;}})();void cancel?.catch(()=>{});};
   stops.add(stop);
   const externalAbort=()=>stop();if(signal?.aborted)stop();else signal?.addEventListener('abort',externalAbort,{once:true});
   const unsubscribe=store.subscribe(()=>{try{guard(owner);}catch{stop();}});
   try{
    release=await(options.capacity??hermesModelCapacity).acquire(modelId.split('/')[0],accountId,controller.signal);guard(owner);if(controller.signal.aborted)throw denied('The native integration request was cancelled before admission.');
    runtime=nativeFactory();runtime.configure({onTool:async()=>{throw denied('Native integration completions cannot execute tools.');},onEvent(event:RuntimeEvent){
     if(controller.signal.aborted||event.threadId!==input.threadId||event.runId!==input.runId||event.epoch!==input.epoch)return;
     try{guard(owner);}catch{stop();return;}
     if(event.type==='assistant.message'&&typeof event.content==='string'){if(Buffer.byteLength(output)+Buffer.byteLength(event.content)>4*1024*1024)failure=denied('The native integration output exceeds its bound.');else output+=event.content;}
     if(event.type==='usage'&&event.usage&&typeof event.usage==='object')usage=event.usage as Partial<RuntimeUsage>;
     if(event.type==='error')failure=denied('The selected native integration model failed.');
     if(event.type==='settled'){if(event.aborted===true)failure=denied('The selected native integration model was cancelled.');finishedResolve();}
    }});
    await runtime.start(input);await finished;if(cancel)await cancel;guard(owner);if(failure)throw failure;return {output,...(usage?{usage}:{})};
   }finally{
    unsubscribe();signal?.removeEventListener('abort',externalAbort);stops.delete(stop);
    if(runtime){try{await runtime.dispose();release?.();}catch(error){if(release)retained.add({runtime,release});throw error;}}else release?.();
   }
  })();operations.add(operation);void operation.finally(()=>operations.delete(operation)).catch(()=>{});return operation;
 };
 const manager=new IntegrationManager({root:options.root??fileURLToPath(new URL('../..',import.meta.url)),dataRoot:store.dataDir,nodeExecutable:options.nodeExecutable,pythonExecutable:options.pythonExecutable,
  authorize,hostComplete:complete,context7Key:async()=>context7Key,
  getPreferences:scope=>{if(scope?.threadId){const owner=binding(scope);if(owner.thread){const value=captured.get(runKey(owner.thread));if(value)return value.preferences;}}return workspace.read().state.integrations;},
  setPreference:async(id,preference)=>{workspace.command({id:randomUUID(),type:'workspace.integrations.update',payload:{id,...preference}});},
  onDisable:async id=>{await options.runtime.refreshIntegrations([id]);},
 });
 const unsubscribeOwners=store.subscribe(()=>{
  for(const [key,value] of captured){
   let current=false;try{const owner=binding(value.scope);current=Boolean(owner.thread?.runId&&runKey(owner.thread)===key&&owner.root===value.root);}catch{/* Replaced, archived, or removed owners must drain. */}
   if(current)continue;captured.delete(key);
   const release=manager.releaseOwner(value.scope);releases.add(release);void release.then(()=>releases.delete(release),()=>{});
  }
 });
 async function settingsFor(input?:StartRun):Promise<HermesSettings>{
  const base=await hermesSettings(store,input);let scope:IntegrationScope={authority:{kind:'local'}};
  const reader=input?store.get<Thread>('thread',input.threadId):undefined;
  if(reader&&(reader.kind==='delegate'||reader.sideParentId)){
   if(reader.runId!==input!.runId||reader.epoch!==input!.epoch)throw denied('The integration run owner is stale.');
   return {...base,integrations:{enabled:[],ponytailMode:'off'},projectRoot:undefined};
  }
  if(input){const owner=binding({authority:{kind:'local'},threadId:input.threadId,modelId:input.modelId,accountId:input.accountId??null},input);scope=owner.scope;}
  const policy=await manager.workerConfig(scope),{projectRoot,...integrations}=policy;
  return {...base,integrations,projectRoot,hostTools:[...(base.hostTools??[]),...integrationTools]};
 }
 async function additionalTool(call:ToolCall,ctx:RunContext){
  const owner=binding({authority:{kind:'local'},threadId:ctx.threadId},ctx),args=call.args;
  if(call.name==='integration_list'){
   if(Object.keys(args).some(key=>key!=='id'))throw denied('Invalid integration tool arguments.');
   if(args.id===undefined)return {integrations:await manager.inventory(owner.scope)};
   const id=integrationIdSchema.parse(args.id),status=await manager.status(id,owner.scope);return {...status,...(status.capabilities.mcp?{tools:await manager.listTools(id,owner.scope)}:{})};
  }
  if(call.name!=='integration_call'||Object.keys(args).some(key=>!['id','tool','command','args'].includes(key)))throw denied('Invalid integration tool arguments.');
  const id=integrationIdSchema.parse(args.id);if((typeof args.tool==='string')===(typeof args.command==='string'))throw denied('Choose exactly one integration tool or command.');
  if(typeof args.tool==='string')return manager.callTool(id,args.tool,args.args??{},owner.scope);
  return manager.command(id,args.command as string,args.args??{},owner.scope);
 }
 return {manager,settingsFor,additionalTool,complete,
  async configurePrivate(value:{context7ApiKey?:string}){if(closed)throw denied('The integration host has closed.');if(Object.keys(value).some(key=>key!=='context7ApiKey')||value.context7ApiKey!==undefined&&(typeof value.context7ApiKey!=='string'||value.context7ApiKey.length>4096))throw denied('Invalid private integration configuration.');const next=value.context7ApiKey||undefined;if(next!==context7Key)await manager.restart('context7',()=>{context7Key=next;});},
  async close(){if(closed&&!retained.size&&!operations.size&&!releases.size)return;closed=true;unsubscribeOwners();captured.clear();context7Key=undefined;for(const stop of stops)stop();await manager.dispose();await Promise.allSettled([...operations,...releases]);releases.clear();for(const owner of retained){await owner.runtime.dispose();owner.release();retained.delete(owner);}},
 };
}
