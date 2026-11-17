import {z} from 'zod';
import {
 capturedSourceV1Schema, logicalOwnerV1Schema, sameLogicalOwner, selectedSourceV1Schema, sourceCandidateV1Schema,
 sourceDescriptorV1Schema, sourceOpenV1Schema, workbenchEvidenceItemV1Schema, workbenchModuleV1Schema, sourceCapabilityV1Schema, outputReadResultV1Schema,workbenchInputsV1Schema,workbenchInputRecoveryRequestV1Schema,workbenchInputRecoveryResultV1Schema,type WorkbenchInputRecoveryRequestV1,
 type LogicalOwnerV1, type SelectedSourceV1, type SourceDescriptorV1, type SourceLocatorV1, type SourceRefV1,
} from '../../../packages/contracts/source-selection';
import {authenticated, csrfToken, read} from './api';

const catalogueSchema = z.strictObject({logicalOwner:logicalOwnerV1Schema,enabled:z.boolean(),sources:z.array(sourceCandidateV1Schema).max(100),sourceCapabilities:z.array(sourceCapabilityV1Schema).max(4)});
const evidenceSchema = z.strictObject({logicalOwner:logicalOwnerV1Schema,items:z.array(workbenchEvidenceItemV1Schema),modules:z.array(workbenchModuleV1Schema)});
const recoveryReceiptSchema=z.strictObject({commandId:z.string().min(1),eventSeq:z.number().int(),result:workbenchInputRecoveryResultV1Schema});
async function request<T>(path:string,schema:z.ZodType<T>,body?:unknown,signal?:AbortSignal):Promise<T> {
 const response = await authenticated(() => fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal,
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify(body)})}));
 return schema.parse(await read<unknown>(response));
}
function owned<T extends {logicalOwner:LogicalOwnerV1}>(owner:LogicalOwnerV1,value:T):T {
 if(!sameLogicalOwner(owner,value.logicalOwner)) throw Error('The source owner changed. The draft was retained.');
 return value;
}
export const workbenchApi = {
 inputs:async(owner:LogicalOwnerV1,signal?:AbortSignal)=>owned(owner,await request(`/api/workbench/threads/${encodeURIComponent(owner.threadId)}/inputs`,workbenchInputsV1Schema,undefined,signal)),
 recoverInput:async(input:WorkbenchInputRecoveryRequestV1,signal?:AbortSignal)=>request('/api/workbench/inputs/recover',recoveryReceiptSchema,workbenchInputRecoveryRequestV1Schema.parse(input),signal),
 output:async(owner:LogicalOwnerV1,messageIds:string[],sourceRevision:string,signal?:AbortSignal)=>owned(owner,await request('/api/workbench/output/read',outputReadResultV1Schema,{logicalOwner:owner,messageIds,sourceRevision},signal)),
 catalogue:async(owner:LogicalOwnerV1,signal?:AbortSignal)=>owned(owner,await request(`/api/workbench/threads/${encodeURIComponent(owner.threadId)}`,catalogueSchema,undefined,signal)),
 evidence:async(owner:LogicalOwnerV1,signal?:AbortSignal)=>owned(owner,await request(`/api/workbench/threads/${encodeURIComponent(owner.threadId)}/evidence`,evidenceSchema,undefined,signal)),
 describe:async(owner:LogicalOwnerV1,locator:SourceLocatorV1,signal?:AbortSignal)=>owned(owner,await request('/api/workbench/sources/describe',sourceDescriptorV1Schema,{logicalOwner:owner,locator},signal)),
 capture:async(source:SelectedSourceV1,signal?:AbortSignal)=>{
  const result=await request('/api/workbench/sources/capture',capturedSourceV1Schema,{commandId:crypto.randomUUID(),source:selectedSourceV1Schema.parse(source)},signal);
  owned(source.logicalOwner,result.ref.source); return result;
 },
 open:async(owner:LogicalOwnerV1,ref:SourceRefV1,signal?:AbortSignal)=>{
  const result=await request('/api/workbench/sources/open',sourceOpenV1Schema,{logicalOwner:owner,ref},signal);
  owned(owner,result.ref.source);
  if(result.ref.captureId!==ref.captureId||JSON.stringify(result.ref.source)!==JSON.stringify(ref.source)) throw Error('The retained source identity changed.');
  return result;
 },
 refresh:async(owner:LogicalOwnerV1,ref:SourceRefV1,signal?:AbortSignal)=>{
  const result=await request('/api/workbench/sources/refresh',capturedSourceV1Schema,{commandId:crypto.randomUUID(),logicalOwner:owner,ref},signal);
  owned(owner,result.ref.source); return result;
 },
};
export type WorkbenchApi = typeof workbenchApi;
export async function textDigest(text:string):Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function messageSelection(descriptor:SourceDescriptorV1,start:number,end:number):Promise<SelectedSourceV1> {
 if(descriptor.locator.kind!=='MESSAGE') throw Error('This source is not a message.');
 return selectedSourceV1Schema.parse({...descriptor.locator,logicalOwner:descriptor.logicalOwner,sourceRevision:descriptor.sourceRevision,contentDigest:descriptor.contentDigest,capturedAt:new Date().toISOString(),range:{encoding:'UTF16',start,end,selectedTextDigest:await textDigest(descriptor.text.slice(start,end))}});
}
