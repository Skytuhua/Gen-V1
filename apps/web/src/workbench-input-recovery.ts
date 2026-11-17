import {sameLogicalOwner,workbenchInputRecoveryRequestV1Schema,workbenchInputRecoveryResultV1Schema,type LogicalOwnerV1,type WorkbenchInputRecoveryRequestV1,type WorkbenchInputRecoveryResultV1} from '../../../packages/contracts/source-selection';
import {journalCompareAndSwap,journalEntries,journalFlush,journalReadRecord} from './journal';

type RecoveryReceipt={commandId:string;eventSeq:number;result:WorkbenchInputRecoveryResultV1};
export const recoveryCommandKey=(owner:LogicalOwnerV1,inputId:string)=>`source-input-recovery:${encodeURIComponent(JSON.stringify([owner.threadId,owner.projectId,owner.workspaceId,inputId]))}`;
export async function pendingInputRecoveries(owner:LogicalOwnerV1):Promise<WorkbenchInputRecoveryRequestV1[]>{
 const pending:WorkbenchInputRecoveryRequestV1[]=[];
 for(const {key,record} of await journalEntries())if(key.startsWith('source-input-recovery:')&&record.value){const value=workbenchInputRecoveryRequestV1Schema.parse(record.value);if(sameLogicalOwner(value.logicalOwner,owner)&&key===recoveryCommandKey(owner,value.inputId))pending.push(value);}
 return pending;
}

/** This local record is retry custody for an existing host input, never a queue
 * or permission to alter task state. A failed acknowledgment freezes the exact
 * command until its matching receipt or a definitive host rejection arrives. */
export async function recoverWorkbenchInput(owner:LogicalOwnerV1,inputId:string,action:WorkbenchInputRecoveryRequestV1['action'],send:(request:WorkbenchInputRecoveryRequestV1)=>Promise<RecoveryReceipt>):Promise<RecoveryReceipt> {
 const key=recoveryCommandKey(owner,inputId);
 await journalFlush();
 for(let attempt=0;attempt<8;attempt++){
  const record=await journalReadRecord<unknown>(key);
  if(!record?.value){
   const request=workbenchInputRecoveryRequestV1Schema.parse({commandId:crypto.randomUUID(),logicalOwner:owner,inputId,action});
   if(!await journalCompareAndSwap(key,record?.generation,request))continue;
   continue;
  }
  const request=workbenchInputRecoveryRequestV1Schema.parse(record.value);
  if(!sameLogicalOwner(request.logicalOwner,owner)||request.inputId!==inputId)throw Error('The recovery command owner changed.');
  if(request.action!==action)throw Error(`The earlier result is uncertain. Retry ${request.action} before choosing another action.`);
  let receipt:RecoveryReceipt;
  try{receipt=await send(request);}catch(cause){
   if(cause&&typeof cause==='object'&&'details' in cause&&(cause.details as {recoveryAccepted?:boolean}|undefined)?.recoveryAccepted===false)await journalCompareAndSwap(key,record.generation,null);
   throw cause;
  }
  const result=workbenchInputRecoveryResultV1Schema.parse(receipt.result);
  if(receipt.commandId!==request.commandId||result.inputId!==request.inputId||result.action!==request.action)throw Error('The recovery receipt does not match the retained command.');
  await journalCompareAndSwap(key,record.generation,null);
  return {...receipt,result};
 }
 throw Error('The recovery choice changed in another window. No new action was sent.');
}
