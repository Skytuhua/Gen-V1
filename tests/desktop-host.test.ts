import {afterEach,expect,it,vi} from 'vitest';
import {fork,type ChildProcess} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,basename} from 'node:path';
import {createServer,type Server} from 'node:net';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {launchHost,readHostOptions,type HostFactories} from '../apps/server/host.ts';
import Fastify from 'fastify';
import {Store} from '../packages/storage/store.ts';
import {SkillCatalogRepository} from '../packages/skill-catalog/repository.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const options={dataDir:resolve('.harness-desktop-unit-unused'),port:4317,widgetPort:4318,dev:false};
function mocks(){
 const profile={dataDir:options.dataDir,close:vi.fn()},store={dataDir:options.dataDir,close:vi.fn()},runtime={dispose:vi.fn(async()=>{})},service={recover:vi.fn(async()=>{}),dispose:vi.fn(async()=>{})};
 const app={addHook:vi.fn(),listen:vi.fn(async()=>{}),close:vi.fn(async()=>{}),server:{address:()=>({port:4317})}},widgets={addHook:vi.fn(),listen:vi.fn(async()=>{}),close:vi.fn(async()=>{}),server:{address:()=>({port:4318})}};
 const factories={acquireProfile:vi.fn(()=>profile),createStore:vi.fn(()=>store),createRuntime:vi.fn(()=>runtime),createService:vi.fn(()=>service),buildServer:vi.fn(async()=>app),buildWidgetServer:vi.fn(async()=>widgets)} as unknown as HostFactories;
 return {profile,store,runtime,service,app,widgets,factories};
}

