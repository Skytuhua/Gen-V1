import {useEffect,useState,type ComponentType} from 'react';
import { ChevronRight, Webhook } from 'lucide-react';
import type { Message } from '../../../packages/contracts';
import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';
import {useSourceWorkbench} from './SourceWorkbench';
function DeferredWorkbenchActivity({updates}:{updates:Message[]}) {
  const [Content,setContent]=useState<ComponentType<{updates:Message[]}>>(),[failed,setFailed]=useState(false);
  useEffect(()=>{
    let current=true;
    void import('./WorkbenchActivity').then(module=>{if(current)setContent(()=>module.WorkbenchActivity);}).catch(()=>{if(current)setFailed(true);});
    return()=>{current=false;};
  },[]);
  return failed?<p role="alert">The activity view could not be loaded. Reload the window to retry.</p>:Content?<Content updates={updates}/>:<p role="status">Loading work activity.</p>;
}

export function groupWorkActivity(messages: Message[], artifactMessageIds: Set<string>) {
  const rows: { message: Message; updates?: Message[] }[] = [];
  let updates: Message[] | undefined;
  for (const message of messages) {
    const hasArtifact = artifactMessageIds.has(message.id);
    if (message.role === 'assistant' && !message.content.trim() && !hasArtifact) continue;
    if (message.role === 'activity' && !hasArtifact) {
      if (!updates) { updates = []; rows.push({ message, updates }); }
      updates.push(message);
    } else {
      updates = undefined;
      rows.push({ message, ...(message.role === 'activity' ? { updates: [message] } : {}) });
    }
  }
  return rows;
}

export function WorkActivity({ updates }: { updates: Message[] }) {
  const workbench=useSourceWorkbench();
  if(workbench?.enabled&&workbench.owner&&updates.every(update=>update.threadId===workbench.owner!.threadId)&&
    (updates.length>60||updates.reduce((count,update)=>count+update.content.split('\n').length,0)>300))return <DeferredWorkbenchActivity updates={updates}/>;
  const latest = updates.at(-1)?.content.trim() || 'Details unavailable';
  return <details className="activity">
    <summary><ChevronRight size={14} aria-hidden="true" /><span className="activity-label">Work activity · {updates.length} {updates.length === 1 ? 'update' : 'updates'}</span><span className="activity-latest" title={latest}> · {latest}</span></summary>
    <ol aria-label="Activity updates">{updates.map(update => {
      if (update.activityKind !== 'hook') return <li key={update.id}><Markdown text={update.content} /><CopyButton text={update.content} label="Copy update"/></li>;
      const boundary = update.content.indexOf('\n'), line = boundary < 0 ? update.content : update.content.slice(0, boundary), output = boundary < 0 ? '' : update.content.slice(boundary + 1);
      return <li key={update.id} className="activity-hook"><Webhook size={13} aria-hidden="true"/><div className="activity-hook-body"><Markdown text={line} />{output && <details className="activity-hook-output"><summary>Hook output</summary><pre>{output}</pre></details>}</div><CopyButton text={update.content} label="Copy update"/></li>;
    })}</ol>
  </details>;
}

