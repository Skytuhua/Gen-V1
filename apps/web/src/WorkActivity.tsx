import { ChevronRight } from 'lucide-react';
import type { Message } from '../../../packages/contracts';
import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';
import {useSourceWorkbench} from './SourceWorkbench';
import {WorkbenchActivity} from './WorkbenchActivity';

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
    (updates.length>60||updates.reduce((count,update)=>count+update.content.split('\n').length,0)>300))return <WorkbenchActivity updates={updates}/>;
  const latest = updates.at(-1)?.content.trim() || 'Details unavailable';
  return <details className="activity">
    <summary><ChevronRight size={14} aria-hidden="true" /><span className="activity-label">Work activity · {updates.length} {updates.length === 1 ? 'update' : 'updates'}</span><span className="activity-latest" title={latest}> · {latest}</span></summary>
    <ol aria-label="Activity updates">{updates.map(update => <li key={update.id}><CopyButton text={update.content} label="Copy update"/><Markdown text={update.content} /></li>)}</ol>
  </details>;
}
