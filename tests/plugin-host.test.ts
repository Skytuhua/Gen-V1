import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {describe,expect,it} from 'vitest';
import {installPluginPackage,loadInstalledPlugins,removePlugin,type PluginRegistry} from '../packages/plugins/host.ts';
import {pluginManifestSchema,pluginSurfaceSchema} from '../packages/plugins/contracts.ts';

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const manifest={id:'example-company',name:'Example company',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.3 <0.7.0',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs'};
async function fixture(options:{manifest?:Record<string,unknown>;host?:string}={}){
 const directory=await mkdtemp(join(tmpdir(),'gen-plugin-')),source=join(directory,'source'),root=join(directory,'plugins');await mkdir(source);await mkdir(join(source,'frontend'));await mkdir(join(source,'host'));
 const files:Record<string,string>={'plugin.json':JSON.stringify({...manifest,...options.manifest}),'frontend/index.html':'<p>Company records</p>','host/main.mjs':options.host??`export default {async activate(context){return {operations:{echo:async(input,signal)=>({input,keys:Object.keys(context).sort(),aborted:signal.aborted}),write:async()=>{const {writeFile}=await import('node:fs/promises');await writeFile(context.dataDir+'/saved.txt','preserved');return null;}},validateSurface:async(surface)=>surface.scopeId==='approved'&&surface.resourceId==='task',isBusy:async()=>false,close:async()=>{}};}};`};
 for(const [path,bytes]of Object.entries(files))await writeFile(join(source,path),bytes);
 const inventory={version:1,files:Object.entries(files).map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}))};const raw=JSON.stringify(inventory);await writeFile(join(source,'plugin-files.json'),raw);
 return {directory,source,root,digest:hash(raw),inventory};
}

