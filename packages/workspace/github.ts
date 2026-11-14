import {execFile} from 'node:child_process';
import {lstat,mkdir,mkdtemp,open} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {z} from 'zod';
import {HarnessError} from '../contracts/index.ts';
import {processEnvironment} from '../capabilities/process.ts';
import type {ProjectTools} from './tools.ts';
import type {TerminalHost} from './terminal.ts';
import {GitHubAuth} from './github-auth.ts';
import {secureDirectory} from '../runtime-official/manifest.ts';
import {readBoundFile,removeOwnedFile,withPathGuard} from '../core/file-access.ts';
import {CODE_REVIEW_LIMITS,ComparisonFileRequestSchema,type CodeReviewComparison,type ComparisonPatch,type ComparisonRead,type PullRequestComparisonIdentity} from '../contracts/code-review.ts';
import {ComparisonSnapshots,PullComparisonSchema,RemoteComparisonSchema,comparisonError,comparisonResult,normalizeChecks,remotePatch,reviewHash} from './code-review.ts';

const repository=z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),number=z.number().int().positive();
const bodyText=z.string().max(64000).refine(value=>Buffer.from(value,'utf8').toString('utf8')===value,'Pull request text must be valid Unicode.');
const quote=(path:string)=>"'"+path.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
export const bundledGh=fileURLToPath(new URL('../../.harness-tool-bundles/gh/bin/gh.exe',import.meta.url));
interface PullRequest{number:number;title:string;url:string;state:string;headRefOid:string;headRefName:string;isDraft:boolean}
/** Bundled GitHub CLI with a private sign-in profile and exact reviewed revisions. */
export class GitHubTools{
 readonly auth:GitHubAuth;
 private readonly reviewComparisons=new ComparisonSnapshots();
 constructor(private readonly projects:ProjectTools,_terminals:TerminalHost,private readonly executable=bundledGh){this.auth=new GitHubAuth(projects.store.dataDir);}
 private environment(){const root=join(this.projects.store.dataDir,'github');return{...processEnvironment(),HOME:root,USERPROFILE:root,GH_CONFIG_DIR:join(root,'config'),GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GIT_TERMINAL_PROMPT:'0'};}
 private parseOutput(output:string){try{return JSON.parse(output) as unknown;}catch{throw new HarnessError('GITHUB_CLI_OUTPUT_INVALID','The GitHub CLI returned unreadable output. Check the bundled gh tool and the repository state.');}}
 private async run(path:string,args:string[]){const token=await this.auth.token();await mkdir(join(this.projects.store.dataDir,'github/config'),{recursive:true});return(await promisify(execFile)(this.executable,args,{cwd:path,env:{...this.environment(),GH_TOKEN:token},windowsHide:true,timeout:60000,maxBuffer:2*1024*1024,encoding:'utf8'})).stdout;}
 private async withInput<T>(text:string,target:{url:string;head:string;revision:string;repo:string},action:(path:string)=>Promise<T>):Promise<T>{
  const parent=await secureDirectory(this.projects.store.dataDir,join(this.projects.store.dataDir,'github','requests')),directory=await mkdtemp(join(parent,'request-')),directoryIdentity=await lstat(directory,{bigint:true}),path=join(directory,'input'),bytes=Buffer.from(text,'utf8'),signal=new AbortController().signal;
  let identity:{dev:bigint;ino:bigint}|undefined,value:T|undefined,entered=false,failed=false,failure:unknown;
  try{
   await withPathGuard([{path:directory,leaf:false,dev:String(directoryIdentity.dev),ino:String(directoryIdentity.ino)}],signal,async()=>{
    const file=await open(path,'wx',0o600);try{identity=await file.stat({bigint:true});await file.writeFile(bytes);}finally{await file.close();}
    await withPathGuard([{path,leaf:true,readOnly:true,dev:String(identity.dev),ino:String(identity.ino)}],signal,async()=>{
     if(!(await readBoundFile(path,512*1024,{dev:String(identity!.dev),ino:String(identity!.ino),size:bytes.length})).equals(bytes))throw new HarnessError('CAPABILITY_DENIED','The private GitHub request input changed before submission.');
     entered=true;try{value=await action(path);}catch(error){failed=true;failure=error;}
    });
   });
   if(failed)throw failure;return value!;
  }catch(error){if(failed)throw failure;if(entered)throw new HarnessError('GITHUB_INPUT_UNCONFIRMED',`The GitHub request input could not be confirmed. Inspect ${target.url||'https://github.com/'+target.repo} at commit ${target.head.slice(0,10)} before retrying.`,target);throw error;}
  finally{try{if(identity)await removeOwnedFile(path,identity,signal);await removeOwnedFile(directory,directoryIdentity,signal,false,true);}catch{process.stderr.write('Gen V1 retained a private GitHub request input because cleanup could not be confirmed.\n');}}
 }
 async repo(projectId:string,threadId?:string){const{path}=await this.projects.binding(projectId,threadId),url=(await this.projects.git(path,['remote','get-url','origin'])).trim(),match=/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);if(!match)throw new HarnessError('GITHUB_REMOTE_REQUIRED','Use an origin remote hosted on github.com.');return{path,repo:repository.parse(match[1])};}
 async list(projectId:string,threadId?:string){const{path,repo}=await this.repo(projectId,threadId),items=this.parseOutput(await this.run(path,['pr','list','--repo',repo,'--state','all','--limit','50','--json','number,title,url,state,headRefOid,headRefName,isDraft'])) as PullRequest[];return{repo,items};}
 async create(projectId:string,threadId:string|undefined,input:Record<string,unknown>){
  const{path,repo}=await this.repo(projectId,threadId),status=await this.projects.gitStatus(projectId,threadId);if(status.gitWrite!==true)throw new HarnessError('PROJECT_READ_ONLY','Pull request creation requires a writable managed working copy.');if(input.revision!==status.revision||input.head!==status.head)throw new HarnessError('REVISION_CHANGED','The reviewed working copy changed. Refresh before creating the pull request.');
  if(status.files.length)throw new HarnessError('UNCOMMITTED_CHANGES','Commit the reviewed changes before creating the pull request.');
  const title=z.string().trim().min(1).max(200).refine(value=>!value.includes('\0')&&Buffer.from(value,'utf8').toString('utf8')===value,'Pull request title must be valid text.').parse(input.title),body=bodyText.parse(input.body??''),base=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9/_-]{0,150}$/).parse(input.base??'main');if(!status.branch)throw new HarnessError('BRANCH_REQUIRED','Create a branch before opening a pull request.');
  const created={url:'',head:status.head,revision:status.revision,repo};return this.withInput(body,created,async bodyFile=>{
  if(input.push===true){
   const helper='!'+quote(this.executable)+' auth git-credential',environment={...this.environment(),GH_TOKEN:await this.auth.token()};
   await this.projects.git(path,['-c','credential.https://github.com.helper='+helper,'push','--','https://github.com/'+repo+'.git',status.head+':refs/heads/'+status.branch],undefined,environment);
  }
  const remote=this.parseOutput(await this.run(path,['api',`repos/${repo}/git/ref/heads/${encodeURIComponent(status.branch)}`])) as {object?:{sha?:string}};if(remote.object?.sha!==status.head)throw new HarnessError('REVISION_CHANGED','The GitHub branch does not match the reviewed local commit. Push the reviewed branch first.');
  const after=await this.projects.gitStatus(projectId,threadId);if(after.gitWrite!==true)throw new HarnessError('PROJECT_READ_ONLY','The working copy is no longer writable.');if(after.head!==status.head||after.revision!==status.revision)throw new HarnessError('REVISION_CHANGED','The working copy changed while preparing publication.');
  const result=await this.run(path,['pr','create','--repo',repo,'--draft','--title',title,'--body-file',bodyFile,'--base',base,'--head',status.branch]);created.url=result.trim();
  let createdHead:string;
  try{createdHead=z.object({headRefOid:z.string().min(1).max(128)}).parse(this.parseOutput(await this.run(path,['pr','view',created.url,'--repo',repo,'--json','headRefOid']))).headRefOid;}
  catch{throw new HarnessError('PR_VERIFICATION_FAILED',`The pull request was created, but its commit could not be verified. Inspect ${created.url} before retrying.`,created);}
  if(createdHead!==status.head)throw new HarnessError('REVISION_CHANGED',`The pull request was created at ${created.url}, but its commit differs from the reviewed commit. Inspect it before retrying.`,created);
  return created;
  });
 }
 async details(projectId:string,threadId:string|undefined,pullNumber:number){const{path,repo}=await this.repo(projectId,threadId),status=await this.projects.gitStatus(projectId,threadId),item=this.parseOutput(await this.run(path,['pr','view',String(number.parse(pullNumber)),'--repo',repo,'--json','number,title,url,state,baseRefOid,headRefOid,headRefName,isDraft,files,reviews,statusCheckRollup'])) as {headRefOid?:string};return{repo,item,head:status.head,revision:status.revision,canReview:status.gitWrite===true&&item.headRefOid===status.head};}
 private async comparisonRepository(projectId:string,threadId?:string){
  const{path}=await this.projects.binding(projectId,threadId),origin=(await this.projects.gitReviewOrigin(projectId,threadId)).trim(),match=/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(origin);
  if(!match)throw new HarnessError('GITHUB_REMOTE_REQUIRED','Use an enrolled origin hosted on github.com.');
  const repo=repository.parse(match[1]);return{path,repo,owner:JSON.stringify([projectId,threadId??null,path,repo])};
 }
 async comparison(projectId:string,threadId:string|undefined,pullNumber:number):Promise<ComparisonRead>{
  const selected=number.parse(pullNumber),{path,repo,owner}=await this.comparisonRepository(projectId,threadId);
  try{
   const item=PullComparisonSchema.parse(this.parseOutput(await this.run(path,['pr','view',String(selected),'--repo',repo,'--json','id,number,title,url,baseRefOid,headRefOid,baseRefName,headRefName,statusCheckRollup'])));
   if(item.number!==selected||item.url!==`https://github.com/${repo}/pull/${selected}`)throw new HarnessError('COMPARISON_IDENTITY_CHANGED','The pull request identity did not match.');
   // GitHub PRs use three-dot semantics. Both tips are immutable, not branch names.
   const data=RemoteComparisonSchema.parse(this.parseOutput(await this.run(path,['api',`repos/${repo}/compare/${item.baseRefOid}...${item.headRefOid}?per_page=1`])));
   if(data.base_commit.sha!==item.baseRefOid)throw new HarnessError('COMPARISON_IDENTITY_CHANGED','The compared base did not match.');
   const identity:PullRequestComparisonIdentity={kind:'pull-request',id:'',repo,number:selected,pullRequestId:item.id,baseOid:item.baseRefOid,headOid:item.headRefOid,mergeBaseOid:data.merge_base_commit.sha,baseRef:item.baseRefName,headRef:item.headRefName,semantics:'merge-base'};
   identity.id=reviewHash([owner,identity]);
   const files=data.files.map(file=>({path:file.filename,...(file.previous_filename?{oldPath:file.previous_filename}:{}),status:file.status,untracked:false,additions:file.additions,deletions:file.deletions,blobOid:file.sha}));
   if(new Set(files.map(file=>file.path)).size!==files.length)throw new HarnessError('COMPARISON_INVALID','The comparison contains duplicate paths.');
   const value:CodeReviewComparison={identity,files,filesTruncated:files.length===CODE_REVIEW_LIMITS.remoteFiles,checks:normalizeChecks(item.statusCheckRollup),observedAt:new Date().toISOString(),access:{mode:'remote',untrackedIncluded:false}};
   const patches=new Map(files.map((file,i)=>[file.path,remotePatch(identity,file,data.files[i].patch)]));
   // Keep only allowlisted blob identities, never upstream download/raw URLs.
   this.reviewComparisons.save(owner,value,patches);
   return comparisonResult(value);
  }catch(error){return comparisonError(error);}
 }
 async comparisonFile(projectId:string,threadId:string|undefined,input:unknown):Promise<ComparisonPatch>{
  const request=ComparisonFileRequestSchema.parse(input),{path,owner,repo}=await this.comparisonRepository(projectId,threadId),entry=this.reviewComparisons.get(owner,request.comparisonId),result=entry.patches?.get(request.path);
  if(!result)throw new HarnessError('NOT_FOUND','The selected file is not in this comparison.');
  if(result.state!=='unavailable'||result.reason!=='patch-omitted')return result;
  const sha=result.file.blobOid;
  if(!sha)throw new HarnessError('COMPARISON_EXPIRED','Refresh the comparison before reading this file.');
  try{
   const blob=z.object({sha:z.literal(sha),size:z.number().int().nonnegative(),encoding:z.literal('base64'),content:z.string()}).parse(this.parseOutput(await this.run(path,['api',`repos/${repo}/git/blobs/${sha}`]))),bytes=Buffer.from(blob.content.replace(/\s/g,''),'base64');
   if(blob.size>CODE_REVIEW_LIMITS.patchBytes)return{...result,state:'truncated',reason:'resource-limit'};
   if(bytes.length!==blob.size)return result;
   if(bytes.includes(0)||!Buffer.from(bytes.toString('utf8'),'utf8').equals(bytes))return{...result,state:'binary',reason:undefined};
   return result;
  }catch{return result;}
 }
 async review(projectId:string,threadId:string|undefined,input:Record<string,unknown>){const pullNumber=number.parse(input.number),details=await this.details(projectId,threadId,pullNumber),{path}=await this.projects.binding(projectId,threadId),current=await this.projects.gitStatus(projectId,threadId);if(current.gitWrite!==true)throw new HarnessError('PROJECT_READ_ONLY','Pull request reviews require a writable managed working copy.');if(input.head!==details.head||input.revision!==details.revision||!details.canReview||current.head!==details.head||current.revision!==details.revision)throw new HarnessError('REVISION_CHANGED','The pull request and local reviewed revision must match exactly.');const event=z.enum(['APPROVE','REQUEST_CHANGES','COMMENT']).parse(input.event),body=bodyText.parse(input.body??''),target={url:`https://github.com/${details.repo}/pull/${pullNumber}`,head:details.head,revision:details.revision,repo:details.repo};return this.withInput(JSON.stringify({commit_id:details.head,event,body}),target,async file=>{
  const latest=await this.projects.gitStatus(projectId,threadId);if(latest.gitWrite!==true)throw new HarnessError('PROJECT_READ_ONLY','Pull request reviews require a writable managed working copy.');if(latest.head!==details.head||latest.revision!==details.revision)throw new HarnessError('REVISION_CHANGED','The pull request and local reviewed revision must match exactly.');
  return this.parseOutput(await this.run(path,['api','--method','POST',`repos/${details.repo}/pulls/${pullNumber}/reviews`,'--input',file]));
 });}
}
