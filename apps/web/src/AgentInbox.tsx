import {InboxView} from './InboxView';
import {useAttention} from './useAttention';

/** The personal host adapter is never exported into the opaque plug-in runtime. */
export function AgentInbox({onOpenThread,active=true}:{onOpenThread:(threadId:string)=>void|Promise<void>;active?:boolean}){const attention=useAttention(active);return <InboxView attention={attention} onOpenThread={onOpenThread}/>;}
