import {File,Lock} from 'lucide-react';
import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import type {ResourceGrant} from '../../../packages/contracts';
import './composer-entry.css';
import {TerminalExcerpt} from './TerminalExcerpt';
import type {TimeFormat} from './time-format';
import type {TerminalExcerpt as Excerpt} from './terminal-excerpts';
import {animateTask} from './task-motion';

type Attachment = {id:string;resource:ResourceGrant;excerpt?:never}|{id:string;excerpt:Excerpt;resource?:never};
function AttachmentItem({leaving,children,onExit}:{leaving:boolean;children:ReactNode;onExit:()=>void}) {
 const element=useRef<HTMLDivElement>(null),finish=useRef(onExit),interrupted=useRef<Keyframe|undefined>(undefined);
 finish.current=onExit;
 useLayoutEffect(()=>{
  const node=element.current!,style=getComputedStyle(node);
  const geometry={width:style.width,paddingLeft:style.paddingLeft,paddingRight:style.paddingRight,marginRight:style.marginRight};
  const from=interrupted.current??(leaving?{opacity:1,transform:'scale(1)',...geometry}:{opacity:0,transform:'scale(.96)'});
  const to=leaving?{opacity:0,transform:'scale(1)',width:'0px',paddingLeft:'0px',paddingRight:'0px',marginRight:'0px'}:{opacity:1,transform:'scale(1)',...geometry};
  interrupted.current=undefined;
  const animation=node.closest('.app-shell')?.getAttribute('data-panel-animations')==='false'?undefined:animateTask(node,[from,to],0,{duration:leaving?'--ui-motion-remove':'--ui-motion-insert',easing:leaving?'--ui-ease-move':'--ui-ease-enter'});
  let active=true;
  const done=()=>{if(active&&leaving)finish.current();};
  if(animation)void animation.finished.then(done).catch(()=>{});else done();
  return()=>{
   active=false;
   if(animation?.playState==='running'||animation?.playState==='paused'){
    const current=getComputedStyle(node);
    interrupted.current={opacity:current.opacity,transform:current.transform,width:current.width,paddingLeft:current.paddingLeft,paddingRight:current.paddingRight,marginRight:current.marginRight};
   }
   animation?.cancel();
  };
 },[leaving]);
 return <div ref={element} className="composer-attachment-item" data-leaving={leaving||undefined} aria-hidden={leaving||undefined} inert={leaving}>{children}</div>;
}

export function ComposerAttachments({resources,excerpts=[],disabled=false,onEditExcerpt,onRemoveExcerpt,timeFormat}:{resources:readonly ResourceGrant[];excerpts?:readonly Excerpt[];disabled?:boolean;onEditExcerpt?:(id:string,text:string)=>Promise<void>;onRemoveExcerpt?:(id:string)=>Promise<void>;timeFormat?:TimeFormat}) {
 const attachments:Attachment[]=[...resources.filter(resource=>resource.kind!=='project').map(resource=>({id:'resource:'+resource.id,resource})),...excerpts.map(excerpt=>({id:'excerpt:'+excerpt.id,excerpt}))];
 // Keep recently removed chips mounted long enough for their exit animation.
 const cache=useRef(new Map<string,Attachment>()),[leaving,setLeaving]=useState<ReadonlySet<string>>(new Set());
 useLayoutEffect(()=>{
  const now=new Set(attachments.map(resource=>resource.id));
  for(const attachment of attachments)cache.current.set(attachment.id,attachment);
  const fresh=[...cache.current.keys()].filter(id=>!now.has(id)&&!leaving.has(id));
  const back=[...leaving].filter(id=>now.has(id));
  if(fresh.length||back.length)setLeaving(previous=>{const next=new Set(previous);for(const id of fresh)next.add(id);for(const id of back)next.delete(id);return next;});
 },[attachments]);
 if(!attachments.length&&!cache.current.size)return null;
 const current=new Set(attachments.map(item=>item.id));
 const retained=[...attachments,...[...cache.current.values()].filter(item=>!current.has(item.id))];
 return <div className="composer-attachment-band" data-state="open" role="group" aria-label="Attachments"><div className="composer-attachment-clip"><div className="resource-strip">
  {retained.map(item=>{const outgoing=!current.has(item.id);return <AttachmentItem key={item.id} leaving={outgoing} onExit={()=>{cache.current.delete(item.id);setLeaving(previous=>{const next=new Set(previous);next.delete(item.id);return next;});}}>{item.resource?<span className="resource-chip" data-leaving={outgoing||undefined} aria-hidden={outgoing||undefined} title={`${item.resource.path} · ${item.resource.writable?'Approved writes allowed':'Read only — the agent can view this file but cannot change it'}`}><File size={12}/>{item.resource.label}{!item.resource.writable&&<Lock size={10} aria-label="Read only" className="resource-chip-readonly"/>}</span>:<TerminalExcerpt excerpt={item.excerpt} disabled={disabled||!onEditExcerpt||!onRemoveExcerpt} onEdit={text=>onEditExcerpt!(item.excerpt.id,text)} onRemove={()=>onRemoveExcerpt!(item.excerpt.id)} timeFormat={timeFormat}/>}</AttachmentItem>;})}
 </div></div></div>;
}
