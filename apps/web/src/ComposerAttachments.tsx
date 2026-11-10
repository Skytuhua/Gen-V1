import {File} from 'lucide-react';
import type {ResourceGrant} from '../../../packages/contracts';
import './composer-entry.css';
import {TerminalExcerpt} from './TerminalExcerpt';
import type {TerminalExcerpt as Excerpt} from './terminal-excerpts';

export function ComposerAttachments({resources,excerpts=[],disabled=false,onEditExcerpt,onRemoveExcerpt}:{resources:readonly ResourceGrant[];excerpts?:readonly Excerpt[];disabled?:boolean;onEditExcerpt?:(id:string,text:string)=>Promise<void>;onRemoveExcerpt?:(id:string)=>Promise<void>}) {
 const attachments=resources.filter(resource=>resource.kind!=='project');
 if(!attachments.length&&!excerpts.length)return null;
 return <div className="composer-attachment-band" data-state="open" role="group" aria-label="Attachments"><div className="composer-attachment-clip"><div className="resource-strip">
  {attachments.map(resource=><span key={resource.id} className="resource-chip" title={`${resource.path} · ${resource.writable?'Approved writes allowed':'Read only'}`}><File size={12}/>{resource.label}</span>)}
  {excerpts.map(excerpt=><TerminalExcerpt key={excerpt.id} excerpt={excerpt} disabled={disabled||!onEditExcerpt||!onRemoveExcerpt} onEdit={text=>onEditExcerpt!(excerpt.id,text)} onRemove={()=>onRemoveExcerpt!(excerpt.id)}/>)}
 </div></div></div>;
}
