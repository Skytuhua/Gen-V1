import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {Store} from '../../packages/storage/store.ts';
import {Service} from '../../packages/core/service.ts';
import {createRuntime} from '../../packages/runtime/index.ts';
import {accountResolver} from '../../packages/core/accounts.ts';
import {buildServer,buildWidgetServer,type MountRegistry} from './server.ts';
import {acquireProfileLease,type ProfileLease} from './profile-lease.ts';
import {createHermesService} from './hermes-service.ts';
import {WorkspaceRepository} from '../../packages/core/workspace-layout.ts';
import {AttentionRepository} from '../../packages/core/attention.ts';
import type {AttentionDelivery} from '../../packages/contracts/attention.ts';
import {parseDesktopLayout,type DesktopLayout} from '../../packages/desktop-contract/index.ts';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {loadInstalledPlugins,type PluginRegistry} from '../../packages/plugins/host.ts';
import {checkInstalledCompatibility} from '../../packages/plugins/installation.ts';
import {createPersonalSkillCatalog} from '../../packages/skill-catalog/adapters.ts';

export interface HostOptions {dataDir:string;port:number;widgetPort:number;dev:boolean;pluginDir?:string;launchToken?:string}
export interface RunningHost {attentionRead?():Promise<AttentionDelivery>;attentionAction?(type:'open'|'dismiss',eventId:string):Promise<{threadId?:string;dismissed?:boolean}>;origin:string;widgetOrigin:string;pid:number;close():Promise<void>;nativeLayout?:DesktopLayout;stopAll():Promise<{stopped:number;errors?:string[]}>;saveNativeLayout(layout:unknown):Promise<void>;validatePluginSurface?(surface:unknown):Promise<boolean>;pluginCompatibility?(version:string):Promise<{allowed:boolean}>;updateReadiness?():Promise<{idle:boolean}>;prepareUpdateClose?():Promise<{idle:boolean}>}
export interface HostFactories {
 acquireProfile:typeof acquireProfileLease;
 createStore(dataDir:string):Store;
 createRuntime:typeof createRuntime;
 createService(store:Store,runtime:ReturnType<typeof createRuntime>):Service;
 buildServer:typeof buildServer;
 buildWidgetServer:typeof buildWidgetServer;
 loadPlugins:typeof loadInstalledPlugins;
 createSkillCatalog:typeof createPersonalSkillCatalog;
}

function port(value:unknown,name:string):number {
 if(typeof value==='string'&&!/^\d{1,5}$/.test(value))throw new Error(`${name} must be a port between 1 and 65535.`);
 const parsed=typeof value==='string'?Number(value):value;
 if(typeof parsed!=='number'||!Number.isSafeInteger(parsed)||parsed<1||parsed>65535)throw new Error(`${name} must be a port between 1 and 65535.`);
 return parsed;
}
export function readHostOptions(env:NodeJS.ProcessEnv=process.env):HostOptions {
 if(env.HARNESS_DATA_DIR!==undefined&&!env.HARNESS_DATA_DIR.trim())throw new Error('HARNESS_DATA_DIR must be a nonempty directory.');
 return {dataDir:resolve(env.HARNESS_DATA_DIR??join(env.LOCALAPPDATA??homedir(),'GenerativeHarness')),port:port(env.HARNESS_PORT??4317,'HARNESS_PORT'),widgetPort:port(env.HARNESS_WIDGET_PORT??4318,'HARNESS_WIDGET_PORT'),dev:env.HARNESS_DEV==='1',launchToken:env.HARNESS_DESKTOP_LAUNCH_TOKEN};
}

