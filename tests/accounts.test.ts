import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import type {ConnectionAccount} from '../packages/contracts/accounts.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun,Thread} from '../packages/contracts/index.ts';
import {accountResolver,beginAccountLogin,endAccountLogin,resolveLoginAccount} from '../packages/core/accounts.ts';
import {createRuntime} from '../packages/runtime/index.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
function fixture(routed=false){
 const dir=mkdtempSync(join(tmpdir(),'harness-accounts-')),store=new Store(dir);
 let callbacks!:RuntimeCallbacks;
 const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:vi.fn(async()=>[{id:'openai/model',provider:'openai',name:'Model'}]),start:vi.fn(async()=>{}),followUp:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),compact:vi.fn(async()=>{}),history:vi.fn(async()=>[]),dispose:vi.fn(async()=>{})};
 const router=routed?createRuntime({dataDir:dir,accounts:accountResolver(store)},{pi:()=>runtime,official:()=>({...runtime,configure:()=>{}})}):runtime;
 const service=new Service(store,router),send=(type:string,payload:Record<string,unknown>,threadId?:string,id=crypto.randomUUID())=>service.command({id,type,payload,threadId});
 cleanup.push(async()=>{await service.dispose();store.close();rmSync(dir,{recursive:true,force:true});});
 const account=async(label='Personal',providerId='openai')=>(await send('account.create',{providerId,label})).result as ConnectionAccount;
 const thread=async()=>(await send('thread.create',{})).result as Thread;
 return {store,service,runtime,send,account,thread,event:(type:string)=>callbacks.onEvent({...vi.mocked(runtime.start).mock.calls.at(-1)![0],type})};
}

it('persists bounded local account metadata and receipt identity without credential fields',async()=>{
 const f=fixture(),id=crypto.randomUUID(),command={providerId:'openai',label:'Personal'};
 const first=await f.send('account.create',command,undefined,id);
 expect(await f.send('account.create',command,undefined,id)).toEqual(first);
 await expect(f.send('account.create',{...command,label:'Changed'},undefined,id)).rejects.toMatchObject({code:'DUPLICATE_COMMAND'});
 expect(f.store.snapshot().accounts).toEqual([expect.objectContaining({label:'Personal',providerId:'openai',enabled:true})]);
 for(const payload of [{providerId:'bogus',label:'A'},{providerId:'openai',label:' '},{providerId:'openai',label:'A',token:'secret'}])await expect(f.send('account.create',payload)).rejects.toMatchObject({code:'INVALID_INPUT'});
});

it('soft-removes an account, clears its future default and preserves bound thread routing',async()=>{
 const f=fixture(),account=await f.account(),thread=await f.thread();
 await f.send('account.select',{providerId:'openai',accountId:account.id});
 await f.send('message.send',{content:'First',modelId:'openai/model'},thread.id);
 expect(f.store.get<Thread>('thread',thread.id)?.accountId).toBe(account.id);
 expect(vi.mocked(f.runtime.start).mock.calls[0][0].accountId).toBe(account.id);
 await f.send('run.stop',{},thread.id);
 await f.send('account.remove',{accountId:account.id});
 expect(f.store.snapshot().settings.selectedAccounts?.openai).toBeNull();
 expect(f.store.get<ConnectionAccount>('account',account.id)?.enabled).toBe(false);
 await f.send('run.resume',{},thread.id);
 expect(vi.mocked(f.runtime.start).mock.calls.at(-1)?.[0].accountId).toBe(account.id);
 await expect(f.send('account.select',{providerId:'gemini-cli',accountId:account.id})).rejects.toMatchObject({code:'ACCOUNT_PROVIDER_MISMATCH'});
 await f.send('account.restore',{accountId:account.id});
 await f.send('account.rename',{accountId:account.id,label:'Work'});
 expect(f.store.get<ConnectionAccount>('account',account.id)).toMatchObject({enabled:true,label:'Work'});
});

