import {useContext,useEffect,useId,useLayoutEffect,useRef,useState,type CSSProperties,type KeyboardEvent,type PointerEvent,type ReactNode} from 'react';
import {ChevronDown,ChevronUp,GripVertical,RotateCcw,ExternalLink,X} from 'lucide-react';
import {clampFloatingLayout,FLOATING_COLLAPSED_HEIGHT,readFloatingLayout,writeFloatingLayout,type FloatingAnchor,type FloatingLayout,type FloatingSize,type FloatingViewport} from './floating-layout';
import {animateTask} from './task-motion';
import {FloatingRailSlotContext} from './FloatingRail';
import './floating-window.css';
export interface FloatingWindowProps {id:string;title:string;children:ReactNode;open?:boolean;onClose?:()=>void;anchor?:FloatingAnchor;defaultSize?:FloatingSize;minSize?:FloatingSize;defaultCollapsed?:boolean;summary?:ReactNode;collapsedLabel?:string;minimizeLabel?:string;ariaLabel?:string;className?:string;escapeBehavior?:'close'|'collapse';resetPosition?:boolean;onDetach?:()=>void;sizing?:'manual'|'content';focusOnOpen?:boolean;expandRequest?:number}

// Focus changes a bounded shell-only stacking list, never generated task state.
const order:string[]=[];
const listeners=new Set<()=>void>();
const layerFor=(id:string)=>34+Math.min(4,Math.max(0,order.indexOf(id)));
function removeLayer(id:string){const index=order.indexOf(id);if(index>=0){order.splice(index,1);listeners.forEach(listener=>listener());}}
function bringForward(id:string){if(order.at(-1)===id)return;removeLayer(id);order.push(id);listeners.forEach(listener=>listener());}

function viewport(collapsed:boolean,slot?:HTMLDivElement|null,inRail=false):FloatingViewport {
  if(slot||inRail){const area=slot?.getBoundingClientRect();return {width:area?.width||352,height:area?.height||Math.max(180,innerHeight-84),top:0,bottom:area?.height||Math.max(180,innerHeight-84),gutter:0,pinned:'left'};}
  const width=window.visualViewport?.width??window.innerWidth,height=window.visualViewport?.height??window.innerHeight;
  const header=document.querySelector<HTMLElement>('.workspace-header')?.getBoundingClientRect();
  const top=Math.max(8,Math.min(header?.bottom||60,height-52));
  const composer=width<=700&&!collapsed?document.querySelector<HTMLElement>('.composer-dock')?.getBoundingClientRect():undefined;
  const bottom=composer&&composer.top>top+80?Math.min(height-8,composer.top-10):height-8;
  return {width,height,top,bottom,pinned:'right'};
}

