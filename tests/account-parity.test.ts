import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {rm,realpath,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import {accountResolver} from '../packages/core/accounts.ts';
import {accountProfileRoot} from '../packages/runtime/account-profile.ts';
import * as runtimeModule from '../packages/runtime/index.ts';
import {isOfficialRuntimeProviderId,type ConnectionProviderId} from '../packages/contracts/connections.ts';
import type {ConnectionAccount} from '../packages/contracts/accounts.ts';
import type {RunContext,RuntimeAdapter,RuntimeCallbacks,StartRun,Thread} from '../packages/contracts/index.ts';

// These are synthetic adapter receipts, not provider authentication or native-session proof.
const providers:ConnectionProviderId[]=['openai','openai-codex','github-copilot','xai','claude-code','gemini-cli','cursor-sdk','kimi-coding','opencode-go'];
const models=providers.map(provider=>({id:`${provider}/acceptance-model`,provider,name:`Synthetic ${provider}`}));
const routeRuntime=runtimeModule.createRuntime;
const cleanups:(()=>Promise<void>)[]=[];
// Each named profile acquires real Windows directory guards before fake startup.
const waitFor=(assertion:()=>void)=>vi.waitFor(assertion,{timeout:5000,interval:25});
afterEach(async()=>{try{for(const close of cleanups.splice(0).reverse())await close();}finally{vi.restoreAllMocks();}});

function nativeAdapter(official:boolean,history:string[]){
 let callbacks!:RuntimeCallbacks;
 const adapter:RuntimeAdapter={
  configure:value=>{callbacks=value;},
  models:vi.fn(async()=>models.filter(model=>isOfficialRuntimeProviderId(model.provider)===official)),
  start:vi.fn(async()=>{}),followUp:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),
  compact:vi.fn(async ctx=>{callbacks.onEvent({...ctx,type:'compaction.start'});callbacks.onEvent({...ctx,type:'compaction.end'});callbacks.onEvent({...ctx,type:'settled'});}),
  history:vi.fn(async()=>[...history]),dispose:vi.fn(async()=>{}),
 };
 const event=(ctx:RunContext,type:string,fields:Record<string,unknown>={})=>callbacks.onEvent({...ctx,type,...fields});
 return {adapter,event,tool:(ctx:RunContext,name:string,args:Record<string,unknown>)=>callbacks.onTool({name,args},ctx),
  finish(input:StartRun,sessionPath:string){event(input,'session',{sessionPath});event(input,'input.processing',{inputIds:input.inputIds});event(input,'assistant.message',{messageId:crypto.randomUUID(),content:'Synthetic accepted response.',inputIds:input.inputIds});event(input,'settled');},
 };
}

async function fixture(){
 const temporaryRoot=await realpath(tmpdir());
 const directory=mkdtempSync(join(temporaryRoot,'harness-account-parity-')),history:string[]=[];
 const adapters:{root:string;official:boolean;native:ReturnType<typeof nativeAdapter>}[]=[];
 let store=new Store(directory),service!:Service;
 const makeRuntime=(options:Parameters<typeof routeRuntime>[0]={dataDir:directory,accounts:accountResolver(store)})=>routeRuntime(options,{
  pi:({dataDir})=>{const native=nativeAdapter(false,history);adapters.push({root:dataDir,official:false,native});return native.adapter;},
  official:({dataDir})=>{const native=nativeAdapter(true,history);adapters.push({root:dataDir,official:true,native});return native.adapter;},
 });
 let sideFactory=()=>Promise.resolve(makeRuntime());
 const open=async()=>{service=new Service(store,makeRuntime(),{sideRuntimeFactory:()=>sideFactory()});await service.recover();};
 await open();
 cleanups.push(async()=>{try{await service.dispose();}finally{store.close();if(await realpath(directory)!==resolve(directory)||!resolve(directory).startsWith(temporaryRoot+sep)||(await lstat(directory)).isSymbolicLink())throw Error('Unsafe account fixture cleanup');await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:100});}});
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:crypto.randomUUID(),type,payload,threadId});
 return {
  directory,history,adapters,makeRuntime,send,
  get store(){return store;},get service(){return service;},
  account:async(providerId:ConnectionProviderId,label:string)=>(await send('account.create',{providerId,label})).result as ConnectionAccount,
  select:(providerId:ConnectionProviderId,accountId:string|null)=>send('account.select',{providerId,accountId}),
  thread:async(payload:Record<string,unknown>={})=>(await send('thread.create',payload)).result as Thread,
  native:(account:ConnectionAccount)=>adapters.filter(item=>item.root===accountProfileRoot(directory,account)&&item.official===isOfficialRuntimeProviderId(account.providerId)).at(-1)?.native,
  setSideFactory:(factory:()=>Promise<RuntimeAdapter>)=>{sideFactory=factory;},
  reopen:async()=>{await service.dispose();store.close();store=new Store(directory);await open();},
 };
}

