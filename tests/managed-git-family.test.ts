import {afterEach,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {lstat,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {withGitMetadata,type ManagedGitFamily} from '../packages/capabilities/git-access.ts';
import {handleDomainTool,type DomainContext} from '../packages/capabilities/index.ts';
import type {DataRecord} from '../packages/contracts/index.ts';
import {Service} from '../packages/core/service.ts';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true,maxRetries:5});});
const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','core.hooksPath=NUL','-c','core.fsmonitor=false','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd,windowsHide:true,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_OPTIONAL_LOCKS:'0'}});
async function identity(path:string){const info=await lstat(path,{bigint:true});return{dev:String(info.dev),ino:String(info.ino)};}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'harness-managed-family-'));roots.push(root);
 const base=join(root,'base'),path=join(root,'managed');await mkdir(base);git(base,'init','-q');
 await writeFile(join(base,'tracked.txt'),'base\n');git(base,'add','tracked.txt');git(base,'commit','-qm','base');git(base,'worktree','add','-qb','managed',path);
 const gitDirectory=resolve((await readFile(join(path,'.git'),'utf8')).trim().slice(8)),commonDirectory=join(base,'.git');
 const family:ManagedGitFamily={path,gitDirectory,commonDirectory,identity:await identity(path),gitDirectoryIdentity:await identity(gitDirectory),commonDirectoryIdentity:await identity(commonDirectory)};
 return{root,base,path,family};
}
const snapshot=<T>(path:string,family:ManagedGitFamily|undefined,action:(metadata:string,worktree:string)=>Promise<T>)=>withGitMetadata(path,new AbortController().signal,action,family);

it('resolves managed host authority only through the current thread workspace binding and local project',()=>{
 const thread={id:'owner',workspaceId:'workspace',projectId:'project'},binding={id:'workspace',threadId:'owner',projectId:'project',path:'C:\\managed'},project={authority:{kind:'local'}};
 const rows:Record<string,unknown>={'thread:owner':thread,'workspaceBinding:workspace':binding,'workspaceProject:project':project};
 const owner={store:{dataDir:'C:\\data',get:(kind:string,id:string)=>rows[kind+':'+id]}};
 const context=(Service.prototype as unknown as {context(threadId:string):DomainContext}).context.call(owner,'owner');
 expect(context.managedGitFamily?.(binding.path)).toBe(binding);expect(context.managedGitFamily?.('C:\\unrelated')).toBeUndefined();
 for(const changed of [{...binding,threadId:'other'},{...binding,id:'other'},{...binding,projectId:'other'}]){
  rows['workspaceBinding:workspace']=changed;expect(()=>context.managedGitFamily?.(binding.path)).toThrow('authority is unavailable');
 }
 rows['workspaceBinding:workspace']=binding;rows['workspaceProject:project']={authority:{kind:'company',companyId:'company'}};
 expect(()=>context.managedGitFamily?.(binding.path)).toThrow('authority is unavailable');
 rows['thread:owner']={id:'owner',projectId:'project'};expect(context.managedGitFamily?.(binding.path)).toBeUndefined();
});

it('refuses automatic Git snapshots of an ancestor containing host storage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'harness-git-storage-scope-'));roots.push(root);
 const dataDir=join(root,'state'),project=join(root,'project');await mkdir(dataDir);await mkdir(project);
 const owner={store:{dataDir,get:()=>undefined}};
 const context=(Service.prototype as unknown as {context(threadId:string):DomainContext}).context.call(owner,'owner');
 for(const path of [root,dataDir])expect(()=>context.managedGitFamily?.(path)).toThrow(expect.objectContaining({code:'CAPABILITY_DENIED'}));
 expect(context.managedGitFamily?.(project)).toBeUndefined();
});

