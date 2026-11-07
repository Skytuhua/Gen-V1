import {randomUUID,createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {lstat,mkdir,readFile,realpath,open} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {z} from 'zod';
import {Store} from '../storage/store.ts';
import {HarnessError,type HostCommand,type ResourceGrant,type Thread} from '../contracts/index.ts';
import type {ProjectContext,ProjectSummary} from '../contracts/workspace.ts';
import {threadNavigationRevision} from '../contracts/shell-read-models.ts';
import {WorkspaceRepository} from '../core/workspace-layout.ts';
import {assertNotStorage,canonical,inside} from '../core/security.ts';
import {gitExecutable} from '../capabilities/process.ts';
import {readBoundFile,withPathGuard} from '../core/file-access.ts';
import {directoryIdentity,importGitFamily,nativeGit,privateFamilyForBinding,sameIdentity,withLegacyGitView,withPrivateGitFamily} from './git-storage.ts';
import {ComparisonFileRequestSchema,ComparisonScopeSchema,type ComparisonRead} from '../contracts/code-review.ts';
import {ComparisonSnapshots,comparisonError,comparisonResult,readLocalComparison,readLocalComparisonFile} from './code-review.ts';

interface Identity{dev:string;ino:string}
export interface WorkspaceBinding {id:string;threadId:string;projectId:string;familyId?:string;path:string;branch:string;gitDirectory:string;commonDirectory:string;identity:Identity;gitDirectoryIdentity:Identity;commonDirectoryIdentity:Identity}
export interface GitFile{path:string;oldPath?:string;index:string;worktree:string;staged:boolean;untracked:boolean;binary:boolean;added:number|null;removed:number|null}
export interface GitStatus{head:string;branch:string;revision:string;files:GitFile[];diff:string;stagedDiff:string;truncated:boolean;mode?:'managed'|'legacy';gitWrite?:boolean;untrackedIncluded?:boolean}
export interface ProjectToolOptions{git?:string;gh?:string}
const id=z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/),label=z.string().trim().min(1).max(100),hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const identity=async(path:string):Promise<Identity>=>{const info=await lstat(path,{bigint:true});if(info.isSymbolicLink()||!info.isDirectory())throw new HarnessError('CAPABILITY_DENIED','Project directories must be ordinary directories.');return{dev:String(info.dev),ino:String(info.ino)};};
const equal=(a:Identity,b:Identity)=>a.dev===b.dev&&a.ino===b.ino;
const pathName=z.string().min(1).max(1024).refine(path=>!path.includes('\0')&&!path.includes(':')&&!/^[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path),'Choose a file inside the project.');
async function untrackedDigest(path:string,signal:AbortSignal){
 return withPathGuard([{path,leaf:true,readOnly:true}],signal,async()=>{
  const file=await open(path,'r');try{const info=await file.stat({bigint:true});if(!info.isFile()||info.nlink!==1n)throw new HarnessError('CAPABILITY_DENIED','Changed paths must be ordinary files.');
   const digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0,binary=false;
   while(offset<Number(info.size)){if(signal.aborted)throw new HarnessError('CANCELLED','Git review cancelled.');const part=await file.read(buffer,0,Math.min(buffer.length,Number(info.size)-offset),offset);if(!part.bytesRead)throw new HarnessError('CAPABILITY_DENIED','Changed file changed during review.');const bytes=buffer.subarray(0,part.bytesRead);digest.update(bytes);binary ||= bytes.includes(0);offset+=part.bytesRead;}
   return{hash:digest.digest('hex'),binary};
  }finally{await file.close();}
 });
}

