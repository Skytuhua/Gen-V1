// Adapted from T3 Code ProviderCredentialStore.ts, MIT, Copyright (c) 2026 T3 Tools Inc.
// Source and full license: third-party/t3code/README.md and LICENSE.
import { createHash } from 'node:crypto';
import { join,resolve,sep } from 'node:path';
import {lstat,mkdir,readdir} from 'node:fs/promises';
import { HarnessError } from '../contracts/index.ts';
import { isConnectionProviderId,isOfficialRuntimeProviderId } from '../contracts/connections.ts';
import { isAccountId, type ConnectionAccount } from '../contracts/accounts.ts';
import {withPathGuard} from '../core/file-access.ts';

export function providerAccountKey(driver: string, bindingId: string): string {
  // Hash the tuple so arbitrary bindings cannot escape or exceed a filename.
  const bindingHash = createHash('sha256').update(new TextEncoder().encode(`${driver.length}:${driver}${bindingId}`)).digest('hex');
  return `provider-auth-${bindingHash}`;
}
export function accountProfileRoot(dataDir: string, account: ConnectionAccount): string {
  if (!isConnectionProviderId(account.providerId) || !isAccountId(account.id)) throw new HarnessError('ACCOUNT_INVALID', 'Choose a saved subscription account.');
  return join(dataDir, 'accounts', providerAccountKey(account.providerId, account.id));
}

async function ordinaryDirectory(path:string,create=false):Promise<void> {
  if(create)try{await mkdir(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw new HarnessError('CAPABILITY_DENIED','The account profile must be an ordinary local directory.');
}

function nativeDirectories(profile:string,account:ConnectionAccount,threadId?:string):string[] {
  const task=threadId===undefined?undefined:createHash('sha256').update(threadId).digest('hex');
  const parts=isOfficialRuntimeProviderId(account.providerId)?[
    `official/${account.providerId}/tasks`,
    ...['tmp','.config','.cache','.local/share','.local/state','AppData/Roaming','AppData/Local',...(account.providerId==='gemini-cli'?['.gemini']:[])].map(part=>`official/${account.providerId}/home/${part}`),
    ...(task?[`official/${account.providerId}/tasks/${task}`]:[]),
  ]:['pi/tasks',...(task?[`pi/tasks/${task}/sessions`]:[])];
  const paths=new Set<string>();
  for(const part of parts){const components=part.split('/');for(let index=1;index<=components.length;index++)paths.add(join(profile,...components.slice(0,index)));}
  return [...paths].sort((left,right)=>left.split(sep).length-right.split(sep).length);
}

/** Inspect names and filesystem metadata only; never read native credential contents. */
async function descendantDirectories(root:string):Promise<string[]> {
  const directories:string[]=[];let count=0;
  async function inspect(path:string,depth:number):Promise<void> {
    if(depth>64)throw new HarnessError('CAPABILITY_DENIED','The native account profile exceeds the directory depth limit.');
    for(const name of await readdir(path)){
      if(++count>10000)throw new HarnessError('CAPABILITY_DENIED','The native account profile exceeds the entry limit.');
      const child=join(path,name),info=await lstat(child,{bigint:true});
      if(info.isSymbolicLink()||(!info.isDirectory()&&(!info.isFile()||info.nlink!==1n)))throw new HarnessError('CAPABILITY_DENIED','Redirected or multiply linked native account storage is unsupported.');
      if(info.isDirectory()){directories.push(child);await inspect(child,depth+1);}
    }
  }
  await inspect(root,0);return directories;
}

async function withNativeDirectories<T>(root:string,profile:string,account:ConnectionAccount,threadId:string|undefined,signal:AbortSignal,action:()=>Promise<T>):Promise<T> {
  const paths=nativeDirectories(profile,account,threadId);
  async function prepare(index:number):Promise<T> {
    if(index<paths.length){const path=paths[index];await ordinaryDirectory(path,true);
      if(process.platform==='linux'&&path===join(profile,'pi')){const {prepareLinuxCredentialParent}=await import('../core/linux-path-guard.ts');await prepareLinuxCredentialParent(join(path,'auth.json'));}
      return withPathGuard([{path,leaf:false,allowChildWrites:true,childWriteRoot:root}],signal,()=>prepare(index+1));}
    const directories=await descendantDirectories(profile);
    return withPathGuard(directories.map(path=>({path,leaf:false,allowChildWrites:true,childWriteRoot:root})),signal,async()=>{
      // Check again after native handle acquisition. Auth files remain replaceable.
      const verified=await descendantDirectories(profile);
      if(verified.length!==directories.length||verified.some(path=>!directories.includes(path)))throw new HarnessError('CAPABILITY_DENIED','The native account profile changed while acquiring its directory guard.');
      return action();
    });
  }
  return prepare(0);
}

/** Pin account namespace ancestors while the native runtime acquires its profile. */
export async function withAccountProfile<T>(dataDir:string,account:ConnectionAccount|null,action:(root:string)=>Promise<T>,signal:AbortSignal=new AbortController().signal,threadId?:string):Promise<T> {
  const root=resolve(dataDir);if(!account)return action(root);
  const profile=accountProfileRoot(root,account),accounts=join(root,'accounts');
  await ordinaryDirectory(root);
  return withPathGuard([{path:root,leaf:false,allowChildWrites:true,childWriteRoot:root}],signal,async()=>{
    await ordinaryDirectory(accounts,true);
    return withPathGuard([{path:accounts,leaf:false,allowChildWrites:true,childWriteRoot:root}],signal,async()=>{
      await ordinaryDirectory(profile,true);
      return withPathGuard([{path:profile,leaf:false,allowChildWrites:true,childWriteRoot:root}],signal,()=>withNativeDirectories(root,profile,account,threadId,signal,()=>action(profile)));
    });
  });
}
