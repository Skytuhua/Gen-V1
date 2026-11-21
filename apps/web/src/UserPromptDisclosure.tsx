import {useCallback,useId,useLayoutEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronUp} from 'lucide-react';
import {Markdown} from './Markdown';
import {readMotionPolicy} from './motion-policy';
import {scrollConversation} from './conversation-scroll';
import {registerPromptClip} from './prompt-clips';
import './user-prompt-disclosure.css';

/** Pixel cap for the collapsed preview: eight rendered line heights. */
export function promptCapPx(lineHeightPx:number){return lineHeightPx*8;}
/** Eligible only when intrinsic height exceeds the cap by more than one CSS pixel. */
export function promptOverflows(intrinsicHeightPx:number,capPx:number){return intrinsicHeightPx>capPx+1;}

const TOGGLE_ANIMATION={duration:180,easing:'cubic-bezier(0.2, 0, 0, 1)'} as const;

function scrollPortOf(element:Element):HTMLElement|null{
 for(let node=element.parentElement;node;node=node.parentElement){
  const overflow=getComputedStyle(node).overflowY;
  if(overflow==='auto'||overflow==='scroll')return node;
 }
 return null;
}

/**
 * Collapses a sent user prompt to an eight-line-height preview with a sticky
 * top Show more/Show less rail. The full Markdown stays mounted: it is inert
 * while collapsed so clipped controls take no focus, and registered with
 * prompt-clips so Conversation Find can still count it and request a reveal.
 */
export function UserPromptDisclosure({text}:{text:string}){
 const id=useId(),root=useRef<HTMLDivElement>(null),rail=useRef<HTMLDivElement>(null),clip=useRef<HTMLDivElement>(null),box=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
 const [measurable,setMeasurable]=useState(false),[overflows,setOverflows]=useState(false),[expanded,setExpanded]=useState(false),[settling,setSettling]=useState(false);
 const cap=useRef(0),collapsedRef=useRef(false),wasCollapsible=useRef(false),buttonFocused=useRef(false),needsScrollFix=useRef(false),pendingAnimation=useRef<{from:number;to:number}|null>(null),animation=useRef<Animation|null>(null),reveals=useRef<(()=>void)[]>([]);
 const collapsed=measurable&&overflows&&!expanded;
 collapsedRef.current=collapsed;

 const measure=useCallback(()=>{
  const node=box.current;
  if(!node)return;
  const rect=node.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0)return;// a hidden cached owner is not a short prompt
  const style=getComputedStyle(node);
  const lineHeight=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.65;
  cap.current=promptCapPx(lineHeight);
  setMeasurable(true);
  setOverflows(promptOverflows(rect.height,cap.current));
 },[]);

 useLayoutEffect(()=>{
  const node=box.current;
  if(!node)return;
  measure();
  const win=node.ownerDocument.defaultView;
  if(typeof ResizeObserver==='undefined'){win?.addEventListener('resize',measure);return()=>win?.removeEventListener('resize',measure);}
  const observer=new ResizeObserver(measure);
  observer.observe(node);
  win?.addEventListener('resize',measure);
  return()=>{observer.disconnect();win?.removeEventListener('resize',measure);};
 },[measure,text]);

 useLayoutEffect(()=>{
  const boundary=box.current;
  if(!boundary)return;
  return registerPromptClip(boundary,{
   clip:()=>clip.current,
   collapsed:()=>collapsedRef.current,
   reveal(done){if(!collapsedRef.current){done();return;}reveals.current.push(done);setExpanded(true);},
  });
 },[]);

 // Acknowledge queued Find reveals once the expanded commit has removed clip/mask/inert.
 useLayoutEffect(()=>{
  if(collapsed||!reveals.current.length)return;
  const callbacks=reveals.current.splice(0);
  callbacks.forEach(done=>done());
 });

 // A focused Markdown descendant must never become inert by remeasurement.
 useLayoutEffect(()=>{
  const node=box.current;
  if(collapsed&&node&&node.contains(node.ownerDocument.activeElement))setExpanded(true);
 });

 // If a remeasure removes the rail while its button held focus, keep focus on the wrapper.
 useLayoutEffect(()=>{
  if(wasCollapsible.current&&measurable&&!overflows&&buttonFocused.current&&root.current){
   root.current.focus({preventScroll:true});
  }
  buttonFocused.current=false;
  wasCollapsible.current=measurable&&overflows;
 });

 // After collapsing from a deep position, keep the rail inside the owning scrollport.
 useLayoutEffect(()=>{
  if(!needsScrollFix.current||!collapsed||!rail.current)return;
  needsScrollFix.current=false;
  const port=scrollPortOf(rail.current);
  if(!port)return;
  const railTop=rail.current.getBoundingClientRect().top,portTop=port.getBoundingClientRect().top;
  if(railTop<portTop)scrollConversation(port,port.scrollTop-(portTop-railTop));
 });

 // Run the pending block-size animation committed by the last toggle.
 useLayoutEffect(()=>{
  const pending=pendingAnimation.current;
  pendingAnimation.current=null;
  if(!pending)return;
  const node=clip.current;
  if(!node||!node.isConnected){setSettling(false);return;}
  animation.current?.cancel();
  const animate=node.animate([{height:`${pending.from}px`},{height:`${pending.to}px`}],TOGGLE_ANIMATION);
  animation.current=animate;
  animate.onfinish=animate.oncancel=()=>{if(animation.current===animate)animation.current=null;setSettling(false);};
 });
 useLayoutEffect(()=>()=>{animation.current?.cancel();},[]);

 const toggle=useCallback(()=>{
  const target=!expanded,node=clip.current;
  if(!node||readMotionPolicy()!=='full'||typeof node.animate!=='function'||!measurable){
   if(!target)needsScrollFix.current=true;
   setExpanded(target);return;
  }
  const from=node.getBoundingClientRect().height,to=target?(box.current?.scrollHeight??from):cap.current;
  if(Math.abs(to-from)<1){if(!target)needsScrollFix.current=true;setExpanded(target);return;}
  pendingAnimation.current={from,to};
  if(!target)needsScrollFix.current=true;
  setSettling(true);
  setExpanded(target);
 },[expanded,measurable]);

 return <div ref={root} className="up-disclosure" tabIndex={-1}>
  {measurable&&overflows&&<div ref={rail} className="up-disclosure-rail">
   <button ref={button} type="button" className="quiet up-disclosure-toggle" aria-expanded={expanded} aria-controls={id} aria-describedby={collapsed?`${id}-hint`:undefined} onClick={toggle} onFocus={()=>{buttonFocused.current=true;}}>
    {expanded?<ChevronUp size={14} aria-hidden/>:<ChevronDown size={14} aria-hidden/>}
    {expanded?'Show less':'Show more'}
   </button>
   {collapsed&&<span id={`${id}-hint`} className="sr-only">Preview clipped. Expand to read the full prompt.</span>}
  </div>}
  <div ref={clip} id={id} className="up-disclosure-clip" data-collapsed={collapsed||undefined} data-fade={(collapsed&&!settling)||undefined} data-settling={settling||undefined}>
   <div ref={box} className="up-disclosure-content" inert={collapsed||undefined}>
    <Markdown text={text}/>
   </div>
  </div>
 </div>;
}
