import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ExternalLink,Minus,PanelLeftClose,RotateCcw} from 'lucide-react';
import type {DesktopBridge,DesktopContext,DesktopState,DesktopSurface,DesktopWindowInfo} from '../../../packages/desktop-contract/index';
import {desktopSurfaceKey} from '../../../packages/desktop-contract/index';

declare global {interface Window {harnessDesktop?:DesktopBridge}}
type DesktopValue={bridge:DesktopBridge;context:DesktopContext;windows:DesktopWindowInfo[];browser?:DesktopState['browser'];state:DesktopState;prepareHandoff:()=>Promise<void>;registerClose:(key:string,guard:()=>Promise<void>)=>()=>void;closing:boolean;resumeEditing:()=>void;pending:DesktopSurface[];detachSurface:(surface:DesktopSurface,before?:()=>Promise<void>)=>Promise<DesktopWindowInfo>};
const Context=createContext<DesktopValue|null>(null);
export const useDesktop=()=>useContext(Context);
export const surfaceKey=desktopSurfaceKey;
function sameEditor(left:DesktopSurface,right:DesktopSurface){const artifact=(value:DesktopSurface)=>value.kind==='artifact'||value.kind==='workspace'&&value.tab==='artifact';return artifact(left)&&artifact(right)?'artifactId'in left&&'artifactId'in right&&left.artifactId===right.artifactId&&left.threadId===right.threadId:surfaceKey(left)===surfaceKey(right);}
export function useDetachedSurface(surface:DesktopSurface|null){const desktop=useDesktop();return desktop&&surface?desktop.windows.find(info=>info.id!==desktop.context.windowId&&sameEditor(info.surface,surface)):undefined;}
export function usePendingSurface(surface:DesktopSurface|null){const desktop=useDesktop();return Boolean(desktop&&surface&&desktop.pending.some(item=>sameEditor(item,surface)));}
export function useDesktopCloseGuard(key:string,guard:()=>Promise<void>){const desktop=useDesktop(),latest=useRef(guard);latest.current=guard;useEffect(()=>desktop?.registerClose(key,()=>latest.current()),[desktop?.registerClose,key]);}
export function useDesktopReady(ready:boolean){const desktop=useDesktop();useEffect(()=>{if(ready&&desktop)void desktop.bridge.ready().catch(()=>{});},[ready,desktop?.bridge]);}
export function DesktopProvider({bridge,context,children}:{bridge:DesktopBridge;context:DesktopContext;children:ReactNode}){
 const [state,setState]=useState<DesktopState>(context),[pending,setPending]=useState<DesktopSurface[]>([]),[closing,setClosing]=useState(false);const pendingKeys=useRef(new Set<string>());const guards=useRef(new Map<string,()=>Promise<void>>());
 const registerClose=useCallback((key:string,guard:()=>Promise<void>)=>{guards.current.set(key,guard);return()=>{if(guards.current.get(key)===guard)guards.current.delete(key);};},[]);
 useEffect(()=>bridge.onState(value=>{setState(value);if(value.closeCancelled)setClosing(false);}),[bridge]);
 const prepareHandoff=useCallback(async()=>{for(const guard of guards.current.values())await guard();},[]);
 useEffect(()=>bridge.onCloseRequested(async()=>{setClosing(true);try{await prepareHandoff();return true;}catch{setClosing(false);return false;}}),[bridge,prepareHandoff]);
 const detachSurface=useCallback(async(surface:DesktopSurface,before?:()=>Promise<void>)=>{const key=surfaceKey(surface);if(pendingKeys.current.has(key))throw new Error('This view is already moving to another window.');pendingKeys.current.add(key);setPending(value=>[...value,surface]);try{if(surface.kind==='thread'||surface.kind==='artifact'||surface.kind==='workspace'&&surface.tab==='artifact')await prepareHandoff();await before?.();return await bridge.detach(surface);}finally{pendingKeys.current.delete(key);setPending(value=>value.filter(item=>surfaceKey(item)!==key));}},[bridge,prepareHandoff]);
 const value=useMemo(()=>({bridge,context,...state,state,registerClose,prepareHandoff,pending,detachSurface,closing,resumeEditing:()=>setClosing(false)}),[bridge,context,state,registerClose,prepareHandoff,pending,detachSurface,closing]);
 return <Context value={value}>{children}</Context>;
}
export function DetachButton({surface,label,before,after,onError}:{surface:DesktopSurface;label:string;before?:()=>Promise<void>;after?:()=>void;onError?:(error:Error)=>void}){
 const desktop=useDesktop(),detached=useDetachedSurface(surface);const [busy,setBusy]=useState(false);if(!desktop)return null;
 return <button type="button" className="icon-button" aria-label={detached?`Focus detached ${label}`:`Detach ${label}`} title={detached?`Focus detached ${label}`:`Detach ${label}`} disabled={busy} onClick={()=>{setBusy(true);void(async()=>{if(detached){await desktop.bridge.focus(detached.id);return;}await desktop.detachSurface(surface,before);after?.();})().catch(cause=>onError?.(cause instanceof Error?cause:new Error('The desktop window could not open.'))).finally(()=>setBusy(false));}}><ExternalLink size={14}/></button>;
}
export function DesktopWindowActions(){const desktop=useDesktop();const [error,setError]=useState('');if(!desktop)return null;const run=(action:()=>Promise<unknown>)=>void action().catch(cause=>{desktop.resumeEditing();setError(cause instanceof Error?cause.message:'The window action failed.');});
 return <><div className="desktop-window-actions">{desktop.context.surface.kind!=='main'&&<button type="button" className="icon-button" aria-label="Dock window" title="Dock window" onClick={()=>run(()=>desktop.bridge.reattach())}><PanelLeftClose size={15}/></button>}<button type="button" className="icon-button" aria-label="Reset desktop window position" title="Reset desktop window position" onClick={()=>run(()=>desktop.bridge.resetBounds())}><RotateCcw size={14}/></button><button type="button" className="icon-button" aria-label={['main','thread'].includes(desktop.context.surface.kind)?'Minimize chat window':'Minimize window'} title="Minimize window" onClick={()=>run(()=>desktop.bridge.minimize())}><Minus size={16}/></button></div>{error&&<p role="alert" className="error-text">{error}</p>}</>;
}