it('pins account discovery before awaits and rejects a default changed before first admission',async()=>{
 const f=fixture(),a=await f.account('A'),b=await f.account('B'),thread=await f.thread();
 await f.send('account.select',{providerId:'openai',accountId:a.id});
 let release!:(models:{id:string;provider:string;name:string}[])=>void;
 vi.mocked(f.runtime.models).mockImplementationOnce(()=>new Promise(done=>{release=done;}));
 const pending=f.send('message.send',{content:'First',modelId:'openai/model'},thread.id);
 expect(f.runtime.models).toHaveBeenLastCalledWith({accountId:a.id});
 await f.send('account.select',{providerId:'openai',accountId:b.id});release([{id:'openai/model',provider:'openai',name:'Model'}]);
 await expect(pending).rejects.toMatchObject({code:'ACCOUNT_SELECTION_CHANGED'});
 expect(f.store.all('message',thread.id)).toEqual([]);
 expect(f.store.get<Thread>('thread',thread.id)?.accountId).toBeUndefined();
});

it('keeps a thread account immutable when defaults change and fails closed on account/provider changes',async()=>{
 const f=fixture(),a=await f.account('A'),b=await f.account('B'),thread=await f.thread();
 await f.send('account.select',{providerId:'openai',accountId:a.id});await f.send('message.send',{content:'First',modelId:'openai/model'},thread.id);await f.send('run.stop',{},thread.id);
 await f.send('account.select',{providerId:'openai',accountId:b.id});await f.send('run.resume',{},thread.id);
 expect(vi.mocked(f.runtime.start).mock.calls.at(-1)?.[0]).toMatchObject({accountId:a.id});
 expect((await f.service.models({threadId:thread.id}))).toHaveLength(1);
 expect(f.runtime.models).toHaveBeenLastCalledWith({accountId:a.id,refresh:undefined});
 await f.send('run.stop',{},thread.id);
 await expect(f.send('run.resume',{modelId:'gemini-cli/pro'},thread.id)).rejects.toMatchObject({code:'ACCOUNT_PROVIDER_MISMATCH'});
});

it('binds prior-work records without an account field to the legacy profile',async()=>{
 const f=fixture(),account=await f.account(),thread=await f.thread();
 f.store.internal('fixture.prior-work',thread.id,()=>{f.store.put('thread',thread.id,thread.id,{...thread,modelId:'openai/model',status:'interrupted'});f.store.put('message','old',thread.id,{id:'old',threadId:thread.id,role:'user',content:'Old',createdAt:thread.createdAt,runId:null});});
 await f.send('account.select',{providerId:'openai',accountId:account.id});await f.send('run.resume',{},thread.id);
 expect((vi.mocked(f.runtime.start).mock.calls.at(-1)?.[0] as StartRun).accountId).toBeNull();
});

it('reserves login atomically, denies bound active runs and releases only the exact lease',async()=>{
 const f=fixture(),account=await f.account(),thread=await f.thread();await f.send('account.select',{providerId:'openai',accountId:account.id});
 expect(resolveLoginAccount(f.store,'openai')).toBeNull();expect(resolveLoginAccount(f.store,'openai',account.id)?.id).toBe(account.id);
 const lease=beginAccountLogin(f.store,'openai',account.id);
 expect(accountResolver(f.store).isSigningIn?.('openai',account.id)).toBe(true);
 endAccountLogin(f.store,{...lease,nonce:'wrong'});expect(accountResolver(f.store).isSigningIn?.('openai',account.id)).toBe(true);
 await expect(f.send('message.send',{content:'First',modelId:'openai/model'},thread.id)).rejects.toMatchObject({code:'ACCOUNT_SIGNING_IN'});expect(f.store.all('message',thread.id)).toEqual([]);
 endAccountLogin(f.store,lease);await f.send('message.send',{content:'First',modelId:'openai/model'},thread.id);
 expect(()=>beginAccountLogin(f.store,'openai',account.id)).toThrow(expect.objectContaining({code:'ACCOUNT_BUSY'}));
});

