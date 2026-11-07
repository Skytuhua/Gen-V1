import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {DesktopBridge,DesktopContext,DesktopState,DesktopSurface,DesktopWindowInfo} from '../../../packages/desktop-contract/index';
import {desktopSurfaceKey} from '../../../packages/desktop-contract/index';
import {prepareEditorHandoff,registerEditorHandoff} from './editor-handoff';
import './native-chrome.css';

declare global {interface Window {harnessDesktop?:DesktopBridge}}
type DesktopValue={bridge:DesktopBridge;context:DesktopContext;windows:DesktopWindowInfo[];browser?:DesktopState['browser'];state:DesktopState;prepareHandoff:()=>Promise<void>;registerClose:(key:string,guard:()=>Promise<void>)=>()=>void;closing:boolean;resumeEditing:()=>void;pending:DesktopSurface[];detachSurface:(surface:DesktopSurface,before?:()=>Promise<void>)=>Promise<DesktopWindowInfo>};
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
export function DesktopProvider({bridge,context,children}:{bridge:DesktopBridge;context:DesktopContext;children:ReactNode}){
 useLayoutEffect(()=>{if(!context.nativeTitleBar)return;document.documentElement.dataset.nativeTitlebar='true';const sync=()=>{const theme=document.documentElement.dataset.theme;if(theme==='light'||theme==='dark')void bridge.setTheme?.(theme).catch(()=>{});};const observer=new MutationObserver(sync);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});sync();return()=>{observer.disconnect();delete document.documentElement.dataset.nativeTitlebar;};},[bridge,context.nativeTitleBar]);
 const [state,setState]=useState<DesktopState>(context),[pending]=useState<DesktopSurface[]>([]),[closing,setClosing]=useState(false);
 const registerClose=registerEditorHandoff;
 useEffect(()=>bridge.onState(value=>{setState(value);if(value.closeCancelled)setClosing(false);}),[bridge]);
 const prepareHandoff=prepareEditorHandoff;
 useEffect(()=>bridge.onCloseRequested(async()=>{setClosing(true);try{await prepareHandoff();return true;}catch{setClosing(false);return false;}}),[bridge,prepareHandoff]);
 const detachSurface=useCallback(async(surface:DesktopSurface)=>{const existing=state.windows.find(info=>surfaceKey(info.surface)===surfaceKey(surface));if(!existing)throw Error('Opening detached views is currently unavailable.');await bridge.focus(existing.id);return existing;},[bridge,state.windows]);
 const value=useMemo(()=>({bridge,context,...state,state,registerClose,prepareHandoff,pending,detachSurface,closing,resumeEditing:()=>setClosing(false)}),[bridge,context,state,registerClose,prepareHandoff,pending,detachSurface,closing]);
 return <Context value={value}>{children}</Context>;
}
/** Retained for source compatibility; detachment has no presentation entry. */
export function DetachButton(_props:{surface:DesktopSurface;label:string;before?:()=>Promise<void>;after?:()=>void;onError?:(error:Error)=>void}){return null;}
/** Recovery is offered only for a child that already owns saved work. */
export function DesktopWindowActions(){const desktop=useDesktop(),[error,setError]=useState('');if(!desktop||desktop.context.surface.kind==='main')return null;
 return <><button type="button" className="quiet" onClick={()=>{void desktop.bridge.reattach().catch(cause=>{desktop.resumeEditing();setError(cause instanceof Error?cause.message:'The view could not return. Keep it open and retry.');});}}>Return to workspace</button>{error&&<p role="alert">{error}</p>}</>;
}
