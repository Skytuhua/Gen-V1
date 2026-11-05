import {lstat,mkdir,mkdtemp,open,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';
import {HarnessError} from '../contracts/index.ts';
import type {Store} from '../storage/store.ts';
import type {ManagedGitFamily} from '../capabilities/git-access.ts';
import {runProcess} from '../capabilities/process.ts';
import {copyBoundGitMetadata,readBoundFile,removeOwnedFile,withPathGuard,type GuardEntry} from '../core/file-access.ts';

export type Identity={dev:string;ino:string};
export interface PrivateGitFamily {projectId:string;commonDirectory:string;commonDirectoryIdentity:Identity;origin?:string}
export interface PrivateGitAttestation extends ManagedGitFamily {privateFamily:PrivateGitFamily;privateStorageRoot:string}
type Owned={path:string;dev:bigint;ino:bigint;directory:boolean};
const denied=()=>new HarnessError('CAPABILITY_DENIED','Private Git family identity or metadata changed.');
const key=(path:string)=>path.replaceAll('\\','/').toLowerCase();
const within=(root:string,path:string)=>{const name=relative(root,path);return !name||!isAbsolute(name)&&name!=='..'&&!name.startsWith('..'+sep);};
export const sameIdentity=(a:Identity|undefined,b:Identity|undefined)=>!!a&&!!b&&a.dev===b.dev&&a.ino===b.ino;
export async function directoryIdentity(path:string):Promise<Identity>{const s=await lstat(path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())throw denied();return{dev:String(s.dev),ino:String(s.ino)};}
export function privateFamilyForBinding(store:Store,binding:ManagedGitFamily&{familyId?:string;projectId?:string}):PrivateGitAttestation|undefined{
 if(!binding.familyId)return undefined;
 const family=store.get<PrivateGitFamily>('workspaceGitFamily',binding.familyId),privateStorageRoot=join(store.dataDir,'git');
 if(!family||family.projectId!==binding.projectId||binding.familyId!==binding.projectId||family.commonDirectory!==join(privateStorageRoot,family.projectId,'repository.git')||binding.commonDirectory!==family.commonDirectory||!sameIdentity(binding.commonDirectoryIdentity,family.commonDirectoryIdentity))throw denied();
 return{...binding,privateFamily:family,privateStorageRoot};
}
const nullFile=process.platform==='win32'?'NUL':'/dev/null';
export const bareConfig='[core]\nrepositoryformatversion = 0\nbare = true\nfilemode = false\nsymlinks = false\n[gc]\nauto = 0\n[maintenance]\nauto = false\n';
const viewConfig=bareConfig.replace('bare = true','bare = false');
export async function nativeGit(executable:string,metadata:string,worktree:string|undefined,args:string[],signal:AbortSignal,environment:NodeJS.ProcessEnv={}){
 const prefix=['--no-pager','--no-replace-objects','--git-dir='+metadata,...(worktree?['--work-tree='+worktree]:[]),'-c','core.hooksPath='+nullFile,'-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','submodule.recurse=false','-c','diff.external=','-c','core.attributesFile=','-c','core.excludesFile=','-c','credential.helper=','-c','gc.auto=0','-c','maintenance.auto=false'];
 const result=await runProcess(executable,[...prefix,...args],worktree??metadata,signal,()=>{},120000,environment,4*1024*1024);
 if(result.truncated)throw new HarnessError('RESOURCE_LIMIT','Git output exceeds the 4 MiB review limit.');
 if(result.exitCode!==0||result.cancelled||result.timedOut)throw new HarnessError(result.cancelled?'CANCELLED':'GIT_ERROR','Git operation did not complete.',result);
 return result.stdout;
}
async function pointer(path:string){return(await readBoundFile(path,4096)).toString().replace(/\r?\n$/,'');}
async function verifyManaged(family:ManagedGitFamily){
 for(const[path,wanted]of[[family.path,family.identity],[family.gitDirectory,family.gitDirectoryIdentity],[family.commonDirectory,family.commonDirectoryIdentity]]as const)if(!sameIdentity(await directoryIdentity(path),wanted))throw denied();
 if(!/^worktrees\/[A-Za-z0-9_.-]+$/.test(key(relative(family.commonDirectory,family.gitDirectory))))throw denied();
 const dot=join(family.path,'.git'),gitdir=await pointer(dot),back=await pointer(join(family.gitDirectory,'gitdir'));
 if(!['gitdir: '+family.gitDirectory,'gitdir: '+family.gitDirectory.replaceAll('\\','/')].includes(gitdir)||![dot,dot.replaceAll('\\','/')].includes(back)||await pointer(join(family.gitDirectory,'commondir'))!=='../..')throw denied();
}
/** Only host Store attestation admits direct access to the protected mutable family. */
export async function withPrivateGitFamily<T>(attestation:PrivateGitAttestation,signal:AbortSignal,action:(metadata:string,worktree:string,signal:AbortSignal)=>Promise<T>):Promise<T>{
 const family=attestation.privateFamily;
 if(!family||attestation.commonDirectory!==join(attestation.privateStorageRoot,family.projectId,'repository.git')||family.commonDirectory!==attestation.commonDirectory||!sameIdentity(family.commonDirectoryIdentity,attestation.commonDirectoryIdentity))throw denied();
 const controller=new AbortController(),active=AbortSignal.any([signal,controller.signal]),common=family.commonDirectory,gitDirectory=attestation.gitDirectory,path=attestation.path;
 const paths=[{path,leaf:false,allowChildWrites:true},{path:common,leaf:false,allowChildWrites:true},{path:gitDirectory,leaf:false,allowChildWrites:true},{path:join(common,'config'),leaf:true,readOnly:true,allowChildWrites:true,childWriteRoot:common},...[[join(path,'.git'),path],[join(gitDirectory,'gitdir'),common],[join(gitDirectory,'commondir'),common]].map(([path,root])=>({path:path!,leaf:true,readOnly:true,allowChildWrites:true,childWriteRoot:root!}))];
 return withPathGuard(paths,active,async()=>{await verifyManaged(attestation);return action(gitDirectory,path,active);},()=>controller.abort());
}
async function configEntry(entry:GuardEntry|undefined){
 if(!entry||entry.directory)throw denied();const config=(await readBoundFile(entry.path,1024*1024,entry)).toString('utf8').replace(/\\\r?\n/g,'');
 if(/\[\s*(?:include(?:if)?|filter|extensions)(?:\s|["\]])/i.test(config))throw denied();
 for(const version of config.matchAll(/^\s*repositoryformatversion\s*=\s*(.*)$/gim))if(!/^"?0"?\s*(?:[;#].*)?$/.test(version[1]!))throw denied();
}
type Captured={entries:Map<string,GuardEntry>;common:string;gitDirectory:string};
async function capture<T>(root:string,workspace:ManagedGitFamily|undefined,signal:AbortSignal,action:(capture:Captured)=>Promise<T>,onLoss?:()=>void,expectedRoot?:Identity):Promise<T>{
 const common=workspace?.commonDirectory??join(root,'.git'),gitDirectory=workspace?.gitDirectory??common;
 return withPathGuard([{path:root,leaf:false},...(workspace?[{path:join(root,'.git'),leaf:true,readOnly:true}]:[]),{path:common,leaf:false,tree:true,readOnly:true,gitMetadataImport:true}],signal,async manifest=>{
  if(!sameIdentity(await directoryIdentity(root),workspace?.identity??expectedRoot))throw denied();
  if(workspace)await verifyManaged(workspace);
  if(manifest.length>100000||manifest.reduce((n,e)=>n+e.size,0)>8*1024*1024*1024)throw new HarnessError('RESOURCE_LIMIT','Git metadata import exceeds its budget.');
  const entries=new Map<string,GuardEntry>();for(const entry of manifest){const name=relative(common,entry.path);if(!name||isAbsolute(name)||name==='..'||name.startsWith('..'+sep)||entries.has(key(name)))throw denied();entries.set(key(name),entry);}
  for(const name of ['objects/info/alternates','objects/info/http-alternates','commondir','gitdir'])if(entries.has(name))throw denied();
  for(const name of entries.keys())if(/^objects\/pack\/pack-[0-9a-f]{40}\.(?:pack|idx)$/.test(name)){
   const paired=name.endsWith('.pack')?name.slice(0,-5)+'.idx':name.slice(0,-4)+'.pack';
   if(!entries.has(paired)||entries.get(paired)!.directory)throw denied();
  }
  await configEntry(entries.get('config'));if(entries.has('config.worktree'))await configEntry(entries.get('config.worktree'));
  if(workspace){const prefix=key(relative(common,gitDirectory));for(const name of ['head','index']){entries.delete(name);const entry=entries.get(prefix+'/'+name);if(entry)entries.set(name,entry);}}
  if(!entries.get('head')||entries.get('head')!.directory)throw denied();
  return action({entries,common,gitDirectory});
 },onLoss);
}
async function remember(path:string,directory:boolean,owned:Owned[]){const s=await lstat(path,{bigint:true});owned.push({path,dev:s.dev,ino:s.ino,directory});}
async function cleanupOwned(root:string,owned:Owned[]){
 // One native session for bounded manifest-only cleanup. A substituted or busy
 // object is retained, never recursively enumerated or guessed at.
 await withPathGuard([{path:dirname(root),leaf:false}],new AbortController().signal,async()=>{
  for(const entry of [...owned].reverse())try{await removeOwnedFile(entry.path,entry,new AbortController().signal,false,entry.directory);}catch{/* Retain recoverable owned remnants. */}
 });
}
async function makeDirectory(path:string,owned?:Owned[]){try{await mkdir(path);if(owned)await remember(path,true,owned);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink())throw denied();}}
async function parents(root:string,destination:string,owned?:Owned[]){let current=root;const rel=relative(root,dirname(destination));for(const part of rel?rel.split(sep):[]){current=join(current,part);await makeDirectory(current,owned);}}
async function writeOwned(path:string,bytes:string,owned:Owned[]){const file=await open(path,'wx',0o600);try{const s=await file.stat({bigint:true});owned.push({path,dev:s.dev,ino:s.ino,directory:false});await file.writeFile(bytes);}finally{await file.close();}}
async function copyEntries(entries:Map<string,GuardEntry>,destination:string,objects:boolean,signal:AbortSignal,owned?:Owned[],existingObjects?:string){
 for(const[name,entry]of entries){
  const allowed=objects?/^objects\/(?:[0-9a-f]{2}\/[0-9a-f]{38}|pack\/pack-[0-9a-f]{40}\.(?:pack|idx|rev))$/.test(name):name==='head'||name==='index'||name==='packed-refs'||/^refs\/(?:heads|tags|remotes)\//.test(name);
  if(!allowed||entry.directory)continue;
  // Existing private object bytes are authoritative. Source filenames are never
  // accepted as evidence of unchanged source bytes and never overwrite them.
  const spelling=entry.path.split(/[\\/]/).slice(-name.split('/').length).join('/');
  const target=join(destination,...(name==='head'?'HEAD':spelling).split('/'));
  if(objects){try{const s=await lstat(target);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw denied();continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  if(objects&&existingObjects){try{const s=await lstat(join(existingObjects,...name.split('/')));if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw denied();continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  await parents(destination,target,owned);
  await copyBoundGitMetadata(entry,target,signal,s=>owned?.push({path:target,...s,directory:false}));
 }
}
/** One history copy per project, published in Store only after native validation. */
export async function importGitFamily(store:Store,projectId:string,root:string,workspace:ManagedGitFamily|undefined,executable:string,signal:AbortSignal):Promise<PrivateGitFamily>{
 const existing=store.get<PrivateGitFamily>('workspaceGitFamily',projectId);
 if(existing){if(existing.projectId!==projectId||existing.commonDirectory!==join(store.dataDir,'git',projectId,'repository.git')||!sameIdentity(await directoryIdentity(existing.commonDirectory),existing.commonDirectoryIdentity))throw denied();return existing;}
 const parent=join(store.dataDir,'git',projectId),commonDirectory=join(parent,'repository.git');
 await mkdir(dirname(parent),{recursive:true});await makeDirectory(parent);
 // An incomplete import is never silently reused or recursively removed.
 try{await mkdir(commonDirectory);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new HarnessError('CAPABILITY_DENIED','An incomplete private Git import is retained for recovery.');throw e;}
 const owned:Owned[]=[];await remember(commonDirectory,true,owned);
 try{
  const controller=new AbortController(),active=AbortSignal.any([signal,controller.signal]);
  const source=store.get<{path:string;identity:Identity}>('workspaceProjectRoot',projectId);
  if(!workspace&&source?.path!==root)throw denied();
  const family=await capture(root,workspace,active,async({entries})=>{
   await copyEntries(entries,commonDirectory,true,active,owned);
   const metadata=new Map(entries);metadata.delete('index');await copyEntries(metadata,commonDirectory,false,active,owned);
   await makeDirectory(join(commonDirectory,'refs'),owned);await makeDirectory(join(commonDirectory,'objects'),owned);
   await writeOwned(join(commonDirectory,'config'),bareConfig,owned);
   const config=entries.get('config')!,capturedConfig=join(parent,'import-config-'+Date.now());
   let capturedConfigIdentity:{dev:bigint;ino:bigint}|undefined;
   await copyBoundGitMetadata(config,capturedConfig,active,s=>{capturedConfigIdentity=s;owned.push({path:capturedConfig,...s,directory:false});});
   let author='';
   try{for(const name of ['user.name','user.email']){try{const value=(await nativeGit(executable,commonDirectory,undefined,['config','--file',capturedConfig,'--get',name],active)).trim();if(value&&value.length<=512&&!/[\r\n\0]/.test(value))author+='\n['+name.split('.')[0]+']\n'+name.split('.')[1]+' = '+JSON.stringify(value)+'\n';}catch{/* Optional scalar. */}}
    let origin:string|undefined;try{const value=(await nativeGit(executable,commonDirectory,undefined,['config','--file',capturedConfig,'--get','remote.origin.url'],active)).trim();if(/^(?:https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)&&value.length<=2048)origin=value;}catch{/* No admitted origin. */}
    if(author||origin)await writeFile(join(commonDirectory,'config'),bareConfig+author+(origin?'\n[remote "origin"]\nurl = '+JSON.stringify(origin)+'\nfetch = +refs/heads/*:refs/remotes/origin/*\n':''));
    await nativeGit(executable,commonDirectory,undefined,['fsck','--full','--no-reflogs'],active);
    return{projectId,commonDirectory,commonDirectoryIdentity:await directoryIdentity(commonDirectory),...(origin?{origin}:{})};
   }finally{if(capturedConfigIdentity)await removeOwnedFile(capturedConfig,capturedConfigIdentity,new AbortController().signal);}
  },()=>controller.abort(),source?.identity);
  store.internal('workspace.git-family.imported',null,()=>store.put('workspaceGitFamily',projectId,null,family));return family;
 }catch(error){await cleanupOwned(commonDirectory,owned);throw error;}
}
/** Legacy reads use a small metadata view and an ordinary tracked-source projection. */
export async function withLegacyGitView<T>(family:PrivateGitFamily,root:string,workspace:ManagedGitFamily|undefined,executable:string,signal:AbortSignal,action:(metadata:string,worktree:string,signal:AbortSignal)=>Promise<T>,expectedRoot:Identity):Promise<T>{
 const snapshot=await mkdtemp(join(tmpdir(),'harness-git-view-')),owned:Owned[]=[];await remember(snapshot,true,owned);
 const controller=new AbortController(),active=AbortSignal.any([signal,controller.signal]);
 try{
  if(within(root,snapshot)||within(family.commonDirectory,snapshot))throw new HarnessError('CAPABILITY_DENIED','Legacy snapshot must stay outside source grants and private Git metadata.');
  return await withPathGuard([{path:family.commonDirectory,leaf:false,allowChildWrites:true},{path:join(family.commonDirectory,'objects'),leaf:false,allowChildWrites:true}],active,async()=>{
  if(!sameIdentity(await directoryIdentity(family.commonDirectory),family.commonDirectoryIdentity))throw denied();
  return capture(root,workspace,active,async({entries})=>{
  const metadata=join(snapshot,'.git');await makeDirectory(metadata,owned);await copyEntries(entries,metadata,false,active,owned);
  // Incremental source objects stay in this read-only view and never enter the managed family.
  await copyEntries(entries,metadata,true,active,owned,family.commonDirectory);
  await writeOwned(join(metadata,'config'),viewConfig,owned);await makeDirectory(join(metadata,'refs'),owned);await makeDirectory(join(metadata,'objects'),owned);await makeDirectory(join(metadata,'objects','info'),owned);
  await writeOwned(join(metadata,'objects','info','alternates'),family.commonDirectory.replaceAll('\\','/')+'/objects\n',owned);
  const names=(await nativeGit(executable,metadata,snapshot,['ls-files','-z'],active)).split('\0').filter(Boolean),tracked:GuardEntry[]=[];
  if(names.length>10000)throw new HarnessError('RESOURCE_LIMIT','Tracked source projection exceeds 10000 entries.');let bytes=0;
  for(const name of new Set(names)){
   if(isAbsolute(name)||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git'))throw denied();
   const path=join(root,...name.split('/'));try{const s=await lstat(path,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n)throw denied();if((bytes+=Number(s.size))>64*1024*1024)throw new HarnessError('RESOURCE_LIMIT','Tracked source projection exceeds 64 MiB.');tracked.push({path,dev:String(s.dev),ino:String(s.ino),directory:false,size:Number(s.size)});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  return withPathGuard(tracked.map(e=>({path:e.path,leaf:true,readOnly:true,dev:e.dev,ino:e.ino})),active,async()=>{
   for(const entry of tracked){const destination=join(snapshot,relative(root,entry.path));await parents(snapshot,destination,owned);await copyBoundGitMetadata(entry,destination,active,s=>owned.push({path:destination,...s,directory:false}));}
   return withPathGuard([{path:snapshot,leaf:false,tree:true,readOnly:true}],active,()=>action(metadata,snapshot,active),()=>controller.abort());
  },()=>controller.abort());
  },()=>controller.abort(),expectedRoot);
 },()=>controller.abort());}finally{await cleanupOwned(snapshot,owned);}
}
