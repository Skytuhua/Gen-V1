import {isAbsolute,relative,resolve,sep} from 'node:path';
import {HarnessError,type RuntimeAdapter,type RuntimeCallbacks,type RunContext,type StartRun} from '../contracts/index.ts';
import {createPiRuntime} from '../runtime-pi/index.ts';
import {createOfficialRuntime} from '../runtime-official/index.ts';
import {isConnectionProviderId,isOfficialRuntimeProviderId,SUBSCRIPTION_PROVIDER_IDS,OFFICIAL_RUNTIME_PROVIDER_IDS,type ConnectionProviderId,type OfficialRuntimeProviderId} from '../contracts/connections.ts';
import type {AccountUseLease,ConnectionAccount,RuntimeAccountResolver} from '../contracts/accounts.ts';
import {accountProfileRoot,withAccountProfile} from './account-profile.ts';

type Provider='pi'|OfficialRuntimeProviderId;
type Factories={pi:(options:{dataDir:string})=>RuntimeAdapter;official:(options:{dataDir:string})=>RuntimeAdapter};
type Pair={root:string;pi:RuntimeAdapter;official:RuntimeAdapter};
type Selection={provider:Provider;adapter:RuntimeAdapter;modelId:string;accountId:string|null};
type Owner=Selection&{ctx:RunContext;closed:boolean;closing?:Promise<void>;lease?:AccountUseLease};
const key=(ctx:RunContext)=>JSON.stringify([ctx.threadId,ctx.runId,ctx.epoch]);
const providerForModel=(modelId:string):Provider=>{const provider=modelId.split('/')[0];return isOfficialRuntimeProviderId(provider)?provider:'pi';};

