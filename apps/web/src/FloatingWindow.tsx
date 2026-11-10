import {useContext,useEffect,useId,useLayoutEffect,useRef,useState,type CSSProperties,type KeyboardEvent,type PointerEvent,type ReactNode} from 'react';
import {ChevronDown,ChevronUp,GripVertical,RotateCcw,X} from 'lucide-react';
import {clampFloatingLayout,FLOATING_COLLAPSED_HEIGHT,readFloatingLayout,writeFloatingLayout,type FloatingAnchor,type FloatingLayout,type FloatingSize,type FloatingViewport} from './floating-layout';
import {animateTask} from './task-motion';
import {FloatingRailSlotContext} from './FloatingRail';
import './floating-window.css';
export interface FloatingWindowProps {id:string;title:string;children:ReactNode;open?:boolean;onClose?:()=>void;anchor?:FloatingAnchor;defaultSize?:FloatingSize;minSize?:FloatingSize;defaultCollapsed?:boolean;summary?:ReactNode;collapsedLabel?:string;minimizeLabel?:string;ariaLabel?:string;className?:string;escapeBehavior?:'close'|'collapse';resetPosition?:boolean;onDetach?:()=>void|Promise<void>;minimizeOnly?:boolean;sizing?:'manual'|'content';focusOnOpen?:boolean;expandRequest?:number;storage?:{read:typeof readFloatingLayout;write:typeof writeFloatingLayout}}

// Focus changes a bounded shell-only stacking list, never generated task state.
const order:string[]=[];
const listeners=new Set<()=>void>();
const layerFor=(id:string)=>34+Math.min(4,Math.max(0,order.indexOf(id)));
function removeLayer(id:string){const index=order.indexOf(id);if(index>=0){order.splice(index,1);listeners.forEach(listener=>listener());}}
function bringForward(id:string){if(order.at(-1)===id)return;removeLayer(id);order.push(id);listeners.forEach(listener=>listener());}

function viewport(collapsed:boolean,slot?:HTMLDivElement|null,inRail=false,floating=false,owner?:HTMLElement|null):FloatingViewport {
  if(inRail&&!floating){const area=slot?.getBoundingClientRect();return {width:area?.width||352,height:area?.height||Math.max(180,innerHeight-84),top:0,bottom:area?.height||Math.max(180,innerHeight-84),gutter:0,pinned:'left'};}
  const width=window.visualViewport?.width??window.innerWidth,height=window.visualViewport?.height??window.innerHeight;
  const workspace=(owner?.closest<HTMLElement>('.shell-workarea')??document.querySelector<HTMLElement>('.shell-workarea'))?.getBoundingClientRect();
  const header=(owner?.closest<HTMLElement>('.shell-workarea')?.querySelector<HTMLElement>('.workspace-header')??document.querySelector<HTMLElement>('.workspace-header'))?.getBoundingClientRect();
  const left=Math.max(8,(workspace?.left??0)+8),right=Math.min(width-8,(workspace?.right??width)-8);
  const top=Math.max(8,Math.min(Math.max(header?.bottom??60,(workspace?.top??0)+8),height-52));
  const composer=width<=700&&!collapsed?document.querySelector<HTMLElement>('.composer-dock')?.getBoundingClientRect():undefined;
  const bottom=Math.min(workspace?.bottom??height,composer&&composer.top>top+80?composer.top-10:height)-8;
  return {width,height,left,right,top,bottom};
}