it.each(providers)('keeps %s task routing through compaction and history-aware recovery after its default changes',async providerId=>{
 const x=await fixture(),a=await x.account(providerId,'Task account'),b=await x.account(providerId,'Next task account'),thread=await x.thread(),modelId=`${providerId}/acceptance-model`;
 await x.select(providerId,a.id);
 await x.send('message.send',{content:'Investigate the failing acceptance check.',modelId},thread.id);
 await waitFor(()=>expect(x.native(a)?.adapter.start).toHaveBeenCalledOnce());
 const native=x.native(a)!,first=vi.mocked(native.adapter.start).mock.calls[0][0];
 const sessionPath=isOfficialRuntimeProviderId(providerId)?join(accountProfileRoot(x.directory,a),'official',providerId,'tasks',thread.id,'session.json'):join(accountProfileRoot(x.directory,a),'pi','tasks',thread.id,'sessions','saved.jsonl');
 expect(first).toMatchObject({threadId:thread.id,modelId,accountId:a.id});
 await x.select(providerId,b.id);
 native.finish(first,sessionPath);
 await waitFor(()=>expect(x.service.thread(thread.id)).toMatchObject({status:'ready',runId:null,accountId:a.id}));

 await x.send('run.compact',{},thread.id);
 await waitFor(()=>expect(native.adapter.compact).toHaveBeenCalledWith(expect.objectContaining({threadId:thread.id}),sessionPath,modelId));
 await waitFor(()=>expect(x.service.thread(thread.id)).toMatchObject({status:'ready',runId:null,accountId:a.id}));
 await x.send('message.send',{content:'Continue the unfinished verification without repeating effects.',modelId},thread.id);
 await waitFor(()=>expect(native.adapter.start).toHaveBeenCalledTimes(2));
 const interrupted=vi.mocked(native.adapter.start).mock.calls[1][0];
 native.event(interrupted,'input.processing',{inputIds:interrupted.inputIds});
 x.history.push(interrupted.inputId);

 await x.reopen();
 expect(x.service.thread(thread.id)).toMatchObject({status:'interrupted',runId:null,accountId:a.id,sessionPath});
 expect(x.store.snapshot().settings.selectedAccounts?.[providerId]).toBe(b.id);
 expect(x.adapters.every(item=>vi.mocked(item.native.adapter.start).mock.calls.length===0||item.root===accountProfileRoot(x.directory,a))).toBe(true);
 await x.send('run.resume',{},thread.id);
 await waitFor(()=>expect(x.native(a)?.adapter.start).toHaveBeenCalledOnce());
 const restored=x.native(a)!,resumed=vi.mocked(restored.adapter.start).mock.calls[0][0];
 expect(restored.adapter.history).toHaveBeenCalledWith(sessionPath);
 expect(resumed).toMatchObject({accountId:a.id,modelId,sessionPath});
 expect(resumed.prompt).toContain(`Continue the unfinished handling of previously delivered input ${interrupted.inputId}`);
 expect(resumed.prompt).not.toContain('Continue the unfinished verification without repeating effects.');
 expect(x.native(b)).toBeUndefined();
});

