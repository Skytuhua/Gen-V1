import {useState} from 'react';
import type {Snapshot} from '../../../packages/contracts';
import {PlanRecordSchema,planDataId,PLANNING_PROVENANCE} from '../../../packages/contracts/planning';
import {PlanStatus} from './PlanStatus';
import {Markdown} from './Markdown';

export function DelegatedAgentTranscript({threadId,agentId,snapshot}:{threadId:string;agentId:string;snapshot:Snapshot}){
 const [history,setHistory]=useState(100);
 const record=snapshot.data.find(item=>item.id===planDataId(threadId)&&item.threadId===threadId&&item.provenance===PLANNING_PROVENANCE),parsed=PlanRecordSchema.safeParse(record?.value),agent=parsed.success?parsed.data.agents.find(item=>item.id===agentId):undefined;
 if(!agent||!parsed.success||!record)return <p role="alert">This subagent record is no longer available.</p>;
 const messages=agent.childThreadId?snapshot.messages.filter(message=>message.threadId===agent.childThreadId):[];
 return <><PlanStatus threadId={threadId} snapshot={{...snapshot,data:snapshot.data.map(item=>item===record?{...record,value:{...parsed.data,title:agent.name,steps:[],agents:[agent]}}:item)}}/><div className="canvas-thread-transcript" role="log" aria-label="Delegated agent messages">{messages.length>history&&<button className="quiet" onClick={()=>setHistory(value=>value+100)}>Load earlier messages</button>}{messages.slice(-history).map(message=><div className={`message message-${message.role}`} key={message.id}><Markdown text={message.content}/></div>)}</div><p className="canvas-thread-readonly">Read-only delegated transcript</p></>;
}
