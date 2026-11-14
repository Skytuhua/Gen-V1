import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {ToolDock} from '../../../packages/ui-shell/ToolDock';
import {ChevronDown,ChevronUp,X} from 'lucide-react';
import type {FloatingWindowProps} from './FloatingWindow';
import {floatingLayoutKey,type FloatingLayout} from './floating-layout';
import {journalRead,journalWrite,registerEditorHandoff,retryJournalWrites} from './plugin-frame-client';
import './floating-window.css';
import './plugin-tools-dock.css';

function DockedWindow({layout,onLayout,notice,...props}:FloatingWindowProps&{layout:Partial<FloatingLayout>|null;onLayout:(layout:Partial<FloatingLayout>)=>void;notice:ReactNode}){
 const {id,title,children,open=true,onClose,defaultCollapsed=false,summary,collapsedLabel,minimizeLabel,ariaLabel,className='',escapeBehavior='close',focusOnOpen=true,expandRequest}=props;
 const [collapsed,setCollapsed]=useState(typeof layout?.collapsed==='boolean'?layout.collapsed:defaultCollapsed),disclosure=useRef<HTMLButtonElement>(null),shell=useRef<HTMLElement>(null),previousOpen=useRef(open),opener=useRef<HTMLElement|null>(null),bodyId=useId();
 const collapse=(value:boolean)=>{setCollapsed(value);onLayout({...layout,collapsed:value});disclosure.current?.focus({preventScroll:true});};
 // This effect's deps omit `layout`, so spreading it here could merge stale
 // fields over newer saved values; onLayout already merges into saved state.
 useLayoutEffect(()=>{if(expandRequest!==undefined&&open&&collapsed){setCollapsed(false);onLayout({collapsed:false});}},[expandRequest,open]);
 useLayoutEffect(()=>{
  if(open&&!previousOpen.current){opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;if(focusOnOpen)disclosure.current?.focus({preventScroll:true});}
  if(!open&&previousOpen.current&&shell.current?.contains(document.activeElement)&&opener.current?.isConnected)opener.current.focus({preventScroll:true});
  previousOpen.current=open;
 },[open,focusOnOpen]);
 return <section ref={shell} hidden={!open} className={`floating-window plugin-tool-window ${className}`} data-floating-id={id} data-floating="false" data-collapsed={collapsed} aria-label={ariaLabel??`${title} window`} onKeyDown={event=>{
  if(event.defaultPrevented||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||event.key!=='Escape')return;
  event.preventDefault();event.stopPropagation();if(props.minimizeOnly||escapeBehavior==='collapse'&&!collapsed)collapse(true);else onClose?.();
 }}>
  <div className="floating-window-header" data-compact={collapsed}>
   <button ref={disclosure} type="button" className="floating-window-summary" aria-label={collapsed?(collapsedLabel??`Expand ${title}`):(minimizeLabel??`Minimize ${title}`)} aria-expanded={!collapsed} aria-controls={bodyId} onClick={()=>collapse(!collapsed)}><strong>{title}</strong>{collapsed&&summary}{collapsed?<ChevronUp size={13} aria-hidden="true"/>:<ChevronDown size={13} aria-hidden="true"/>}</button>
   {!props.minimizeOnly&&onClose&&<button type="button" className="floating-window-control" aria-label={`Close ${title}`} onClick={onClose}><X size={13} aria-hidden="true"/></button>}
  </div>
  {notice}
  <div id={bodyId} className="floating-window-body" hidden={collapsed}><div className="floating-window-content">{children}</div></div>
 </section>;
}

/** Recover before mounting: opaque frames cannot use the personal browser's
 * localStorage. Retain legacy placement fields, but only present bounded docks. */
export function PluginFloatingWindow(props:FloatingWindowProps){
 const [recovery,setRecovery]=useState<{id:string;layout:Partial<FloatingLayout>|null}>(),[error,setError]=useState(''),[retryRecovery,setRetryRecovery]=useState(0),saved=useRef<Partial<FloatingLayout>|null>(null),pending=useRef(Promise.resolve()),recovered=useRef(false);
 const key=floatingLayoutKey(props.id);
 useEffect(()=>{let alive=true;recovered.current=false;setError('');void journalRead<Partial<FloatingLayout>>(key).then(layout=>{if(alive){saved.current=layout??null;recovered.current=true;setRecovery({id:props.id,layout});}}).catch(()=>{if(alive)setError('The saved window placement could not be recovered. Keep this view open and retry.');});return()=>{alive=false;recovered.current=false;};},[key,props.id,retryRecovery]);
 // Failed writes remain in the SDK's intent journal. Let its flush check the
 // current intent after an explicit retry, rather than retaining an old rejection.
 useEffect(()=>registerEditorHandoff('floating:'+props.id,async()=>{if(!recovered.current)throw Error('Window placement has not recovered.');await pending.current.catch(()=>{});}),[props.id]);
 const write=useCallback((layout:Partial<FloatingLayout>)=>{saved.current={...saved.current,...layout};setRecovery({id:props.id,layout:saved.current});const value=saved.current,write=pending.current.catch(()=>{}).then(()=>journalWrite(key,value));pending.current=write;void write.catch(()=>setError('Window placement could not be saved. Keep this view open.'));},[key,props.id]);
 const hasRecovered=recovery?.id===props.id,preferredWidth=(hasRecovered?recovery.layout?.width:undefined)??props.defaultSize?.width??400;
 const width=Number.isFinite(preferredWidth)?Math.max(280,Math.min(720,preferredWidth)):400;
 const notice=error&&<p role="alert">{error} {hasRecovered?<button type="button" onClick={()=>{void retryJournalWrites().then(()=>setError(''),()=>setError('Window placement could not be saved. Keep this view open.'));}}>Retry saving</button>:<button type="button" onClick={()=>setRetryRecovery(value=>value+1)}>Retry recovery</button>}</p>;
 // A loading dock would expose a fallback split that recovery can replace.
 // Mount only once the read settles; failures retain the default-width retry UI.
 if(!hasRecovered&&!error)return null;
 return <ToolDock width={width}>{hasRecovered?<DockedWindow key={props.id} {...props} layout={recovery.layout} onLayout={write} notice={notice}/>:<section hidden={props.open===false} className="floating-window plugin-tool-window" data-collapsed="false" aria-label={props.ariaLabel??`${props.title} window`}><div className="floating-window-header"><strong className="floating-window-title">{props.title}</strong></div>{notice}</section>}</ToolDock>;
}
