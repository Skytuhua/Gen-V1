import type {PluginFrameRequest} from '../../../packages/plugins/frame-protocol';
import {pluginWindowOperation} from '../../../packages/plugins/frame-protocol';
import {pluginSurfaceSchema,type PluginSurface} from '../../../packages/plugins/contracts';

interface Pending {resolve:(value:unknown)=>void;reject:(cause:Error)=>void;timer:ReturnType<typeof setTimeout>;cleanup:()=>void;blocksClose:boolean}
const pending=new Map<string,Pending>();
const editorGuards=new Map<string,()=>Promise<void>>();
const journalIntents=new Map<string,{value:unknown}>(),journalWrites=new Map<string,Promise<void>>();
const surfaceListeners=new Set<(surface:PluginSurface)=>void>();
let lastSurfaceFocus='';
export function onPluginSurfaceFocus(listener:(surface:PluginSurface)=>void){surfaceListeners.add(listener);return()=>{surfaceListeners.delete(listener);};}
const session=new URLSearchParams(location.search).get('session')??'';
const pluginId=document.querySelector<HTMLMetaElement>('meta[name="gen-plugin-id"]')?.content??'';
const theme=new URLSearchParams(location.search).get('theme');
if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;

export function pluginRequest<T=unknown>(operation:string,input:unknown=null,signal?:AbortSignal):Promise<T> {
  if(window.parent===window||!session||!pluginId)return Promise.reject(Error('Open this plug-in from Gen.'));
  if(signal?.aborted)return Promise.reject(Error('The request was cancelled.'));
  const id=crypto.randomUUID();
  return new Promise<T>((resolve,reject)=>{
    const finish=(cause?:Error)=>{const item=pending.get(id);if(!item)return;pending.delete(id);clearTimeout(item.timer);item.cleanup();if(cause)item.reject(cause);};
    const abort=()=>{parent.postMessage({type:'gen.plugin.abort',session,pluginId,id},'*');finish(Error('The request was cancelled.'));};
    const timer=setTimeout(()=>{parent.postMessage({type:'gen.plugin.abort',session,pluginId,id},'*');finish(Error('The request outcome is unconfirmed. Recover the existing request before retrying.'));},20000);
    signal?.addEventListener('abort',abort,{once:true});
    pending.set(id,{resolve:value=>resolve(value as T),reject,timer,cleanup:()=>signal?.removeEventListener('abort',abort),blocksClose:!pluginWindowOperation(operation)});
    const request:PluginFrameRequest={type:'gen.plugin.request',session,id,pluginId,operation,input};
    parent.postMessage(request,'*');
  });
}
export async function pluginFlush(){await Promise.all([...editorGuards.values()].map(guard=>guard()));await Promise.all([...journalWrites.values()]);await Promise.all([...pending.values()].filter(item=>item.blocksClose).map(item=>new Promise<void>((resolve,reject)=>{const originalResolve=item.resolve,originalReject=item.reject;item.resolve=value=>{originalResolve(value);resolve();};item.reject=cause=>{originalReject(cause);reject(cause);};})));if(journalIntents.size)throw Error('A draft could not be saved. Retry saving before closing this view.');}
export function registerEditorHandoff(id:string,guard:()=>Promise<void>){editorGuards.set(id,guard);return()=>{if(editorGuards.get(id)===guard)editorGuards.delete(id);};}
export const prepareEditorHandoff=pluginFlush;
export function pluginReady(){parent.postMessage({type:'gen.plugin.ready',pluginId,session},'*');}
export const journalRead=<T,>(key:string)=>pluginRequest<T|null>('state.read',{key});
export function journalWrite(key:string,value:unknown):Promise<void>{
 const intent={value:structuredClone(value)};journalIntents.set(key,intent);
 const write=(journalWrites.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{await pluginRequest('state.write',{key,value:intent.value});if(journalIntents.get(key)===intent)journalIntents.delete(key);});
 journalWrites.set(key,write);void write.then(()=>{if(journalWrites.get(key)===write)journalWrites.delete(key);},()=>{if(journalWrites.get(key)===write)journalWrites.delete(key);});return write;
}
/** Explicitly retries local draft persistence only; never a Company operation. */
export async function retryJournalWrites(){const intents=[...journalIntents.entries()];await Promise.all(intents.map(([key,intent])=>journalIntents.get(key)===intent?journalWrite(key,intent.value):Promise.resolve()));}
export const journalFlush=pluginFlush;
export function journalSubscribe(_key:string,listener:()=>void){const changed=(event:MessageEvent)=>{if(event.source===parent&&event.data?.type==='gen.plugin.state-changed'&&event.data.session===session)listener();};addEventListener('message',changed);return()=>removeEventListener('message',changed);}

addEventListener('message',event=>{
  if(event.source!==parent||!event.data||typeof event.data!=='object')return;
  const value=event.data;
  if(value.type==='gen.plugin.reply'&&typeof value.id==='string'){
    const item=pending.get(value.id);if(!item)return;pending.delete(value.id);clearTimeout(item.timer);item.cleanup();
    if(value.ok===true)item.resolve(value.value);else item.reject(Error(typeof value.error==='string'?value.error:'The plug-in request failed.'));
  }else if(value.type==='gen.plugin.flush'&&value.session===session&&typeof value.id==='string'){
    void pluginFlush().then(()=>parent.postMessage({type:'gen.plugin.flushed',session,id:value.id,ok:true},'*'),()=>parent.postMessage({type:'gen.plugin.flushed',session,id:value.id,ok:false},'*'));
  }else if(value.type==='gen.plugin.theme'&&value.session===session&&(value.theme==='light'||value.theme==='dark')){
    document.documentElement.dataset.theme=value.theme;
  }else if(value.type==='gen.plugin.retry-saves'&&value.session===session){
    void retryJournalWrites().then(()=>parent.postMessage({type:'gen.plugin.saves-retried',session,ok:true},'*'),()=>parent.postMessage({type:'gen.plugin.saves-retried',session,ok:false},'*'));
  }else if(value.type==='gen.plugin.focus-surface'&&value.session===session&&typeof value.id==='string'&&value.id.length<=200&&value.id!==lastSurfaceFocus){
    const surface=pluginSurfaceSchema.safeParse(value.surface);
    if(surface.success&&surface.data.pluginId===pluginId&&surfaceListeners.size){lastSurfaceFocus=value.id;for(const listener of surfaceListeners)listener(surface.data);}
  }
});
