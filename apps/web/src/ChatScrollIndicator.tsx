import {useEffect,useId,useRef,useState,type KeyboardEvent,type PointerEvent,type RefObject} from 'react';
import type {createConversationScroll} from './conversation-scroll';
import './chat-scroll-indicator.css';

export interface ChatScrollIndicatorProps {
 scrollRef:RefObject<HTMLElement|null>;
 controllerRef:RefObject<ReturnType<typeof createConversationScroll>|null>;
 contentKey?:string;
}

/** A view of the existing transcript scroll position; it never owns message state. */
export function ChatScrollIndicator({scrollRef,controllerRef,contentKey}:ChatScrollIndicatorProps){
 const id=useId(),track=useRef<HTMLDivElement>(null),drag=useRef<{pointerId:number;offset:number}|null>(null);
 const [metrics,setMetrics]=useState({top:0,maximum:0,ratio:1,height:0});
 const finish=()=>{if(!drag.current)return;drag.current=null;controllerRef.current?.endManualScroll();};
 useEffect(()=>{
  const element=scrollRef.current;if(!element)return;
  if(!element.id)element.id=`chat-scroll-${id}`;
  let frame=0;
  const measure=()=>{frame=0;const next={top:element.scrollTop,maximum:Math.max(0,element.scrollHeight-element.clientHeight),ratio:element.scrollHeight?Math.min(1,element.clientHeight/element.scrollHeight):1,height:track.current?.clientHeight??element.clientHeight};setMetrics(previous=>Object.keys(next).every(key=>previous[key as keyof typeof next]===next[key as keyof typeof next])?previous:next);};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const resize=new ResizeObserver(schedule),mutation=new MutationObserver(()=>{observe();schedule();});
  const observe=()=>{resize.disconnect();resize.observe(element);for(const child of element.children)resize.observe(child);};
  observe();mutation.observe(element,{childList:true,subtree:true,characterData:true});element.addEventListener('scroll',schedule,{passive:true});window.addEventListener('blur',finish);schedule();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();element.removeEventListener('scroll',schedule);window.removeEventListener('blur',finish);finish();};
 },[scrollRef,controllerRef,contentKey,id]);
 const height=Math.min(metrics.height,Math.max(24,metrics.height*metrics.ratio)),travel=Math.max(0,metrics.height-height);
 const top=metrics.maximum?Math.max(0,Math.min(travel,metrics.top/metrics.maximum*travel)):0;
 const scroll=(value:number)=>{const element=scrollRef.current;if(!element)return;const controller=controllerRef.current;if(controller)controller.scrollTo(value);else element.scrollTop=Math.max(0,Math.min(metrics.maximum,value));};
 const move=(event:PointerEvent<HTMLDivElement>)=>{const current=drag.current,rect=track.current?.getBoundingClientRect();if(!current||current.pointerId!==event.pointerId||!rect)return;scroll(travel?Math.max(0,Math.min(travel,event.clientY-rect.top-current.offset))/travel*metrics.maximum:0);};
 const begin=(event:PointerEvent<HTMLDivElement>)=>{
  if(event.button!==0||!metrics.maximum)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});finish();
  const rect=event.currentTarget.getBoundingClientRect(),onThumb=(event.target as HTMLElement).closest('.chat-scroll-thumb');
  drag.current={pointerId:event.pointerId,offset:onThumb?event.clientY-rect.top-top:height/2};controllerRef.current?.beginManualScroll();event.currentTarget.setPointerCapture(event.pointerId);move(event);
 };
 const key=(event:KeyboardEvent<HTMLDivElement>)=>{
  const element=scrollRef.current;if(!element)return;
  const page=element.clientHeight*.85,delta=event.key==='ArrowUp'?-40:event.key==='ArrowDown'?40:event.key==='PageUp'?-page:event.key==='PageDown'?page:event.key===' '?(event.shiftKey?-page:page):undefined;
  if(delta===undefined&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();event.stopPropagation();finish();scroll(event.key==='Home'?0:event.key==='End'?metrics.maximum:element.scrollTop+delta!);
 };
 return <div ref={track} className="chat-scroll-indicator" role="scrollbar" aria-label="Scroll conversation" aria-controls={scrollRef.current?.id} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(metrics.maximum)} aria-valuenow={Math.round(Math.min(metrics.maximum,metrics.top))} tabIndex={metrics.maximum>1?0:-1} data-scrollable={metrics.maximum>1} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={key}><span className="chat-scroll-track" aria-hidden="true"/><span className="chat-scroll-thumb" aria-hidden="true" style={{height,transform:`translateY(${top}px)`}}/></div>;
}