describe('trusted separately installed plug-ins',()=>{
 it('boots with no package and exposes no personal fallback',async()=>{const f=await fixture(),registry=await loadInstalledPlugins(f.root,'0.6.3');expect(registry.list()).toEqual([]);await expect(registry.dispatch('example-company','message.send',{},new AbortController().signal)).rejects.toThrow(/unavailable/i);await registry.close();});
 it('installs verified immutable versions and gives the host only its own data directory and Gen version',async()=>{const f=await fixture(),installed=await installPluginPackage(f.source,f.root,f.digest,'0.6.3');expect(installed.manifest).toEqual(manifest);const registry=await loadInstalledPlugins(f.root,'0.6.3');expect(registry.list()).toEqual([manifest]);expect(await registry.dispatch(manifest.id,'echo',{scope:'project'},new AbortController().signal)).toEqual({input:{scope:'project'},keys:['dataDir','genVersion'],aborted:false});expect(await registry.readAsset(manifest.id,'frontend/index.html')).toEqual({bytes:Buffer.from('<p>Company records</p>'),contentType:'text/html; charset=utf-8'});await expect(registry.readAsset(manifest.id,'host/main.mjs')).rejects.toThrow(/frontend/i);await expect(installPluginPackage(f.source,f.root,f.digest,'0.6.3')).rejects.toThrow(/exists/i);await registry.close();});
 it('fails closed on incompatible Gen or API declarations and malformed identities',async()=>{const f=await fixture();await expect(installPluginPackage(f.source,f.root,f.digest,'0.7.0')).rejects.toThrow(/compatible/i);for(const value of [{...manifest,id:'../escape'},{...manifest,hostEntry:'../outside.mjs'},{...manifest,frontendEntry:'https://example.com'},{...manifest,apiVersion:2},{...manifest,token:'secret'}])expect(pluginManifestSchema.safeParse(value).success).toBe(false);});
 it('requires the trusted inventory digest and exact declared bytes before copying or importing',async()=>{const f=await fixture();await expect(installPluginPackage(f.source,f.root,'0'.repeat(64),'0.6.3')).rejects.toThrow(/digest/i);await writeFile(join(f.source,'host/main.mjs'),'throw Error("must not import")');await expect(installPluginPackage(f.source,f.root,f.digest,'0.6.3')).rejects.toThrow(/integrity/i);});
 it('reclaims a crashed installer lock while a live owner still reports busy',async()=>{
  const f=await fixture();await mkdir(f.root,{recursive:true});
  await writeFile(join(f.root,'.registry-lock'),JSON.stringify({pid:99999999,at:Date.now()}));
  await installPluginPackage(f.source,f.root,f.digest,'0.6.3');
  const g=await fixture();await mkdir(g.root,{recursive:true});
  await writeFile(join(g.root,'.registry-lock'),JSON.stringify({pid:process.pid,at:Date.now()}));
  await expect(installPluginPackage(g.source,g.root,g.digest,'0.6.3')).rejects.toThrow(/busy/i);
 });
 it('rejects undeclared files and inventory traversal',async()=>{const f=await fixture();await writeFile(join(f.source,'unlisted.txt'),'extra');await expect(installPluginPackage(f.source,f.root,f.digest,'0.6.3')).rejects.toThrow(/undeclared/i);const g=await fixture();g.inventory.files[0].path='../outside';const raw=JSON.stringify(g.inventory);await writeFile(join(g.source,'plugin-files.json'),raw);await expect(installPluginPackage(g.source,g.root,hash(raw),'0.6.3')).rejects.toThrow();});
 it('rejects linked package files without following them',async()=>{const f=await fixture();await symlink(f.source,join(f.source,'linked'),'junction');await expect(installPluginPackage(f.source,f.root,f.digest,'0.6.3')).rejects.toThrow(/link/i);});
 it('rechecks installed integrity before loading or serving and never serves host source',async()=>{const f=await fixture(),installed=await installPluginPackage(f.source,f.root,f.digest,'0.6.3');const registry=await loadInstalledPlugins(f.root,'0.6.3');await writeFile(join(installed.directory,'frontend/index.html'),'changed');await expect(registry.readAsset(manifest.id,'frontend/index.html')).rejects.toThrow(/integrity/i);const fresh=await loadInstalledPlugins(f.root,'0.6.3');expect(fresh.list()).toEqual([]);expect(fresh.failures().map(failure=>failure.id)).toEqual([manifest.id]);await fresh.close();await registry.close();});
 it('rejects absent operations, oversized JSON and preaborted requests without dispatch',async()=>{const f=await fixture();await installPluginPackage(f.source,f.root,f.digest,'0.6.3');const registry=await loadInstalledPlugins(f.root,'0.6.3');await expect(registry.dispatch(manifest.id,'message.send',{},new AbortController().signal)).rejects.toThrow(/operation/i);await expect(registry.dispatch(manifest.id,'echo',{text:'x'.repeat(300_000)},new AbortController().signal)).rejects.toThrow(/large/i);const abort=new AbortController();abort.abort();await expect(registry.dispatch(manifest.id,'echo',{},abort.signal)).rejects.toThrow(/abort/i);await registry.close();});
 it('validates native surfaces only through the installed host and refuses URL or personal identity fields',async()=>{const f=await fixture();await installPluginPackage(f.source,f.root,f.digest,'0.6.3');const registry=await loadInstalledPlugins(f.root,'0.6.3'),surface={kind:'plugin' as const,pluginId:manifest.id,scopeId:'approved',surfaceId:'plan',resourceId:'task'};expect(await registry.validateSurface(surface)).toBe(true);expect(await registry.validateSurface({...surface,scopeId:'other'})).toBe(false);expect(pluginSurfaceSchema.safeParse({...surface,url:'https://example.com'}).success).toBe(false);expect(pluginSurfaceSchema.safeParse({...surface,threadId:'personal'}).success).toBe(false);await registry.close();expect(await registry.validateSurface(surface)).toBe(false);});
 it('checks installed plug-in compatibility before public updates',async()=>{const f=await fixture();await installPluginPackage(f.source,f.root,f.digest,'0.6.3');const registry=await loadInstalledPlugins(f.root,'0.6.3');expect(await registry.compatibleWith('0.6.4')).toEqual({compatible:true,blockers:[]});expect(await registry.compatibleWith('0.7.0')).toMatchObject({compatible:false,blockers:[{pluginId:manifest.id}]});expect((await registry.compatibleWith('not-a-version')).compatible).toBe(false);await registry.close();});
 it('deactivates without deleting package or private state and revokes an already loaded registry',async()=>{const f=await fixture(),installed=await installPluginPackage(f.source,f.root,f.digest,'0.6.3'),registry=await loadInstalledPlugins(f.root,'0.6.3');await registry.dispatch(manifest.id,'write',null,new AbortController().signal);await removePlugin(f.root,manifest.id);expect(await readFile(join(f.root,'data',manifest.id,'saved.txt'),'utf8')).toBe('preserved');expect(await readFile(join(installed.directory,'plugin.json'),'utf8')).toBe(JSON.stringify(manifest));await expect(registry.dispatch(manifest.id,'echo',{},new AbortController().signal)).rejects.toThrow(/unavailable/i);await registry.close();expect((await loadInstalledPlugins(f.root,'0.6.3')).list()).toEqual([]);});
 it('does not expose failures from private host operations or credentials in errors',async()=>{const f=await fixture({host:`export default {async activate(){return {operations:{fail:async()=>{throw Error('private-token-value')}},close:async()=>{}}}};`});await installPluginPackage(f.source,f.root,f.digest,'0.6.3');const registry=await loadInstalledPlugins(f.root,'0.6.3');await expect(registry.dispatch(manifest.id,'fail',{},new AbortController().signal)).rejects.toThrow('The plug-in operation could not complete.');await registry.close();});
 it('rechecks revocation after a host authorizes a native surface',async()=>{const f=await fixture({host:`export default {async activate(context){return {operations:{},validateSurface:async()=>{const {writeFile}=await import('node:fs/promises');const {resolve}=await import('node:path');await writeFile(resolve(context.dataDir,'../../active.json'),JSON.stringify({version:1,plugins:[]}));return true;},close:async()=>{}}}};`});await installPluginPackage(f.source,f.root,f.digest,'0.6.3');const registry=await loadInstalledPlugins(f.root,'0.6.3');expect(await registry.validateSurface({kind:'plugin',pluginId:manifest.id,scopeId:'approved',surfaceId:'plan'})).toBe(false);await registry.close();});
 it('closes an activated host whose returned API does not pass validation',async()=>{const f=await fixture({host:`export default {async activate(context){return {operations:null,close:async()=>{const {writeFile}=await import('node:fs/promises');await writeFile(context.dataDir+'/closed.txt','closed');}}}};`});await installPluginPackage(f.source,f.root,f.digest,'0.6.3');const registry=await loadInstalledPlugins(f.root,'0.6.3');expect(registry.list()).toEqual([]);expect(registry.failures().map(failure=>failure.id)).toEqual([manifest.id]);expect(await readFile(join(f.root,'data',manifest.id,'closed.txt'),'utf8')).toBe('closed');await registry.close();});
 it('isolates a plug-in that cannot activate so healthy plug-ins still load',async()=>{
  const bad=await fixture({manifest:{id:'bad-plugin'},host:`export default {async activate(){throw Error('synthetic activation failure');}};`}),good=await fixture({manifest:{id:'good-plugin'}});
  try{
   await installPluginPackage(bad.source,bad.root,bad.digest,'0.6.3');await installPluginPackage(good.source,bad.root,good.digest,'0.6.3');
   const registry=await loadInstalledPlugins(bad.root,'0.6.3');
   expect(registry.list().map(item=>item.id)).toEqual(['good-plugin']);
   expect(registry.failures().map(failure=>failure.id)).toEqual(['bad-plugin']);
   expect(await registry.dispatch('good-plugin','echo',{},new AbortController().signal)).toMatchObject({aborted:false});
   await expect(registry.dispatch('bad-plugin','echo',{},new AbortController().signal)).rejects.toThrow(/unavailable/i);
   await registry.close();
  }finally{await rm(bad.directory,{recursive:true,force:true});await rm(good.directory,{recursive:true,force:true});}
 });
 it('reports data-lease contention as already open in another window',async()=>{
  const f=await fixture({host:`export default {async activate(){const error=new Error('busy');error.code='PROFILE_IN_USE';throw error;}};`});
  try{
   await installPluginPackage(f.source,f.root,f.digest,'0.6.3');const registry=await loadInstalledPlugins(f.root,'0.6.3');
   expect(registry.list()).toEqual([]);expect(registry.failures()[0].message).toMatch(/already open in another Gen window/i);
   await registry.close();
  }finally{await rm(f.directory,{recursive:true,force:true});}
 });
});

