import {useEffect,useRef,type FocusEvent,type PointerEvent} from 'react';

// :active includes Space/Enter. Track pointer ownership without changing clicks or focus.
export function useComposerPointerPress(){
 const pressed=useRef<{target:HTMLElement;pointerId:number}|null>(null);
 const clear=()=>{pressed.current?.target.removeAttribute('data-pointer-pressed');pressed.current=null;};
 useEffect(()=>{
  const release=(event:globalThis.PointerEvent)=>{if(event.pointerId===pressed.current?.pointerId)clear();};
  window.addEventListener('pointerup',release,true);
  window.addEventListener('pointercancel',release,true);
  window.addEventListener('blur',clear);
  return ()=>{clear();window.removeEventListener('pointerup',release,true);window.removeEventListener('pointercancel',release,true);window.removeEventListener('blur',clear);};
 },[]);
 return {
  onPointerDown(event:PointerEvent<HTMLDivElement>){
   if(event.button!==0||!event.isPrimary)return;
   clear();
   const target=event.target instanceof Element?event.target.closest<HTMLElement>('.composer-tool,.composer-context-chip'):null;
   if(!target||!event.currentTarget.contains(target)||target.matches(':disabled,[data-pointer-pressed]'))return;
   pressed.current={target,pointerId:event.pointerId};target.setAttribute('data-pointer-pressed','');
  },
  onPointerOut(event:PointerEvent<HTMLDivElement>){
   if(pressed.current&&!(event.relatedTarget instanceof Node&&pressed.current.target.contains(event.relatedTarget)))clear();
  },
  onKeyDownCapture:clear,
  onBlurCapture(event:FocusEvent<HTMLDivElement>){if(pressed.current?.target.contains(event.target))clear();},
 };
}
