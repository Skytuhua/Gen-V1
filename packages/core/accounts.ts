import {randomUUID} from 'node:crypto';
import {HarnessError,type HostCommand,type Snapshot,type Thread} from '../contracts/index.ts';
import {isConnectionProviderId,type ConnectionProviderId} from '../contracts/connections.ts';
import {isAccountId,type AccountUseLease,type ConnectionAccount,type RuntimeAccountResolver} from '../contracts/accounts.ts';
import type {Store} from '../storage/store.ts';

const leaseId=(providerId:ConnectionProviderId,accountId:string|null)=>JSON.stringify([providerId,accountId]);
type LoginLease={id:string;nonce:string;expiresAt:number;ownerPid:number;shutdownUnconfirmed?:boolean};
type AccountUse=AccountUseLease&{providerId:ConnectionProviderId;accountId:string|null;ownerPid:number;shutdownUnconfirmed?:boolean};
export const modelProvider=(modelId:string)=>modelId.split('/')[0];
export function accountResolver(store:Store):RuntimeAccountResolver {
 return {
  get:id=>isAccountId(id)?store.get<ConnectionAccount>('account',id):null,
  // A dead/expired console is not proof that all of its native children stopped.
  isSigningIn:(providerId,accountId)=>!!store.get<LoginLease>('accountLogin',leaseId(providerId,accountId)),
  claimUse:(providerId,accountId)=>store.internal('account.use.started',null,()=>{
   assertAccountAvailable(store,providerId,accountId);
   const use:AccountUse={id:randomUUID(),nonce:randomUUID(),providerId,accountId,ownerPid:process.pid};store.put('accountUse',use.id,null,use);return {id:use.id,nonce:use.nonce};
  }) as AccountUseLease,
  releaseUse:lease=>{store.internal('account.use.ended',null,()=>{const use=store.get<AccountUse>('accountUse',lease.id);if(use?.nonce===lease.nonce)store.remove('accountUse',lease.id);return {released:use?.nonce===lease.nonce};});},
 };
}
function account(store:Store,id:unknown):ConnectionAccount {
 if(!isAccountId(id))throw new HarnessError('ACCOUNT_NOT_FOUND','Choose a saved subscription account.');
 const saved=store.get<ConnectionAccount>('account',id);if(!saved||!isConnectionProviderId(saved.providerId))throw new HarnessError('ACCOUNT_NOT_FOUND','Choose a saved subscription account.');return saved;
}
export function assertAccountAvailable(store:Store,providerId:string,accountId:string|null,allowDisabled=true):void {
 if(accountId!==null){const saved=account(store,accountId);if(saved.providerId!==providerId)throw new HarnessError('ACCOUNT_PROVIDER_MISMATCH','This account belongs to another provider.');if(!allowDisabled&&!saved.enabled)throw new HarnessError('ACCOUNT_DISABLED','Restore this account before selecting it.');}
 if(isConnectionProviderId(providerId)&&accountResolver(store).isSigningIn?.(providerId,accountId))throw new HarnessError('ACCOUNT_SIGNING_IN','Wait for account sign-in to finish before starting work.');
 if(store.all<AccountUse>('accountUse').some(use=>use.providerId===providerId&&use.accountId===accountId&&use.shutdownUnconfirmed))throw new HarnessError('ACCOUNT_CLEANUP_UNCONFIRMED','Native account cleanup is unconfirmed. This account remains blocked.');
}
export function holdAccountUse(store:Store,lease:AccountUseLease):void {
 store.internal('account.use.shutdown_unconfirmed',null,()=>{const use=store.get<AccountUse>('accountUse',lease.id);if(use?.nonce===lease.nonce)store.put('accountUse',lease.id,null,{...use,shutdownUnconfirmed:true});return {held:use?.nonce===lease.nonce};});
}
/** Login targets are explicit; omitted targets preserve the original legacy profile. */
export function resolveLoginAccount(store:Store,providerId:ConnectionProviderId,accountId?:string|null):ConnectionAccount|null {
 if(!isConnectionProviderId(providerId))throw new HarnessError('INVALID_INPUT','Choose an available subscription provider.');
 const id=accountId??null;
 if(id===null)return null;const saved=account(store,id);if(saved.providerId!==providerId)throw new HarnessError('ACCOUNT_PROVIDER_MISMATCH','This account belongs to another provider.');if(!saved.enabled)throw new HarnessError('ACCOUNT_DISABLED','Restore this account before signing in.');return saved;
}
export function beginAccountLogin(store:Store,providerId:ConnectionProviderId,accountId?:string|null):{id:string;nonce:string} {
 return store.internal('account.login.started',null,()=>{
  const saved=resolveLoginAccount(store,providerId,accountId),selected=saved?.id??null;
  // Check durable run authority before reserving credential mutation, including side sessions.
  if(store.all<AccountUse>('accountUse').some(use=>use.providerId===providerId&&use.accountId===selected)||store.all<Thread>('thread').some(thread=>thread.runId&&thread.modelId&&modelProvider(thread.modelId)===providerId&&(thread.accountId??null)===selected))throw new HarnessError('ACCOUNT_BUSY','This account is still in use. Wait for its native runtime to close before signing in.');
  assertAccountAvailable(store,providerId,selected);
  const lease:LoginLease={id:leaseId(providerId,selected),nonce:randomUUID(),expiresAt:Date.now()+15*60*1000,ownerPid:process.pid};store.put('accountLogin',lease.id,null,lease);return {id:lease.id,nonce:lease.nonce};
 }) as {id:string;nonce:string};
}
export function endAccountLogin(store:Store,lease:{id:string;nonce:string}):void {
 store.internal('account.login.ended',null,()=>{const current=store.get<LoginLease>('accountLogin',lease.id),released=current?.nonce===lease.nonce&&!current.shutdownUnconfirmed;if(released)store.remove('accountLogin',lease.id);return {released};});
}
/** Expiry or a dead console cannot prove that its native children have stopped. */
export function holdAccountLogin(store:Store,lease:{id:string;nonce:string}):void {
 store.internal('account.login.shutdown_unconfirmed',null,()=>{const current=store.get<LoginLease>('accountLogin',lease.id);if(current?.nonce===lease.nonce)store.put('accountLogin',lease.id,null,{...current,shutdownUnconfirmed:true});return {held:current?.nonce===lease.nonce};});
}
function strict(payload:Record<string,unknown>,keys:string[]):void {if(Object.keys(payload).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(payload,key)))throw new HarnessError('INVALID_INPUT','Invalid account fields.');}
function label(value:unknown):string {if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>80||/[\x00-\x1f\x7f]/.test(value))throw new HarnessError('INVALID_INPUT','Use a local account label of 1 to 80 bytes.');return value.trim();}
/** Runs only inside the existing durable command transaction. Profiles are never removed. */
export function changeAccount(store:Store,command:HostCommand):unknown {
 const p=command.payload;
 if(command.threadId!==undefined)throw new HarnessError('INVALID_INPUT','Account commands are workspace settings.');
 if(command.type==='account.create'){
  strict(p,['providerId','label']);if(!isConnectionProviderId(p.providerId))throw new HarnessError('INVALID_INPUT','Choose an available subscription provider.');
  const name=label(p.label),all=store.all<ConnectionAccount>('account');if(all.length>=100||all.filter(saved=>saved.providerId===p.providerId).length>=20)throw new HarnessError('ACCOUNT_LIMIT','This provider has reached its saved account limit.');
  const stamp=new Date().toISOString(),saved:ConnectionAccount={id:randomUUID(),providerId:p.providerId,label:name,enabled:true,createdAt:stamp,updatedAt:stamp};store.put('account',saved.id,null,saved);return saved;
 }
 if(command.type==='account.select'){
  strict(p,['providerId','accountId']);if(!isConnectionProviderId(p.providerId)||(p.accountId!==null&&typeof p.accountId!=='string'))throw new HarnessError('INVALID_INPUT','Choose an available subscription provider and account.');
  assertAccountAvailable(store,p.providerId,p.accountId,false);
  const settings=store.get<Snapshot['settings']>('settings','global')??{theme:'dark',modelId:null},next={...settings,selectedAccounts:{...settings.selectedAccounts,[p.providerId]:p.accountId}};store.put('settings','global',null,next);return next;
 }
 strict(p,command.type==='account.rename'?['accountId','label']:['accountId']);
 if(!['account.rename','account.remove','account.restore'].includes(command.type))throw new HarnessError('INVALID_INPUT','Unknown account command.');
 const saved=account(store,p.accountId),next={...saved,updatedAt:new Date().toISOString(),...(command.type==='account.rename'?{label:label(p.label)}:{enabled:command.type==='account.restore'})};store.put('account',saved.id,null,next);
 if(command.type==='account.remove'){
  const settings=store.get<Snapshot['settings']>('settings','global');if(settings?.selectedAccounts?.[saved.providerId]===saved.id)store.put('settings','global',null,{...settings,selectedAccounts:{...settings.selectedAccounts,[saved.providerId]:null}});
 }
 return next;
}
