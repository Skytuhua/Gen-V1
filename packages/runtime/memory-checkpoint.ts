import {HarnessError,type RuntimeCallbacks} from '../contracts/index.ts';
import type {MemoryCheckpointAckV1,MemoryCheckpointRequestV1,MemoryCheckpointRequirementV1} from '../contracts/memory-checkpoint.ts';

export const MEMORY_CHECKPOINT_TIMEOUT_MS=15_000;
type Binding=Pick<MemoryCheckpointRequestV1,'adapterId'|'ctx'|'sessionPath'|'modelId'|'accountId'>;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,limit=512):value is string=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value,'utf8')<=limit;
const failure=(code:string,message:string)=>new HarnessError(code,message);

export function requiresMemoryCheckpoint(value:unknown):value is MemoryCheckpointRequirementV1 {
 if(value===undefined)return false;
 if(!record(value)||value.apiVersion!==2||value.required!==true||Object.keys(value).some(key=>key!=='apiVersion'&&key!=='required'))throw failure('MEMORY_CHECKPOINT_UNSUPPORTED','Required memory checkpoint API or capability is unsupported.');
 return true;
}
export function sameMemoryCheckpointRequirement(a:unknown,b:unknown):boolean{return requiresMemoryCheckpoint(a)===requiresMemoryCheckpoint(b);}

export function validateMemoryCheckpointRequest(value:unknown,expected:Binding):MemoryCheckpointRequestV1 {
 const keys=['apiVersion','requestId','adapterId','ctx','sessionPath','modelId','accountId','reason'];
 if(!record(value)||Object.keys(value).some(key=>!keys.includes(key))||value.apiVersion!==2||!text(value.requestId,128)||!record(value.ctx)||Object.keys(value.ctx).some(key=>!['threadId','runId','epoch'].includes(key))||!text(value.ctx.threadId)||!text(value.ctx.runId)||!Number.isSafeInteger(value.ctx.epoch)||Number(value.ctx.epoch)<0||!text(value.sessionPath,4096)||!text(value.modelId)||!(value.accountId===null||text(value.accountId))||!['manual','threshold','overflow','automatic'].includes(String(value.reason)))throw failure('MEMORY_CHECKPOINT_INVALID','The private memory checkpoint request is invalid.');
 if(value.adapterId!==expected.adapterId||value.ctx.threadId!==expected.ctx.threadId||value.ctx.runId!==expected.ctx.runId||value.ctx.epoch!==expected.ctx.epoch||value.sessionPath!==expected.sessionPath||value.modelId!==expected.modelId||value.accountId!==expected.accountId)throw failure('MEMORY_CHECKPOINT_OWNER','The memory checkpoint belongs to a different native owner.');
 return Object.freeze({...value,ctx:Object.freeze({...value.ctx})}) as unknown as MemoryCheckpointRequestV1;
}

export function validateMemoryCheckpointAck(value:unknown,request:MemoryCheckpointRequestV1):MemoryCheckpointAckV1 {
 if(!record(value)||Object.keys(value).some(key=>!['apiVersion','requestId','checkpointId','digest','persisted'].includes(key))||value.apiVersion!==2||value.requestId!==request.requestId||!text(value.checkpointId,256)||typeof value.digest!=='string'||!/^[a-f0-9]{64}$/.test(value.digest)||value.persisted!==true)throw failure('MEMORY_CHECKPOINT_UNCONFIRMED','The host did not confirm durable memory checkpoint persistence.');
 return Object.freeze({...value}) as unknown as MemoryCheckpointAckV1;
}

/** The callback is trusted host persistence, separate from native/model tool authority. */
export async function routeMemoryCheckpoint(value:unknown,expected:Binding,callback:RuntimeCallbacks['onMemoryCheckpoint'],assertCurrent:()=>void):Promise<MemoryCheckpointAckV1> {
 assertCurrent();const request=validateMemoryCheckpointRequest(value,expected);
 if(!callback)throw failure('MEMORY_CHECKPOINT_UNSUPPORTED','Required host memory checkpoint persistence is unavailable.');
 const result=await callback(request);assertCurrent();return validateMemoryCheckpointAck(result,request);
}