it('inherits the parent account for a new side conversation while defaults change before and during startup',async()=>{
 const x=await fixture(),a=await x.account('openai','Parent account'),b=await x.account('openai','Future tasks'),parent=await x.thread();
 await x.select('openai',a.id);await x.send('message.send',{content:'Inspect the main task.',modelId:'openai/acceptance-model'},parent.id);
 await waitFor(()=>expect(x.native(a)?.adapter.start).toHaveBeenCalledOnce());
 const main=x.native(a)!,mainRun=vi.mocked(main.adapter.start).mock.calls[0][0];
 await x.select('openai',b.id);
 const side=await x.thread({sideParentId:parent.id});
 expect(side).toMatchObject({sideParentId:parent.id,accountId:a.id,modelId:mainRun.modelId});
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
 x.setSideFactory(async()=>{await gate;return x.makeRuntime();});
 await x.send('message.send',{content:'Explain this finding separately.',modelId:mainRun.modelId},side.id);
 await x.select('openai',null);release();
 await waitFor(()=>expect(x.native(a)).not.toBe(main));
 const child=x.native(a)!;
 await waitFor(()=>expect(child.adapter.start).toHaveBeenCalledOnce());
 const input=vi.mocked(child.adapter.start).mock.calls[0][0];
 expect(input).toMatchObject({threadId:side.id,accountId:a.id,modelId:mainRun.modelId,resources:[]});
 expect(x.service.thread(parent.id).runId).toBe(mainRun.runId);
 expect(main.adapter.cancel).not.toHaveBeenCalled();
 expect(x.native(b)).toBeUndefined();
});

it('delegates through Service using the parent account after future defaults change before asynchronous child creation',async()=>{
 const x=await fixture(),a=await x.account('gemini-cli','Parent account'),b=await x.account('gemini-cli','Future tasks'),parent=await x.thread();
 await x.select('gemini-cli',a.id);await x.send('message.send',{content:'Plan the next verification.',modelId:'gemini-cli/acceptance-model'},parent.id);
 await waitFor(()=>expect(x.native(a)?.adapter.start).toHaveBeenCalledOnce());
 const main=x.native(a)!,mainRun=vi.mocked(main.adapter.start).mock.calls[0][0];
 await x.select('gemini-cli',b.id);
 const factory=vi.spyOn(runtimeModule,'createRuntime').mockImplementation(options=>{
  expect(x.store.snapshot().settings.selectedAccounts?.['gemini-cli']).toBeNull();
  return x.makeRuntime(options);
 });
 const pending=x.service.tool({name:'task_delegate',args:{commandId:'account-parity-delegate',tasks:[{id:'reader',name:'Acceptance reader',task:'Inspect the verification evidence.',prompt:'Report the account-scoped routing receipt.',requirements:[{id:'route',label:'Verify the assigned account route'}]}]}},mainRun);
 await x.select('gemini-cli',null);
 await waitFor(()=>expect(factory).toHaveBeenCalledOnce());
 await waitFor(()=>expect(x.native(a)).not.toBe(main));
 const child=x.native(a)!;
 await waitFor(()=>expect(child.adapter.start).toHaveBeenCalledOnce());
 const input=vi.mocked(child.adapter.start).mock.calls[0][0];
 expect(input).toMatchObject({accountId:a.id,modelId:mainRun.modelId,sessionPath:null});
 const delegated=x.service.thread(input.threadId);
 expect(delegated).toMatchObject({kind:'delegate',parentThreadId:parent.id,accountId:a.id,modelId:mainRun.modelId});
 expect(delegated.id).not.toBe(parent.id);
 await child.tool(input,'agent_progress',{completedRequirementIds:['route']});
 await child.tool(input,'task_finish',{outcome:'Verified the synthetic account-scoped routing receipt.'});
 child.event(input,'settled');
 await expect(pending).resolves.toMatchObject({jobs:[{id:delegated.jobId,childThreadId:delegated.id,status:'completed',completedRequirementIds:['route']}]});
 expect(x.service.thread(delegated.id)).toMatchObject({status:'completed',runId:null,accountId:a.id,parentThreadId:parent.id});
 expect(x.service.thread(parent.id)).toMatchObject({runId:mainRun.runId,accountId:a.id});
 expect(main.adapter.cancel).not.toHaveBeenCalled();
 expect(x.native(b)).toBeUndefined();
});
