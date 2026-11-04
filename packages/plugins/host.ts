import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pluginIdSchema,pluginPathSchema,pluginSurfaceSchema,type PluginCompatibility,type PluginHostInstance,type PluginHostModule,type PluginManifest,type PluginSurface} from './contracts.ts';
import {checkInstalledCompatibility,readPluginIndex,safeDirectory,validGenVersion,verifyPluginPackage,versionCompatible,type ActivePlugin,type VerifiedPackage} from './installation.ts';
export {installPluginPackage,removePlugin} from './installation.ts';

interface LoadedPlugin {record:ActivePlugin;verified:VerifiedPackage;instance?:PluginHostInstance;pending:Set<AbortController>}
export interface PluginRegistry {
 list():PluginManifest[];
 dispatch(id:string,operation:string,input:unknown,signal:AbortSignal):Promise<unknown>;
 readAsset(id:string,relativePath:string):Promise<{bytes:Uint8Array;contentType:string}>;
 validateSurface(surface:PluginSurface):Promise<boolean>;
 compatibleWith(genVersion:string):Promise<PluginCompatibility>;
 isBusy():Promise<boolean>;
 close():Promise<void>;
}
const unavailable=()=>Error('The installed plug-in is unavailable.');
function jsonCopy(value:unknown,maxBytes:number):unknown{
 let nodes=0;const visited=new Set<object>();
 function inspect(item:unknown,depth:number):void{
  if(++nodes>20000||depth>32)throw Error('The plug-in request is too large.');
  if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return;
  if(typeof item!=='object'||visited.has(item))throw Error('The plug-in request must contain JSON values.');
  if(!Array.isArray(item)&&Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null)throw Error('The plug-in request must contain JSON values.');
  visited.add(item);for(const [key,entry]of Object.entries(Object.getOwnPropertyDescriptors(item))){if(Array.isArray(item)&&key==='length')continue;if(!('value'in entry)||['__proto__','prototype','constructor'].includes(key))throw Error('The plug-in request must contain plain JSON values.');inspect(entry.value,depth+1);}visited.delete(item);
 }
 inspect(value,0);const text=JSON.stringify(value);if(Buffer.byteLength(text)>maxBytes)throw Error('The plug-in request is too large.');return JSON.parse(text);
}
function hostInstance(value:unknown):PluginHostInstance{
 if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();const host=value as PluginHostInstance;
 if(!host.operations||typeof host.operations!=='object'||Array.isArray(host.operations)||typeof host.close!=='function'||host.validateSurface!==undefined&&typeof host.validateSurface!=='function'||host.isBusy!==undefined&&typeof host.isBusy!=='function')throw unavailable();
 if(Object.entries(host.operations).some(([name,operation])=>!/^[a-z][a-zA-Z0-9_.-]{0,79}$/.test(name)||['constructor','prototype'].includes(name)||typeof operation!=='function'))throw unavailable();return host;
}
const contentTypes:Record<string,string>={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',webp:'image/webp',woff:'font/woff',woff2:'font/woff2',ico:'image/x-icon'};

/** Only packages explicitly installed with a trusted inventory digest activate.
 * Package hostEntry must export default {activate({dataDir,genVersion})}.
 * No personal Store, runtime, accounts, credential manager or command client is
 * provided. These are trusted Node extensions; this API is not a code sandbox. */
export async function loadInstalledPlugins(root:string,genVersion:string):Promise<PluginRegistry>{
 if(!validGenVersion(genVersion))throw Error('Gen needs a valid semantic version to load plug-ins.');
 const loaded=new Map<string,LoadedPlugin>();let closed=false,admissions=0;
 try{for(const record of await readPluginIndex(root)){
  const verified=await verifyPluginPackage(join(root,record.id,record.version),record.digest);if(verified.manifest.id!==record.id||verified.manifest.version!==record.version)throw unavailable();
  const entry:LoadedPlugin={record,verified,pending:new Set()};loaded.set(record.id,entry);
  if(versionCompatible(verified.manifest,genVersion)){
   const dataDir=await safeDirectory(join(root,'data',record.id),true);
   try{
    const module=await import(/* @vite-ignore */pathToFileURL(join(verified.directory,verified.manifest.hostEntry)).href+'?integrity='+record.digest) as {default?:PluginHostModule};if(typeof module.default?.activate!=='function')throw unavailable();
    const activated=await module.default.activate(Object.freeze({dataDir,genVersion}));
    try{entry.instance=hostInstance(activated);}catch(error){if(activated&&typeof activated.close==='function')await activated.close().catch(()=>{});throw error;}
   }catch{throw Error('The installed plug-in host could not start.');}
  }
 }}catch(error){await Promise.allSettled([...loaded.values()].map(entry=>entry.instance?.close()));throw error;}
 const current=async(id:string,requireHost=false)=>{
  if(closed||!pluginIdSchema.safeParse(id).success)throw unavailable();const entry=loaded.get(id),active=(await readPluginIndex(root)).find(row=>row.id===id);
  if(!entry||!active||active.version!==entry.record.version||active.digest!==entry.record.digest||requireHost&&!entry.instance){if(entry)for(const request of entry.pending)request.abort();throw unavailable();}
  await verifyPluginPackage(entry.verified.directory,entry.record.digest);
  const latest=(await readPluginIndex(root)).find(row=>row.id===id);if(closed||!latest||latest.version!==entry.record.version||latest.digest!==entry.record.digest){for(const request of entry.pending)request.abort();throw unavailable();}return entry;
 };
 return {
  list:()=>[...loaded.values()].map(entry=>structuredClone(entry.verified.manifest)),
  async dispatch(id,operation,input,signal){
   if(signal.aborted)throw Error('The plug-in request was aborted.');admissions++;try{const cloned=jsonCopy(input,256*1024),entry=await current(id,true);if(!Object.hasOwn(entry.instance!.operations,operation))throw Error('This plug-in operation is unavailable.');
   const request=new AbortController(),abort=()=>request.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)request.abort();entry.pending.add(request);
   try{if(request.signal.aborted)throw Error('The plug-in request was aborted.');const result=await entry.instance!.operations[operation](cloned,request.signal);await current(id,true);if(request.signal.aborted)throw Error('The plug-in request was aborted.');return jsonCopy(result,2*1024*1024);}
   catch(error){if(request.signal.aborted)throw Error('The plug-in request was aborted.');if(error instanceof Error&&error.message==='The installed plug-in is unavailable.')throw error;throw Error('The plug-in operation could not complete.');}
   finally{entry.pending.delete(request);signal.removeEventListener('abort',abort);}}finally{admissions--;}
  },
  async readAsset(id,path){pluginPathSchema.parse(path);if(!path.startsWith('frontend/'))throw Error('Only verified frontend assets may be served.');const entry=await current(id),bytes=entry.verified.files.get(path);if(!bytes)throw Error('The plug-in frontend asset is unavailable.');const extension=path.split('.').at(-1)??'';if(!contentTypes[extension])throw Error('The plug-in frontend asset type is unavailable.');return {bytes:Buffer.from(bytes),contentType:contentTypes[extension]};},
  async validateSurface(surface){const parsed=pluginSurfaceSchema.safeParse(surface);if(!parsed.success)return false;try{const entry=await current(parsed.data.pluginId,true);if(!entry.instance!.validateSurface||await entry.instance!.validateSurface(structuredClone(parsed.data))!==true)return false;await current(parsed.data.pluginId,true);return true;}catch{return false;}},
  async compatibleWith(version){if(closed)throw unavailable();return checkInstalledCompatibility(root,version);},
  async isBusy(){if(closed)return false;if(admissions)return true;for(const entry of loaded.values()){if(entry.pending.size)return true;try{if(entry.instance&&(!entry.instance.isBusy||await entry.instance.isBusy()!==false))return true;}catch{return true;}}return false;},
  async close(){if(closed)return;closed=true;for(const entry of loaded.values())for(const request of entry.pending)request.abort();const results=await Promise.allSettled([...loaded.values()].map(entry=>entry.instance?.close()));if(results.some(result=>result.status==='rejected'))throw Error('A plug-in host could not confirm shutdown.');},
 };
}
