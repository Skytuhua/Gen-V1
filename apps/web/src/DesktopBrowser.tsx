import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,LoaderCircle,RotateCcw,Square,X} from 'lucide-react';
import type {DesktopBrowserBoundsResult,DesktopBrowserState,DesktopBrowserWidthPreset} from '../../../packages/desktop-contract';
import {DesktopWindowActions,useDesktop} from './desktop-context';
import {browserSlotRect} from './browser-slot-bounds';

const PREVIEW_PRESETS=['fit',390,768] as const;
interface BrowserSizing {
 preset:DesktopBrowserWidthPreset;
 availability:{390:boolean;768:boolean}|undefined;
 readout:string;
 reason:string;
 stale:boolean;
 onSelect:(preset:DesktopBrowserWidthPreset)=>void;
}
interface BrowserSlotSizing {
 preset:DesktopBrowserWidthPreset;
 nonce:number;
 reason:string;
 onResult:(result:DesktopBrowserBoundsResult,sequence:number,empty:boolean)=>void;
 onError:(sequence:number)=>void;
}
const formatWidth=(width:number)=>Number(width.toFixed(2));

export function DesktopBrowserToolbar({state,detached=false,sizing}:{state?:DesktopBrowserState;detached?:boolean;sizing?:BrowserSizing}){
 const desktop=useDesktop(),[url,setUrl]=useState(state?.url??''),[error,setError]=useState('');useEffect(()=>setUrl(state?.url==='about:blank'?'':state?.url??''),[state?.url]);
 const actionSequence=useRef(0);
 const run=(action:()=>Promise<unknown>)=>{const sequence=++actionSequence.current;void action().then(()=>{if(sequence===actionSequence.current)setError('');},cause=>{if(sequence===actionSequence.current)setError(cause instanceof Error?cause.message:'Browser action failed.');});};
 const fitButton=useRef<HTMLButtonElement>(null),p390=useRef<HTMLButtonElement>(null),p768=useRef<HTMLButtonElement>(null);
 const availability=sizing?.availability;
 useEffect(()=>{if(!availability)return;for(const [preset,ref]of [[390,p390],[768,p768]]as const)if(availability[preset]===false&&ref.current===document.activeElement)fitButton.current?.focus();},[availability]);
 return <div className="desktop-browser-toolbar"><header>{error||state?.error?<p role="alert" className="error-text" title={error||state?.error}>{error||state?.error}</p>:<strong>{state?.title||'Browser'}</strong>}
  {sizing&&<span className="browser-width"><span className="segmented" role="group" aria-label="Preview width" aria-describedby={sizing.reason?'browser-width-reason':undefined}>{PREVIEW_PRESETS.map(preset=><button key={preset} type="button" ref={preset==='fit'?fitButton:preset===390?p390:p768} aria-pressed={sizing.preset===preset} disabled={preset!=='fit'&&sizing.availability?.[preset]===false} onClick={()=>sizing.onSelect(preset)}>{preset==='fit'?'Fit':preset}</button>)}</span><span className={`browser-width-readout${sizing.stale?' stale':''}`} role="status">{sizing.readout}</span></span>}
  {detached?<DesktopWindowActions/>:desktop?.state.dockedBrowser?<button type="button" className="icon-button browser-close" aria-label="Close browser" title="Close browser" onClick={()=>desktop&&run(()=>desktop.bridge.browser({type:'close'}))}><X size={15}/></button>:null}
  {sizing?.reason&&<span id="browser-width-reason" className="browser-width-reason">{sizing.reason}</span>}
 </header><form onSubmit={event=>{event.preventDefault();if(desktop)run(()=>desktop.bridge.browser({type:'navigate',url}));}}><button type="button" className="icon-button" aria-label="Browser back" disabled={!state?.canGoBack} onClick={()=>desktop&&run(()=>desktop.bridge.browser({type:'back'}))}><ArrowLeft size={15}/></button><button type="button" className="icon-button" aria-label="Browser forward" disabled={!state?.canGoForward} onClick={()=>desktop&&run(()=>desktop.bridge.browser({type:'forward'}))}><ArrowRight size={15}/></button><button type="button" className="icon-button" aria-label={state?.loading?'Stop browser loading':'Reload browser'} onClick={()=>desktop&&run(()=>desktop.bridge.browser({type:state?.loading?'stop':'reload'}))}>{state?.loading?<Square size={13}/>:<RotateCcw size={14}/>}</button><input aria-label="Browser address" placeholder="Enter a website address" value={url} onChange={event=>setUrl(event.target.value)}/><button className="quiet" type="submit">Go</button>{state?.loading&&<LoaderCircle size={13} className="spinning"/>}</form></div>;
}
export function DesktopBrowserSurface(){const desktop=useDesktop();return <main className="desktop-browser-surface"><DesktopBrowserToolbar state={desktop?.browser} detached/><div className="desktop-browser-native" aria-label="Isolated browser content"/></main>;}
export function DesktopBrowserSlot({sizing}:{sizing?:BrowserSlotSizing}={}){
 const desktop=useDesktop(),bounds=useRef<HTMLDivElement>(null),docked=desktop?.state.dockedBrowser;
 const latest=useRef(sizing);latest.current=sizing;
 const tick=useRef<(()=>void)|undefined>(undefined);
 useEffect(()=>{tick.current?.();},[sizing?.preset,sizing?.nonce]);
 useLayoutEffect(()=>{if(!desktop||!docked||!bounds.current)return;let frame=0,last='',sequence=0;const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const element=bounds.current;if(!element)return;const rect=element.getBoundingClientRect(),{left,top,right,bottom}=browserSlotRect(rect,{width:innerWidth,height:innerHeight},[...document.querySelectorAll('.panel-resizer,.split-divider')].map(node=>node.getBoundingClientRect()));const suppressed=Boolean(document.querySelector('dialog[open],.artifact-expanded,[aria-modal="true"],.workspace-menu,.ui-popover'))||Boolean(element.closest('[inert],[hidden]'))||document.documentElement.classList.contains('workspace-canvas-interaction'),empty=right<=left||bottom<=top;const points=[[left+1,top+1],[right-1,top+1],[left+1,bottom-1],[right-1,bottom-1],[(left+right)/2,(top+bottom)/2]];const occluded=!suppressed&&!empty&&points.some(([x,y])=>{const hit=document.elementFromPoint(x,y);return hit&&!element.contains(hit);});const value=suppressed||empty||occluded?{x:0,y:0,width:0,height:0}:{x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)},current=latest.current,key=JSON.stringify([devicePixelRatio,value,current?.preset??'',current?.nonce??0]);if(key!==last){last=key;const request=++sequence;void desktop.bridge.browser({type:'bounds',bounds:value,...(current?{widthPreset:current.preset}:{})}).then(result=>{if(current&&result&&typeof result==='object')current.onResult(result,request,empty);}).catch(()=>{last='';if(current)current.onError(request);});}});};tick.current=update;const observer=new ResizeObserver(update);observer.observe(bounds.current);const mutations=new MutationObserver(update);mutations.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['inert','open','class','hidden','style']});window.addEventListener('resize',update);window.addEventListener('scroll',update,true);window.addEventListener('harness:canvas-layout',update);update();return()=>{cancelAnimationFrame(frame);tick.current=undefined;observer.disconnect();mutations.disconnect();window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);window.removeEventListener('harness:canvas-layout',update);void desktop.bridge.browser({type:'bounds',bounds:{x:0,y:0,width:0,height:0}}).catch(()=>{});};},[desktop,docked?.browserId]);
 const measured=<div ref={bounds} className="desktop-browser-native" aria-label="Isolated browser content"/>;
 if(!sizing)return measured;
 return <div className="desktop-browser-slot">{sizing.reason&&<p className="browser-preview-note">{sizing.reason}</p>}{measured}</div>;
}
export function DesktopBrowserDock(){
 const desktop=useDesktop(),docked=desktop?.state.dockedBrowser,browserId=docked?.browserId;
 const [preset,setPreset]=useState<DesktopBrowserWidthPreset>('fit');
 const [ack,setAck]=useState<DesktopBrowserBoundsResult>();
 const [availability,setAvailability]=useState<{390:boolean;768:boolean}>();
 const [updating,setUpdating]=useState(false);
 const [stale,setStale]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const [nonce,setNonce]=useState(0);
 const lastSequence=useRef(0);
 useEffect(()=>{setPreset('fit');setAck(undefined);setAvailability(undefined);setUpdating(false);setStale(false);setNotice('');setError('');lastSequence.current=0;},[browserId]);
 const onResult=useCallback((result:DesktopBrowserBoundsResult,sequence:number,empty:boolean)=>{
  if(sequence<lastSequence.current)return;lastSequence.current=sequence;
  setAck(result);setUpdating(false);setStale(false);setError('');
  if(!result.hidden)setAvailability(result.availability);
  setPreset(current=>{
   if(result.hidden)return empty?'fit':current;
   if(result.effective!==current){if(current!=='fit'&&result.effective==='fit')setNotice(`${current} px no longer fits. Switched to Fit.`);return result.effective;}
   return current;
  });
 },[]);
 const onError=useCallback((sequence:number)=>{if(sequence<lastSequence.current)return;setUpdating(false);setStale(true);setError('Preview size could not be updated');},[]);
 const select=useCallback((next:DesktopBrowserWidthPreset)=>{setPreset(next);setNotice('');setError('');setStale(false);setUpdating(true);setNonce(count=>count+1);},[]);
 const reason=error||(availability&&ack?([390,768] as const).filter(p=>availability[p]===false).map(p=>`${p} px needs ${p} px; available ${Math.floor(ack.availableWidth)} px`).join('; '):'');
 const readout=updating?'Updating':ack?.hidden?'Preview hidden':ack?(preset==='fit'?`Fit · ${formatWidth(ack.actualWidth)} px actual`:`${formatWidth(ack.actualWidth)} px actual`) + (stale?' (stale)':''):'';
 const sizing:BrowserSizing={preset,availability,readout,reason:reason||notice,stale,onSelect:select};
 if(!docked)return null;
 return <section className="desktop-browser-dock" aria-label="Docked browser"><DesktopBrowserToolbar state={docked.state} sizing={sizing}/><DesktopBrowserSlot sizing={{preset,nonce,reason:sizing.reason,onResult,onError}}/>
  {ack&&!ack.hidden&&ack.ownerBounds.width>0&&<div className="browser-preview-edges" aria-hidden="true" style={{left:Math.max(0,ack.ownerBounds.x-1),top:ack.ownerBounds.y,width:ack.ownerBounds.width+2,height:ack.ownerBounds.height}}/>}
  {notice&&<span className="browser-width-notice" role="status">{notice}</span>}
 </section>;
}
