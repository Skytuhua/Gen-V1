import {createElement,useLayoutEffect,useRef,type ReactNode} from 'react';
import './sentence-reveal.css';
export interface SentenceRevealProps {text:string;children:ReactNode;animate?:boolean;initialReveal?:boolean;className?:string;as?:'div'|'p';revealClassName?:string}
interface TextRun {node:Text;start:number;end:number}
interface TextMap {text:string;runs:TextRun[]}
interface Reveal {start:number;end:number;created:number;duration:number;boundaries:number[];progress:number;covers:HTMLElement[];edge:HTMLElement|null;timer:ReturnType<typeof setTimeout>|null}
const MAX_TEXT=100_000,MAX_NODES=1024,MAX_COVERS=64;
function textMap(root:HTMLElement,proseOnly:boolean):TextMap|null {
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),runs:TextRun[]=[];let text='';
 for(let node=walker.nextNode();node;node=walker.nextNode()){
  const parent=node.parentElement;if(!parent||parent.closest('.sentence-reveal-layer,[aria-hidden="true"]')||proseOnly&&(parent.closest('pre,code,table,button,input,textarea,select,output,time,[data-sensitive],[data-credentials],[data-telemetry],.credential-entry,.credential-input,.surface-metric')||!/[\p{L}]/u.test(node.textContent??'')))continue;
  if(runs.length>=MAX_NODES||text.length+node.textContent!.length>MAX_TEXT)return null;
  const start=text.length;text+=node.textContent;runs.push({node:node as Text,start,end:text.length});
 }
 return {text,runs};
}
function changedRange(previous:string,current:string){let start=0,end=current.length,oldEnd=previous.length;while(start<Math.min(previous.length,current.length)&&previous[start]===current[start])start++;while(end>start&&oldEnd>start&&current[end-1]===previous[oldEnd-1]){end--;oldEnd--;}return {start,end,oldEnd};}
function point(map:TextMap,offset:number,boundary:'start'|'end'):{node:Text;offset:number}|undefined {
 const run=map.runs.find(item=>boundary==='start'?offset>=item.start&&offset<item.end:offset>item.start&&offset<=item.end);return run&&{node:run.node,offset:Math.min(run.node.length,offset-run.start)};
}
function domRange(map:TextMap,start:number,end:number){const first=point(map,start,'start'),last=point(map,end,'end');if(!first||!last)return null;const range=document.createRange();range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset);return range;}
function proseRects(map:TextMap,start:number,end:number,limit:number){
 const rects:DOMRect[]=[];if(limit<=0)return rects;
 for(const run of map.runs){
  if(run.end<=start)continue;if(run.start>=end)break;
  const range=document.createRange();range.setStart(run.node,Math.max(0,start-run.start));range.setEnd(run.node,Math.min(run.node.length,end-run.start));
  for(const rect of range.getClientRects())if(rect.width>.1&&rect.height>.1){rects.push(rect);if(rects.length>=limit)return rects;}
 }
 return rects;
}
function background(root:HTMLElement){for(let node:HTMLElement|null=root;node;node=node.parentElement){const color=getComputedStyle(node).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent')return color;}return getComputedStyle(document.documentElement).getPropertyValue('--surface')||'#fff';}

/** Non-textual grapheme masks preserve the real DOM, selection and accessible prose. */
export function SentenceReveal({text,children,animate=false,initialReveal=false,className='',as='div',revealClassName='sentence-reveal-veil'}:SentenceRevealProps){
 const root=useRef<HTMLElement|null>(null),layer=useRef<HTMLSpanElement|null>(null),previous=useRef<string|null>(null),reveals=useRef<Reveal[]>([]);
 const selected=useRef<{start:number;end:number;content:string;fullText:string}|null>(null);
 const paint=useRef<(()=>void)|null>(null),frame=useRef(0);
 function retire(reveal:Reveal){if(reveal.timer!==null)clearTimeout(reveal.timer);for(const cover of reveal.covers){cover.getAnimations().forEach(animation=>animation.cancel());cover.remove();}reveal.edge?.remove();reveals.current=reveals.current.filter(item=>item!==reveal);}
 function clear(){cancelAnimationFrame(frame.current);frame.current=0;for(const reveal of [...reveals.current])retire(reveal);}
 useLayoutEffect(()=>{
  const element=root.current;if(!element)return;
  function remember(){
   const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed){selected.current=null;return;}
   const range=selection.getRangeAt(0);if(!element!.contains(range.startContainer)||!element!.contains(range.endContainer)){selected.current=null;return;}
   const map=textMap(element!,false);if(!map){selected.current=null;return;}
   const startRun=map.runs.find(run=>run.node===range.startContainer),endRun=map.runs.find(run=>run.node===range.endContainer);
   selected.current=startRun&&endRun?{start:startRun.start+range.startOffset,end:endRun.start+range.endOffset,content:selection.toString(),fullText:map.text}:null;
  }
  const interact=()=>clear();element.addEventListener('pointerdown',interact);element.addEventListener('focusin',interact);element.addEventListener('keydown',interact);document.addEventListener('selectionchange',remember);
  const observer=new ResizeObserver(()=>paint.current?.());observer.observe(element);
  const motion=matchMedia('(prefers-reduced-motion: reduce)'),settle=()=>clear();motion.addEventListener('change',settle);
  const theme=new MutationObserver(settle);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  return()=>{element.removeEventListener('pointerdown',interact);element.removeEventListener('focusin',interact);element.removeEventListener('keydown',interact);document.removeEventListener('selectionchange',remember);observer.disconnect();theme.disconnect();motion.removeEventListener('change',settle);clear();};
 },[]);
 useLayoutEffect(()=>{
  const element=root.current,container=layer.current;if(!element||!container)return;
  const map=textMap(element,true),full=textMap(element,false),selection=selected.current;
  if(full&&selection){
   // React can replace an arriving text node. Restore an unchanged selection by logical offset.
   const diff=changedRange(selection.fullText,full.text),shift=full.text.length-selection.fullText.length;
   let start=selection.start,end=selection.end;
   if(start>=diff.oldEnd){start+=shift;end+=shift;}
   if((selection.end<=diff.start||selection.start>=diff.oldEnd)&&full.text.slice(start,end)===selection.content){
    const range=domRange(full,start,end);if(range){const current=getSelection();current?.removeAllRanges();current?.addRange(range);selected.current={...selection,start,end,fullText:full.text};}
   }else selected.current=null;
  }
  if(!map){clear();previous.current=null;return;}
  const old=previous.current;previous.current=map.text;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const position=()=>{
   const current=textMap(element,true);if(!current)return clear();
   const bounds=element.getBoundingClientRect(),color=background(element);let count=0;
   for(const reveal of [...reveals.current]){
    const elapsed=performance.now()-reveal.created;
    if(elapsed>=reveal.duration){retire(reveal);continue;}
    const progress=Math.min(reveal.boundaries.length-1,Math.floor(elapsed/reveal.duration*reveal.boundaries.length));
    reveal.progress=Math.max(reveal.progress,reveal.boundaries[progress]??reveal.start);
    const rects=proseRects(current,reveal.progress,reveal.end,MAX_COVERS-count);
    while(reveal.covers.length>rects.length){const cover=reveal.covers.pop()!;cover.getAnimations().forEach(animation=>animation.cancel());cover.remove();}
    rects.forEach((rect,index)=>{
     let cover=reveal.covers[index];
     if(!cover){
      cover=document.createElement('span');cover.dataset.revealStart=String(reveal.start);cover.className=revealClassName;container.append(cover);reveal.covers.push(cover);
      // The opaque range moves by grapheme; it never fades future prose into view.
      cover.animate([{opacity:1},{opacity:1}],{duration:Math.max(1,reveal.duration-elapsed),fill:'both'});
     }
     cover.dataset.revealProgress=String(reveal.progress);
     Object.assign(cover.style,{left:`${rect.left-bounds.left+element.scrollLeft}px`,top:`${rect.top-bounds.top+element.scrollTop}px`,width:`${rect.width}px`,height:`${rect.height}px`,backgroundColor:color});
    });count+=rects.length;
    const head=rects[0];
    if(head){
     if(!reveal.edge){const edge=document.createElement('span');edge.className='sentence-reveal-edge';container.append(edge);reveal.edge=edge;}
     Object.assign(reveal.edge.style,{left:`${head.left-bounds.left+element.scrollLeft}px`,top:`${head.top-bounds.top+element.scrollTop}px`,height:`${head.height}px`});
    }
   }
  };
  paint.current=position;
  if(!animate||reduced){clear();return;}
  if(old===map.text){position();return;}
  if(old===null&&!initialReveal&&!element.closest('[data-entry-phase="entering"]'))return;
  const diff=changedRange(old??'',map.text);
  // Appends retain their in-flight animation; a genuine replacement retires stale ranges.
  if(old!==null&&!map.text.startsWith(old))clear();
  if(diff.start<diff.end){
   // Intl.Segmenter keeps combining marks, ZWJ families and skin tones indivisible.
   const segments=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(map.text)];
   const boundaries=segments.filter(segment=>segment.index+segment.segment.length>diff.start&&segment.index<diff.end).map(segment=>segment.index);
   if(boundaries.length){
    const start=boundaries[0]!,end=segments.find(segment=>segment.index>=diff.end)?.index??map.text.length;
    const pending=reveals.current.at(-1),now=performance.now();
    if(pending&&start<=pending.end){
     // Streaming appends extend one advancing edge without resetting its age.
     pending.boundaries.push(...boundaries.filter(boundary=>boundary>pending.boundaries.at(-1)!));pending.end=end;
     pending.duration=Math.min(450,Math.max(pending.duration,now-pending.created+Math.max(120,boundaries.length*9)));
     if(pending.timer!==null)clearTimeout(pending.timer);
     pending.timer=setTimeout(()=>retire(pending),Math.max(0,pending.duration-(now-pending.created)));
    }else{
     const reveal:Reveal={start,end,created:now,duration:Math.min(450,Math.max(120,boundaries.length*9)),boundaries,progress:start,covers:[],edge:null,timer:null};
     if(reveals.current.length>=12)retire(reveals.current[0]!);
     reveal.timer=setTimeout(()=>retire(reveal),reveal.duration);reveals.current.push(reveal);
    }
   }
  }
  position();
  if(!frame.current){const advance=()=>{frame.current=0;paint.current?.();if(reveals.current.length)frame.current=requestAnimationFrame(advance);};frame.current=requestAnimationFrame(advance);}
 },[text,animate,initialReveal,revealClassName]);
 return createElement(as,{ref:root,className:`sentence-reveal ${className}`},children,createElement('span',{ref:layer,className:'sentence-reveal-layer','aria-hidden':true}));
}
