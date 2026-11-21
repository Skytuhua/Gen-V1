import {useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ToolDock} from '../../../packages/ui-shell/ToolDock';
import {ChevronDown,ChevronUp,X} from 'lucide-react';
import type {FloatingWindowProps} from './FloatingWindow';
import {floatingLayoutKey,type FloatingLayout} from './floating-layout';
import {journalLocalIntent,journalReadRetainingIntent,journalWrite,registerEditorHandoff,retryJournalWrites} from './plugin-frame-client';
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
 * browser storage. Retain legacy placement fields, but only present bounded docks. */
export function PluginFloatingWindow(props:FloatingWindowProps){
 const currentOwner=useMemo(()=>({id:props.id}),[props.id]),owner=useRef<typeof currentOwner|null>(currentOwner);
 useLayoutEffect(()=>{owner.current=currentOwner;},[currentOwner]);
 const [recovery,setRecovery]=useState<{owner:typeof currentOwner;layout:Partial<FloatingLayout>|null}>(),[failure,setFailure]=useState<{owner:typeof currentOwner;message:string}|null>(null),[retryRecovery,setRetryRecovery]=useState(0),saved=useRef<Partial<FloatingLayout>|null>(null),pending=useRef(Promise.resolve()),recovered=useRef(false);
 const error=failure?.owner===currentOwner?failure.message:'',setError=(message:string)=>setFailure(message?{owner:currentOwner,message}:null);
 const key=floatingLayoutKey(props.id);
 useEffect(()=>{
  let alive=true;recovered.current=false;setError('');
  void journalReadRetainingIntent<Partial<FloatingLayout>>(key).then(layout=>{
   if(!alive||owner.current!==currentOwner)return;
   const journal=journalLocalIntent<Partial<FloatingLayout>>(key);
   saved.current=journal?.value??layout??null;recovered.current=true;setRecovery({owner:currentOwner,layout:saved.current});
   if(journal&&!journal.pending)setError('Window placement could not be saved. Keep this view open.');
   if(journal?.pending)void journal.pending.catch(()=>{if(alive&&owner.current===currentOwner&&journalLocalIntent(key)?.identity===journal.identity)setError('Window placement could not be saved. Keep this view open.');});
  }).catch(()=>{if(alive&&owner.current===currentOwner)setError('The saved window placement could not be recovered. Keep this view open and retry.');});
  return()=>{alive=false;recovered.current=false;};
 },[key,props.id,retryRecovery,currentOwner]);
 // Failed writes remain in the SDK's intent journal. Let its flush check the
 // current intent after an explicit retry, rather than retaining an old rejection.
 // Suspense replays layout effects while the journal and handoff remain live.
 useEffect(()=>{
  const unregister=registerEditorHandoff('floating:'+props.id,async()=>{if(owner.current!==currentOwner||!recovered.current)throw Error('Window placement has not recovered.');await pending.current.catch(()=>{});if(owner.current!==currentOwner||!recovered.current)throw Error('Window placement has changed.');});
  return()=>{if(owner.current===currentOwner)owner.current=null;unregister();};
 },[props.id,currentOwner]);
 const write=useCallback((layout:Partial<FloatingLayout>)=>{
  if(owner.current!==currentOwner)return;
  saved.current={...saved.current,...layout};setRecovery({owner:currentOwner,layout:saved.current});
  const write=journalWrite(key,saved.current),intent=journalLocalIntent(key);
  pending.current=Promise.all([pending.current.catch(()=>{}),write]).then(()=>{});void pending.current.catch(()=>{});
  void write.then(()=>{
   const latest=journalLocalIntent(key);
   if(intent&&owner.current?.id===props.id&&recovered.current&&(!latest||latest.identity===intent.identity))setFailure(null);
  },()=>{
   if(intent&&owner.current?.id===props.id&&recovered.current&&journalLocalIntent(key)?.identity===intent.identity)setFailure({owner:owner.current,message:'Window placement could not be saved. Keep this view open.'});
  });
 },[key,props.id,currentOwner]);
 const hasRecovered=recovery?.owner===currentOwner,preferredWidth=(hasRecovered?recovery.layout?.width:undefined)??props.defaultSize?.width??400;
 const width=Number.isFinite(preferredWidth)?Math.max(280,Math.min(720,preferredWidth)):400;
 const retrySave=()=>{
  const retry=retryJournalWrites(),intent=journalLocalIntent(key);
  const success=()=>{const latest=journalLocalIntent(key);if(owner.current===currentOwner&&(!latest||latest.identity===intent?.identity))setError('');};
  const failed=()=>{if(intent&&owner.current===currentOwner&&journalLocalIntent(key)?.identity===intent.identity)setError('Window placement could not be saved. Keep this view open.');};
  void retry.then(success,()=>{
   const latest=journalLocalIntent(key);if(owner.current!==currentOwner)return;
   if(!latest)success();else if(intent&&latest.identity===intent.identity){if(latest.pending)void latest.pending.then(success,failed);else failed();}
  });
 };
 const notice=error&&<p role="status">{error} {hasRecovered?<button type="button" onClick={retrySave}>Retry saving</button>:<button type="button" onClick={()=>setRetryRecovery(value=>value+1)}>Retry recovery</button>}</p>;
 // A loading dock would expose a fallback split that recovery can replace.
 // Mount only once the read settles; failures retain the default-width retry UI.
 if(!hasRecovered&&!error)return null;
 return <ToolDock width={width}>{hasRecovered?<DockedWindow key={props.id} {...props} layout={recovery.layout} onLayout={write} notice={notice}/>:<section hidden={props.open===false} className="floating-window plugin-tool-window" data-collapsed="false" aria-label={props.ariaLabel??`${props.title} window`}><div className="floating-window-header"><strong className="floating-window-title">{props.title}</strong></div>{notice}</section>}</ToolDock>;
}