/** Routes execution; each adapter retains its own protocol, auth and session validation. */
export function createRuntime(options:{dataDir:string;accounts?:RuntimeAccountResolver},factories:Factories={pi:createPiRuntime,official:createOfficialRuntime}):RuntimeAdapter{
 const root=resolve(options.dataDir),pairs=new Map<string|null,Pair>(),owners=new Map<string,Owner>(),adapters=new Set<RuntimeAdapter>(),probes=new Map<string,{adapter:RuntimeAdapter;lease:AccountUseLease}>();
 let callbacks:RuntimeCallbacks|undefined,disposed=false;
 const active=()=>{if(disposed)throw new HarnessError('RUNTIME_DISPOSED','The runtime has closed.');};
 const owner=(ctx:RunContext,adapter:RuntimeAdapter)=>{const current=owners.get(key(ctx));if(disposed||current?.adapter!==adapter||current.closed)throw new HarnessError('STALE_RUN','This runtime run no longer has authority.');return current;};
 function releaseOwner(current:Owner):void {
  if(current.lease)options.accounts?.releaseUse?.(current.lease);
  current.lease=undefined;if(owners.get(key(current.ctx))===current)owners.delete(key(current.ctx));
 }
 function close(current:Owner):Promise<void> {
  current.closed=true;
  return current.closing??=(async()=>{await current.adapter.cancel(current.ctx);releaseOwner(current);})();
 }
 function pair(account:ConnectionAccount|null):Pair {
  active();const id=account?.id??null,dataDir=account?accountProfileRoot(root,account):root,cached=pairs.get(id);
  if(cached){if(cached.root!==dataDir)throw new HarnessError('ACCOUNT_PROVIDER_MISMATCH','This saved account changed providers.');return cached;}
  const pi=factories.pi({dataDir}),official=factories.official({dataDir}),created={root:dataDir,pi,official};
  for(const adapter of [pi,official])adapter.configure({
   onEvent(event){
    let current:Owner;try{current=owner(event,adapter);}catch{return;}
    if(event.type==='settled'){
     void close(current).then(()=>{if(!disposed)callbacks?.onEvent(event);},()=>{if(!disposed)callbacks?.onEvent({...current.ctx,type:'error',message:'The native runtime could not close. Account sign-in remains blocked.'});});return;
    }
    callbacks?.onEvent(event);
   },
   async onTool(call,ctx){owner(ctx,adapter);if(!callbacks)throw new HarnessError('RUNTIME_NOT_CONFIGURED','The runtime is not configured.');const result=await callbacks.onTool(call,ctx);owner(ctx,adapter);return result;},
  });adapters.add(pi);adapters.add(official);pairs.set(id,created);return created;
 }
 pair(null);
 function resolveAccount(id:string|null|undefined):ConnectionAccount|null {
  active();if(id===undefined||id===null)return null;const saved=options.accounts?.get(id);if(!saved||saved.id!==id||!isConnectionProviderId(saved.providerId))throw new HarnessError('ACCOUNT_NOT_FOUND','Choose a saved subscription account.');
  accountProfileRoot(root,saved);return {...saved};
 }
 function available(providerId:string,accountId:string|null):void {if(isConnectionProviderId(providerId)&&options.accounts?.isSigningIn?.(providerId,accountId))throw new HarnessError('ACCOUNT_SIGNING_IN','Wait for account sign-in to finish before starting work.');}
 function providerForSession(path:string,selected:Pair):Provider {
  if(!isAbsolute(path))throw new HarnessError('RUNTIME_SESSION_INVALID','The session path must belong to this harness profile.');
  const part=relative(selected.root,resolve(path));if(part===''||part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw new HarnessError('RUNTIME_SESSION_INVALID','The session path must belong to this harness profile.');
  const pieces=part.split(sep);if(pieces[0]?.toLowerCase()==='accounts')throw new HarnessError('RUNTIME_SESSION_INVALID','The session belongs to another account profile.');
  if(pieces[0]?.toLowerCase()!=='official')return 'pi';if(isOfficialRuntimeProviderId(pieces[1]))return pieces[1];throw new HarnessError('RUNTIME_SESSION_INVALID','The official session provider is unknown.');
 }
 function choose(modelId:string,sessionPath:string|null,accountId?:string|null):Selection {
  const provider=providerForModel(modelId),providerId=modelId.split('/')[0],account=resolveAccount(accountId);
  if(provider!=='pi'&&!isConnectionProviderId(provider))throw new HarnessError('RUNTIME_PROVIDER_UNAVAILABLE','This official runtime is not yet available.');
  if(account&&account.providerId!==providerId)throw new HarnessError('ACCOUNT_PROVIDER_MISMATCH','This account belongs to another provider.');available(providerId,account?.id??null);
  const selected=pair(account);
  if(sessionPath&&providerForSession(sessionPath,selected)!==provider)throw new HarnessError('RUNTIME_SESSION_MISMATCH','This session belongs to another runtime. Start a new thread to change runtimes.');
  return {provider,adapter:provider==='pi'?selected.pi:selected.official,modelId,accountId:account?.id??null};
 }
 function reserve(ctx:RunContext,selected:Selection):Owner {
  active();if(!callbacks)throw new HarnessError('RUNTIME_NOT_CONFIGURED','The runtime is not configured.');const providerId=selected.modelId.split('/')[0];available(providerId,selected.accountId);if(owners.size)throw new HarnessError('RUNTIME_BUSY','Another run still owns the runtime.');
  const lease=isConnectionProviderId(providerId)?options.accounts?.claimUse?.(providerId,selected.accountId):undefined;
  const current:Owner={...selected,ctx:{...ctx},closed:false,lease};owners.set(key(ctx),current);return current;
 }
 async function retire(adapter:RuntimeAdapter):Promise<void> {
  const affected=[...owners.values()].filter(current=>current.adapter===adapter);for(const current of affected)current.closed=true;
  await adapter.dispose();
  for(const [id,value]of pairs)if(value.pi===adapter||value.official===adapter)pairs.delete(id);
  for(const current of affected){releaseOwner(current);if(!disposed)callbacks?.onEvent({...current.ctx,type:'error',message:'The subscription runtime closed after discovery failed. Resume the task to continue.'});}
 }
 async function probe<T>(adapter:RuntimeAdapter,providerIds:readonly ConnectionProviderId[],accountId:string|null,action:()=>Promise<T>):Promise<T> {
  const leases:AccountUseLease[]=[];
  const release=()=>{for(const lease of leases){options.accounts?.releaseUse?.(lease);probes.delete(lease.id);}};
  try{for(const providerId of providerIds){available(providerId,accountId);const lease=options.accounts?.claimUse?.(providerId,accountId);if(lease){leases.push(lease);probes.set(lease.id,{adapter,lease});}}}catch(error){release();throw error;}
  try{const result=await action();release();return result;}
  catch(error){await retire(adapter);release();throw error;}
 }
 function probeProviders(account:ConnectionAccount|null,official:boolean):ConnectionProviderId[] {return account?[account.providerId]:(official?OFFICIAL_RUNTIME_PROVIDER_IDS:SUBSCRIPTION_PROVIDER_IDS).filter(isConnectionProviderId);}
 return {
  configure(value){active();callbacks=value;},
  async models(query){
   active();const account=resolveAccount(query?.accountId),selected=pair(account);
   if(account)available(account.providerId,account.id);
   const targets=account?[isOfficialRuntimeProviderId(account.providerId)?selected.official:selected.pi]:[selected.pi,selected.official];
   const refresh=query?.refresh;
   const results=await withAccountProfile(root,account,async()=>{active();if(account)available(account.providerId,account.id);return Promise.allSettled(targets.map(adapter=>probe(adapter,probeProviders(account,adapter===selected.official),account?.id??null,()=>adapter.models(refresh===undefined?undefined:{refresh}))));});active();
   if(account){const current=resolveAccount(account.id);if(current?.providerId!==account.providerId)throw new HarnessError('ACCOUNT_PROVIDER_MISMATCH','This account changed during model discovery.');available(account.providerId,account.id);}
   const models=results.flatMap(result=>result.status==='fulfilled'?result.value:[]).filter(model=>{
    const provider=providerForModel(model.id),providerId=model.id.split('/')[0];
    return (provider==='pi'||isConnectionProviderId(provider))&&(!isOfficialRuntimeProviderId(model.provider)||isConnectionProviderId(model.provider))&&(!account||(model.provider===account.providerId&&providerId===account.providerId))&&!(isConnectionProviderId(providerId)&&options.accounts?.isSigningIn?.(providerId,account?.id??null));
   });
   if(!models.length&&results.some(result=>result.status==='rejected'))throw new HarnessError('AI_AUTH_REQUIRED','No signed-in subscription runtime is available. Connect a provider in Settings and refresh models.');return models;
  },
  async start(input:StartRun){const captured={...input},selected=reserve(captured,choose(captured.modelId,captured.sessionPath,captured.accountId)),account=resolveAccount(selected.accountId);try{await withAccountProfile(root,account,async()=>{owner(captured,selected.adapter);available(captured.modelId.split('/')[0],selected.accountId);await selected.adapter.start(captured);},undefined,captured.threadId);}catch(error){await close(selected);throw error;}},
  async followUp(input){active();const captured={...input},current=owners.get(key(captured));if(!current)throw new HarnessError('STALE_RUN','Start or resume this task under fresh run authority.');if(current.accountId!==(captured.accountId??null))throw new HarnessError('RUNTIME_ACCOUNT_MISMATCH','This run belongs to another account.');if(current.modelId!==captured.modelId)throw new HarnessError('RUNTIME_MODEL_MISMATCH','Stop the active run before changing models.');choose(captured.modelId,captured.sessionPath,captured.accountId);const account=resolveAccount(current.accountId);await withAccountProfile(root,account,async()=>{owner(captured,current.adapter);available(captured.modelId.split('/')[0],current.accountId);await current.adapter.followUp(captured);},undefined,captured.threadId);},
  async cancel(ctx){const current=owners.get(key(ctx));if(current)await close(current);},
  async compact(ctx,sessionPath,modelId,accountId){const selected=reserve(ctx,choose(modelId,sessionPath,accountId)),account=resolveAccount(selected.accountId);try{await withAccountProfile(root,account,async()=>{owner(ctx,selected.adapter);available(modelId.split('/')[0],selected.accountId);await selected.adapter.compact(ctx,sessionPath,modelId);},undefined,ctx.threadId);await close(selected);}catch(error){await close(selected);throw error;}},
  async history(sessionPath,accountId){active();const account=resolveAccount(accountId),selected=pair(account),provider=providerForSession(sessionPath,selected);if(account&&isOfficialRuntimeProviderId(account.providerId)&&provider!==account.providerId)throw new HarnessError('RUNTIME_SESSION_MISMATCH','This session belongs to another provider.');if(account&&!isOfficialRuntimeProviderId(account.providerId)&&provider!=='pi')throw new HarnessError('RUNTIME_SESSION_MISMATCH','This session belongs to another provider.');return withAccountProfile(root,account,async()=>{active();const adapter=provider==='pi'?selected.pi:selected.official;return probe(adapter,account?[account.providerId]:provider==='pi'?probeProviders(null,false):[provider],account?.id??null,()=>adapter.history(sessionPath));});},
  async dispose(){
   if(disposed)return;disposed=true;for(const current of owners.values())current.closed=true;
   const values=[...adapters],results=await Promise.allSettled(values.map(adapter=>adapter.dispose()));
   results.forEach((result,index)=>{if(result.status==='fulfilled'){for(const current of owners.values())if(current.adapter===values[index])releaseOwner(current);for(const [id,probe]of probes)if(probe.adapter===values[index]){options.accounts?.releaseUse?.(probe.lease);probes.delete(id);}}});
   const failures=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,'Could not close every runtime.');
  },
 };
}
