import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {Store} from '../../packages/storage/store.ts';
import {Service} from '../../packages/core/service.ts';
import {createRuntime} from '../../packages/runtime/index.ts';
import {buildServer,buildWidgetServer,type MountRegistry} from './server.ts';

export interface HostOptions {dataDir:string;port:number;widgetPort:number;dev:boolean}
export interface RunningHost {origin:string;widgetOrigin:string;pid:number;close():Promise<void>}
export interface HostFactories {
 createStore(dataDir:string):Store;
 createRuntime:typeof createRuntime;
 createService(store:Store,runtime:ReturnType<typeof createRuntime>):Service;
 buildServer:typeof buildServer;
 buildWidgetServer:typeof buildWidgetServer;
}

function port(value:unknown,name:string):number {
 if(typeof value==='string'&&!/^\d{1,5}$/.test(value))throw new Error(`${name} must be a port between 1 and 65535.`);
 const parsed=typeof value==='string'?Number(value):value;
 if(typeof parsed!=='number'||!Number.isSafeInteger(parsed)||parsed<1||parsed>65535)throw new Error(`${name} must be a port between 1 and 65535.`);
 return parsed;
}
export function readHostOptions(env:NodeJS.ProcessEnv=process.env):HostOptions {
 if(env.HARNESS_DATA_DIR!==undefined&&!env.HARNESS_DATA_DIR.trim())throw new Error('HARNESS_DATA_DIR must be a nonempty directory.');
 return {dataDir:resolve(env.HARNESS_DATA_DIR??join(env.LOCALAPPDATA??homedir(),'GenerativeHarness')),port:port(env.HARNESS_PORT??4317,'HARNESS_PORT'),widgetPort:port(env.HARNESS_WIDGET_PORT??4318,'HARNESS_WIDGET_PORT'),dev:env.HARNESS_DEV==='1'};
}

/** One owned host, reused by the CLI and the desktop's real-Node sidecar. */
export async function launchHost(options:HostOptions,overrides:Partial<HostFactories>={}):Promise<RunningHost> {
 const hostPort=port(options.port,'HARNESS_PORT'),widgetPort=port(options.widgetPort,'HARNESS_WIDGET_PORT');
 if(hostPort===widgetPort)throw new Error('The host and widget ports must be different.');
 if(!options.dataDir.trim())throw new Error('The harness data directory must be nonempty.');
 const make:HostFactories={createStore:dataDir=>new Store(dataDir),createRuntime,createService:(store,runtime)=>new Service(store,runtime),buildServer,buildWidgetServer,...overrides};
 let store:Store|undefined,runtime:ReturnType<typeof createRuntime>|undefined,service:Service|undefined,app:Awaited<ReturnType<typeof buildServer>>|undefined,widgets:Awaited<ReturnType<typeof buildWidgetServer>>|undefined,closing:Promise<void>|undefined,accepting=false;
 const close=()=>closing??= (async()=>{
  accepting=false;
  // Begin revoking task authority immediately, independently of HTTP/SSE close.
  const results=await Promise.allSettled([
   Promise.resolve().then(()=>app?.close()),
   Promise.resolve().then(()=>widgets?.close()),
   Promise.resolve().then(()=>service?service.dispose():runtime?.dispose()),
  ]);
  const failures:unknown[]=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected').map(result=>result.reason);
  try{store?.close();}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,`Could not close the harness: ${failures[0] instanceof Error?failures[0].message:'resource cleanup failed'}`);
 })();
 try {
  store=make.createStore(resolve(options.dataDir));runtime=make.createRuntime({dataDir:store.dataDir});service=make.createService(store,runtime);
  const mounts:MountRegistry=new Map();
  app=await make.buildServer(service,{port:hostPort,widgetPort,dev:options.dev,mounts});
  widgets=await make.buildWidgetServer(service,mounts,widgetPort);
  // Own both ports before recovering durable runs. A collision must not alter
  // another live host's task authority, and early clients must wait for recovery.
  app.addHook('onRequest',async(_request,reply)=>{if(!accepting)return reply.code(503).send({error:'The local harness is starting. Try again shortly.'});});
  widgets.addHook('onRequest',async(_request,reply)=>{if(!accepting)return reply.code(503).send({error:'The local harness is starting. Try again shortly.'});});
  await app.listen({host:'127.0.0.1',port:hostPort});
  await widgets.listen({host:'127.0.0.1',port:widgetPort});
  const hostAddress=app.server.address(),widgetAddress=widgets.server.address();
  if(!hostAddress||typeof hostAddress==='string'||!widgetAddress||typeof widgetAddress==='string')throw new Error('The local harness did not establish its loopback listeners.');
  await service.recover();
  accepting=true;
  return {origin:`http://127.0.0.1:${hostAddress.port}`,widgetOrigin:`http://localhost:${widgetAddress.port}`,pid:process.pid,close};
 }catch(error){await close().catch(()=>{});throw error;}
}