it('checks a newly installed plugin against an already loaded registry without activating it twice',async()=>{const f=await fixture();const registry=await loadInstalledPlugins(f.root,'0.6.3');await installPluginPackage(f.source,f.root,f.digest,'0.6.3');expect(await registry.compatibleWith('0.7.0')).toMatchObject({compatible:false});await registry.close();});
it('counts a dispatch as busy while its package verification is still pending',async()=>{const f=await fixture();await installPluginPackage(f.source,f.root,f.digest,'0.6.3');const registry=await loadInstalledPlugins(f.root,'0.6.3');const result=registry.dispatch(manifest.id,'echo',{},new AbortController().signal);expect(await registry.isBusy()).toBe(true);await result;await registry.close();});

const shutdownError='A plug-in host could not confirm shutdown.';
const shutdownHost=(synchronousFailure=false)=>`
 function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
 export const control={gate:deferred(),entered:deferred(),request:deferred(),busy:deferred(),checking:deferred(),holdBusy:false,closes:0,aborted:false};
 control.gate.promise.catch(()=>{});
 export default {async activate(){return {
  operations:{wait:async(_input,signal)=>{control.request.resolve();return new Promise(resolve=>signal.addEventListener('abort',()=>{control.aborted=true;resolve(null);},{once:true}));}},
  validateSurface:async()=>true,isBusy:async()=>{if(control.holdBusy){control.checking.resolve();await control.busy.promise;}return false;},
  close(){control.closes++;control.entered.resolve();${synchronousFailure?"throw Error('SYNTHETIC_PRIVATE_CLOSE_DETAIL');":"return control.gate.promise;"}}
 };}};
`;
interface ShutdownControl {
 gate:{promise:Promise<void>;resolve():void;reject(error:Error):void};
 entered:{promise:Promise<void>};request:{promise:Promise<void>};
 busy:{promise:Promise<void>;resolve():void};checking:{promise:Promise<void>};holdBusy:boolean;closes:number;aborted:boolean;
}
async function installShutdownHost(f:Awaited<ReturnType<typeof fixture>>,root=f.root):Promise<ShutdownControl>{
 const installed=await installPluginPackage(f.source,root,f.digest,'0.6.3');
 const module=await import(/* @vite-ignore */pathToFileURL(join(installed.directory,'host/main.mjs')).href+'?integrity='+f.digest);
 return module.control;
}
function observeClose(registry:PluginRegistry){
 let settled=false;
 const result=registry.close().then(()=>{settled=true;return undefined;},error=>{settled=true;return error as Error;});
 return {result,settled:()=>settled};
}
async function expectAdmissionRevoked(registry:PluginRegistry,id=manifest.id){
 await expect(registry.dispatch(id,'wait',null,new AbortController().signal)).rejects.toThrow('The installed plug-in is unavailable.');
 await expect(registry.readAsset(id,'frontend/index.html')).rejects.toThrow('The installed plug-in is unavailable.');
 expect(await registry.validateSurface({kind:'plugin',pluginId:id,scopeId:'approved',surfaceId:'plan'})).toBe(false);
}

