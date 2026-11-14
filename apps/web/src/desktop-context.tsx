import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ExternalLink} from 'lucide-react';
import type {DesktopBridge,DesktopContext,DesktopState,DesktopSurface,DesktopWindowInfo} from '../../../packages/desktop-contract/index';
import {desktopSurfaceKey} from '../../../packages/desktop-contract/index';
import {prepareEditorHandoff,registerEditorHandoff} from './editor-handoff';
import './native-chrome.css';

declare global {interface Window {harnessDesktop?:DesktopBridge}}
type DesktopValue={bridge:DesktopBridge;context:DesktopContext;windows:DesktopWindowInfo[];browser?:DesktopState['browser'];state:DesktopState;prepareHandoff:()=>Promise<void>;registerClose:(key:string,guard:()=>Promise<void>)=>()=>void;closing:boolean;resumeEditing:()=>void;pending:DesktopSurface[];ownership:(surface:DesktopSurface|null)=>number|undefined;detachSurface:(surface:DesktopSurface,before?:()=>Promise<void>)=>Promise<DesktopWindowInfo>};
const Context=createContext<DesktopValue|null>(null);
export const useDesktop=()=>useContext(Context);
export const surfaceKey=desktopSurfaceKey;
function sameEditor(left:DesktopSurface,right:DesktopSurface){const artifact=(value:DesktopSurface)=>value.kind==='artifact'||value.kind==='workspace'&&value.tab==='artifact';return artifact(left)&&artifact(right)?'artifactId'in left&&'artifactId'in right&&left.artifactId===right.artifactId&&left.threadId===right.threadId:surfaceKey(left)===surfaceKey(right);}
export function detachedSurface(desktop:DesktopValue|null,surface:DesktopSurface|null){return desktop&&surface?desktop.windows.find(info=>info.id!==desktop.context.windowId&&sameEditor(info.surface,surface)):undefined;}
export function pendingSurface(desktop:DesktopValue|null,surface:DesktopSurface|null){return Boolean(desktop&&surface&&desktop.pending.some(item=>sameEditor(item,surface)));}
export function useDetachedSurface(surface:DesktopSurface|null){return detachedSurface(useDesktop(),surface);}
export function usePendingSurface(surface:DesktopSurface|null){return pendingSurface(useDesktop(),surface);}
export function useDesktopCloseGuard(key:string,guard:()=>Promise<void>){const latest=useRef(guard);latest.current=guard;useEffect(()=>registerEditorHandoff(key,()=>latest.current()),[key]);}
export function useDesktopReady(ready:boolean){const desktop=useDesktop();useEffect(()=>{if(ready&&desktop)void desktop.bridge.ready().catch(()=>{});},[ready,desktop?.bridge]);}
function surfaceOwners(windows:DesktopWindowInfo[],windowId:string){
 const owners=new Map<string,string[]>();
 for(const info of windows){if(info.id===windowId)continue;const key=surfaceKey(info.surface),ids=owners.get(key)??[];ids.push(info.id);owners.set(key,ids);}
 return new Map([...owners].map(([key,ids])=>[key,JSON.stringify(ids.sort())]));
}
export function DesktopProvider({bridge,context,children}:{bridge:DesktopBridge;context:DesktopContext;children:ReactNode}){
 useLayoutEffect(()=>{if(!context.nativeTitleBar)return;document.documentElement.dataset.nativeTitlebar='true';const sync=()=>{const theme=document.documentElement.dataset.theme;if(theme==='light'||theme==='dark')void bridge.setTheme?.(theme).catch(()=>{});};const observer=new MutationObserver(sync);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});sync();return()=>{observer.disconnect();delete document.documentElement.dataset.nativeTitlebar;};},[bridge,context.nativeTitleBar]);
 const [state,setState]=useState<DesktopState>(context),[pending,setPending]=useState<DesktopSurface[]>([]),[closing,setClosing]=useState(false);
 const pendingKeys=useRef(new Set<string>());
 const owner=useRef({owners:surfaceOwners(context.windows,context.windowId),epochs:new Map<string,number>(),sequence:0,closing:false,closeEpoch:0});
 const updateClosing=useCallback((value:boolean)=>{
  const current=owner.current;if(current.closing!==value){current.closing=value;current.closeEpoch=++current.sequence;}setClosing(value);
 },[]);
 const ownership=useCallback((surface:DesktopSurface|null)=>{
  const current=owner.current,key=surface&&surfaceKey(surface);
  return current.closing||key&&current.owners.has(key)?undefined:Math.max(current.closeEpoch,key?current.epochs.get(key)??0:0);
 },[]);
 const registerClose=registerEditorHandoff;
 useEffect(()=>bridge.onState(value=>{
  // Record every trusted transition before React can batch away an owner roundtrip.
  const current=owner.current,next=surfaceOwners(value.windows,context.windowId);
  for(const key of new Set([...current.owners.keys(),...next.keys()]))if(current.owners.get(key)!==next.get(key))current.epochs.set(key,++current.sequence);
  current.owners=next;
  if(value.closeCancelled)updateClosing(false);setState(value);
 }),[bridge,context.windowId,updateClosing]);
 const prepareHandoff=prepareEditorHandoff;
 useEffect(()=>bridge.onCloseRequested(async()=>{updateClosing(true);try{await prepareHandoff();return true;}catch{updateClosing(false);return false;}}),[bridge,prepareHandoff,updateClosing]);
 const detachSurface=useCallback(async(surface:DesktopSurface,before?:()=>Promise<void>)=>{const key=surfaceKey(surface);if(pendingKeys.current.has(key))throw Error('This view is already moving to another window.');pendingKeys.current.add(key);setPending(value=>[...value,surface]);try{await prepareEditorHandoff();await before?.();return await bridge.detach(surface);}finally{pendingKeys.current.delete(key);setPending(value=>value.filter(item=>surfaceKey(item)!==key));}},[bridge]);
 const value=useMemo(()=>({bridge,context,...state,state,registerClose,prepareHandoff,pending,ownership,detachSurface,closing,resumeEditing:()=>updateClosing(false)}),[bridge,context,state,registerClose,prepareHandoff,pending,ownership,detachSurface,closing,updateClosing]);
 return <Context value={value}>{children}</Context>;
}
/** Moves a view into its own native window, or focuses the window that owns it. */
export function DetachButton({surface,label,before,after,onError}:{surface:DesktopSurface;label:string;before?:()=>Promise<void>;after?:()=>void;onError?:(error:Error)=>void}){
 const desktop=useDesktop(),detached=useDetachedSurface(surface),[busy,setBusy]=useState(false);
 return <button type="button" className="icon-button" aria-label={detached?`Focus detached ${label}`:`Detach ${label}`} title={detached?`Focus detached ${label}`:`Detach ${label}`} disabled={!desktop||busy} onClick={()=>{if(!desktop)return;setBusy(true);void(async()=>{if(detached){await desktop.bridge.focus(detached.id);return;}await desktop.detachSurface(surface,before);after?.();})().catch(cause=>onError?.(cause instanceof Error?cause:Error('The desktop window could not open.'))).finally(()=>setBusy(false));}}><ExternalLink size={14}/></button>;
}
/** Recovery is offered only for a child that already owns saved work. */
export function DesktopWindowActions(){const desktop=useDesktop(),[error,setError]=useState('');if(!desktop||desktop.context.surface.kind==='main')return null;
 return <><button type="button" className="quiet" onClick={()=>{void desktop.bridge.reattach().catch(cause=>{desktop.resumeEditing();setError(cause instanceof Error?cause.message:'The view could not return. Keep it open and retry.');});}}>Return to workspace</button>{error&&<p role="status">{error}</p>}</>;
}
