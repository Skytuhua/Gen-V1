import {afterEach,expect,it,vi} from 'vitest';
import {join,resolve} from 'node:path';
import {mkdtempSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createRuntime} from '../packages/runtime/index.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {SUBSCRIPTION_CONNECTIONS} from '../packages/contracts/connections.ts';
import {accountProfileRoot} from '../packages/runtime/account-profile.ts';
import type {ConnectionAccount,RuntimeAccountResolver} from '../packages/contracts/accounts.ts';
import {taskPaths,validateSessionPath} from '../packages/runtime-pi/session.ts';

const root=resolve('.harness-runtime-router-fixture');
const temporary:string[]=[];
const profileFixture=()=>{const dir=mkdtempSync(join(tmpdir(),'harness-account-router-'));temporary.push(dir);return dir;};
afterEach(()=>{for(const path of temporary.splice(0))rmSync(path,{recursive:true,force:true});});
const input=(modelId='openai/model'):StartRun=>({threadId:'thread',runId:'run',epoch:1,modelId,sessionPath:null,inputId:'input',prompt:'A supplied task',resources:[]});
function adapter(){
 let callbacks:RuntimeCallbacks;
 const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:vi.fn(async()=>[]),start:vi.fn(async()=>{}),followUp:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),compact:vi.fn(async()=>{}),history:vi.fn(async()=>[]),dispose:vi.fn(async()=>{})};
 return {runtime,event:(type:string)=>callbacks.onEvent({...input(),type}),tool:()=>callbacks.onTool({name:'ui_inspect',args:{}},input())};
}
function fixture(accounts?:RuntimeAccountResolver){
 const pi=adapter(),official=adapter(),callbacks:RuntimeCallbacks={onEvent:vi.fn(),onTool:vi.fn(async()=>({ok:true}))};
 const runtime=createRuntime({dataDir:root,accounts},{pi:()=>pi.runtime,official:()=>official.runtime});runtime.configure(callbacks);
 return {runtime,pi,official,callbacks};
}

it('merges available runtime models without hiding a signed-in provider behind another auth failure',async()=>{
 const f=fixture();vi.mocked(f.pi.runtime.models).mockRejectedValue(Error('No Pi subscription'));vi.mocked(f.official.runtime.models).mockResolvedValue([{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}]);
 expect(await f.runtime.models()).toEqual([{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}]);
 vi.mocked(f.official.runtime.models).mockRejectedValue(Error('No official subscription'));await expect(f.runtime.models()).rejects.toMatchObject({code:'AI_AUTH_REQUIRED'});
});

it('routes the requested model and rejects a session belonging to a different runtime before startup',async()=>{
 const f=fixture();await f.runtime.start(input('claude-code/sonnet'));expect(f.official.runtime.start).toHaveBeenCalledOnce();expect(f.pi.runtime.start).not.toHaveBeenCalled();await f.runtime.cancel(input());
 await expect(f.runtime.start({...input(),sessionPath:join(root,'official','claude-code','tasks','thread','session.json')})).rejects.toMatchObject({code:'RUNTIME_SESSION_MISMATCH'});
 expect(f.pi.runtime.start).not.toHaveBeenCalled();
});

it('revokes callbacks before cancelling an in-flight startup and rejects late tool calls',async()=>{
 const f=fixture();let release!:()=>void;vi.mocked(f.official.runtime.start).mockImplementation(()=>new Promise<void>(done=>{release=done;}));
 const started=f.runtime.start(input('gemini-cli/pro'));await f.runtime.cancel(input());
 f.official.event('assistant.delta');expect(f.callbacks.onEvent).not.toHaveBeenCalled();
 await expect(f.official.tool()).rejects.toMatchObject({code:'STALE_RUN'});expect(f.callbacks.onTool).not.toHaveBeenCalled();release();await started;
});

it('retains cancellation ownership after an error and revokes a settled run before follow-up',async()=>{
 const f=fixture();await f.runtime.start(input());f.pi.event('error');await f.runtime.cancel(input());expect(f.pi.runtime.cancel).toHaveBeenCalledWith(input());
 await f.runtime.start(input());f.pi.event('settled');await expect(f.runtime.followUp(input())).rejects.toMatchObject({code:'STALE_RUN'});expect(f.pi.runtime.followUp).not.toHaveBeenCalled();
});
it('cancels the original adapter if startup rejects after acquiring a worker',async()=>{
 const f=fixture();vi.mocked(f.official.runtime.start).mockRejectedValue(Error('Initialization failed'));
 await expect(f.runtime.start(input('claude-code/sonnet'))).rejects.toThrow('Initialization failed');
 expect(f.official.runtime.cancel).toHaveBeenCalledWith(input('claude-code/sonnet'));
 await expect(f.official.tool()).rejects.toMatchObject({code:'STALE_RUN'});
});

