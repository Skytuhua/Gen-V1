import {InboxView} from './InboxView';
import {useAttention} from './useAttention';
import type {TimeFormat} from './time-format';

/** The personal host adapter is never exported into the opaque plug-in runtime. */
export function AgentInbox({onOpenThread,active=true,timeFormat}:{onOpenThread:(threadId:string)=>void|Promise<void>;active?:boolean;timeFormat?:TimeFormat}){const attention=useAttention(active);return <InboxView attention={attention} onOpenThread={onOpenThread} timeFormat={timeFormat}/>;}