export function FloatingWindow({id,title,children,open=true,onClose,anchor='top-right',defaultSize={width:400,height:560},minSize={width:280,height:180},defaultCollapsed=false,summary,collapsedLabel,minimizeLabel,ariaLabel,className='',escapeBehavior='close',resetPosition=false,onDetach,sizing='manual',focusOnOpen=true,expandRequest}:FloatingWindowProps){
  const rail=useContext(FloatingRailSlotContext);
  const areaFor=(collapsed:boolean)=>viewport(collapsed,rail?.element.current,Boolean(rail));
  const shell=useRef<HTMLElement>(null),summaryButton=useRef<HTMLButtonElement>(null),moveButton=useRef<HTMLButtonElement>(null),minimizeButton=useRef<HTMLButtonElement>(null);
  const content=useRef<HTMLDivElement>(null),contentHeight=useRef(defaultSize.height);
  const opener=useRef<HTMLElement|null>(null),previousOpen=useRef<boolean|undefined>(undefined),previousCollapsed=useRef<boolean|undefined>(undefined),collapsedOrigin=useRef<{x:number;y:number}|undefined>(undefined),stopInteraction=useRef<()=>void>(()=>{}),entrance=useRef<Animation|undefined>(undefined);
  const description=useId(),bodyId=useId();
  const [layout,setLayout]=useState(()=>{
    const area=areaFor(defaultCollapsed),visibleHeight=defaultCollapsed?FLOATING_COLLAPSED_HEIGHT:defaultSize.height;
    const initial={x:area.width-defaultSize.width-14,y:anchor==='bottom-right'?area.height-visibleHeight-(rail?0:8):(rail?0:72),width:rail?area.width:defaultSize.width,height:defaultSize.height,collapsed:defaultCollapsed};
    const restored=readFloatingLayout(id,initial,area,minSize);
    return sizing==='content'?clampFloatingLayout({...restored,height:initial.height},area,minSize):restored;
  });
  const current=useRef(layout);current.current=layout;
  const resizeOrigin=useRef({layout,width:window.visualViewport?.width??window.innerWidth,height:window.visualViewport?.height??window.innerHeight});
  const [layer,setLayer]=useState(()=>layerFor(id)),[interacting,setInteracting]=useState(false),[adjusting,setAdjusting]=useState(Boolean(rail));
  const update=(next:FloatingLayout,persist=false,intent=persist)=>{
    const area=areaFor(next.collapsed),preferred=sizing==='content'?{...next,height:contentHeight.current}:next,valid=clampFloatingLayout(rail?{...preferred,width:area.width}:preferred,area,minSize);current.current=valid;setLayout(valid);if(intent)resizeOrigin.current={layout:valid,width:area.width,height:area.height};if(persist)writeFloatingLayout(id,valid);
  };
  useLayoutEffect(()=>{rail?.report({open,collapsed:layout.collapsed});},[rail,open,layout.collapsed]);
  useLayoutEffect(()=>()=>rail?.report(null),[rail]);
  useEffect(()=>{const timer=setTimeout(()=>writeFloatingLayout(id,layout),120);return()=>clearTimeout(timer);},[id,layout]);
  useLayoutEffect(()=>{
    const refresh=()=>setLayer(layerFor(id));listeners.add(refresh);if(open)bringForward(id);
    return()=>{listeners.delete(refresh);removeLayer(id);};
  },[id,open]);
  useLayoutEffect(()=>{
    const wasOpen=previousOpen.current;previousOpen.current=open;
    if(!open){entrance.current?.cancel();stopInteraction.current();if(wasOpen&&shell.current?.contains(document.activeElement)&&opener.current?.isConnected)opener.current.focus({preventScroll:true});return;}
    update(current.current);
    if(wasOpen)return;
    if(wasOpen===false)opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const animation=shell.current?.closest('.app-shell')?.getAttribute('data-panel-animations')==='false'?undefined:animateTask(shell.current,[{opacity:.4,transform:'translateY(9px) scale(.985)'},{opacity:1,transform:'translateY(-1px) scale(1.002)',offset:.78},{opacity:1,transform:'translateY(0) scale(1)'}],280);
    entrance.current=animation;
    if(wasOpen===false&&focusOnOpen)moveButton.current?.focus({preventScroll:true});
    return()=>animation?.cancel();
  },[open]);
  useLayoutEffect(()=>{
    const before=previousCollapsed.current;previousCollapsed.current=layout.collapsed;
    if(before===undefined||before===layout.collapsed||!open)return;
    (layout.collapsed?summaryButton.current:minimizeButton.current)?.focus({preventScroll:true});
  },[layout.collapsed,open]);
  useLayoutEffect(()=>{
    if(sizing!=='content'||!open||layout.collapsed||!content.current)return;
    const measure=()=>{
      if(!content.current)return;
      const height=Math.ceil(content.current.getBoundingClientRect().height+39);
      if(height<=39||Math.abs(height-contentHeight.current)<1)return;
      contentHeight.current=height;update(current.current);
    };
    measure();const observer=new ResizeObserver(measure);observer.observe(content.current);
    return()=>observer.disconnect();
  },[sizing,open,layout.collapsed]);
  useEffect(()=>{
    let lastArea='',observedRail=false,adjustmentFrame=0;
    const resize=()=>{
      // A closed tool has no slot geometry yet. Preserve its saved coordinates
      // until the overlay opens instead of treating the fallback as a resize.
      if(rail&&!rail.element.current?.clientHeight)return;
      const area=areaFor(current.current.collapsed),key=JSON.stringify(area);if(key===lastArea)return;lastArea=key;stopInteraction.current();
      if(rail){cancelAnimationFrame(adjustmentFrame);setAdjusting(true);adjustmentFrame=requestAnimationFrame(()=>setAdjusting(false));}
      if(rail&&!observedRail&&rail.element.current?.clientHeight){observedRail=true;update(current.current,false,true);return;}
      const origin=resizeOrigin.current,preferred=origin.layout,width=Math.min(preferred.width,area.width-16),height=preferred.height;
      const x=area.width-width-(origin.width-preferred.x-preferred.width);
      const visibleHeight=preferred.collapsed?FLOATING_COLLAPSED_HEIGHT:height,y=anchor==='bottom-right'?area.height-visibleHeight-(origin.height-preferred.y-(preferred.collapsed?FLOATING_COLLAPSED_HEIGHT:preferred.height)):preferred.y;
      update({...preferred,x,y,width,height});
    };
    window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    const composer=document.querySelector('.composer-dock'),observer=new ResizeObserver(resize);if(composer)observer.observe(composer);if(rail?.element.current)observer.observe(rail.element.current);resize();
    return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);observer.disconnect();cancelAnimationFrame(adjustmentFrame);};
  },[minSize.width,minSize.height,rail]);
  useEffect(()=>()=>stopInteraction.current(),[]);

  const collapse=(collapsed:boolean)=>{
    stopInteraction.current();const before=current.current;if(before.collapsed===collapsed)return;
    let x=before.x,y=before.y;
    if(!collapsed){collapsedOrigin.current={x,y};if(anchor==='bottom-right')y+=FLOATING_COLLAPSED_HEIGHT-before.height;}
    else if(collapsedOrigin.current){({x,y}=collapsedOrigin.current);collapsedOrigin.current=undefined;}
    else if(anchor==='bottom-right')y+=before.height-FLOATING_COLLAPSED_HEIGHT;
    update({...before,x,y,collapsed},true);
    if(rail&&!collapsed)resizeOrigin.current.layout.height=before.height;
  };
  useLayoutEffect(()=>{
    if(expandRequest===undefined||!open||!current.current.collapsed)return;
    // An external presentation request must not behave like a clicked
    // disclosure or move focus away from the user's current field.
    previousCollapsed.current=false;collapse(false);
  },[expandRequest,open]);
  const close=()=>{stopInteraction.current();onClose?.();};
  const restorePosition=()=>{
    stopInteraction.current();collapsedOrigin.current=undefined;
    const before=current.current,area=areaFor(before.collapsed),visibleHeight=before.collapsed?FLOATING_COLLAPSED_HEIGHT:before.height;
    update({...before,x:area.width-before.width-(rail?0:8),y:anchor==='bottom-right'?area.height-visibleHeight-(rail?0:8):(rail?0:72)},true);
  };
  const keyboard=(event:KeyboardEvent<HTMLElement>,resize=false)=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();bringForward(id);collapsedOrigin.current=undefined;
    const before=current.current,step=event.altKey?2:12;
    if(event.key==='Home'){restorePosition();return;}
    const dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
    if(event.shiftKey&&sizing==='content')return;
    update(resize||event.shiftKey?{...before,height:before.height+dy}:{...before,y:before.y+dy},true);
  };
  const pointer=(event:PointerEvent<HTMLElement>,resize=false)=>{
    if(event.button!==0)return;
    event.preventDefault();stopInteraction.current();bringForward(id);collapsedOrigin.current=undefined;
    event.currentTarget.focus({preventScroll:true});const element=event.currentTarget,start=current.current,y=event.clientY,pointerId=event.pointerId;
    setInteracting(true);document.documentElement.classList.add('floating-window-interaction');element.setPointerCapture?.(pointerId);
    const move=(next:globalThis.PointerEvent)=>{if(next.pointerId!==pointerId)return;const dy=next.clientY-y;update(resize?{...start,height:start.height+dy}:{...start,y:start.y+dy},false,true);};
    let finished=false;
    const finish=()=>{if(finished)return;finished=true;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);window.removeEventListener('blur',finish);if(element.hasPointerCapture?.(pointerId))element.releasePointerCapture(pointerId);document.documentElement.classList.remove('floating-window-interaction');setInteracting(false);writeFloatingLayout(id,current.current);};
    stopInteraction.current=finish;window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);window.addEventListener('blur',finish);
  };
  const style:CSSProperties={left:layout.x,top:layout.y,width:layout.width,height:layout.collapsed?FLOATING_COLLAPSED_HEIGHT:layout.height,zIndex:layer};
  return <section ref={shell} hidden={!open} className={`floating-window ${className}`} data-floating-id={id} data-axis="vertical" data-collapsed={layout.collapsed} data-interacting={interacting} data-adjusting={adjusting} style={style} aria-label={ariaLabel??`${title} window`} onFocusCapture={()=>bringForward(id)} onPointerDownCapture={()=>{entrance.current?.cancel();bringForward(id);}} onKeyDownCapture={()=>entrance.current?.cancel()} onKeyDown={event=>{
    if(event.defaultPrevented||event.nativeEvent.isComposing||event.key!=='Escape')return;
    event.preventDefault();event.stopPropagation();if(escapeBehavior==='collapse'&&!current.current.collapsed)collapse(true);else close();
  }}>
    <p className="sr-only" id={description}>Use Up and Down to move this window vertically. {sizing==='manual'&&'Hold Shift to change its height. '}Home restores its edge position.</p>
    <div className="floating-window-header" data-compact={layout.collapsed}>
      <button ref={moveButton} type="button" className="floating-window-move" aria-label={`Move ${title}`} aria-describedby={description} onPointerDown={event=>pointer(event)} onKeyDown={event=>keyboard(event)}><GripVertical size={13} aria-hidden="true"/>{!layout.collapsed&&<strong>{title}</strong>}</button>
      {onDetach&&<button type="button" className="floating-window-control" aria-label={`Detach ${title}`} title={`Detach ${title}`} onClick={onDetach}><ExternalLink size={13} aria-hidden="true"/></button>}
      {resetPosition&&<button type="button" className="floating-window-control" aria-label={`Reset ${title} position`} title={`Reset ${title} position`} onClick={restorePosition}><RotateCcw size={13} aria-hidden="true"/></button>}
      {layout.collapsed?<button ref={summaryButton} type="button" className="floating-window-summary" aria-label={collapsedLabel??`Expand ${title}`} aria-expanded={false} aria-controls={bodyId} onClick={()=>collapse(false)}>{summary??<strong>{title}</strong>}<ChevronUp size={12} aria-hidden="true"/></button>:<button ref={minimizeButton} type="button" className="floating-window-control" aria-label={minimizeLabel??`Minimize ${title}`} aria-expanded={true} aria-controls={bodyId} onClick={()=>collapse(true)}><ChevronDown size={14} aria-hidden="true"/></button>}
      {onClose&&<button type="button" className="floating-window-control" aria-label={`Close ${title}`} onClick={close}><X size={13} aria-hidden="true"/></button>}
    </div>
    <div id={bodyId} className="floating-window-body" data-collapsed={layout.collapsed} inert={layout.collapsed||!open} aria-hidden={layout.collapsed||!open}>{sizing==='content'?<div ref={content} className="floating-window-content">{children}</div>:children}</div>
  </section>;
}
