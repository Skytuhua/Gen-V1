import {createContext,useEffect,useId,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {CheckCircle2,ChevronDown,ChevronUp,CircleAlert,LoaderCircle,X} from 'lucide-react';
import {observeMotionPolicy,readMotionPolicy,type MotionPolicy} from './motion-policy';
import {Popover} from '../../../packages/ui-shell/Popover';
import {visibleNotifications,type WorkspaceNotification,type WorkspaceNotificationStore} from './workspace-notifications';
import './workspace-notifications.css';

export const WorkspaceNotificationContext=createContext<WorkspaceNotificationStore|null>(null);

function Notification({entry,store,motion,dismiss}:{entry:WorkspaceNotification;store:WorkspaceNotificationStore;motion:MotionPolicy;dismiss:(id:number)=>void}){
 const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),card=useRef<HTMLElement>(null);
 const title=entry.title??entry.message,success=entry.status==='success',busy=entry.status==='retrying';
 // No blur event fires when the focused control unmounts (retry→success), so re-derive the flag from actual DOM focus.
 useLayoutEffect(()=>{if(focused&&card.current&&!card.current.contains(document.activeElement))setFocused(false);});
 useEffect(()=>{
  if(entry.leaving){const timer=setTimeout(()=>store.remove(entry.id),motion==='off'?0:motion==='reduced'?100:160);return()=>clearTimeout(timer);}
  if(success&&!hovered&&!focused){const timer=setTimeout(()=>store.dismiss(entry.id),2000);return()=>clearTimeout(timer);}
 },[entry.id,entry.leaving,entry.revision,success,hovered,focused,motion,store]);
 const Icon=success?CheckCircle2:busy?LoaderCircle:CircleAlert;
 return <div className="workspace-notification-slot" data-leaving={entry.leaving}>
  <article ref={card} className="workspace-notification" role="alert" aria-live="polite" aria-atomic="true" aria-busy={busy} data-status={entry.status}
   onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}>
   <Icon size={16} className={busy?'workspace-notification-icon spinning':'workspace-notification-icon'} aria-hidden="true"/>
   <div className="workspace-notification-copy"><strong>{success?'Recovered':title}</strong>{(entry.title||success)&&<span>{success?title:entry.message}</span>}</div>
   {entry.retry&&!success&&<button type="button" className="workspace-notification-retry" disabled={busy||entry.leaving} aria-label={`Retry ${title}`} onClick={()=>void store.retry(entry.id)}>{busy?'Retrying…':'Retry'}</button>}
   <button type="button" className="workspace-notification-dismiss" disabled={entry.leaving} aria-label={`Dismiss ${title}`} onClick={()=>dismiss(entry.id)}><X size={14} aria-hidden="true"/></button>
  </article>
 </div>;
}

export function WorkspaceNotifications({store}:{store:WorkspaceNotificationStore}){
 const entries=useSyncExternalStore(store.subscribe,store.getSnapshot),[open,setOpen]=useState(true),[expanded,setExpanded]=useState(false),[motion,setMotion]=useState(readMotionPolicy);
 const trigger=useRef<HTMLButtonElement>(null),panelId=useId(),listId=useId();
 const returnFocus=useRef<HTMLElement|null>(null),previousCount=useRef(0);
 useLayoutEffect(()=>{
  if(entries.length&&!previousCount.current)returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  previousCount.current=entries.length;
 },[entries.length]);
 const dismiss=(id:number)=>{
  const target=entries.filter(entry=>!entry.leaving).length===1?returnFocus.current:trigger.current;
  store.dismiss(id);if(target?.isConnected)target.focus();
 };
 const [body,setBody]=useState<HTMLDivElement|null>(null),[height,setHeight]=useState(200);
 useLayoutEffect(()=>{
  if(!body)return;
  const measure=()=>setHeight(Math.ceil(body.getBoundingClientRect().height)+10);
  measure();const observer=new ResizeObserver(measure);observer.observe(body);return()=>observer.disconnect();
 },[body]);
 useEffect(()=>observeMotionPolicy(setMotion),[]);
 const active=entries.filter(entry=>!entry.leaving),count=active.length,hidden=Math.max(0,entries.length-3);
 useEffect(()=>{if(!entries.length){setExpanded(false);setOpen(true);}},[entries.length]);
 // Retain exiting cards while minimized too, so their timers always finish.
 const visible=visibleNotifications(entries,expanded);
 const cards=visible.map(entry=><Notification key={entry.id} entry={entry} store={store} motion={motion} dismiss={dismiss}/>);
 if(!entries.length)return null;
 return <section className="workspace-notifications" aria-label="Workspace notifications" data-motion={motion}>
  <div className="workspace-notifications-toolbar"><button ref={trigger} type="button" aria-controls={panelId} aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Hide':'Show'} notifications ({count}){open?<ChevronUp size={12}/>:<ChevronDown size={12}/>}</button></div>
  {!open&&<span className="sr-only" role="status" aria-live="polite">{active[0]?.message}</span>}
  <Popover anchor={trigger} id={panelId} className="workspace-notifications-panel" role="region" aria-label="Workspace errors" data-motion={motion} open={open} present={open} width={336} height={height} preferredSide="below" align="end" onDismiss={()=>{}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
   <div ref={setBody}>
   <div id={listId} className="workspace-notifications-list" tabIndex={expanded?0:undefined} aria-label={expanded?'All workspace notifications':undefined}>
    {cards}
   </div>
   {entries.length>3&&<button className="workspace-notifications-overflow" type="button" aria-expanded={expanded} aria-controls={listId} onClick={()=>setExpanded(value=>!value)}>{expanded?'Show fewer':`+${hidden} more`}{expanded?<ChevronUp size={12}/>:<ChevronDown size={12}/>}</button>}
   </div>
  </Popover>
  {!open&&<div hidden>{cards}</div>}
  {!expanded&&entries.slice(3).map(entry=><div hidden key={entry.id}><Notification entry={entry} store={store} motion={motion} dismiss={dismiss}/></div>)}
 </section>;
}