it('keeps pending and failed registry shutdown busy',async()=>{
 const f=await fixture({host:shutdownHost()});let registry:PluginRegistry|undefined,control:ShutdownControl|undefined;
 try{
  control=await installShutdownHost(f);registry=await loadInstalledPlugins(f.root,'0.6.3');expect(await registry.isBusy()).toBe(false);
  const request=registry.dispatch(manifest.id,'wait',null,new AbortController().signal).then(()=>undefined,error=>error as Error);
  await control.request.promise;
  const first=observeClose(registry),second=observeClose(registry);await control.entered.promise;
  expect(await registry.isBusy()).toBe(true);expect(first.settled()).toBe(false);expect(second.settled()).toBe(false);expect(control.closes).toBe(1);
  expect(control.aborted).toBe(true);expect((await request)?.message).toBe('The plug-in request was aborted.');
  await expectAdmissionRevoked(registry);
  control.gate.reject(Error('SYNTHETIC_PRIVATE_CLOSE_DETAIL'));
  for(const result of await Promise.all([first.result,second.result]))expect(result?.message).toBe(shutdownError);
  expect((await observeClose(registry).result)?.message).toBe(shutdownError);
  expect(await registry.isBusy()).toBe(true);expect(control.closes).toBe(1);await expectAdmissionRevoked(registry);
 }finally{control?.gate.resolve();await registry?.close().catch(()=>{});await rm(f.directory,{recursive:true,force:true});}
});