it('cannot redirect an active follow-up to another provider and keeps single-run ownership',async()=>{
 const f=fixture();await f.runtime.start(input());await expect(f.runtime.followUp(input('gemini-cli/pro'))).rejects.toMatchObject({code:'RUNTIME_MODEL_MISMATCH'});
 await expect(f.runtime.start({...input('claude-code/sonnet'),runId:'other'})).rejects.toMatchObject({code:'RUNTIME_BUSY'});
 expect(f.official.runtime.start).not.toHaveBeenCalled();
});

it('routes compaction and history without passing official manifests to Pi or allowing outside sessions',async()=>{
 const f=fixture(),session=join(root,'official','gemini-cli','tasks','thread','session.json');
 await f.runtime.compact(input(),session,'gemini-cli/pro');expect(f.official.runtime.compact).toHaveBeenCalledWith(input(),session,'gemini-cli/pro');
 await f.runtime.history(session);expect(f.official.runtime.history).toHaveBeenCalledWith(session);expect(f.pi.runtime.history).not.toHaveBeenCalled();
 await expect(f.runtime.history(resolve(root,'..','outside.json'))).rejects.toMatchObject({code:'RUNTIME_SESSION_INVALID'});
});

it('disposes both adapters and rejects new work after disposal',async()=>{
 const f=fixture();await f.runtime.dispose();await f.runtime.dispose();expect(f.pi.runtime.dispose).toHaveBeenCalledOnce();expect(f.official.runtime.dispose).toHaveBeenCalledOnce();
 await expect(f.runtime.start(input())).rejects.toMatchObject({code:'RUNTIME_DISPOSED'});
});

it('keeps concurrent disposal pending and account ownership held until adapter cleanup completes',async()=>{
 const lease={id:'run-lease',nonce:'nonce'},releaseUse=vi.fn(),f=fixture({get:()=>null,claimUse:()=>lease,releaseUse});
 await f.runtime.start(input());
 let release!:()=>void;const cleanup=new Promise<void>(done=>{release=done;});vi.mocked(f.pi.runtime.dispose).mockReturnValue(cleanup);
 const completed=vi.fn(),first=f.runtime.dispose().then(completed),second=f.runtime.dispose().then(completed);
 try{
  await vi.waitFor(()=>expect(f.pi.runtime.dispose).toHaveBeenCalledOnce());
  expect(completed).not.toHaveBeenCalled();expect(releaseUse).not.toHaveBeenCalled();
  f.pi.event('assistant.delta');expect(f.callbacks.onEvent).not.toHaveBeenCalled();
  await expect(f.pi.tool()).rejects.toMatchObject({code:'STALE_RUN'});
  await expect(f.runtime.start(input())).rejects.toMatchObject({code:'RUNTIME_DISPOSED'});
 }finally{release();await Promise.all([first,second]);}
 expect(completed).toHaveBeenCalledTimes(2);expect(releaseUse).toHaveBeenCalledExactlyOnceWith(lease);
 await f.runtime.dispose();expect(f.pi.runtime.dispose).toHaveBeenCalledOnce();expect(f.official.runtime.dispose).toHaveBeenCalledOnce();
});

it('retains failed disposal and its account ownership for every later caller',async()=>{
 const lease={id:'run-lease',nonce:'nonce'},releaseUse=vi.fn(),f=fixture({get:()=>null,claimUse:()=>lease,releaseUse}),failure=Error('Native cleanup is unconfirmed');
 await f.runtime.start(input());vi.mocked(f.pi.runtime.dispose).mockRejectedValue(failure);
 const result=await f.runtime.dispose().catch(error=>error);
 expect(result).toBeInstanceOf(AggregateError);expect(result.errors).toEqual([failure]);
 await expect(f.runtime.dispose()).rejects.toBe(result);
 expect(releaseUse).not.toHaveBeenCalled();expect(f.pi.runtime.dispose).toHaveBeenCalledOnce();expect(f.official.runtime.dispose).toHaveBeenCalledOnce();
 await expect(f.runtime.start(input())).rejects.toMatchObject({code:'RUNTIME_DISPOSED'});
});