it('rejects a second host using the same canonical profile and different ports before Store or recovery',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'harness-profile-owner-')),first=mocks(),second=mocks();
 delete (first.factories as Partial<HostFactories>).acquireProfile;delete (second.factories as Partial<HostFactories>).acquireProfile;
 first.store.dataDir=directory;second.store.dataDir=directory;
 const firstHost=await launchHost({...options,dataDir:directory},first.factories);
 try{
  await expect(launchHost({...options,dataDir:join(directory,'.'),port:4417,widgetPort:4418},second.factories)).rejects.toMatchObject({code:'PROFILE_IN_USE'});
  expect(second.factories.createStore).not.toHaveBeenCalled();expect(second.service.recover).not.toHaveBeenCalled();expect(first.service.dispose).not.toHaveBeenCalled();
 }finally{await firstHost.close();await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

it('keeps profile ownership until every shutdown component confirms cleanup',async()=>{
 const m=mocks(),host=await launchHost(options,m.factories);m.service.dispose.mockRejectedValueOnce(new Error('Synthetic runtime cleanup failure'));
 expect(m.factories.acquireProfile).toHaveBeenCalledOnce();
 await expect(host.close()).rejects.toThrow('Synthetic runtime cleanup failure');expect(m.profile.close).not.toHaveBeenCalled();
});

it('constructs one runtime and reports readiness only after both listeners are live',async()=>{
 const m=mocks();let release!:()=>void;m.widgets.listen.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 let ready=false;const pending=launchHost(options,m.factories).then(host=>{ready=true;return host;});
 await vi.waitFor(()=>expect(m.widgets.listen).toHaveBeenCalledOnce());expect(ready).toBe(false);expect(m.service.recover).not.toHaveBeenCalled();
 release();const host=await pending;cleanup.push(()=>host.close());expect(host.origin).toBe('http://127.0.0.1:4317');expect(host.widgetOrigin).toBe('http://localhost:4318');expect(host.pid).toBe(process.pid);expect(m.factories.createRuntime).toHaveBeenCalledOnce();
 expect(m.app.listen).toHaveBeenCalledWith({host:'127.0.0.1',port:4317});expect(m.widgets.listen).toHaveBeenCalledWith({host:'127.0.0.1',port:4318});expect(m.service.recover).toHaveBeenCalledOnce();
});

it('composes skill discovery with the same owner-selected installation registry as plug-in loading',async()=>{
 const m=mocks(),catalog=new SkillCatalogRepository([]),createSkillCatalog=vi.fn(()=>catalog),loadPlugins=vi.fn(async()=>{throw Error('Synthetic unavailable plug-in host');});
 const selectedRoot=resolve(options.dataDir,'explicit-installed-registry');
 const host=await launchHost({...options,pluginDir:selectedRoot},{...m.factories,loadPlugins,createSkillCatalog} as Partial<HostFactories>);cleanup.push(()=>host.close());
 expect(loadPlugins).toHaveBeenCalledWith(selectedRoot,expect.any(String));
 expect(createSkillCatalog).toHaveBeenCalledWith(m.store,{pluginRoot:selectedRoot});
 expect(m.factories.buildServer).toHaveBeenCalledWith(m.service,expect.objectContaining({skillCatalog:catalog}));
});

it('closes every acquired resource when the widget port cannot bind',async()=>{
 const m=mocks();m.widgets.listen.mockRejectedValueOnce(new Error('EADDRINUSE fixture'));
 await expect(launchHost(options,m.factories)).rejects.toThrow('EADDRINUSE fixture');expect(m.app.close).toHaveBeenCalledOnce();expect(m.widgets.close).toHaveBeenCalledOnce();expect(m.service.dispose).toHaveBeenCalledOnce();expect(m.store.close).toHaveBeenCalledOnce();
 expect(m.service.recover).not.toHaveBeenCalled();
});

it('does not recover durable task authority when the host port cannot bind',async()=>{
 const m=mocks();m.app.listen.mockRejectedValueOnce(new Error('EADDRINUSE fixture'));
 await expect(launchHost(options,m.factories)).rejects.toThrow('EADDRINUSE fixture');expect(m.service.recover).not.toHaveBeenCalled();expect(m.widgets.listen).not.toHaveBeenCalled();
});

it('gates both actual listeners until recovery settles and only then reports readiness',async()=>{
 const hostPort=await freePort();let widgetPort=await freePort();while(widgetPort===hostPort)widgetPort=await freePort();
 const m=mocks();let release!:()=>void;m.service.recover.mockImplementationOnce(()=>new Promise<void>(accept=>{release=accept;}));
 const app=Fastify(),widgets=Fastify();app.get('/probe',async()=>({ready:true}));widgets.get('/probe',async()=>({ready:true}));
 const pending=launchHost({...options,port:hostPort,widgetPort},{...m.factories,buildServer:async()=>app,buildWidgetServer:async()=>widgets});
 let ready=false;void pending.then(()=>{ready=true;});
 try{
  await vi.waitFor(()=>expect(m.service.recover).toHaveBeenCalledOnce());expect(ready).toBe(false);
  for(const port of [hostPort,widgetPort])expect((await fetch(`http://127.0.0.1:${port}/probe`)).status).toBe(503);
  release();const host=await pending;cleanup.push(()=>host.close());
  for(const port of [hostPort,widgetPort])expect(await (await fetch(`http://127.0.0.1:${port}/probe`)).json()).toEqual({ready:true});
 }finally{release?.();await pending.then(host=>host.close(),()=>{});}
});

it('disposes the runtime if service construction fails and cleanup remains idempotent',async()=>{
 const m=mocks();vi.mocked(m.factories.createService).mockImplementationOnce(()=>{throw new Error('Service setup failed');});
 await expect(launchHost(options,m.factories)).rejects.toThrow('Service setup failed');expect(m.runtime.dispose).toHaveBeenCalledOnce();expect(m.store.close).toHaveBeenCalledOnce();
 const other=mocks(),host=await launchHost(options,other.factories);await Promise.all([host.close(),host.close()]);expect(other.service.dispose).toHaveBeenCalledOnce();expect(other.app.close).toHaveBeenCalledOnce();expect(other.store.close).toHaveBeenCalledOnce();
});

it('still closes storage when an individual shutdown component rejects',async()=>{
 const m=mocks(),host=await launchHost(options,m.factories);m.app.close.mockRejectedValueOnce(new Error('fixture close failed'));
 await expect(host.close()).rejects.toThrow('fixture close failed');expect(m.widgets.close).toHaveBeenCalledOnce();expect(m.service.dispose).toHaveBeenCalledOnce();expect(m.store.close).toHaveBeenCalledOnce();
});

it('validates launch options before creating a store or binding any listener',async()=>{
 for(const invalid of [{port:0},{port:NaN},{port:65536},{widgetPort:-1},{widgetPort:4317}]){const m=mocks();await expect(launchHost({...options,...invalid},m.factories)).rejects.toThrow();expect(m.factories.createStore).not.toHaveBeenCalled();}
 expect(readHostOptions({HARNESS_DATA_DIR:'./fixture-data',HARNESS_PORT:'4417',HARNESS_WIDGET_PORT:'4418',HARNESS_DEV:'1'})).toEqual({dataDir:resolve('fixture-data'),port:4417,widgetPort:4418,dev:true});
 expect(()=>readHostOptions({HARNESS_PORT:'4317junk'})).toThrow();
});

async function freePort(){const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});const port=(server.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return port;}
async function launched(env:NodeJS.ProcessEnv,prepare?:(directory:string)=>void){
 const dir=await mkdtemp(join(tmpdir(),'harness-desktop-host-')),token=randomBytes(32).toString('hex');let output='';
 prepare?.(dir);
 const child=fork(resolve('apps/server/main.ts'),[],{execArgv:['--import',pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href],cwd:resolve('.'),env:{...process.env,HARNESS_DATA_DIR:dir,...env,HARNESS_DESKTOP_LAUNCH_TOKEN:token},silent:true});
 child.stdout?.on('data',part=>output+=part);child.stderr?.on('data',part=>output+=part);
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 cleanup.push(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}if(relative(resolve(tmpdir()),resolve(dir))!==basename(dir)||!basename(dir).startsWith('harness-desktop-host-'))throw new Error('Refusing cleanup outside the owned test directory.');await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 return {child,token,dir,exited,output:()=>output};
}
function nextMessage(child:ChildProcess,type:string){return new Promise<Record<string,unknown>>((resolve,reject)=>{const timer=setTimeout(()=>{clear();reject(new Error('Desktop host IPC timed out: '+type));},type==='harness.ready'?25000:8000);const message=(value:unknown)=>{if(value&&typeof value==='object'&&(value as {type?:string}).type===type){clear();resolve(value as Record<string,unknown>);}};const exit=(code:number|null)=>{clear();reject(new Error('Host exited before '+type+': '+code));};const clear=()=>{clearTimeout(timer);child.off('message',message);child.off('exit',exit);};child.on('message',message);child.once('exit',exit);});}