it('rechecks the login reservation after asynchronous model discovery before committing a message',async()=>{
 const f=fixture(),account=await f.account(),thread=await f.thread();await f.send('account.select',{providerId:'openai',accountId:account.id});
 let release!:(models:{id:string;provider:string;name:string}[])=>void;vi.mocked(f.runtime.models).mockImplementationOnce(()=>new Promise(done=>{release=done;}));
 const pending=f.send('message.send',{content:'First',modelId:'openai/model'},thread.id),lease=beginAccountLogin(f.store,'openai',account.id);release([{id:'openai/model',provider:'openai',name:'Model'}]);
 await expect(pending).rejects.toMatchObject({code:'ACCOUNT_SIGNING_IN'});expect(f.store.all('message',thread.id)).toEqual([]);endAccountLogin(f.store,lease);
});

it('builds the new-task catalog from one legacy discovery and each saved provider selection',async()=>{
 const f=fixture(),account=await f.account();await f.send('account.select',{providerId:'openai',accountId:account.id});
 vi.mocked(f.runtime.models).mockImplementation(async options=>options?.accountId===account.id?[{id:'openai/named',provider:'openai',name:'Named'},{id:'xai/foreign',provider:'xai',name:'Foreign'}]:[{id:'openai/legacy',provider:'openai',name:'Legacy'},{id:'xai/grok',provider:'xai',name:'Grok'}]);
 expect(await f.service.models()).toEqual([{id:'xai/grok',provider:'xai',name:'Grok'},{id:'openai/named',provider:'openai',name:'Named'}]);expect(f.runtime.models).toHaveBeenCalledTimes(2);
});

it('retains abandoned login reservations until explicit cleanup and rejects stale owner release',async()=>{
 const f=fixture(),account=await f.account(),clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 try{
  const first=beginAccountLogin(f.store,'openai',account.id);expect(()=>beginAccountLogin(f.store,'openai',account.id)).toThrow(expect.objectContaining({code:'ACCOUNT_SIGNING_IN'}));
  f.store.internal('fixture.dead-login',null,()=>f.store.put('accountLogin',first.id,null,{...f.store.get<Record<string,unknown>>('accountLogin',first.id),ownerPid:2147483647}));
  clock.mockReturnValue(1000+15*60*1000+1);expect(accountResolver(f.store).isSigningIn?.('openai',account.id)).toBe(true);
  expect(()=>beginAccountLogin(f.store,'openai',account.id)).toThrow(expect.objectContaining({code:'ACCOUNT_SIGNING_IN'}));endAccountLogin(f.store,first);
  const next=beginAccountLogin(f.store,'openai',account.id);expect(next.nonce).not.toBe(first.nonce);endAccountLogin(f.store,first);expect(accountResolver(f.store).isSigningIn?.('openai',account.id)).toBe(true);endAccountLogin(f.store,next);
 }finally{clock.mockRestore();}
});

it('keeps expired sign-in reservations while the owning process is alive',async()=>{
 const f=fixture(),clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 try{const lease=beginAccountLogin(f.store,'openai',null);clock.mockReturnValue(1000+16*60*1000);expect(()=>beginAccountLogin(f.store,'openai',null)).toThrow(expect.objectContaining({code:'ACCOUNT_SIGNING_IN'}));endAccountLogin(f.store,lease);}finally{clock.mockRestore();}
});

it('retains account use after Stop clears the thread until native cancellation completes',async()=>{
 const f=fixture(true),thread=await f.thread();await f.send('message.send',{content:'Run',modelId:'openai/model'},thread.id);
 let release!:()=>void;vi.mocked(f.runtime.cancel).mockImplementationOnce(()=>new Promise(done=>{release=done;}));
 await f.send('run.stop',{},thread.id);expect(f.store.get<Thread>('thread',thread.id)?.runId).toBeNull();
 try{expect(()=>beginAccountLogin(f.store,'openai',null)).toThrow(expect.objectContaining({code:'ACCOUNT_BUSY'}));}finally{release();}
 await vi.waitFor(()=>expect(f.store.all('accountUse')).toHaveLength(0));const lease=beginAccountLogin(f.store,'openai',null);endAccountLogin(f.store,lease);
});