/** One owned host, reused by the CLI and the desktop's real-Node sidecar. */
export async function launchHost(options:HostOptions,overrides:Partial<HostFactories>={}):Promise<RunningHost> {
 const hostPort=port(options.port,'HARNESS_PORT'),widgetPort=port(options.widgetPort,'HARNESS_WIDGET_PORT');
 if(hostPort===widgetPort)throw new Error('The host and widget ports must be different.');
 if(!options.dataDir.trim())throw new Error('The harness data directory must be nonempty.');
 const make:HostFactories={acquireProfile:acquireProfileLease,createStore:dataDir=>new Store(dataDir),createRuntime,createService:createHermesService,buildServer,buildWidgetServer,loadPlugins:loadInstalledPlugins,createSkillCatalog:createPersonalSkillCatalog,...overrides};
 let plugins:PluginRegistry|undefined,pluginLoadFailed=false;
 let profile:ProfileLease|undefined,store:Store|undefined,runtime:ReturnType<typeof createRuntime>|undefined,service:Service|undefined,app:Awaited<ReturnType<typeof buildServer>>|undefined,widgets:Awaited<ReturnType<typeof buildWidgetServer>>|undefined,closing:Promise<void>|undefined,accepting=false;
 const close=()=>closing??= (async()=>{
  accepting=false;
  // Begin revoking task authority immediately, independently of HTTP/SSE close.
  const results=await Promise.allSettled([
   Promise.resolve().then(()=>app?.close()),
   Promise.resolve().then(()=>widgets?.close()),
   Promise.resolve().then(()=>service?service.dispose():runtime?.dispose()),
   Promise.resolve().then(()=>plugins?.close()),
  ]);
  const failures:unknown[]=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected').map(result=>result.reason);
  try{store?.close();}catch(error){failures.push(error);}
  if(!failures.length)try{profile?.close();}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,`Could not close the harness: ${failures[0] instanceof Error?failures[0].message:'resource cleanup failed'}`);
 })();
 try {
  profile=make.acquireProfile(resolve(options.dataDir));
  store=make.createStore(profile.dataDir);runtime=make.createRuntime({dataDir:store.dataDir,accounts:accountResolver(store)});service=make.createService(store,runtime);
  const pluginRoot=resolve(options.pluginDir??process.env.HARNESS_PLUGIN_DIR??join(process.env.LOCALAPPDATA??homedir(),'GenV1','plugins'));
  const version=JSON.parse(await readFile(resolve('package.json'),'utf8')).version as string;
  try{plugins=await make.loadPlugins(pluginRoot,version);}catch{pluginLoadFailed=true;}
  const mounts:MountRegistry=new Map();
  app=await make.buildServer(service,{port:hostPort,widgetPort,dev:options.dev,mounts,plugins,skillCatalog:make.createSkillCatalog(store,{pluginRoot}),admitPluginRequest:()=>accepting,launchToken:options.launchToken,...(pluginLoadFailed?{pluginError:'An installed plug-in could not load. Its saved data is retained.'}:{})});
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
  const workspace=()=>new WorkspaceRepository(store!),attention=new AttentionRepository(store!);
  return {origin:`http://127.0.0.1:${hostAddress.port}`,widgetOrigin:`http://localhost:${widgetAddress.port}`,pid:process.pid,close,
   get nativeLayout(){return store&&typeof store.get==='function'?workspace().read().state.nativeLayout:undefined;},
   async saveNativeLayout(layout){if(!accepting)throw Error('Host is not accepting layout saves.');workspace().command({id:randomUUID(),type:'workspace.native.update',payload:{layout:parseDesktopLayout(layout)}});},
   stopAll:()=>service!.stopAll(),
   async attentionRead(){if(!accepting)throw Error('The host is not accepting attention requests.');return attention.claimDelivery();},
   async attentionAction(type,eventId){if(!accepting)throw Error('The host is not accepting attention requests.');if(type==='open')return attention.markOpen(eventId);attention.command({id:randomUUID(),eventId,type:'dismiss-popup'});return{dismissed:true};},
   validatePluginSurface:async surface=>await plugins?.validateSurface(surface as Parameters<PluginRegistry['validateSurface']>[0])===true,
   async pluginCompatibility(version){
    // Reload the active inventory for this decision; a separately installed
    // plug-in may have changed since download or application startup.
    return {allowed:(await checkInstalledCompatibility(pluginRoot,version)).compatible};
   },
   async updateReadiness(){return {idle:accepting&&!pluginLoadFailed&&!await plugins?.isBusy()&&service!.isUpdateIdle()};},
   async prepareUpdateClose(){accepting=false;const idle=service!.freezeForUpdate();return {idle:idle&&!pluginLoadFailed&&!await plugins?.isBusy()};},
  };
 }catch(error){await close().catch(()=>{});throw error;}
}