it('keeps pending Cursor models out of public discovery and rejects task admission before adapter startup',async()=>{
 const row=SUBSCRIPTION_CONNECTIONS.find(value=>value.id==='cursor-sdk')!,status=row.status;row.status='runtime-pending';
 try{
 const f=fixture();vi.mocked(f.official.runtime.models).mockResolvedValue([{id:'cursor-sdk/model',provider:'cursor-sdk',name:'Cursor model'},{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}]);
 expect(await f.runtime.models()).toEqual([{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}]);
 await expect(f.runtime.start(input('cursor-sdk/model'))).rejects.toMatchObject({code:'RUNTIME_PROVIDER_UNAVAILABLE'});
 await expect(f.runtime.compact(input(),join(root,'official','cursor-sdk','tasks','thread','session.json'),'cursor-sdk/model')).rejects.toMatchObject({code:'RUNTIME_PROVIDER_UNAVAILABLE'});
 expect(f.pi.runtime.start).not.toHaveBeenCalled();expect(f.official.runtime.start).not.toHaveBeenCalled();expect(f.official.runtime.compact).not.toHaveBeenCalled();
 }finally{row.status=status;}
});

it('routes admitted Cursor discovery and work to its official adapter without a Pi fallback',async()=>{
 const f=fixture(),model={id:'cursor-sdk/model',provider:'cursor-sdk',name:'Cursor model'};
 vi.mocked(f.official.runtime.models).mockResolvedValue([model]);expect(await f.runtime.models()).toEqual([model]);
 await f.runtime.start(input(model.id));expect(f.official.runtime.start).toHaveBeenCalledWith(input(model.id));expect(f.pi.runtime.start).not.toHaveBeenCalled();
 await f.runtime.cancel(input(model.id));expect(f.official.runtime.cancel).toHaveBeenCalledWith(input(model.id));
});

it('routes private Cursor history to the official adapter and rejects cross-provider resume',async()=>{
 const f=fixture(),session=join(root,'official','cursor-sdk','tasks','thread','session.json');
 await f.runtime.history(session);expect(f.official.runtime.history).toHaveBeenCalledWith(session);expect(f.pi.runtime.history).not.toHaveBeenCalled();
 await expect(f.runtime.start({...input('claude-code/sonnet'),sessionPath:session})).rejects.toMatchObject({code:'RUNTIME_SESSION_MISMATCH'});
 expect(f.official.runtime.start).not.toHaveBeenCalled();
});

it('lazily isolates account adapters, pins routing and denies cross-account sessions',async()=>{
 const root=profileFixture();
 const account:ConnectionAccount={id:crypto.randomUUID(),providerId:'openai',label:'A',enabled:true,createdAt:'now',updatedAt:'now'};
 const other:ConnectionAccount={...account,id:crypto.randomUUID(),label:'B'};
 const created:{root:string;pi:ReturnType<typeof adapter>;official?:ReturnType<typeof adapter>}[]=[];
 const runtime=createRuntime({dataDir:root,accounts:{get:id=>id===account.id?account:id===other.id?other:null}},{pi:options=>{const item={root:options.dataDir,pi:adapter()};created.push(item);return item.pi.runtime;},official:options=>{const item=created.find(item=>item.root===options.dataDir)!;item.official=adapter();return item.official.runtime;}});
 runtime.configure({onEvent:()=>{},onTool:async()=>null});expect(created).toHaveLength(1);
 await runtime.start({...input(),accountId:account.id});expect(created).toHaveLength(2);
 expect(created[1].root).toBe(accountProfileRoot(root,account));expect(created[1].pi.runtime.start).toHaveBeenCalledOnce();expect(created[0].pi.runtime.start).not.toHaveBeenCalled();
 await expect(runtime.followUp({...input(),accountId:other.id})).rejects.toMatchObject({code:'RUNTIME_ACCOUNT_MISMATCH'});
 await runtime.cancel(input());
 const session=join(created[1].root,'sessions','thread.jsonl');await runtime.history(session,account.id);expect(created[1].pi.runtime.history).toHaveBeenCalledWith(session);
 await expect(runtime.history(session,other.id)).rejects.toMatchObject({code:'RUNTIME_SESSION_INVALID'});
 await expect(runtime.history(session,null)).rejects.toMatchObject({code:'RUNTIME_SESSION_INVALID'});
 await expect(runtime.start({...input(),accountId:'unknown'})).rejects.toMatchObject({code:'ACCOUNT_NOT_FOUND'});
 await expect(runtime.start({...input('gemini-cli/pro'),accountId:account.id})).rejects.toMatchObject({code:'ACCOUNT_PROVIDER_MISMATCH'});
 await runtime.dispose();for(const item of created){expect(item.pi.runtime.dispose).toHaveBeenCalledOnce();expect(item.official!.runtime.dispose).toHaveBeenCalledOnce();}
});

