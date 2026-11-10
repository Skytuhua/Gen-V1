import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,mkdir,symlink,writeFile,readFile,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {HermesClient} from '../packages/runtime-hermes/client.ts';
import * as processTree from '../packages/runtime-pi/process-tree.ts';
import * as homeGuard from '../packages/runtime-hermes/home.ts';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(options:Partial<ConstructorParameters<typeof HermesClient>[0]>={}){
 const home=await mkdtemp(join(tmpdir(),'hermes-wire-'));
 const client=new HermesClient({home,python:{executable:process.execPath,args:[resolve('tests/fixtures/hermes-protocol-worker.mjs')]},...options});
 cleanups.push(async()=>{await client.dispose();await rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return{client,home};
}
it('preserves Unicode through chunked replies and resolves concurrent request IDs independently',async()=>{
 const {client}=await fixture();expect(await Promise.all([client.request('echo',{text:'Café 😀'}),client.request('echo',{text:'第二个请求'})])).toEqual([{text:'Café 😀'},{text:'第二个请求'}]);
});
it('uses an isolated home and does not pass provider credentials to Python',async()=>{
 vi.stubEnv('OPENAI_API_KEY','synthetic-do-not-pass');try{const {client,home}=await fixture();expect(await client.request('environment',{})).toEqual({home,keyPresent:false,noSite:'1',noLazyInstall:'1'});}finally{vi.unstubAllEnvs();}
});
it('awaits owned host callbacks and returns their results over the private channel',async()=>{
 const onHostCall=vi.fn(async(call:{name:string;args:unknown})=>({name:call.name,value:call.args})),{client}=await fixture({onHostCall});
 expect(await client.request('host',{name:'source'})).toEqual({name:'fixture.read',value:{name:'source'}});expect(onHostCall).toHaveBeenCalledOnce();
});
it('forwards source events without inventing entry or settlement events',async()=>{
 const onEvent=vi.fn(),{client}=await fixture({onEvent});await client.request('event',{text:'source'});expect(onEvent.mock.calls).toEqual([[{event:'fixture.event',ctx:{threadId:'thread',runId:'run',epoch:1},data:{text:'source'}}]]);
});
it('fails pending requests safely on malformed worker output',async()=>{
 const {client}=await fixture();await expect(client.request('invalid',{})).rejects.toMatchObject({code:'HERMES_PROTOCOL'});await expect(client.request('echo',{})).rejects.toMatchObject({code:'HERMES_CLOSED'});
});
it('closes its worker and revokes unanswered requests when disposed',async()=>{
 const {client}=await fixture(),pending=client.request('never',{}).catch(error=>error);await new Promise(done=>setTimeout(done,40));await client.dispose();expect(await pending).toMatchObject({code:'HERMES_CLOSED'});await expect(client.request('echo',{})).rejects.toMatchObject({code:'HERMES_CLOSED'});
});
it.each(['home','nested','hardlink'])('rejects redirected or multiply linked source storage: %s',async(kind)=>{
 const root=await mkdtemp(join(tmpdir(),'hermes-home-guard-')),home=join(root,'home'),outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'retain.txt'),'original bytes');
 if(kind==='home')await symlink(outside,home,process.platform==='win32'?'junction':'dir');
 else{await mkdir(home);if(kind==='nested')await symlink(outside,join(home,'skills'),process.platform==='win32'?'junction':'dir');else await link(join(outside,'retain.txt'),join(home,'linked.txt'));}
 const client=new HermesClient({home,python:{executable:process.execPath,args:[resolve('tests/fixtures/hermes-protocol-worker.mjs')]}});
 try{await expect(client.request('echo',{})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});expect(await readFile(join(outside,'retain.txt'),'utf8')).toBe('original bytes');}finally{await client.dispose().catch(()=>{});await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
it('refuses a hello for a different source home',async()=>{
 const {client,home}=await fixture();await expect(client.request('hello',{home:join(home,'other')})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
});
it('revokes source requests immediately if its lifetime namespace guard is lost',async()=>{
 let lost!:()=>void;const spy=vi.spyOn(homeGuard,'withHermesHome').mockImplementationOnce(async(_home,action,onLoss)=>{lost=onLoss!;return action();});
 try{const {client}=await fixture();await client.request('echo',{});const pending=client.request('never',{}).catch(error=>error);await client.request('echo',{});lost();expect(await pending).toMatchObject({code:'HERMES_STORAGE_CHANGED'});await client.dispose();}finally{spy.mockRestore();}
});
it('drains owned host callbacks even when process cancellation fails',async()=>{
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),onHostCall=vi.fn(async()=>{await gate;return {};});
 const {client}=await fixture({onHostCall}),pending=client.request('host',{}).catch(error=>error);
 let stopping:Promise<unknown>|undefined,spy:{mockRestore():void}|undefined;
 try{
  await vi.waitFor(()=>expect(onHostCall).toHaveBeenCalledOnce(),{timeout:5000});
  let terminated=false;const terminate=processTree.terminateProcessTree;spy=vi.spyOn(processTree,'terminateProcessTree').mockImplementationOnce(async child=>{await terminate(child);terminated=true;throw new Error('Synthetic cancellation failure');});
  let closed=false;stopping=client.dispose().then(()=>{closed=true;return null;},error=>{closed=true;return error;});
  await vi.waitFor(()=>expect(terminated).toBe(true),{timeout:5000});expect(closed).toBe(false);
 }finally{release();await stopping;spy?.mockRestore();await client.dispose();await pending;}
 expect(await stopping).toBeInstanceOf(Error);
});
it('treats a denied host callback as an ordinary tool result during teardown',async()=>{
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),onHostCall=vi.fn(async()=>{await gate;throw new Error('Synthetic revoked tool');});
 const {client}=await fixture({onHostCall}),pending=client.request('host',{}).catch(error=>error);
 try{await vi.waitFor(()=>expect(onHostCall).toHaveBeenCalledOnce(),{timeout:5000});const stopping=client.dispose();release();await pending;await expect(stopping).resolves.toBeUndefined();}
 finally{release();await client.dispose();await pending;}
});