export function FloatingWindow({id,title,children,open=true,onClose,anchor='top-right',defaultSize={width:400,height:560},minSize={width:280,height:180},defaultCollapsed=false,summary,collapsedLabel,minimizeLabel,ariaLabel,className='',escapeBehavior='close',resetPosition=false,minimizeOnly=false,sizing='manual',focusOnOpen=true,expandRequest,storage}:FloatingWindowProps){
  const readLayout=storage?.read??readFloatingLayout,writeLayout=storage?.write??writeFloatingLayout;
  const rail=useContext(FloatingRailSlotContext);
  const shell=useRef<HTMLElement>(null),summaryButton=useRef<HTMLButtonElement>(null),moveButton=useRef<HTMLButtonElement>(null),minimizeButton=useRef<HTMLButtonElement>(null);
  const floating=useRef(!rail);
  const areaFor=(collapsed:boolean,released=floating.current)=>{const area=viewport(collapsed,rail?.element.current,Boolean(rail),released,shell.current);return minimizeOnly&&rail&&!released?{...area,pinned:'right' as const}:area;};
  const content=useRef<HTMLDivElement>(null),contentHeight=useRef(defaultSize.height);
  const opener=useRef<HTMLElement|null>(null),previousOpen=useRef<boolean|undefined>(undefined),previousCollapsed=useRef<boolean|undefined>(undefined),collapsedOrigin=useRef<{x:number;y:number}|undefined>(undefined),stopInteraction=useRef<()=>void>(()=>{}),entrance=useRef<Animation|undefined>(undefined);
  const description=useId(),bodyId=useId();
  const [layout,setLayout]=useState(()=>{
    const area=areaFor(defaultCollapsed),visibleHeight=defaultCollapsed?FLOATING_COLLAPSED_HEIGHT:defaultSize.height;
    const initial={x:(area.right??area.width)-defaultSize.width-(rail?0:8),y:anchor==='bottom-right'?(area.bottom??area.height)-visibleHeight-(rail?0:8):(rail?0:Math.max(72,area.top??0)),width:rail?minimizeOnly?Math.min(defaultSize.width,area.width):area.width:defaultSize.width,height:defaultSize.height,collapsed:defaultCollapsed,floating:!rail};
    let restored=readLayout(id,initial,area,minSize);
    if(minimizeOnly)restored=clampFloatingLayout({...initial,collapsed:restored.collapsed},area,minSize);
    // Rail coordinates are local; a previously released window is recovered in
    // viewport coordinates before any preference write can replace its bounds.
    if(rail&&restored.floating)restored=readLayout(id,initial,areaFor(restored.collapsed,true),minSize);
    floating.current=!rail||restored.floating===true;
    return sizing==='content'?clampFloatingLayout({...restored,height:initial.height},areaFor(restored.collapsed),minSize):restored;
  });
  const current=useRef(layout);current.current=layout;
  const resizeOrigin=useRef({layout,width:window.visualViewport?.width??window.innerWidth,height:window.visualViewport?.height??window.innerHeight});
  const [layer,setLayer]=useState(()=>layerFor(id)),[interacting,setInteracting]=useState(false),[adjusting,setAdjusting]=useState(Boolean(rail));
  const update=(next:FloatingLayout,persist=false,intent=persist)=>{
    floating.current=!rail||next.floating===true;
    const area=areaFor(next.collapsed),available=(area.bottom??area.height)-Math.max(area.top??0,next.y),preferred=sizing==='content'?{...next,height:next.collapsed?contentHeight.current:Math.min(contentHeight.current,Math.max(minSize.height,available))}:next,valid=clampFloatingLayout(rail&&!floating.current?{...preferred,width:minimizeOnly?Math.min(defaultSize.width,area.width):area.width}:preferred,area,minSize);current.current=valid;setLayout(valid);if(intent)resizeOrigin.current={layout:valid,width:area.width,height:area.height};if(persist)writeLayout(id,valid);
  };
  useLayoutEffect(()=>{rail?.report({open,collapsed:layout.collapsed});},[rail,open,layout.collapsed]);
  useLayoutEffect(()=>()=>rail?.report(null),[rail]);
  useEffect(()=>{const timer=setTimeout(()=>writeLayout(id,layout),120);return()=>clearTimeout(timer);},[id,layout,writeLayout]);
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
    const animation=shell.current?.closest('.app-shell')?.getAttribute('data-panel-animations')==='false'?undefined:animateTask(shell.current,[{opacity:.4,transform:'translateY(9px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],220,{duration:'--ui-motion-panel-enter',easing:'--ui-ease-enter'});
    entrance.current=animation;
    if(wasOpen===false&&focusOnOpen)(minimizeOnly?(current.current.collapsed?summaryButton:minimizeButton):moveButton).current?.focus({preventScroll:true});
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
      if(rail&&!floating.current&&!rail.element.current?.clientHeight)return;
      const area=areaFor(current.current.collapsed),key=JSON.stringify(area);if(key===lastArea)return;lastArea=key;stopInteraction.current();
      if(rail&&!floating.current){cancelAnimationFrame(adjustmentFrame);setAdjusting(true);adjustmentFrame=requestAnimationFrame(()=>setAdjusting(false));}
      if(rail&&!floating.current&&!observedRail&&rail.element.current?.clientHeight){observedRail=true;update(current.current,false,true);return;}
      const origin=resizeOrigin.current,preferred=origin.layout,width=Math.min(preferred.width,(area.right??area.width)-(area.left??8)),height=preferred.height;
      const x=floating.current?preferred.x:area.width-width-(origin.width-preferred.x-preferred.width);
      const visibleHeight=preferred.collapsed?FLOATING_COLLAPSED_HEIGHT:height,y=anchor==='bottom-right'?area.height-visibleHeight-(origin.height-preferred.y-(preferred.collapsed?FLOATING_COLLAPSED_HEIGHT:preferred.height)):preferred.y;
      update({...preferred,x,y,width,height});
    };
    window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    const composer=document.querySelector('.composer-dock'),workspace=shell.current?.closest('.shell-workarea'),observer=new ResizeObserver(resize);if(composer)observer.observe(composer);if(workspace)observer.observe(workspace);if(rail?.element.current)observer.observe(rail.element.current);resize();
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
    const before=current.current,area=areaFor(before.collapsed,!rail),visibleHeight=before.collapsed?FLOATING_COLLAPSED_HEIGHT:before.height;
    update({...before,floating:!rail,x:(area.right??area.width)-before.width-(rail?0:8),y:anchor==='bottom-right'?(area.bottom??area.height)-visibleHeight-(rail?0:8):(rail?0:Math.max(72,area.top??0))},true);
  };
  const release=()=>{
    if(!rail||floating.current)return current.current;
    const bounds=shell.current?.getBoundingClientRect(),before=current.current;
    if(!bounds)return before;
    const next={...before,x:bounds.left,y:bounds.top,width:bounds.width,floating:true};
    update(next,false,true);return current.current;
  };
  const keyboard=(event:KeyboardEvent<HTMLElement>,resize=false)=>{
    if(minimizeOnly||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();bringForward(id);collapsedOrigin.current=undefined;
    const step=event.altKey?2:12;
    if(event.key==='Home'){restorePosition();return;}
    if(event.shiftKey&&sizing==='content')return;
    const before=release(),dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
    update(resize||event.shiftKey?{...before,width:before.width+dx,height:before.height+dy}:{...before,x:before.x+dx,y:before.y+dy},true);
  };
  const pointer=(event:PointerEvent<HTMLElement>,resize=false)=>{
    if(event.button!==0||minimizeOnly)return;
    event.preventDefault();stopInteraction.current();bringForward(id);collapsedOrigin.current=undefined;
    event.currentTarget.focus({preventScroll:true});const element=event.currentTarget,start=release(),x=event.clientX,y=event.clientY,pointerId=event.pointerId;
    setInteracting(true);document.documentElement.classList.add('floating-window-interaction');element.setPointerCapture?.(pointerId);
    const move=(next:globalThis.PointerEvent)=>{if(next.pointerId!==pointerId)return;const dx=next.clientX-x,dy=next.clientY-y;update(resize?{...start,width:start.width+dx,height:start.height+dy}:{...start,x:start.x+dx,y:start.y+dy},false,true);};
    let finished=false;
    const finish=(ending?:Event)=>{if(finished||ending instanceof globalThis.PointerEvent&&ending.pointerId!==pointerId)return;finished=true;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);window.removeEventListener('blur',finish);if(element.hasPointerCapture?.(pointerId))element.releasePointerCapture(pointerId);document.documentElement.classList.remove('floating-window-interaction');setInteracting(false);writeLayout(id,current.current);};
    stopInteraction.current=finish;window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);window.addEventListener('blur',finish);
  };
  const style:CSSProperties={left:layout.x,top:layout.y,width:layout.width,height:layout.collapsed?FLOATING_COLLAPSED_HEIGHT:layout.height,zIndex:layer};
  return <section ref={shell} hidden={!open} className={`floating-window ${className}`} data-floating-id={id} data-floating={layout.floating===true||!rail} data-axis={minimizeOnly?'none':'both'} data-minimize-only={minimizeOnly} data-collapsed={layout.collapsed} data-interacting={interacting} data-adjusting={adjusting} style={style} aria-label={ariaLabel??`${title} window`} onFocusCapture={()=>bringForward(id)} onPointerDownCapture={()=>{entrance.current?.cancel();bringForward(id);}} onKeyDownCapture={()=>entrance.current?.cancel()} onKeyDown={event=>{
    if(event.defaultPrevented||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||event.key!=='Escape')return;
    event.preventDefault();event.stopPropagation();if(minimizeOnly){if(!current.current.collapsed)collapse(true);}else if(escapeBehavior==='collapse'&&!current.current.collapsed)collapse(true);else close();
  }}>
    {!minimizeOnly&&<p className="sr-only" id={description}>Use the arrow keys to move this window. {sizing==='manual'&&'Hold Shift to resize it. '}Home restores its edge position.</p>}
    <div className="floating-window-header" data-compact={layout.collapsed}>
      {minimizeOnly?<strong className="floating-window-title">{title}</strong>:<button ref={moveButton} type="button" className="floating-window-move" aria-label={`Move ${title}`} aria-describedby={description} onPointerDown={event=>pointer(event)} onKeyDown={event=>keyboard(event)}><GripVertical size={13} aria-hidden="true"/>{!layout.collapsed&&<strong>{title}</strong>}</button>}
      {!minimizeOnly&&resetPosition&&<button type="button" className="floating-window-control" aria-label={`Reset ${title} position`} title={`Reset ${title} position`} onClick={restorePosition}><RotateCcw size={13} aria-hidden="true"/></button>}
      {layout.collapsed?<button ref={summaryButton} type="button" className="floating-window-summary" aria-label={collapsedLabel??`Expand ${title}`} aria-expanded={false} aria-controls={bodyId} onClick={()=>collapse(false)}>{summary??(!minimizeOnly&&<strong>{title}</strong>)}<ChevronUp size={12} aria-hidden="true"/></button>:<button ref={minimizeButton} type="button" className="floating-window-control" aria-label={minimizeLabel??`Minimize ${title}`} aria-expanded={true} aria-controls={bodyId} onClick={()=>collapse(true)}><ChevronDown size={14} aria-hidden="true"/></button>}
      {!minimizeOnly&&onClose&&<button type="button" className="floating-window-control" aria-label={`Close ${title}`} onClick={close}><X size={13} aria-hidden="true"/></button>}
    </div>
    <div id={bodyId} className="floating-window-body" data-collapsed={layout.collapsed} inert={layout.collapsed||!open} aria-hidden={layout.collapsed||!open}>{sizing==='content'?<div ref={content} className="floating-window-content">{children}</div>:children}</div>
  </section>;
}
