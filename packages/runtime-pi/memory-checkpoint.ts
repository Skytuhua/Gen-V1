import {randomUUID} from 'node:crypto';
import type {Extension,SessionBeforeCompactEvent,SessionBeforeCompactResult} from '@earendil-works/pi-coding-agent';
import {HarnessError} from '../contracts/index.ts';
import type {MemoryCheckpointAckV1,MemoryCheckpointRequestV1,MemoryCheckpointRequirementV1} from '../contracts/memory-checkpoint.ts';
import {requiresMemoryCheckpoint,validateMemoryCheckpointAck,validateMemoryCheckpointRequest} from '../runtime/memory-checkpoint.ts';

export interface PiCheckpointOptions {
 requirement?:MemoryCheckpointRequirementV1;
 binding:()=>Omit<MemoryCheckpointRequestV1,'apiVersion'|'adapterId'|'requestId'|'reason'>;
 request:(request:MemoryCheckpointRequestV1,signal:AbortSignal)=>Promise<MemoryCheckpointAckV1>;
 assertCurrent?:()=>void;
 onFailure?:(error:HarnessError)=>void;
}

export function createPiCheckpointExtension(version:string|undefined,options?:PiCheckpointOptions,modelOnly=false):Extension|undefined {
 if(!options||!requiresMemoryCheckpoint(options.requirement))return undefined;
 if(version!=='1.4.0'||modelOnly)throw new HarnessError('MEMORY_CHECKPOINT_UNSUPPORTED','Required memory checkpoint needs the verified Pi SDK version and a host conversation.');
 const handler=async(event:SessionBeforeCompactEvent):Promise<SessionBeforeCompactResult|undefined>=>{
  try{
   options.assertCurrent?.();event.signal.throwIfAborted();
   const expected={...options.binding(),adapterId:'pi' as const};
   const request=validateMemoryCheckpointRequest({...expected,apiVersion:2,requestId:randomUUID(),reason:event.reason},expected);
   const receipt=await options.request(request,event.signal);
   event.signal.throwIfAborted();options.assertCurrent?.();validateMemoryCheckpointRequest(request,{...options.binding(),adapterId:'pi'});validateMemoryCheckpointAck(receipt,request);
   // Native Pi continues its unchanged default summarizer and history handling.
   return undefined;
  }catch{
   try{options.onFailure?.(new HarnessError('MEMORY_CHECKPOINT_BLOCKED','Native compaction was cancelled because the required memory checkpoint was not confirmed.'));}catch{/* Observers cannot bypass cancellation. */}
   // Pi's ExtensionRunner swallows thrown handlers. A cancel result is mandatory.
   return{cancel:true};
  }
 };
 const path='builtin:harness-memory-checkpoint';
 return{path,resolvedPath:path,hidden:true,sourceInfo:{path,source:'harness',scope:'temporary',origin:'top-level'},handlers:new Map([['session_before_compact',[(event:unknown)=>handler(event as SessionBeforeCompactEvent)]]]),tools:new Map(),commands:new Map(),flags:new Map(),shortcuts:new Map(),messageRenderers:new Map()};
}
