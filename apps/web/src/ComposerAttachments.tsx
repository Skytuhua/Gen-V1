import {File,Lock} from 'lucide-react';
import {useLayoutEffect, useRef, useState} from 'react';
import type {ResourceGrant} from '../../../packages/contracts';
import './composer-entry.css';
import {TerminalExcerpt} from './TerminalExcerpt';
import type {TimeFormat} from './time-format';
import type {TerminalExcerpt as Excerpt} from './terminal-excerpts';
import {reducedMotion} from './task-motion';

export function ComposerAttachments({resources,excerpts=[],disabled=false,onEditExcerpt,onRemoveExcerpt,timeFormat}:{resources:readonly ResourceGrant[];excerpts?:readonly Excerpt[];disabled?:boolean;onEditExcerpt?:(id:string,text:string)=>Promise<void>;onRemoveExcerpt?:(id:string)=>Promise<void>;timeFormat?:TimeFormat}) {
 const attachments=resources.filter(resource=>resource.kind!=='project');
 // Keep recently removed chips mounted long enough for their exit animation.
 const cache=useRef(new Map<string,ResourceGrant>()),[leaving,setLeaving]=useState<ReadonlySet<string>>(new Set());
 useLayoutEffect(()=>{
  const now=new Set(attachments.map(resource=>resource.id));
  for(const resource of attachments)cache.current.set(resource.id,resource);
  // Exit animations cannot finish when the motion policy or panel animations disable them.
  const animated=!reducedMotion()&&document.querySelector('.app-shell')?.getAttribute('data-panel-animations')!=='false';
  const fresh=animated?[...cache.current.keys()].filter(id=>!now.has(id)&&!leaving.has(id)):[];
  const back=[...leaving].filter(id=>now.has(id));
  if(!animated)for(const id of cache.current.keys())if(!now.has(id))cache.current.delete(id);
  if(fresh.length||back.length||(!animated&&leaving.size))setLeaving(previous=>{const next=new Set(previous);for(const id of fresh)next.add(id);for(const id of back)next.delete(id);if(!animated)next.clear();return next;});
 },[attachments]);
 // The row itself exits on its own 180ms tween, slightly longer than a leaving chip.
 const empty=!attachments.length&&!excerpts.length,[rowClosing,setRowClosing]=useState(false),wasEmpty=useRef(empty);
 useLayoutEffect(()=>{
  const animated=!reducedMotion()&&document.querySelector('.app-shell')?.getAttribute('data-panel-animations')!=='false';
  if(empty&&!wasEmpty.current&&animated)setRowClosing(true);
  if(!empty&&rowClosing)setRowClosing(false);
  wasEmpty.current=empty;
 },[empty,rowClosing]);
 if(!attachments.length&&!excerpts.length&&!leaving.size&&!rowClosing)return null;
 return <div className="composer-attachment-band" data-state={attachments.length||excerpts.length?'open':'closed'} role="group" aria-label="Attachments" onTransitionEnd={event=>{if(event.propertyName==='grid-template-rows'&&!attachments.length&&!excerpts.length)setRowClosing(false);}}><div className="composer-attachment-clip"><div className="resource-strip">
  {attachments.map(resource=><span key={resource.id} className="resource-chip" title={`${resource.path} · ${resource.writable?'Approved writes allowed':'Read only — the agent can view this file but cannot change it'}`}><File size={12}/>{resource.label}{!resource.writable&&<Lock size={10} aria-label="Read only" className="resource-chip-readonly"/>}</span>)}
  {[...leaving].map(id=>{const resource=cache.current.get(id);return resource?<span key={id} className="resource-chip" data-leaving aria-hidden="true" onAnimationEnd={()=>{cache.current.delete(id);setLeaving(previous=>{const next=new Set(previous);next.delete(id);return next;});}}><File size={12}/>{resource.label}</span>:null;})}
  {excerpts.map(excerpt=><TerminalExcerpt key={excerpt.id} excerpt={excerpt} disabled={disabled||!onEditExcerpt||!onRemoveExcerpt} onEdit={text=>onEditExcerpt!(excerpt.id,text)} onRemove={()=>onRemoveExcerpt!(excerpt.id)} timeFormat={timeFormat}/>)}
 </div></div></div>;
}
