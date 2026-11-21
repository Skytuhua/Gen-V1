import {useState} from 'react';
import type {Snapshot} from '../../../packages/contracts';
import {PlanRecordSchema,planDataId,PLANNING_PROVENANCE} from '../../../packages/contracts/planning';
import {PlanStatus} from './PlanStatus';
import {Markdown} from './Markdown';
import {CopyButton} from './CopyButton';
import {MessageActions} from './MessageActions.tsx';
import {hasSpeechText} from './read-aloud-text.ts';
import {useThreadMessages} from './thread-messages';

export function DelegatedAgentTranscript({threadId,agentId,snapshot}:{threadId:string;agentId:string;snapshot:Snapshot}){
 const [history,setHistory]=useState(100);
 const record=snapshot.data.find(item=>item.id===planDataId(threadId)&&item.threadId===threadId&&item.provenance===PLANNING_PROVENANCE),parsed=PlanRecordSchema.safeParse(record?.value),agent=parsed.success?parsed.data.agents.find(item=>item.id===agentId):undefined;
 const threadMessages=useThreadMessages(snapshot,agent?.childThreadId);
 const child=snapshot.threads.find(item=>item.id===agent?.childThreadId);
 if(!agent||!parsed.success||!record)return <p role="status">This subagent record is no longer available.</p>;
 const messages=threadMessages.messages;
 return <><PlanStatus threadId={threadId} snapshot={snapshot} focusAgentId={agentId}/><div className="canvas-thread-transcript" role="log" aria-label="Delegated agent messages">{(messages.length>history||threadMessages.remaining>0)&&<button className="quiet" disabled={threadMessages.loading} onClick={()=>{if(messages.length>history)setHistory(value=>value+100);else void threadMessages.loadMore();}}>Load earlier messages</button>}{messages.slice(-history).map(message=><div className={`message message-${message.role}`} key={message.id}><Markdown text={message.content}/>{(()=>{const live=Boolean(child&&child.status==='working'&&(!child.runId||child.runId===message.runId));return message.role==='assistant'&&!live&&hasSpeechText(message.content)?<MessageActions threadId={message.threadId} messageId={message.id} text={message.content} live={live} active={true}/>:<CopyButton text={message.content} label="Copy message"/>;})()}</div>)}</div></>;
}