it('keeps failed cancellation fail-closed until disposal proves native teardown',async()=>{
 const f=fixture(true),thread=await f.thread();await f.send('message.send',{content:'Run',modelId:'openai/model'},thread.id);
 vi.mocked(f.runtime.cancel).mockRejectedValueOnce(Error('Native termination failed'));await f.send('run.stop',{},thread.id);await vi.waitFor(()=>expect(f.runtime.cancel).toHaveBeenCalled());
 expect(()=>beginAccountLogin(f.store,'openai',null)).toThrow(expect.objectContaining({code:'ACCOUNT_BUSY'}));
 await f.service.dispose();const lease=beginAccountLogin(f.store,'openai',null);endAccountLogin(f.store,lease);
});

it('does not forward natural settlement until the native adapter has stopped using credentials',async()=>{
 const f=fixture(true),thread=await f.thread();await f.send('message.send',{content:'Run',modelId:'openai/model'},thread.id);
 let release!:()=>void;vi.mocked(f.runtime.cancel).mockImplementationOnce(()=>new Promise(done=>{release=done;}));f.event('settled');
 try{expect(f.store.get<Thread>('thread',thread.id)?.runId).not.toBeNull();expect(()=>beginAccountLogin(f.store,'openai',null)).toThrow(expect.objectContaining({code:'ACCOUNT_BUSY'}));}finally{release?.();}
 await vi.waitFor(()=>expect(f.store.get<Thread>('thread',thread.id)?.runId).toBeNull());const lease=beginAccountLogin(f.store,'openai',null);endAccountLogin(f.store,lease);
});

it('retains account use when a native error revokes thread authority before cancellation finishes',async()=>{
 const f=fixture(true),thread=await f.thread();await f.send('message.send',{content:'Run',modelId:'openai/model'},thread.id);
 let release!:()=>void;vi.mocked(f.runtime.cancel).mockImplementationOnce(()=>new Promise(done=>{release=done;}));f.event('error');
 try{expect(f.store.get<Thread>('thread',thread.id)?.runId).toBeNull();expect(()=>beginAccountLogin(f.store,'openai',null)).toThrow(expect.objectContaining({code:'ACCOUNT_BUSY'}));}finally{release();}
 await vi.waitFor(()=>expect(f.store.all('accountUse')).toHaveLength(0));
});

it('holds account use throughout model probes and keeps failed probe teardown fail-closed',async()=>{
 const f=fixture(true);let release!:(models:{id:string;provider:string;name:string}[])=>void;vi.mocked(f.runtime.models).mockImplementationOnce(()=>new Promise(done=>{release=done;}));
 const models=f.service.models();
 try{expect(()=>beginAccountLogin(f.store,'openai',null)).toThrow(expect.objectContaining({code:'ACCOUNT_BUSY'}));}finally{release([{id:'openai/model',provider:'openai',name:'Model'}]);await models;}
 expect(f.store.all('accountUse')).toHaveLength(0);
 vi.mocked(f.runtime.models).mockRejectedValueOnce(Error('Probe failed'));vi.mocked(f.runtime.dispose).mockRejectedValueOnce(Error('Probe cleanup failed'));await f.service.models();
 expect(()=>beginAccountLogin(f.store,'openai',null)).toThrow(expect.objectContaining({code:'ACCOUNT_BUSY'}));await f.service.dispose();expect(f.store.all('accountUse')).toHaveLength(0);
});

it('bounds persisted account records and preserves disabled metadata across store reopen',async()=>{
 const f=fixture(),first=await f.account('First');await f.send('account.remove',{accountId:first.id});
 for(let index=1;index<20;index++)await f.account('Account '+index);
 await expect(f.account('Overflow')).rejects.toMatchObject({code:'ACCOUNT_LIMIT'});
 const reopened=new Store(f.store.dataDir);try{expect(reopened.snapshot().accounts?.find(account=>account.id===first.id)).toMatchObject({label:'First',enabled:false});}finally{reopened.close();}
});
