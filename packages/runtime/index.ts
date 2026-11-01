import {isAbsolute,relative,resolve,sep} from 'node:path';
import {HarnessError,type RuntimeAdapter,type RuntimeCallbacks,type RunContext,type StartRun} from '../contracts/index.ts';
import {createPiRuntime} from '../runtime-pi/index.ts';
import {createOfficialRuntime} from '../runtime-official/index.ts';
import {isConnectionProviderId,isOfficialRuntimeProviderId,type OfficialRuntimeProviderId} from '../contracts/connections.ts';

type Provider='pi'|OfficialRuntimeProviderId;
type Factories={pi:(options:{dataDir:string})=>RuntimeAdapter;official:(options:{dataDir:string})=>RuntimeAdapter};
type Owner={provider:Provider;adapter:RuntimeAdapter;modelId:string};
const key=(ctx:RunContext)=>JSON.stringify([ctx.threadId,ctx.runId,ctx.epoch]);
const providerForModel=(modelId:string):Provider=>{const provider=modelId.split('/')[0];return isOfficialRuntimeProviderId(provider)?provider:'pi';};

/** Routes execution; each adapter retains its own protocol, auth and session validation. */
export function createRuntime(options:{dataDir:string},factories:Factories={pi:createPiRuntime,official:createOfficialRuntime}):RuntimeAdapter{
 const root=resolve(options.dataDir),pi=factories.pi(options),official=factories.official(options),owners=new Map<string,Owner>();
 let callbacks:RuntimeCallbacks|undefined,disposed=false;
 const active=()=>{if(disposed)throw new HarnessError('RUNTIME_DISPOSED','The runtime has closed.');};
 const owner=(ctx:RunContext,adapter:RuntimeAdapter)=>{
  const current=owners.get(key(ctx));
  if(disposed||current?.adapter!==adapter)throw new HarnessError('STALE_RUN','This runtime run no longer has authority.');
  return current;
 };
 for(const adapter of [pi,official])adapter.configure({
  onEvent(event){
   let current:Owner;try{current=owner(event,adapter);}catch{return;}
   if(event.type==='settled')owners.delete(key(event));
   if(current&&callbacks)callbacks.onEvent(event);
  },
  async onTool(call,ctx){
   owner(ctx,adapter);if(!callbacks)throw new HarnessError('RUNTIME_NOT_CONFIGURED','The runtime is not configured.');
   const result=await callbacks.onTool(call,ctx);owner(ctx,adapter);return result;
  },
 });
 function providerForSession(path:string):Provider{
  if(!isAbsolute(path))throw new HarnessError('RUNTIME_SESSION_INVALID','The session path must belong to this harness profile.');
  const part=relative(root,resolve(path));
  if(part===''||part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw new HarnessError('RUNTIME_SESSION_INVALID','The session path must belong to this harness profile.');
  const pieces=part.split(sep);if(pieces[0]?.toLowerCase()!=='official')return 'pi';
  if(isOfficialRuntimeProviderId(pieces[1]))return pieces[1];
  throw new HarnessError('RUNTIME_SESSION_INVALID','The official session provider is unknown.');
 }
 function choose(modelId:string,sessionPath:string|null){
  const provider=providerForModel(modelId);
  if(provider!=='pi'&&!isConnectionProviderId(provider))throw new HarnessError('RUNTIME_PROVIDER_UNAVAILABLE','This official runtime is not yet available.');
  if(sessionPath&&providerForSession(sessionPath)!==provider)throw new HarnessError('RUNTIME_SESSION_MISMATCH','This session belongs to another runtime. Start a new thread to change runtimes.');
  return {provider,adapter:provider==='pi'?pi:official,modelId};
 }
 function reserve(ctx:RunContext,selected:Owner){
  active();if(!callbacks)throw new HarnessError('RUNTIME_NOT_CONFIGURED','The runtime is not configured.');
  if(owners.size)throw new HarnessError('RUNTIME_BUSY','Another run still owns the runtime.');
  owners.set(key(ctx),selected);
 }
 return {
  configure(value){active();callbacks=value;},
  async models(refresh){
   active();const results=await Promise.allSettled([pi.models(refresh),official.models(refresh)]);active();
   const models=results.flatMap(result=>result.status==='fulfilled'?result.value:[]).filter(model=>{
    const provider=providerForModel(model.id);
    return (provider==='pi'||isConnectionProviderId(provider))&&(!isOfficialRuntimeProviderId(model.provider)||isConnectionProviderId(model.provider));
   });
   if(!models.length&&results.some(result=>result.status==='rejected'))throw new HarnessError('AI_AUTH_REQUIRED','No signed-in subscription runtime is available. Connect a provider in Settings and refresh models.');
   return models;
  },
  async start(input:StartRun){
   const selected=choose(input.modelId,input.sessionPath);reserve(input,selected);
   try{await selected.adapter.start(input);}catch(error){
    if(owners.get(key(input))===selected)owners.delete(key(input));
    await selected.adapter.cancel(input);throw error;
   }
  },
  async followUp(input){
   active();const current=owners.get(key(input));if(!current)throw new HarnessError('STALE_RUN','Start or resume this task under fresh run authority.');
   if(current.modelId!==input.modelId)throw new HarnessError('RUNTIME_MODEL_MISMATCH','Stop the active run before changing models.');
   choose(input.modelId,input.sessionPath);await current.adapter.followUp(input);
  },
  async cancel(ctx){
   const current=owners.get(key(ctx));owners.delete(key(ctx));
   if(current)await current.adapter.cancel(ctx);
  },
  async compact(ctx,sessionPath,modelId){
   const selected=choose(modelId,sessionPath);reserve(ctx,selected);
   try{await selected.adapter.compact(ctx,sessionPath,modelId);}
   catch(error){if(owners.get(key(ctx))===selected)owners.delete(key(ctx));await selected.adapter.cancel(ctx);throw error;}
   finally{if(owners.get(key(ctx))===selected)owners.delete(key(ctx));}
  },
  async history(sessionPath){active();return (providerForSession(sessionPath)==='pi'?pi:official).history(sessionPath);},
  async dispose(){
   if(disposed)return;disposed=true;owners.clear();const results=await Promise.allSettled([pi.dispose(),official.dispose()]);
   const failures=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,'Could not close every runtime.');
  },
 };
}