it('requires host attestation for linked worktrees and retains ordinary repositories',async()=>{
 const f=await fixture();
 await expect(snapshot(f.path,undefined,async()=>true)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 await expect(snapshot(f.base,undefined,async(metadata,worktree)=>git(worktree,'--git-dir='+metadata,'status','--porcelain'))).resolves.toBe('');
});
it('snapshots the attested worktree HEAD, index and source, without other worktrees or hooks',async()=>{
 const f=await fixture();await writeFile(join(f.path,'tracked.txt'),'managed commit\n');git(f.path,'commit','-qam','managed commit');
 const head=git(f.path,'rev-parse','HEAD').trim();await writeFile(join(f.path,'tracked.txt'),'staged\n');git(f.path,'add','tracked.txt');await writeFile(join(f.path,'tracked.txt'),'working\n');
 await writeFile(join(f.base,'tracked.txt'),'base dirty\n');
 const result=await snapshot(f.path,f.family,async(metadata,worktree)=>{
  await expect(writeFile(join(f.path,'tracked.txt'),'changed',{flag:'r+'})).rejects.toThrow();
  await expect(writeFile(join(f.family.commonDirectory,'config'),'changed',{flag:'r+'})).rejects.toThrow();
  return{head:git(worktree,'--git-dir='+metadata,'rev-parse','HEAD').trim(),status:git(worktree,'--git-dir='+metadata,'status','--porcelain'),diff:git(worktree,'--git-dir='+metadata,'diff'),staged:git(worktree,'--git-dir='+metadata,'diff','--cached'),hooks:await lstat(join(metadata,'hooks')).then(()=>true,()=>false),others:await lstat(join(metadata,'worktrees')).then(()=>true,()=>false)};
 });
 expect(result.head).toBe(head);expect(result.status).toBe('MM tracked.txt\n');expect(result.diff).toContain('+working');expect(result.diff).toContain('-staged');expect(result.staged).toContain('+staged');expect(result.staged).toContain('-managed commit');expect(result.diff).not.toContain('base dirty');expect(result.hooks).toBe(false);expect(result.others).toBe(false);
});
it('passes only the host-resolved family for the granted domain repository root',async()=>{
 const f=await fixture(),seen:string[]=[];await writeFile(join(f.path,'tracked.txt'),'managed change\n');
 const ctx:DomainContext={threadId:'managed-thread',signal:new AbortController().signal,resolveResource:async()=>f.path,managedGitFamily:cwd=>{seen.push(cwd);return cwd===f.path?f.family:undefined;},publishData:(value,provenance)=>({id:'data',threadId:'managed-thread',revision:1,value,provenance,createdAt:new Date().toISOString()}),prepareOperation:()=>{throw new Error('unused');},progress:()=>{}};
 const result=await handleDomainTool('repository_status',{resourceId:'managed'},ctx) as DataRecord;
 expect(result.value).toMatchObject({exitCode:0,stdout:' M tracked.txt\n'});expect(seen).toEqual([f.path]);
 await expect(handleDomainTool('repository_status',{resourceId:'managed'},{...ctx,managedGitFamily:()=>undefined})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
});
it('rejects unsupported common config even when the worktree provides a config override',async()=>{
 const f=await fixture();await writeFile(join(f.family.commonDirectory,'config.worktree'),'[include]\npath = elsewhere\n');await writeFile(join(f.family.gitDirectory,'config.worktree'),'[core]\nbare = false\n');
 await expect(snapshot(f.path,f.family,async()=>true)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
});
it('refuses an unrelated linked worktree even with another trusted binding',async()=>{
 const f=await fixture(),other=join(f.root,'other');git(f.base,'worktree','add','-qb','other',other);
 await expect(snapshot(other,f.family,async()=>true)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
});
it.each(['identity','common identity','git identity','pointer','backref','commondir','config','alternates'] as const)('refuses changed managed %s',async(change)=>{
 const f=await fixture();
 if(change==='identity')f.family.identity={...f.family.identity,ino:'0'};
 if(change==='common identity')f.family.commonDirectoryIdentity={...f.family.commonDirectoryIdentity,ino:'0'};
 if(change==='git identity')f.family.gitDirectoryIdentity={...f.family.gitDirectoryIdentity,ino:'0'};
 if(change==='pointer'){await rm(join(f.path,'.git'));await writeFile(join(f.path,'.git'),'gitdir: '+f.family.commonDirectory+'\n');}
 if(change==='backref')await writeFile(join(f.family.gitDirectory,'gitdir'),join(f.base,'.git')+'\n');
 if(change==='commondir')await writeFile(join(f.family.gitDirectory,'commondir'),f.family.commonDirectory+'\n');
 if(change==='config')await writeFile(join(f.family.commonDirectory,'config'),'[include]\npath = elsewhere\n');
 if(change==='alternates')await writeFile(join(f.family.commonDirectory,'objects','info','alternates'),'elsewhere\n');
 await expect(snapshot(f.path,f.family,async()=>true)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
});
