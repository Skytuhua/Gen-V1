import {useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent,type PointerEvent,type ReactNode} from 'react';
import {GripVertical,Maximize2,PanelRight,Unplug} from 'lucide-react';
import {CHAT_EDGES,CHAT_TRANSITION_MS,chatBounds,chatPanelRect,clampChatRect,isChatDockTarget,readChatLayout,resizeChatRect,writeChatLayout,type ChatEdge,type ChatLayout,type ChatRect,type ChatViewport} from './chat-layout';
import './chat-view.css';

const edgeNames:Record<ChatEdge,string>={n:'top',e:'right',s:'bottom',w:'left',ne:'top right',nw:'top left',se:'bottom right',sw:'bottom left'};
const rectOf=(element:HTMLElement):ChatRect=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
function viewport():ChatViewport{
 return {width:window.innerWidth,height:window.innerHeight,top:document.documentElement.dataset.nativeTitlebar==='true'?62:20};
}
function storage(){try{return localStorage;}catch{return undefined;}}
const motionAllowed=()=>!matchMedia('(prefers-reduced-motion: reduce)').matches&&!['off','reduced'].includes(document.documentElement.dataset.motion??'');

/** Keeps saved conversation-window geometry while preserving one live subtree. */
export function ChatView({header,actions,children,enabled=true}:{header:ReactNode;actions?:ReactNode;children:ReactNode;enabled?:boolean}){
 const [layout,setLayout]=useState<ChatLayout>(()=>enabled?readChatLayout(storage()):{mode:'full',detached:false});
 const current=useRef(layout),slot=useRef<HTMLDivElement>(null),panel=useRef<HTMLElement>(null),animation=useRef<Animation|null>(null);
 const pending=useRef<ChatRect|null>(null),instant=useRef(false),stop=useRef<((cancel?:boolean)=>void)|null>(null);
 const [tracking,setTracking]=useState(false),[dockTarget,setDockTarget]=useState(false),[announcement,setAnnouncement]=useState('');
 const snap=useRef<HTMLDivElement>(null),rememberedFocus=useRef<HTMLElement|null>(null);
 const floating=layout.mode!=='full';
 const apply=(rect:ChatRect,fixed:boolean)=>{
  const element=panel.current;if(!element)return;
  Object.assign(element.style,{position:fixed?'fixed':'absolute',left:'0px',top:'0px',width:`${rect.width}px`,height:`${rect.height}px`,transform:fixed?`translate3d(${rect.x}px,${rect.y}px,0)`:'none'});
 };
 const focusChat=()=>{
  const element=panel.current,previous=rememberedFocus.current;
  if(previous?.isConnected&&element?.contains(previous))previous.focus({preventScroll:true});
  else (element?.querySelector<HTMLElement>('textarea:not(:disabled)')??element?.querySelector<HTMLElement>('.conversation-scroll'))?.focus({preventScroll:true});
 };
 const commit=(next:ChatLayout,immediate=false,focus=true)=>{
  stop.current?.();pending.current=panel.current?rectOf(panel.current):null;instant.current=immediate;
  current.current={...next};setLayout(current.current);writeChatLayout(next,storage());
  if(focus)focusChat();
 };
 const dock=(immediate=false)=>{
  const saved=current.current,area=chatBounds(viewport()),rect=chatPanelRect({...saved,mode:'drawer'},viewport());
  commit({...saved,mode:'drawer',detached:false,drawer:{...rect,x:area.right-rect.width,y:area.top}},immediate);setAnnouncement('Chat docked to the right');
 };
 const detach=(immediate=false)=>{
  const next={...current.current,mode:'popup' as const,detached:true};
  // The compact remembered pop-up is reachable from either docked layout.
  commit(next,immediate);setAnnouncement('Chat detached. Drag its header or use the arrow keys to move it.');
 };
 useLayoutEffect(()=>{
  const element=panel.current,owner=slot.current;if(!element||!owner)return;
  const before=pending.current;pending.current=null;animation.current?.cancel();
  const rect=layout.mode==='full'?{x:0,y:0,width:owner.clientWidth,height:owner.clientHeight}:chatPanelRect(layout,viewport());
  apply(rect,layout.mode!=='full');
  if(!before||instant.current||!motionAllowed()){instant.current=false;return;}
  const after=rectOf(element),base=layout.mode==='full'?'':`translate3d(${rect.x}px,${rect.y}px,0) `;
  // Commit target dimensions once; animate position without stretching readable content.
  const effect=element.animate([
   {transform:`${base}translate(${before.x-after.x}px,${before.y-after.y}px)`},
   {transform:element.style.transform},
  ],{duration:CHAT_TRANSITION_MS,easing:getComputedStyle(element).getPropertyValue('--ui-ease-enter').trim()||'cubic-bezier(.16,1,.3,1)'});
  animation.current=effect;effect.onfinish=()=>{effect.cancel();if(animation.current===effect)animation.current=null;};
 },[layout]);
 useEffect(()=>{
  const resize=()=>{
   stop.current?.(true);animation.current?.cancel();
   if(!panel.current||!slot.current)return;
   const saved=current.current;
   apply(saved.mode==='full'?{x:0,y:0,width:slot.current.clientWidth,height:slot.current.clientHeight}:chatPanelRect(saved,viewport()),saved.mode!=='full');
  };
  const observer=new ResizeObserver(resize);if(slot.current)observer.observe(slot.current);
  window.addEventListener('resize',resize);
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const reduce=()=>{if(!motionAllowed())animation.current?.cancel();};
  media.addEventListener('change',reduce);const policy=new MutationObserver(reduce);policy.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
  return()=>{stop.current?.(true);animation.current?.cancel();observer.disconnect();policy.disconnect();window.removeEventListener('resize',resize);media.removeEventListener('change',reduce);};
 },[]);
 const saveRect=(rect:ChatRect,detached=current.current.detached)=>{
  const saved=current.current,mode=saved.mode==='full'?'popup':saved.mode;
  commit({...saved,mode,detached,[mode]:rect},true,false);
 };
 const begin=(event:PointerEvent<HTMLElement>,edge?:ChatEdge)=>{
  if(!enabled||event.button!==0||!event.isPrimary||stop.current||!panel.current||current.current.mode==='full')return;
  if(!edge&&event.currentTarget.tagName==='HEADER'&&(event.target as HTMLElement).closest('button,input,textarea,a,[role="menu"]'))return;
  event.preventDefault();const element=panel.current,target=event.currentTarget,start=rectOf(element),saved=current.current;
  animation.current?.cancel();animation.current=null;apply(start,true);
  const origin={x:event.clientX,y:event.clientY},pointerId=event.pointerId;let latest=start,frame=0,atDock=false,moved=false;
  target.setPointerCapture(pointerId);setTracking(true);if(!edge)setDockTarget(true);
  target.focus({preventScroll:true});
  const draw=()=>{
   frame=0;apply(latest,true);
   if(snap.current)snap.current.dataset.active=String(atDock);
  };
  const move=(e:globalThis.PointerEvent)=>{
   if(e.pointerId!==pointerId)return;
   const dx=e.clientX-origin.x,dy=e.clientY-origin.y;moved ||= Math.abs(dx)+Math.abs(dy)>3;
   latest=edge?resizeChatRect(start,edge,dx,dy,viewport()):clampChatRect({...start,x:start.x+dx,y:start.y+dy},viewport());
   atDock=!edge&&moved&&isChatDockTarget(e.clientX,e.clientY,viewport());
   if(!frame)frame=requestAnimationFrame(draw);
  };
  const finish=(cancel=false)=>{
   cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancelled);target.removeEventListener('lostpointercapture',cancelled);window.removeEventListener('keydown',escape,true);window.removeEventListener('blur',blur);
   stop.current=null;if(target.hasPointerCapture(pointerId))target.releasePointerCapture(pointerId);
   setTracking(false);setDockTarget(false);draw();
   if(cancel){commit(saved,true,false);return;}
   if(atDock){dock();return;}
   saveRect(latest,edge?saved.detached:moved||saved.detached);
  };
  const end=(e:globalThis.PointerEvent)=>{if(e.pointerId===pointerId){move(e);finish();}};
  const cancelled=(e:globalThis.PointerEvent)=>{if(e.pointerId===pointerId)finish(true);};
  const blur=()=>finish(true);
  const escape=(e:globalThis.KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();e.stopPropagation();finish(true);}};
  // The active pointer interaction owns cancellation before document tooltips.
  stop.current=finish;window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancelled);target.addEventListener('lostpointercapture',cancelled);window.addEventListener('keydown',escape,true);window.addEventListener('blur',blur);
 };
 const adjust=(event:KeyboardEvent<HTMLElement>,edge?:ChatEdge)=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey||event.nativeEvent.isComposing||!panel.current)return;
  event.preventDefault();const step=event.shiftKey?32:8,dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
  const start=chatPanelRect(current.current,viewport()),next=edge?resizeChatRect(start,edge,dx,dy,viewport()):clampChatRect({...start,x:start.x+dx,y:start.y+dy},viewport());
  saveRect(next,edge?current.current.detached:true);setAnnouncement(`${Math.round(next.width)} by ${Math.round(next.height)} pixels`);
 };
 const bounds=chatBounds(viewport());
 return <div ref={slot} className="workspace chat-view-slot">
  <main ref={panel} className="workspace chat-view-surface" aria-label="Chat" data-chat-mode={layout.mode} data-detached={layout.detached} data-tracking={tracking}
   onFocusCapture={event=>{const target=event.target as HTMLElement;if(panel.current?.contains(target)&&!target.closest('.chat-layout-actions,.chat-resize-handle,.chat-move-handle'))rememberedFocus.current=target;}}>
   {Boolean(header||actions||enabled)&&<header className="workspace-header chat-view-header" onPointerDown={event=>begin(event)}>
    {header}<div className="header-actions">{actions}{enabled&&<div className="chat-layout-actions">
     {floating&&<button type="button" className="icon-button chat-move-handle" aria-label="Move chat panel" title="Move chat panel (arrow keys; Shift for larger steps)" onPointerDown={event=>{event.stopPropagation();begin(event);}} onKeyDown={event=>adjust(event)}><GripVertical size={15}/></button>}
     {layout.mode==='full'||layout.mode==='drawer'&&!layout.detached?<button type="button" className="icon-button" aria-label="Detach chat" title="Detach chat" onClick={event=>detach(event.detail===0)}><Unplug size={15}/></button>:<button type="button" className="icon-button" aria-label="Dock chat to side drawer" title="Expand to side drawer" onClick={event=>dock(event.detail===0)}><Maximize2 size={15}/></button>}
    </div>}</div>
   </header>}
   {children}
   {floating&&CHAT_EDGES.map(edge=><button key={edge} type="button" className={`chat-resize-handle chat-resize-${edge}`} aria-label={`Resize chat ${edgeNames[edge]}`} title={`Resize ${edgeNames[edge]} (arrow keys; Shift for larger steps)`} onPointerDown={event=>begin(event,edge)} onKeyDown={event=>adjust(event,edge)}/>)}
  </main>
  <div ref={snap} className="chat-dock-target" aria-hidden="true" data-visible={dockTarget} style={{top:bounds.top,right:20,height:bounds.bottom-bounds.top}}><PanelRight size={20}/></div>
  <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
 </div>;
}