it('successful registry shutdown is idempotent and idle',async()=>{
 const f=await fixture({host:shutdownHost()});let registry:PluginRegistry|undefined,control:ShutdownControl|undefined;
 try{
  control=await installShutdownHost(f);registry=await loadInstalledPlugins(f.root,'0.6.3');expect(await registry.isBusy()).toBe(false);
  const first=observeClose(registry),second=observeClose(registry);await control.entered.promise;
  expect(await registry.isBusy()).toBe(true);expect(first.settled()).toBe(false);expect(second.settled()).toBe(false);expect(control.closes).toBe(1);
  await expectAdmissionRevoked(registry);control.gate.resolve();
  expect(await first.result).toBeUndefined();expect(await second.result).toBeUndefined();await registry.close();
  expect(await registry.isBusy()).toBe(false);expect(control.closes).toBe(1);await expectAdmissionRevoked(registry);
 }finally{control?.gate.resolve();await registry?.close().catch(()=>{});await rm(f.directory,{recursive:true,force:true});}
});

it.each(['empty','incompatible'] as const)('successfully closes an %s registry without activating a host',async kind=>{
 const f=await fixture({host:`throw Error('An incompatible host must not activate.');`});let registry:PluginRegistry|undefined;
 try{
  if(kind==='incompatible')await installPluginPackage(f.source,f.root,f.digest,'0.6.3');
  registry=await loadInstalledPlugins(f.root,'0.7.0');expect(registry.list()).toHaveLength(kind==='empty'?0:1);
  await Promise.all([registry.close(),registry.close()]);await registry.close();expect(await registry.isBusy()).toBe(false);await expectAdmissionRevoked(registry);
 }finally{await registry?.close().catch(()=>{});await rm(f.directory,{recursive:true,force:true});}
});

it.each([false,true])('waits for every host and preserves aggregate shutdown failure (synchronous=%s)',async synchronousFailure=>{
 const firstFixture=await fixture({manifest:{id:'shutdown-first'},host:shutdownHost(synchronousFailure)});
 let secondFixture:Awaited<ReturnType<typeof fixture>>|undefined,registry:PluginRegistry|undefined,firstHost:ShutdownControl|undefined,secondHost:ShutdownControl|undefined;
 try{
  secondFixture=await fixture({manifest:{id:'shutdown-second'},host:shutdownHost()});
  firstHost=await installShutdownHost(firstFixture);secondHost=await installShutdownHost(secondFixture,firstFixture.root);
  registry=await loadInstalledPlugins(firstFixture.root,'0.6.3');expect(await registry.isBusy()).toBe(false);
  const first=observeClose(registry),second=observeClose(registry);await firstHost.entered.promise;
  expect(await registry.isBusy()).toBe(true);
  await secondHost.entered.promise;expect(firstHost.closes).toBe(1);expect(secondHost.closes).toBe(1);
  firstHost.gate.reject(Error('SYNTHETIC_PRIVATE_CLOSE_DETAIL'));
  await new Promise<void>(resolve=>setImmediate(resolve));
  expect(first.settled()).toBe(false);expect(second.settled()).toBe(false);expect(await registry.isBusy()).toBe(true);
  secondHost.gate.resolve();
  for(const result of await Promise.all([first.result,second.result]))expect(result?.message).toBe(shutdownError);
  expect((await observeClose(registry).result)?.message).toBe(shutdownError);
  expect(await registry.isBusy()).toBe(true);expect(firstHost.closes).toBe(1);expect(secondHost.closes).toBe(1);
 }finally{
  firstHost?.gate.resolve();secondHost?.gate.resolve();await registry?.close().catch(()=>{});
  await rm(firstFixture.directory,{recursive:true,force:true});if(secondFixture)await rm(secondFixture.directory,{recursive:true,force:true});
 }
});

it('keeps an in-flight idle check busy when shutdown begins before the host answers',async()=>{
 const f=await fixture({host:shutdownHost()});let registry:PluginRegistry|undefined,control:ShutdownControl|undefined;
 try{
  control=await installShutdownHost(f);registry=await loadInstalledPlugins(f.root,'0.6.3');control.holdBusy=true;
  const busy=registry.isBusy();await control.checking.promise;
  const closing=observeClose(registry);await control.entered.promise;control.busy.resolve();
  expect(await busy).toBe(true);expect(closing.settled()).toBe(false);
  control.gate.resolve();expect(await closing.result).toBeUndefined();expect(await registry.isBusy()).toBe(false);
 }finally{control?.busy.resolve();control?.gate.resolve();await registry?.close().catch(()=>{});await rm(f.directory,{recursive:true,force:true});}
});
