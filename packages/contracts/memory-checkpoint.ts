import type {RunContext} from './index.ts';

/** Private host custody. Never accepted from tools or encoded into a model prompt. */
export interface MemoryCheckpointRequirementV1 {apiVersion:2;required:true}
export interface MemoryCheckpointRequestV1 {
 apiVersion:2;
 requestId:string;
 adapterId:'pi'|'hermes';
 ctx:RunContext;
 sessionPath:string;
 modelId:string;
 accountId:string|null;
 reason:'manual'|'threshold'|'overflow'|'automatic';
}
/** Only a matching durable receipt authorizes this one native compaction attempt. */
export interface MemoryCheckpointAckV1 {
 apiVersion:2;
 requestId:string;
 checkpointId:string;
 digest:string;
 persisted:true;
}