it('launches an actual isolated sidecar, authenticates HTTP and shuts down only for its launch token',async()=>{
 const port=await freePort();let widgetPort=await freePort();while(widgetPort===port)widgetPort=await freePort();
 const fixture=await launched({HARNESS_PORT:String(port),HARNESS_WIDGET_PORT:String(widgetPort)}),ready=await nextMessage(fixture.child,'harness.ready');
 expect(ready).toEqual({type:'harness.ready',token:fixture.token,origin:`http://127.0.0.1:${port}`,pid:fixture.child.pid});
 const origin=String(ready.origin),boot=await fetch(origin+'/api/bootstrap'),session=await boot.json() as {csrfToken:string};expect(boot.status).toBe(200);expect(session.csrfToken).toBeTypeOf('string');
 const denied=await fetch(origin+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'denied',type:'thread.create',payload:{}})});expect(denied.status).toBe(401);
 fixture.child.send({type:'harness.shutdown',token:'wrong-token'});fixture.child.send({type:'harness.shutdown',token:'é'.repeat(fixture.token.length)});await new Promise(resolve=>setTimeout(resolve,100));expect(fixture.child.exitCode).toBeNull();expect((await fetch(origin+'/health')).status).toBe(200);
 const stopped=nextMessage(fixture.child,'harness.stopped');fixture.child.send({type:'harness.shutdown',token:fixture.token});expect(await stopped).toEqual({type:'harness.stopped',token:fixture.token});expect((await fixture.exited).code).toBe(0);
},35000);

it('reports a real startup collision without adopting an unrelated HTTP service',async()=>{
 const occupied:Server=createServer();await new Promise<void>(resolve=>occupied.listen(0,'127.0.0.1',resolve));cleanup.push(()=>new Promise<void>((resolve,reject)=>occupied.close(error=>error?reject(error):resolve())));
 const running={id:'existing-task',title:'Existing owner',status:'working',runId:'owned-run',epoch:7};
 const widgetPort=(occupied.address() as {port:number}).port,port=await freePort();const fixture=await launched({HARNESS_PORT:String(port),HARNESS_WIDGET_PORT:String(widgetPort)},directory=>{const store=new Store(directory);store.internal('fixture.seed',null,()=>store.put('thread',running.id,running.id,running));store.close();}),error=await nextMessage(fixture.child,'harness.error');
 expect(error.token).toBe(fixture.token);expect(error.message).toMatch(/EADDRINUSE|address already in use/i);expect((await fixture.exited).code).toBe(1);expect(occupied.listening).toBe(true);
 await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
 const saved=new Store(fixture.dir);try{expect(saved.get('thread',running.id)).toEqual(running);}finally{saved.close();}
});

it('does not leave its backend running after the owning IPC channel disconnects',async()=>{
 const port=await freePort();let widgetPort=await freePort();while(widgetPort===port)widgetPort=await freePort();
 const fixture=await launched({HARNESS_PORT:String(port),HARNESS_WIDGET_PORT:String(widgetPort)});await nextMessage(fixture.child,'harness.ready');fixture.child.disconnect();expect((await fixture.exited).code).toBe(0);
 await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
},35000);
