import {afterEach,expect,it,vi} from 'vitest';
import {syncBuiltinESMExports} from 'node:module';
import {lstat,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {GitHubAuth} from '../packages/workspace/github-auth.ts';
import {GitHubTools} from '../packages/workspace/github.ts';
import type {ProjectTools} from '../packages/workspace/tools.ts';
import type {TerminalHost} from '../packages/workspace/terminal.ts';
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{vi.restoreAllMocks();syncBuiltinESMExports();for(const close of cleanup.splice(0).reverse())await close();});
it('keeps device authorization tokens private and requires a Gen V1 credential before CLI use',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gen-gh-auth-'));cleanup.push(()=>rm(root,{recursive:true,force:true,maxRetries:5}));let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
 const request=vi.fn(async(url:unknown)=>new Response(JSON.stringify(String(url).endsWith('/device/code')?{device_code:'private-device-code',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:900,interval:5}:String(url).endsWith('/access_token')?{access_token:'private-profile-token'}:{login:'fixture-user'}),{status:200,headers:{'Content-Type':'application/json'}}));
 const auth=new GitHubAuth(root,request as typeof fetch);await expect(auth.token()).rejects.toThrow(/Sign in/);
 const flow=await auth.start();expect(JSON.stringify(flow)).not.toContain('private-device-code');expect(await auth.poll(flow.id)).toEqual({status:'pending'});expect(request).toHaveBeenCalledTimes(1);
 now+=5001;const result=await auth.poll(flow.id);expect(result).toEqual({status:'authenticated',login:'fixture-user'});expect(JSON.stringify(result)).not.toContain('private-profile-token');expect(await new GitHubAuth(root).token()).toBe('private-profile-token');
});
it('refuses to create a PR when the GitHub branch differs from the reviewed local commit',async()=>{
 const{github,run,status}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}));run.mockResolvedValueOnce(JSON.stringify({object:{sha:'b'.repeat(40)}}));
 await expect(github.create('project',undefined,{title:'Review',head:status.head,revision:status.revision,push:false})).rejects.toThrow(/GitHub branch/);expect(run.mock.calls[0]).toBeDefined();expect(run).toHaveBeenCalledTimes(1);
});
async function createdPullRequest(readCreated:()=>Promise<string>,access:{gitWrite?:boolean;mode?:'managed'|'legacy'}={gitWrite:true,mode:'managed'}){
 const root=await mkdtemp(join(tmpdir(),'gen-gh-pr-'));cleanup.push(async()=>{if(!root.startsWith(join(tmpdir(),'gen-gh-pr-')))throw Error('Unexpected PR fixture cleanup path');await rm(root,{recursive:true,force:true,maxRetries:5});});
 const status={head:'a'.repeat(40),branch:'gen/review',revision:'c'.repeat(64),files:[],...access},url='https://github.com/example/fixture/pull/12';
 const payloads:{path:string;bytes:Buffer}[]=[];
 const git=vi.fn(async(_path:string,_args:string[])=>'https://github.com/example/fixture.git'),gitStatus=vi.fn(async()=>status);
 const projects={store:{dataDir:root},binding:async()=>({path:root}),git,gitStatus} as unknown as ProjectTools;
 const github=new GitHubTools(projects,{} as TerminalHost),run=vi.fn(async(_path:string,args:string[])=>{
  await mkdir(join(root,'github','config'),{recursive:true});
  for(const flag of ['--body-file','--input'])if(args.includes(flag)){const path=args[args.indexOf(flag)+1];payloads.push({path,bytes:await readFile(path)});}
  if(args[0]==='api')return JSON.stringify({object:{sha:status.head}});
  if(args[0]==='pr'&&args[1]==='create')return url+'\n';
  if(args[0]==='pr'&&args[1]==='view')return readCreated();
  throw Error('Unexpected GitHub command');
 });(github as unknown as {run:typeof run}).run=run;
 return{github,run,git,gitStatus,status,url,root,payloads,input:{title:'Review',head:status.head,revision:status.revision,push:false}};
}
it('returns a created PR only after its actual head matches the reviewed commit',async()=>{
 const {github,run,status,url,input}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}));
 await expect(github.create('project','thread',input)).resolves.toEqual({url,head:status.head,revision:status.revision,repo:'example/fixture'});
 expect(run.mock.calls.at(-1)?.[1]).toEqual(['pr','view',url,'--repo','example/fixture','--json','headRefOid']);
 expect(run.mock.calls.filter(([,args])=>args[0]==='pr'&&args[1]==='create')).toHaveLength(1);
});
it('retains the created PR URL when its actual head differs from the reviewed commit',async()=>{
 const {github,run,status,url,input}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'b'.repeat(40)}));
 await expect(github.create('project','thread',input)).rejects.toMatchObject({code:'REVISION_CHANGED',message:expect.stringContaining(url),details:{url,head:status.head,revision:status.revision,repo:'example/fixture'}});
 expect(run.mock.calls.filter(([,args])=>args[0]==='pr'&&args[1]==='create')).toHaveLength(1);
});
it.each([
 ['failed read',async():Promise<string>=>{throw Error('CLI unavailable');}],
 ['malformed JSON',async():Promise<string>=>'{'],
 ['missing head',async():Promise<string>=>JSON.stringify({})],
] as const)('retains the already-created PR URL after %s without creating it again',async(_name,readCreated)=>{
 const {github,run,status,url,input}=await createdPullRequest(readCreated);
 await expect(github.create('project','thread',input)).rejects.toMatchObject({code:'PR_VERIFICATION_FAILED',message:expect.stringContaining(url),details:{url,head:status.head,revision:status.revision,repo:'example/fixture'}});
 expect(run.mock.calls.filter(([,args])=>args[0]==='pr'&&args[1]==='create')).toHaveLength(1);
});
it.each([
 ['legacy read-only',{gitWrite:false,mode:'legacy'}],
 ['managed read-only',{gitWrite:false,mode:'managed'}],
 ['missing capability',{}],
] as const)('refuses draft creation and push without writable authority: %s',async(_name,access)=>{
 const {github,run,git,input}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}),access);
 const token=vi.spyOn(github.auth,'token').mockResolvedValue('unused-fixture-token');
 await expect(github.create('project','thread',{...input,push:true})).rejects.toMatchObject({code:'PROJECT_READ_ONLY'});
 expect(token).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();expect(git.mock.calls.some(([,args])=>args.includes('push'))).toBe(false);
});
it.each([
 ['legacy read-only',{gitWrite:false,mode:'legacy'}],
 ['managed read-only',{gitWrite:false,mode:'managed'}],
 ['missing capability',{}],
] as const)('refuses review writes without writable authority: %s',async(_name,access)=>{
 const {github,run,status}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}),access);
 expect((await github.details('project','thread',12)).canReview).toBe(false);
 await expect(github.review('project','thread',{number:12,event:'APPROVE',head:status.head,revision:status.revision})).rejects.toMatchObject({code:'PROJECT_READ_ONLY'});
 expect(run.mock.calls.some(([,args])=>args.includes('POST'))).toBe(false);
});
it('rechecks writable authority after remote validation before draft creation',async()=>{
 const {github,run,status,gitStatus,input}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}));
 gitStatus.mockResolvedValueOnce(status).mockResolvedValueOnce({...status,gitWrite:false});
 await expect(github.create('project','thread',input)).rejects.toMatchObject({code:'PROJECT_READ_ONLY'});
 expect(run.mock.calls.some(([,args])=>args[0]==='pr'&&args[1]==='create')).toBe(false);
});
it.each(['capability','revision'] as const)('rechecks %s after PR details before review submission',async(change)=>{
 const {github,run,status,gitStatus}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}));
 gitStatus.mockResolvedValueOnce(status).mockResolvedValueOnce({...status,...(change==='capability'?{gitWrite:false}:{revision:'d'.repeat(64)})});
 await expect(github.review('project','thread',{number:12,event:'APPROVE',head:status.head,revision:status.revision})).rejects.toMatchObject({code:change==='capability'?'PROJECT_READ_ONLY':'REVISION_CHANGED'});
 expect(run.mock.calls.some(([,args])=>args.includes('POST'))).toBe(false);
});
it('submits a writable exact-head review against its reviewed commit',async()=>{
 const {github,run,status,payloads}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}));
 expect((await github.details('project','thread',12)).canReview).toBe(true);
 await github.review('project','thread',{number:12,event:'COMMENT',body:'Reviewed fixture',head:status.head,revision:status.revision});
 const args=run.mock.calls.at(-1)?.[1];expect(args?.slice(0,5)).toEqual(['api','--method','POST','repos/example/fixture/pulls/12/reviews','--input']);
 expect(JSON.parse(payloads[0]?.bytes.toString('utf8')??'{}')).toEqual({commit_id:status.head,event:'COMMENT',body:'Reviewed fixture'});
});
const longBody='é🚢\nActual line\\nLiteral\\backslash\r\n'.repeat(1500);
it('writes long Unicode PR text exactly to a private file before push and removes it after success',async()=>{
 const{github,run,git,root,input,payloads}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}));
 expect(longBody.length).toBeGreaterThan(32768);expect(longBody.length).toBeLessThanOrEqual(64000);
 vi.spyOn(github.auth,'token').mockResolvedValue('unused-fixture-token');let readyBeforePush=false;
 git.mockImplementation(async(_path,args)=>{if(args.includes('push')){const parent=join(root,'github','requests'),directories=await readdir(parent);expect(directories).toHaveLength(1);const bytes=await readFile(join(parent,directories[0],'input'));readyBeforePush=bytes.equals(Buffer.from(longBody,'utf8'));}return'https://github.com/example/fixture.git';});
 await expect(github.create('project','thread',{...input,body:longBody,push:true})).resolves.toMatchObject({url:'https://github.com/example/fixture/pull/12'});
 const args=run.mock.calls.find(([,args])=>args[0]==='pr'&&args[1]==='create')?.[1];expect(args).toContain('--body-file');expect(args).not.toContain('--body');expect(args?.join(' ').length).toBeLessThan(4096);expect(readyBeforePush).toBe(true);expect(payloads[0].bytes.equals(Buffer.from(longBody,'utf8'))).toBe(true);
 expect(payloads[0].path.startsWith(join(root,'github','requests')+'\\')).toBe(true);await expect(lstat(payloads[0].path)).rejects.toMatchObject({code:'ENOENT'});await expect(lstat(dirname(payloads[0].path))).rejects.toMatchObject({code:'ENOENT'});
});
it('uses file-backed review JSON without changing newlines, Unicode or literal backslashes',async()=>{
 const{github,run,status,payloads}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}));
 await github.review('project','thread',{number:12,event:'REQUEST_CHANGES',body:longBody,head:status.head,revision:status.revision});
 const args=run.mock.calls.at(-1)?.[1];expect(args).toContain('--input');expect(args).not.toContain('-f');expect(args?.join(' ').length).toBeLessThan(4096);const value=JSON.parse(payloads[0]?.bytes.toString('utf8')??'{}');expect(value.body===longBody).toBe(true);expect(value.commit_id).toBe(status.head);expect(value.event).toBe('REQUEST_CHANGES');
 await expect(lstat(payloads[0].path)).rejects.toMatchObject({code:'ENOENT'});await expect(lstat(dirname(payloads[0].path))).rejects.toMatchObject({code:'ENOENT'});
});
it.each(['capability','head','revision'] as const)('rejects changed %s while preparing a private review input',async(change)=>{
 const{github,run,status}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}));
 const owner=github as unknown as {withInput(text:string,target:unknown,action:(path:string)=>Promise<unknown>):Promise<unknown>},prepare=owner.withInput.bind(owner);
 vi.spyOn(owner,'withInput').mockImplementation((text,target,action)=>prepare(text,target,async path=>{
  if(change==='capability')status.gitWrite=false;else if(change==='head')status.head='b'.repeat(40);else status.revision='d'.repeat(64);
  return action(path);
 }));
 await expect(github.review('project','thread',{number:12,event:'COMMENT',body:'Exact reviewed input',head:status.head,revision:status.revision})).rejects.toMatchObject({code:change==='capability'?'PROJECT_READ_ONLY':'REVISION_CHANGED'});
 expect(run.mock.calls.some(([,args])=>args.includes('POST'))).toBe(false);
});
it.each(['create','review'] as const)('cleans private %s input while preserving a remote failure',async(kind)=>{
 const{github,run,status,input,payloads}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)})),original=run.getMockImplementation()!,failure=Error('Synthetic remote failure');
 run.mockImplementation(async(path,args)=>{const result=await original(path,args);if(args.includes('--body-file')||args.includes('--input'))throw failure;return result;});
 await expect(kind==='create'?github.create('project','thread',{...input,body:longBody}):github.review('project','thread',{number:12,event:'COMMENT',head:status.head,revision:status.revision,body:longBody})).rejects.toBe(failure);
 expect(payloads).toHaveLength(1);await expect(lstat(payloads[0].path)).rejects.toMatchObject({code:'ENOENT'});await expect(lstat(dirname(payloads[0].path))).rejects.toMatchObject({code:'ENOENT'});
});
it('fails private input allocation before acquiring push credentials or mutating the remote',async()=>{
 const{github,run,git,root,input}=await createdPullRequest(async()=>JSON.stringify({headRefOid:'a'.repeat(40)}));await writeFile(join(root,'github'),'Existing ordinary file');const token=vi.spyOn(github.auth,'token').mockResolvedValue('unused-fixture-token');
 await expect(github.create('project','thread',{...input,body:longBody,push:true})).rejects.toBeDefined();expect(token).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();expect(git.mock.calls.some(([,args])=>args.includes('push'))).toBe(false);
});
it.each(['success','verification failure'] as const)('retains publication state after %s even when exact directory cleanup is refused',async(outcome)=>{
 const{github,run,input,payloads,url}=await createdPullRequest(async()=>JSON.stringify({headRefOid:(outcome==='success'?'a':'b').repeat(40)})),original=run.getMockImplementation()!;const warn=vi.spyOn(process.stderr,'write').mockImplementation(()=>true);
 run.mockImplementation(async(path,args)=>{const result=await original(path,args);if(args.includes('--body-file'))await writeFile(join(dirname(payloads[0].path),'unowned.txt'),'Keep this unexpected file');return result;});
 if(outcome==='success')await expect(github.create('project','thread',{...input,body:longBody})).resolves.toEqual({url,head:input.head,revision:input.revision,repo:'example/fixture'});else await expect(github.create('project','thread',{...input,body:longBody})).rejects.toMatchObject({code:'REVISION_CHANGED',details:{url},message:expect.stringContaining(url)});
 expect(warn).toHaveBeenCalled();expect(await readFile(join(dirname(payloads[0].path),'unowned.txt'),'utf8')).toBe('Keep this unexpected file');await expect(lstat(payloads[0].path)).rejects.toMatchObject({code:'ENOENT'});
});

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(accept=>{resolve=accept;});return{promise,resolve};}
async function authFixture(){
 const root=await mkdtemp(join(tmpdir(),'gen-gh-auth-'));cleanup.push(()=>rm(root,{recursive:true,force:true,maxRetries:5}));let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
 const request=vi.fn(async(url:unknown)=>new Response(JSON.stringify(String(url).endsWith('/device/code')?{device_code:'private-code',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:60,interval:1}:String(url).endsWith('/access_token')?{access_token:'new-profile-token'}:{login:'fixture-user'}),{status:200}));
 const auth=new GitHubAuth(root,request as typeof fetch);return{root,auth,request,advance:(ms:number)=>{now+=ms;}};
}
it.each(['cancel','replace','expire'] as const)('fences %s while a token request is in flight',async(change)=>{
 const{root,auth,request,advance}=await authFixture(),flow=await auth.start(),pending=deferred<Response>();advance(1001);request.mockImplementationOnce(()=>pending.promise);const poll=auth.poll(flow.id),rejected=expect(poll).rejects.toMatchObject({code:'GITHUB_AUTH_EXPIRED'});
 if(change==='cancel')await auth.cancel(flow.id);else if(change==='replace')await auth.start();else advance(60000);
 pending.resolve(new Response(JSON.stringify({access_token:'stale-profile-token'})));await rejected;await expect(lstat(join(root,'github','credentials.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it('orders starts by invocation and refuses a delayed superseded start',async()=>{
 const{auth,request}=await authFixture(),pending=deferred<Response>();request.mockImplementationOnce(()=>pending.promise);const first=auth.start(),rejected=expect(first).rejects.toMatchObject({code:'GITHUB_AUTH_EXPIRED'}),second=await auth.start();
 pending.resolve(new Response(JSON.stringify({device_code:'old-code',user_code:'OLD-CODE',verification_uri:'https://github.com/login/device',expires_in:60,interval:1})));await rejected;expect(await auth.poll(second.id)).toEqual({status:'pending'});
});
it.each(['cancel','replace','expire'] as const)('fences %s during private credential writing before rename and preserves the prior token',async(change)=>{
 const{auth,root,advance}=await authFixture();await mkdir(join(root,'github'));const prior=JSON.stringify({version:1,token:'prior-profile-token',login:'prior-user'});await writeFile(join(root,'github','credentials.json'),prior);
 const flow=await auth.start();advance(1001);const entered=deferred<void>(),release=deferred<void>();const disk=(await import('node:fs/promises')).default,original=disk.writeFile;
 vi.spyOn(disk,'writeFile').mockImplementation(async(...args:Parameters<typeof writeFile>)=>{await original(...args);if(String(args[0]).endsWith('.tmp')){entered.resolve();await release.promise;}});syncBuiltinESMExports();
 const poll=auth.poll(flow.id),rejected=expect(poll).rejects.toMatchObject({code:'GITHUB_AUTH_EXPIRED'});await entered.promise;
 if(change==='cancel')await auth.cancel(flow.id);else if(change==='replace')await auth.start();else advance(60000);release.resolve();await rejected;
 expect(await readFile(join(root,'github','credentials.json'),'utf8')).toBe(prior);expect((await readdir(join(root,'github'))).filter(name=>name.endsWith('.tmp'))).toEqual([]);
});
it('serializes polling per flow and treats cancellation of an older flow as harmless',async()=>{
 const{auth,request,advance}=await authFixture(),old=await auth.start(),flow=await auth.start();await auth.cancel(old.id);const pending=deferred<Response>();advance(1001);request.mockImplementationOnce(()=>pending.promise);const first=auth.poll(flow.id);advance(1001);expect(await auth.poll(flow.id)).toEqual({status:'pending'});expect(request).toHaveBeenCalledTimes(3);
 pending.resolve(new Response(JSON.stringify({access_token:'current-profile-token'})));expect(await first).toEqual({status:'authenticated',login:'fixture-user'});
});

it('reports denial without mislabelling it as a cancelled sign-in',async()=>{
 const{auth,request,advance}=await authFixture(),flow=await auth.start();advance(1001);request.mockImplementationOnce(async()=>new Response(JSON.stringify({error:'access_denied'})));await expect(auth.poll(flow.id)).rejects.toMatchObject({code:'GITHUB_AUTH_FAILED',message:expect.stringContaining('denied')});
});

it('reports a completed sign-in when credential commit wins the cancellation race',async()=>{
 const{auth,advance}=await authFixture(),flow=await auth.start();advance(1001);expect(await auth.poll(flow.id)).toEqual({status:'authenticated',login:'fixture-user'});expect(auth.cancel(flow.id)).toEqual({status:'authenticated',login:'fixture-user'});expect(await auth.token()).toBe('new-profile-token');
});