/** Explicit project enrollment and per-main-agent worktrees. Company references never fall back locally. */
export class ProjectTools{
 readonly workspace:WorkspaceRepository;private readonly queues=new Map<string,Promise<unknown>>();
 private readonly reviewComparisons=new ComparisonSnapshots();
 constructor(readonly store:Store,readonly options:ProjectToolOptions={}){this.workspace=new WorkspaceRepository(store);}
 private exclusive<T>(key:string,action:()=>Promise<T>):Promise<T>{const next=(this.queues.get(key)??Promise.resolve()).catch(()=>{}).then(action);this.queues.set(key,next);void next.finally(()=>{if(this.queues.get(key)===next)this.queues.delete(key);}).catch(()=>{});return next;}
 private gitExecutable(){return this.options.git??gitExecutable();}
 async git(path:string,args:string[],signal?:AbortSignal,environment:NodeJS.ProcessEnv={}){
  const workspace=this.store.all<WorkspaceBinding>('workspaceBinding').find(item=>item.path===path);
  if(!workspace)throw new HarnessError('CAPABILITY_DENIED','Legacy project Git is read-only. Select a new managed working copy.');
  const bound=await this.binding(workspace.projectId,workspace.threadId),family=privateFamilyForBinding(this.store,workspace);
  if(bound.workspace?.id!==workspace.id||!family)throw new HarnessError('CAPABILITY_DENIED','Legacy project Git is read-only. Select a new managed working copy.');
  return withPrivateGitFamily(family,signal??new AbortController().signal,(metadata,worktree,active)=>nativeGit(this.gitExecutable(),metadata,worktree,args,active,environment));
 }
 private project(projectId:string){const project=this.store.get<ProjectSummary>('workspaceProject',id.parse(projectId));if(!project)throw new HarnessError('NOT_FOUND','Project is unavailable.');if(project.authority.kind!=='local')throw new HarnessError('CAPABILITY_DENIED','Company authority cannot use personal project tools.');return project;}
 async binding(projectId:string,threadId?:string):Promise<{project:ProjectSummary;path:string;workspace?:WorkspaceBinding}>{
  const project=this.project(projectId);let workspace:WorkspaceBinding|undefined;
  if(threadId){const thread=this.store.get<Thread>('thread',id.parse(threadId));if(!thread||thread.projectId!==project.id||thread.kind==='delegate'||thread.kind==='side'||Boolean(thread.sideParentId))throw new HarnessError('CAPABILITY_DENIED','Select a main thread belonging to this project.');workspace=thread.workspaceId?this.store.get<WorkspaceBinding>('workspaceBinding',thread.workspaceId)??undefined:undefined;if(thread.workspaceId&&(!workspace||workspace.id!==thread.workspaceId||workspace.threadId!==thread.id||workspace.projectId!==project.id))throw new HarnessError('CAPABILITY_DENIED','The working copy binding is unavailable.');}
  const root=this.store.get<{path:string;identity:Identity}>('workspaceProjectRoot',project.id),path=workspace?.path??root?.path;
  if(!path||!root)throw new HarnessError('PROJECT_NOT_CONNECTED','Connect this project to a local folder.');
  if(resolve(await realpath(path))!==resolve(path)||!equal(await identity(path),workspace?.identity??root.identity))throw new HarnessError('CAPABILITY_DENIED','The project folder changed. Reconnect it explicitly.');
  return{project,path,...(workspace?{workspace}:{})};
 }
 async connect(command:HostCommand){
  const existing=this.store.receipt(command);if(existing)return existing;
  const p=z.strictObject({name:label,path:z.string().min(1).max(4096),threadId:id.optional(),baseRevision:z.number().int().nonnegative().optional()}).parse(command.payload),path=await canonical(p.path);assertNotStorage(path,this.store.dataDir);
  if(inside(this.store.dataDir,path)||inside(path,this.store.dataDir))throw new HarnessError('CAPABILITY_DENIED','Choose a project folder outside harness application data.');
  const captured=await identity(path);await this.validateRepository(path).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
  return this.store.command(command,()=>{
   const state=this.workspace.read();if(p.baseRevision!==undefined&&p.baseRevision!==state.state.revision)throw new HarnessError('WORKSPACE_CHANGED','The workspace revision changed.');
   let project=state.projects.find(item=>item.authority.kind==='local'&&item.rootPath===path);project??={id:randomUUID(),name:p.name,rootPath:path,authority:{kind:'local'},createdAt:new Date().toISOString()};
   this.store.put('workspaceProject',project.id,null,project);this.store.put('workspaceProjectRoot',project.id,null,{path,identity:captured});
   if(p.threadId){const thread=this.store.get<Thread>('thread',p.threadId);if(!thread||thread.runId||thread.sessionPath||thread.workspaceId)throw new HarnessError('PROJECT_BUSY','Connect a project before starting this thread.');this.store.put('thread',thread.id,thread.id,{...thread,projectId:project.id,projectName:project.name});}
   this.store.put('workspaceState','personal',null,{...state.state,revision:state.state.revision+1});return this.workspace.read();
  });
 }
 async validateRepository(path:string,workspace?:WorkspaceBinding){
  const dot=join(path,'.git'),info=await lstat(dot);let common=dot;
  if(workspace){if(!info.isFile()||info.nlink!==1)throw new HarnessError('CAPABILITY_DENIED','Managed Git binding changed.');const text=(await readBoundFile(dot,4096)).toString().trim();if(text!=='gitdir: '+workspace.gitDirectory.replaceAll('\\','/')){
    if(text!=='gitdir: '+workspace.gitDirectory)throw new HarnessError('CAPABILITY_DENIED','Managed worktree metadata changed.');
   }common=workspace.commonDirectory;const back=(await readBoundFile(join(workspace.gitDirectory,'gitdir'),4096)).toString().trim();if(resolve(back)!==resolve(dot)||resolve(workspace.gitDirectory,'../..')!==resolve(common)||(await readBoundFile(join(workspace.gitDirectory,'commondir'),4096)).toString().trim()!=='../..')throw new HarnessError('CAPABILITY_DENIED','Managed worktree family changed.');
  }else if(!info.isDirectory()||info.isSymbolicLink())throw new HarnessError('CAPABILITY_DENIED','Only ordinary repositories and verified application-managed worktrees are supported.');
  const config=(await readBoundFile(join(common,'config'),1024*1024)).toString().replace(/\\\r?\n/g,'');if(/\[\s*(?:include(?:if)?|filter|extensions)(?:\s|["\]])/i.test(config))throw new HarnessError('CAPABILITY_DENIED','Repository config redirects and executable filters are unsupported.');
  for(const file of ['objects/info/alternates','objects/info/http-alternates'])try{await lstat(join(common,file));throw new HarnessError('CAPABILITY_DENIED','Alternate object stores are unsupported.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return{common,gitDirectory:workspace?.gitDirectory??common};
 }
 async prepareWorkspace(thread:Thread){
  if(!thread.projectId||thread.workspaceId||thread.sessionPath||thread.sideParentId||thread.kind==='delegate')return;
  if(!this.store.get('workspaceProjectRoot',thread.projectId))return;
  await this.exclusive(thread.projectId,async()=>{
   const current=this.store.get<Thread>('thread',thread.id);if(!current||current.workspaceId||current.sessionPath)return;
   const base=await this.binding(thread.projectId!);
   if(!this.store.get('workspaceGitFamily',thread.projectId!)){try{await lstat(join(base.path,'.git'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}}
   const family=await importGitFamily(this.store,thread.projectId!,base.path,base.workspace,this.gitExecutable(),new AbortController().signal),workspaceId=randomUUID(),path=join(this.store.dataDir,'worktrees',workspaceId),branch='gen/'+thread.id.replace(/[^a-zA-Z0-9_-]/g,'-')+'-'+workspaceId.slice(0,8);
   await mkdir(dirname(path),{recursive:true});
   const controller=new AbortController();
   await withPathGuard([{path:family.commonDirectory,leaf:false,allowChildWrites:true},{path:join(family.commonDirectory,'config'),leaf:true,readOnly:true,allowChildWrites:true,childWriteRoot:family.commonDirectory}],controller.signal,async()=>{
    if(!sameIdentity(await directoryIdentity(family.commonDirectory),family.commonDirectoryIdentity))throw new HarnessError('CAPABILITY_DENIED','Private Git family changed.');
    const head=(await nativeGit(this.gitExecutable(),family.commonDirectory,undefined,['rev-parse','HEAD'],controller.signal)).trim();
    if(!/^[0-9a-f]{40}$/.test(head))throw new HarnessError('CAPABILITY_DENIED','Private Git HEAD is unavailable.');
    await nativeGit(this.gitExecutable(),family.commonDirectory,undefined,['worktree','add','-b',branch,path,head],controller.signal);
   },()=>controller.abort());
   const pointer=(await readFile(join(path,'.git'),'utf8')).trim().replace(/^gitdir: /,'');
   const binding:WorkspaceBinding={id:workspaceId,threadId:thread.id,projectId:thread.projectId!,familyId:family.projectId,path,branch,gitDirectory:resolve(pointer),commonDirectory:family.commonDirectory,identity:await identity(path),gitDirectoryIdentity:await identity(resolve(pointer)),commonDirectoryIdentity:await identity(family.commonDirectory)};await this.validateRepository(path,binding);
   this.store.internal('workspace.working-copy.created',thread.id,()=>{const latest=this.store.get<Thread>('thread',thread.id);if(!latest||latest.workspaceId||latest.epoch!==current.epoch||latest.runId!==current.runId)throw new HarnessError('WORKSPACE_CHANGED','Thread changed while creating its working copy.');this.store.put('workspaceBinding',workspaceId,thread.id,binding);this.store.put('thread',thread.id,thread.id,{...latest,workspaceId});const grant:ResourceGrant={id:randomUUID(),threadId:thread.id,kind:'project',path,label:base.project.name,writable:true,createdAt:new Date().toISOString(),identity:binding.identity};this.store.put('resource',grant.id,thread.id,grant);});
  });
 }
 private async withGitOperation<T>(projectId:string,threadId:string|undefined,write:boolean,action:(metadata:string,path:string,signal:AbortSignal,managed:boolean)=>Promise<T>):Promise<T>{
  const binding=await this.binding(projectId,threadId),family=binding.workspace?privateFamilyForBinding(this.store,binding.workspace):undefined,signal=new AbortController().signal;
  if(family)return withPrivateGitFamily(family,signal,(metadata,path,active)=>action(metadata,path,active,true));
  if(write)throw new HarnessError('CAPABILITY_DENIED','Legacy project Git is read-only. Select a new managed working copy.');
  const imported=await importGitFamily(this.store,projectId,binding.path,binding.workspace,this.gitExecutable(),signal);
  const expected=binding.workspace?.identity??this.store.get<{identity:Identity}>('workspaceProjectRoot',projectId)?.identity;
  if(!expected)throw new HarnessError('CAPABILITY_DENIED','Project identity is unavailable.');
  return withLegacyGitView(imported,binding.path,binding.workspace,this.gitExecutable(),signal,(metadata,path,active)=>action(metadata,path,active,false),expected);
 }
 private async status(metadata:string,path:string,signal:AbortSignal,managed:boolean):Promise<GitStatus>{
  const git=(args:string[])=>nativeGit(this.gitExecutable(),metadata,path,args,signal);
  const head=(await git(['rev-parse','HEAD'])).trim(),branch=(await git(['branch','--show-current'])).trim(),raw=await git(['status','--porcelain=v1','-z',managed?'--untracked-files=all':'--untracked-files=no']),diff=await git(['diff','--full-index','--no-ext-diff','--no-textconv']),stagedDiff=await git(['diff','--cached','--full-index','--no-ext-diff','--no-textconv']),files:GitFile[]=[],untracked:string[]=[];
  const entries=raw.split('\0');for(let i=0;i<entries.length;i++){
   const entry=entries[i];if(!entry)continue;const index=entry[0]!,worktree=entry[1]!,name=entry.slice(3),oldPath=/[RC]/.test(index+worktree)?entries[++i]:undefined;pathName.parse(name);
   if(name.split('/').at(-1)==='.harness-directory-guard')continue;
   const item:GitFile={path:name,...(oldPath?{oldPath}:{}),index,worktree,staged:index!==' '&&index!=='?',untracked:index==='?',binary:false,added:null,removed:null};files.push(item);
   if(item.untracked){const data=await untrackedDigest(join(path,name),signal);item.binary=data.binary;untracked.push(name+':'+data.hash);}
  }
  const stats=(await git(['diff','--numstat','-z','--no-ext-diff','--no-textconv','HEAD'])).split('\0');
  for(let i=0;i<stats.length;i++){const row=stats[i];if(!row)continue;const[added,removed,...parts]=row.split('\t');let name=parts.join('\t');if(!name){i++;name=stats[++i]??'';}const item=files.find(item=>item.path===name);if(item){item.binary=added==='-';item.added=item.binary?null:Number(added);item.removed=item.binary?null:Number(removed);}}
  return{head,branch,revision:hash(JSON.stringify([head,branch,raw,diff,stagedDiff,untracked])),files,diff,stagedDiff,truncated:false,mode:managed?'managed':'legacy',gitWrite:managed,untrackedIncluded:managed};
 }
 async gitStatus(projectId:string,threadId?:string):Promise<GitStatus>{return this.exclusive(projectId,()=>this.withGitOperation(projectId,threadId,false,(metadata,path,signal,managed)=>this.status(metadata,path,signal,managed)));}
 /** Read-only origin through the same attested managed/legacy Git boundary. */
 async gitReviewOrigin(projectId:string,threadId?:string){return this.exclusive(projectId,async()=>{
  const binding=await this.binding(projectId,threadId),signal=new AbortController().signal;
  if(binding.workspace&&privateFamilyForBinding(this.store,binding.workspace))return this.git(binding.path,['remote','get-url','origin'],signal);
  // Once enrolled, the Store-attested origin needs no source checkout or tracked-file projection.
  const family=await importGitFamily(this.store,projectId,binding.path,binding.workspace,this.gitExecutable(),signal);
  return withPathGuard([{path:family.commonDirectory,leaf:false}],signal,async()=>{
   if(!sameIdentity(await directoryIdentity(family.commonDirectory),family.commonDirectoryIdentity))throw new HarnessError('CAPABILITY_DENIED','Private Git family changed.');
   if(!family.origin)throw new HarnessError('GITHUB_REMOTE_REQUIRED','Use an enrolled origin hosted on github.com.');return family.origin;
  });
 });}
 async gitComparison(projectId:string,threadId:string|undefined,input:unknown):Promise<ComparisonRead>{
  const{scope}=ComparisonScopeSchema.parse(input),binding=await this.binding(projectId,threadId);
  return this.exclusive(projectId,()=>this.withGitOperation(projectId,threadId,false,async(metadata,path,signal,managed)=>{
   const owner=JSON.stringify([projectId,threadId??null,binding.path]);
   try{const value=await readLocalComparison({git:args=>nativeGit(this.gitExecutable(),metadata,path,args,signal),path,signal,managed,owner},scope);this.reviewComparisons.save(owner,value);return comparisonResult(value);}catch(error){return comparisonError(error);}
  }));
 }
 async gitComparisonFile(projectId:string,threadId:string|undefined,input:unknown){
  const request=ComparisonFileRequestSchema.parse(input),binding=await this.binding(projectId,threadId);
  return this.exclusive(projectId,()=>this.withGitOperation(projectId,threadId,false,async(metadata,path,signal,managed)=>{
   const owner=JSON.stringify([projectId,threadId??null,binding.path]),entry=this.reviewComparisons.get(owner,request.comparisonId);
   return readLocalComparisonFile({git:args=>nativeGit(this.gitExecutable(),metadata,path,args,signal),path,signal,managed,owner},entry.value,request.path);
  }));
 }
 async gitAction(projectId:string,threadId:string|undefined,input:{type:string;revision:string;paths?:string[];message?:string;name?:string}){
  return this.exclusive(projectId,()=>this.withGitOperation(projectId,threadId,true,async(metadata,path,signal,managed)=>{
   const current=await this.status(metadata,path,signal,managed);if(input.revision!==current.revision)throw new HarnessError('REVISION_CHANGED','The worktree changed. Refresh the review before applying this action.');const paths=z.array(pathName).min(1).max(1000).optional().parse(input.paths),git=(args:string[])=>nativeGit(this.gitExecutable(),metadata,path,args,signal);
   if(input.type==='stage'){if(!paths)throw new HarnessError('INVALID_INPUT','Choose files to stage.');await git(['add','--',...paths]);}
   else if(input.type==='unstage'){if(!paths)throw new HarnessError('INVALID_INPUT','Choose files to unstage.');await git(['restore','--staged','--',...paths]);}
   else if(input.type==='commit')await git(['-c','commit.gpgsign=false','commit','-m',z.string().trim().min(1).max(4000).parse(input.message)]);
   else if(input.type==='branch'){const branch=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,150}$/).refine(value=>!value.endsWith('/')&&!value.includes('//')).parse(input.name);await git(['switch','-c',branch]);}
   else throw new HarnessError('INVALID_INPUT','Unknown Git action.');return this.status(metadata,path,signal,managed);
  }));
 }
 async context(projectId:string,threadId?:string):Promise<ProjectContext>{
  const admitted=await this.binding(projectId,threadId),project=admitted.project,captured=threadId?this.store.get<Thread>('thread',threadId):undefined,threadRevision=captured?threadNavigationRevision(captured):undefined;
  const lineage=this.store.all<Thread>('thread').filter(item=>item.projectId===project.id).map(item=>({id:item.id,title:item.title,status:item.status,parentThreadId:item.parentThreadId,kind:item.kind})),scripts=this.store.all<{id:string;name:string;command:string;projectId:string}>('projectScript').filter(item=>item.projectId===project.id);
  let status:GitStatus|undefined,error:string|undefined;try{status=await this.gitStatus(projectId,threadId);}catch(reason){error=reason instanceof Error?reason.message:'Project status is unavailable.';}
  const current=await this.binding(projectId,threadId),latest=threadId?this.store.get<Thread>('thread',threadId):undefined;
  if(current.path!==admitted.path||current.workspace?.id!==admitted.workspace?.id||threadId&&(!captured||!latest||threadNavigationRevision(latest)!==threadRevision))throw new HarnessError('REVISION_CHANGED','Conversation metadata changed. Retry the current thread.');
  return{project,...(threadId?{threadId,threadRevision}:{}),...(admitted.workspace?{workingCopy:{id:admitted.workspace.id,path:admitted.path}}:{}),machineName:hostname(),editor:{available:true,label:'Default editor'},branch:status?.branch??null,head:status?.head??null,...(status?{revision:status.revision}:{}),changes:{added:status?status.files.reduce((sum,file)=>sum+(file.added??0),0):null,removed:status?status.files.reduce((sum,file)=>sum+(file.removed??0),0):null,files:status?.files.length??null},lineage,scripts,capabilities:{git:!!status,gitWrite:status?.gitWrite??false,untrackedIncluded:status?.untrackedIncluded??false,terminal:!!project.rootPath,pullRequests:!!status?.gitWrite},...(error?{error}:{})};
 }
 async files(projectId:string,threadId:string|undefined,relativePath=''){
  const{path}=await this.binding(projectId,threadId),target=relativePath?join(path,pathName.parse(relativePath)):path;if(!inside(path,await realpath(target)))throw new HarnessError('CAPABILITY_DENIED','Files stay inside the selected worktree.');
  return withPathGuard([{path:target,leaf:false}],new AbortController().signal,async()=>{const{readdir}=await import('node:fs/promises'),entries=[];for(const item of(await readdir(target,{withFileTypes:true})).slice(0,500)){if(item.name==='.git'||item.name==='.harness-directory-guard'||item.isSymbolicLink())continue;entries.push({name:item.name,path:relativePath?relativePath+'/'+item.name:item.name,kind:item.isDirectory()?'directory':'file'});}return{path:relativePath,entries};});
 }
 async file(projectId:string,threadId:string|undefined,relativePath:string){const{path}=await this.binding(projectId,threadId),target=join(path,pathName.parse(relativePath));if(!inside(path,await realpath(target))||relativePath.replaceAll('\\','/').split('/').includes('.git'))throw new HarnessError('CAPABILITY_DENIED','Choose a source file inside this worktree.');return withPathGuard([{path:target,leaf:true,readOnly:true}],new AbortController().signal,async()=>{const data=await readBoundFile(target,1024*1024);return{text:data.includes(0)?null:data.toString('utf8'),binary:data.includes(0),sha256:hash(data)};});}
 async dispose(){await Promise.allSettled([...this.queues.values()]);}
}
