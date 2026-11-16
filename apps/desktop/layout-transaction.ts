import {randomUUID} from 'node:crypto';
import {desktopSurfaceKey,parseDesktopLayout,type DesktopLayout,type DesktopLayoutEntry} from '../../packages/desktop-contract/index.ts';

export interface NativeCloseOwner {
 closePromise?:Promise<boolean>;
 closeRequest?:{id:string;resolve:(allow:boolean)=>void;timer:ReturnType<typeof setTimeout>};
}

/** A delivery failure does not authorize closing an editor with unsaved changes. */
export function requestNativeClose(owner:NativeCloseOwner,notify:(id:string)=>void):Promise<boolean>{
 if(owner.closePromise)return owner.closePromise;
 const id=randomUUID();
 let settle!:(allow:boolean)=>void;
 const pending=new Promise<boolean>(resolve=>{settle=resolve;});
 const finish=(allow:boolean)=>{
  const request=owner.closeRequest;if(request?.id!==id)return;
  clearTimeout(request.timer);owner.closeRequest=undefined;owner.closePromise=undefined;settle(allow);
 };
 owner.closePromise=pending;
 owner.closeRequest={id,resolve:finish,timer:setTimeout(()=>finish(false),15000)};
 try{notify(id);}catch{finish(false);}
 return pending;
}

interface NativeLayoutAdapter {
 current():DesktopLayoutEntry[];
 prepare(entry:DesktopLayoutEntry):Promise<void>;
 open(entry:DesktopLayoutEntry):Promise<void>;
 apply(entry:DesktopLayoutEntry):Promise<void>;
 close(entry:DesktopLayoutEntry):Promise<void>;
 resume():void;
}

/** Stage only within the ordinary window budget; readiness failure retains the old editors. */
export async function applyNativeLayout(raw:DesktopLayout,adapter:NativeLayoutAdapter):Promise<void>{
 const next=parseDesktopLayout(raw),previous=structuredClone(adapter.current()),key=(entry:DesktopLayoutEntry)=>desktopSurfaceKey(entry.surface),oldKeys=new Set(previous.map(key)),nextKeys=new Set(next.windows.map(key));
 if(new Set([...oldKeys,...nextKeys]).size>24)throw Error('This profile needs more than 24 windows while restoring. Close unused windows and retry; your current layout is unchanged.');
 let changed=false;
 try{
  for(const entry of previous)await adapter.prepare(entry);
  changed=true;
  for(const entry of next.windows)if(!oldKeys.has(key(entry)))await adapter.open(entry);
  for(const entry of next.windows)await adapter.apply(entry);
  for(const entry of previous)if(!nextKeys.has(key(entry)))await adapter.close(entry);
 }catch(cause){
  if(!changed)throw cause;
  const rollbackErrors:unknown[]=[];
  // Return original view ownership before closing staged browser windows.
  for(const entry of previous)try{if(!adapter.current().some(value=>key(value)===key(entry)))await adapter.open(entry);await adapter.apply(entry);}catch(error){rollbackErrors.push(error);}
  for(const entry of adapter.current())if(!oldKeys.has(key(entry)))try{await adapter.close(entry);}catch(error){rollbackErrors.push(error);}
  if(rollbackErrors.length)throw new AggregateError([cause,...rollbackErrors],'Profile restoration failed and some windows could not be restored. Your saved drafts are retained.');
  throw cause;
 }finally{adapter.resume();}
}