it('scopes named-account model discovery to its provider and blocks a profile being signed in',async()=>{
 const root=profileFixture();
 const account:ConnectionAccount={id:crypto.randomUUID(),providerId:'openai',label:'A',enabled:false,createdAt:'now',updatedAt:'now'};let signingIn=false;
 const pi=adapter(),official=adapter(),runtime=createRuntime({dataDir:root,accounts:{get:id=>id===account.id?account:null,isSigningIn:()=>signingIn}},{pi:()=>pi.runtime,official:()=>official.runtime});
 vi.mocked(pi.runtime.models).mockResolvedValue([{id:'openai/model',provider:'openai',name:'A'},{id:'github-copilot/model',provider:'github-copilot',name:'Other'}]);
 vi.mocked(official.runtime.models).mockResolvedValue([{id:'gemini-cli/pro',provider:'gemini-cli',name:'Other'}]);
 expect(await runtime.models({accountId:account.id})).toEqual([{id:'openai/model',provider:'openai',name:'A'}]);expect(official.runtime.models).not.toHaveBeenCalled();
 signingIn=true;await expect(runtime.models({accountId:account.id})).rejects.toMatchObject({code:'ACCOUNT_SIGNING_IN'});await runtime.dispose();
});

it('rejects redirected named-account directories before any auth or session adapter call',async()=>{
 const root=profileFixture(),outside=profileFixture(),account:ConnectionAccount={id:crypto.randomUUID(),providerId:'openai',label:'A',enabled:true,createdAt:'now',updatedAt:'now'};
 mkdirSync(join(root,'accounts'));symlinkSync(outside,accountProfileRoot(root,account),'junction');
 const pi=adapter(),official=adapter(),runtime=createRuntime({dataDir:root,accounts:{get:()=>account}},{pi:()=>pi.runtime,official:()=>official.runtime});runtime.configure({onEvent:()=>{},onTool:async()=>null});
 await expect(runtime.start({...input(),accountId:account.id})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});expect(pi.runtime.start).not.toHaveBeenCalled();
 await expect(runtime.models({accountId:account.id})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});expect(pi.runtime.models).not.toHaveBeenCalled();
 await runtime.dispose();
});

it('rejects a resolver that changes the provider of an already acquired account profile',async()=>{
 const root=profileFixture();let account:ConnectionAccount={id:crypto.randomUUID(),providerId:'openai',label:'A',enabled:true,createdAt:'now',updatedAt:'now'};
 const pi=adapter(),official=adapter(),runtime=createRuntime({dataDir:root,accounts:{get:()=>account}},{pi:()=>pi.runtime,official:()=>official.runtime});
 await runtime.models({accountId:account.id});account={...account,providerId:'gemini-cli'};
 await expect(runtime.models({accountId:account.id})).rejects.toMatchObject({code:'ACCOUNT_PROVIDER_MISMATCH'});expect(official.runtime.models).not.toHaveBeenCalled();await runtime.dispose();
});

it('denies a descendant Pi junction before actual session validation can resolve another account history',async()=>{
 const root=profileFixture(),account:ConnectionAccount={id:crypto.randomUUID(),providerId:'openai',label:'A',enabled:true,createdAt:'now',updatedAt:'now'},other={...account,id:crypto.randomUUID(),label:'B'},aRoot=accountProfileRoot(root,account),bRoot=accountProfileRoot(root,other);
 const bSessions=taskPaths(bRoot,'task').sessionsDir;mkdirSync(bSessions,{recursive:true});writeFileSync(join(bSessions,'saved.jsonl'),JSON.stringify({type:'session',id:'saved',version:3})+'\n');mkdirSync(aRoot,{recursive:true});symlinkSync(join(bRoot,'pi'),join(aRoot,'pi'),'junction');
 const pi=adapter(),official=adapter(),runtime=createRuntime({dataDir:root,accounts:{get:id=>id===account.id?account:null}},{pi:options=>{pi.runtime.history=vi.fn(async path=>[await validateSessionPath(options.dataDir,path)]);return pi.runtime;},official:()=>official.runtime});
 const aSession=join(taskPaths(aRoot,'task').sessionsDir,'saved.jsonl');
 // The underlying lexical-root validator alone follows this junction into B.
 expect(await validateSessionPath(aRoot,aSession)).toBe(join(bSessions,'saved.jsonl'));
 await expect(runtime.history(aSession,account.id)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});expect(pi.runtime.history).not.toHaveBeenCalled();await runtime.dispose();
});
