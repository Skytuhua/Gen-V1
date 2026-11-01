import {createSpringValue} from './motion-spring';

export type ConversationPosition={top:number;tail:boolean};
export type ConversationAnchor={height:number;top:number};

/** Own only tail-following scrolls. Reading history and user intent always win. */
export function createConversationScroll(element:HTMLElement){
 const preference=matchMedia('(prefers-reduced-motion: reduce)');
 let thread='',following=false,disposed=false,ownedTop:number|undefined,dragging=false;
 const maximum=()=>Math.max(0,element.scrollHeight-element.clientHeight);
 const nearTail=()=>maximum()-element.scrollTop<80;
 const write=(value:number)=>{element.scrollTop=Math.min(maximum(),Math.max(0,value));ownedTop=element.scrollTop;};
 let spring=createSpringValue(element.scrollTop,write);
 const interrupt=()=>{spring.dispose();spring=createSpringValue(element.scrollTop,write);ownedTop=undefined;following=false;};
 const follow=()=>{if(!disposed&&following)spring.to(maximum(),preference.matches||document.visibilityState==='hidden'||!element.getClientRects().length);};
 const observed=new Set<Element>();
 const observer=new ResizeObserver(follow);
 observer.observe(element);
 const observeContent=()=>{
  const children=new Set(element.children);
  for(const child of observed)if(!children.has(child)){observer.unobserve(child);observed.delete(child);}
  for(const child of children)if(!observed.has(child)){observed.add(child);observer.observe(child);}
 };
 const wheel=(event:WheelEvent)=>{if(event.ctrlKey)return;interrupt();if(event.deltaY>=0&&nearTail())following=true;};
 const touchStart=()=>{interrupt();};
 const touchEnd=()=>{following=nearTail();};
 const pointerDown=(event:PointerEvent)=>{
  // Ordinary button clicks should not detach a conversation from the tail.
  // The scrollbar and middle-button pan do constitute reading intent.
  if(event.button!==1&&!(event.target===element&&event.clientX>=element.getBoundingClientRect().left+element.clientWidth))return;
  dragging=true;interrupt();
 };
 const pointerEnd=()=>{if(dragging){dragging=false;following=nearTail();}};
 const key=(event:KeyboardEvent)=>{
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))return;
  const target=event.target as HTMLElement|null;
  if(target?.closest?.('input,textarea,select,button,a,summary,[contenteditable="true"],[role="slider"]'))return;
  interrupt();if(['ArrowDown','PageDown','End',' '].includes(event.key)&&nearTail())following=true;
 };
 const settleHidden=()=>{if(document.visibilityState==='hidden'&&following)spring.to(maximum(),true);};
 const motionChanged=()=>{if(preference.matches&&following)spring.to(maximum(),true);};
 element.addEventListener('wheel',wheel,{passive:true});
 element.addEventListener('touchstart',touchStart,{passive:true});
 element.addEventListener('touchend',touchEnd,{passive:true});
 element.addEventListener('touchcancel',touchEnd,{passive:true});
 element.addEventListener('pointerdown',pointerDown);
 element.addEventListener('keydown',key);
 document.addEventListener('pointerup',pointerEnd);
 document.addEventListener('pointercancel',pointerEnd);
 document.addEventListener('visibilitychange',settleHidden);
 preference.addEventListener('change',motionChanged);
 return {
  update(id:string,position:ConversationPosition,anchor?:ConversationAnchor){
   if(disposed)return;
   observeContent();
   if(thread!==id){thread=id;interrupt();following=position.tail;spring.to(position.tail?maximum():position.top,true);}
   else if(anchor){interrupt();following=position.tail;spring.to(anchor.top+element.scrollHeight-anchor.height,true);}
   else follow();
  },
  remember():ConversationPosition|null{
   if(disposed||ownedTop!==undefined&&Math.abs(element.scrollTop-ownedTop)<1)return null;
   interrupt();following=nearTail();ownedTop=element.scrollTop;return {top:element.scrollTop,tail:following};
  },
  jump():ConversationPosition{
   following=true;follow();return {top:maximum(),tail:true};
  },
  dispose(){
   if(disposed)return;disposed=true;spring.dispose();observer.disconnect();observed.clear();
   element.removeEventListener('wheel',wheel);element.removeEventListener('touchstart',touchStart);element.removeEventListener('touchend',touchEnd);element.removeEventListener('touchcancel',touchEnd);element.removeEventListener('pointerdown',pointerDown);element.removeEventListener('keydown',key);
   document.removeEventListener('pointerup',pointerEnd);document.removeEventListener('pointercancel',pointerEnd);document.removeEventListener('visibilitychange',settleHidden);preference.removeEventListener('change',motionChanged);
  },
 };
}
