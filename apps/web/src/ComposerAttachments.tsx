import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {File} from 'lucide-react';
import type {ResourceGrant} from '../../../packages/contracts';
import './composer-entry.css';

export function ComposerAttachments({resources}:{resources:readonly ResourceGrant[]}) {
  const attachments=resources.filter(resource=>resource.kind!=='project'),present=attachments.length>0;
  const previous=useRef(attachments),[retained,setRetained]=useState(present);
  useLayoutEffect(()=>{if(present)previous.current=attachments;},[resources]);
  useEffect(()=>{
    if(present){setRetained(true);return;}
    const timer=setTimeout(()=>setRetained(false),180);return()=>clearTimeout(timer);
  },[present]);
  if(!present&&!retained)return null;
  return <div className="composer-attachment-band" data-state={present?'open':'closing'} role="group" aria-label="Attachments" aria-hidden={!present} inert={!present}>
    <div className="composer-attachment-clip"><div className="resource-strip">
      {(present?attachments:previous.current).map(resource=><span key={resource.id} className="resource-chip" title={`${resource.path} · ${resource.writable?'Approved writes allowed':'Read only'}`}><File size={12}/>{resource.label}</span>)}
    </div></div>
  </div>;
}
