import {File} from 'lucide-react';
import {useLayoutEffect, useRef, useState} from 'react';
import type {ResourceGrant} from '../../../packages/contracts';
import './composer-entry.css';
import {TerminalExcerpt} from './TerminalExcerpt';
import type {TerminalExcerpt as Excerpt} from './terminal-excerpts';
import {reducedMotion} from './task-motion';

export function ComposerAttachments({resources,excerpts=[],disabled=false,onEditExcerpt,onRemoveExcerpt}:{resources:readonly ResourceGrant[];excerpts?:readonly Excerpt[];disabled?:boolean;onEditExcerpt?:(id:string,text:string)=>Promise<void>;onRemoveExcerpt?:(id:string)=>Promise<void>}) {
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
  if(!animated)for(const id of leaving)cache.current.delete(id);
  if(fresh.length||back.length||(!animated&&leaving.size))setLeaving(previous=>{const next=new Set(previous);for(const id of fresh)next.add(id);for(const id of back)next.delete(id);if(!animated)next.clear();return next;});
 },[attachments]);
 if(!attachments.length&&!excerpts.length&&!leaving.size)return null;
 return <div className="composer-attachment-band" data-state="open" role="group" aria-label="Attachments"><div className="composer-attachment-clip"><div className="resource-strip">
  {attachments.map(resource=><span key={resource.id} className="resource-chip" title={`${resource.path} · ${resource.writable?'Approved writes allowed':'Read only'}`}><File size={12}/>{resource.label}</span>)}
  {[...leaving].map(id=>{const resource=cache.current.get(id);return resource?<span key={id} className="resource-chip" data-leaving aria-hidden="true" onAnimationEnd={()=>{cache.current.delete(id);setLeaving(previous=>{const next=new Set(previous);next.delete(id);return next;});}}><File size={12}/>{resource.label}</span>:null;})}
  {excerpts.map(excerpt=><TerminalExcerpt key={excerpt.id} excerpt={excerpt} disabled={disabled||!onEditExcerpt||!onRemoveExcerpt} onEdit={text=>onEditExcerpt!(excerpt.id,text)} onRemove={()=>onRemoveExcerpt!(excerpt.id)}/>)}
 </div></div></div>;
}
