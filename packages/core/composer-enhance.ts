import {randomUUID} from 'node:crypto';
import {HarnessError,type RuntimeAdapter,type RunContext,type RuntimeEvent} from '../contracts/index.ts';

export const ENHANCE_LIMITS={draftBytes:8*1024,projectBytes:8*1024,frameBytes:40*1024,outputBytes:24*1024,timeoutMs:15000} as const;
export type EnhanceTarget={kind:'thread';threadId:string;modelId?:string}|{kind:'new';modelId:string};
export interface EnhanceRequest {draft:string;target:EnhanceTarget}
export interface EnhanceResult {draft:string;usedProjectContext:boolean}
export interface ProjectNote {filename:string;text:string}
/** Admission result resolved server-side. assertCurrent rechecks the exact
 * owner state at capture, dispatch and settlement boundaries. */
export interface EnhanceBasis {modelId:string;accountId:string|null;assertCurrent():void;capture(signal:AbortSignal):Promise<ProjectNote[]|undefined>}
interface Owner {context:RunContext;basis?:EnhanceBasis;usedProjectContext:boolean;creating?:Promise<RuntimeAdapter>;startup?:Promise<void>;closed:boolean;timedOut:boolean;closing?:Promise<void>;failure?:HarnessError;text:string;result:Promise<EnhanceResult>;resolve(value:EnhanceResult):void;reject(error:unknown):void;timer:ReturnType<typeof setTimeout>}
const same=(left:RunContext,right:RunContext)=>left.threadId===right.threadId&&left.runId===right.runId&&left.epoch===right.epoch;
const NEVER=new AbortController().signal;
export const ENHANCE_INVALID_DRAFT='Enhancement requires a nonblank draft of at most 8 KiB.';
export function assertEnhanceDraft(draft:string):void{if(typeof draft!=='string'||!draft.trim()||Buffer.byteLength(draft)>ENHANCE_LIMITS.draftBytes)throw new HarnessError('ENHANCE_INVALID_DRAFT',ENHANCE_INVALID_DRAFT);}

/** Strict single-key {"draft":"..."}; no fences, extra keys or control text. */
export function parseEnhancement(text:string):string|null {
 try{const output:unknown=JSON.parse(text);
  if(!/^\s*\{\s*"draft"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}\s*$/u.test(text)||!output||typeof output!=='object'||Array.isArray(output)||Object.keys(output).length!==1)return null;
  const value=(output as {draft:unknown}).draft;
  if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>ENHANCE_LIMITS.draftBytes||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u.test(value))return null;
  return value;
 }catch{return null;}
}

/** Bounded JSON frame; drop trailing notes before ever failing the request. */
export function enhancePrompt(draft:string,notes:readonly ProjectNote[]|undefined):string {
 let selected=[...(notes??[])];
 while(selected.length&&Buffer.byteLength(JSON.stringify({draft,projectNotes:selected}))>ENHANCE_LIMITS.frameBytes)selected.pop();
 return 'Quoted draft and project notes JSON:\n'+JSON.stringify({draft,projectNotes:selected});
}

/** One active rewrite per host; runtime disposal is the only slot release. */
export class ComposerEnhance {
 private owner?:Owner;
 private disposed=false;
 constructor(private hooks:{factory:()=>RuntimeAdapter|Promise<RuntimeAdapter>;basis:(input:EnhanceRequest)=>EnhanceBasis|Promise<EnhanceBasis>}){}
 get busy():boolean{return this.owner!==undefined;}
 request(input:EnhanceRequest,signal?:AbortSignal):Promise<EnhanceResult> {
  if(this.disposed||signal?.aborted)throw new HarnessError('ENHANCE_CANCELLED','The enhancement was cancelled.');
  assertEnhanceDraft(input.draft);
  // No queue: the slot is reserved synchronously before any admission await.
  if(this.owner)throw new HarnessError('ENHANCE_BUSY','Another enhancement is still running.');
  let resolve!:(value:EnhanceResult)=>void,reject!:(error:unknown)=>void;
  const result=new Promise<EnhanceResult>((yes,no)=>{resolve=yes;reject=no;});
  const owner:Owner={context:{threadId:'enhance-'+randomUUID(),runId:randomUUID(),epoch:0},usedProjectContext:false,closed:false,timedOut:false,text:'',result,resolve,reject,timer:setTimeout(()=>{owner.timedOut=true;void this.close(owner,false,new HarnessError('ENHANCE_TIMEOUT','Enhancement timed out.')).catch(()=>{});},ENHANCE_LIMITS.timeoutMs)};
  owner.timer.unref?.();this.owner=owner;
  const abort=()=>void this.close(owner,false,new HarnessError('ENHANCE_CANCELLED','The enhancement was cancelled.')).catch(()=>{});
  signal?.addEventListener('abort',abort,{once:true});
  void this.run(owner,input,signal).finally(()=>signal?.removeEventListener('abort',abort));
  return result;
 }
 private async run(owner:Owner,input:EnhanceRequest,signal?:AbortSignal):Promise<void> {
  try{
   owner.basis=await this.hooks.basis(input);
   if(owner.closed)return;
   const notes=await owner.basis.capture(signal??NEVER);
   if(owner.closed)return;
   owner.usedProjectContext=!!notes?.length;
   owner.basis.assertCurrent();
   // The isolated adapter exists only after full admission succeeded.
   owner.creating=Promise.resolve().then(()=>this.hooks.factory());
   const adapter=await owner.creating;
   if(owner.closed)return;
   adapter.configure({onEvent:event=>this.event(owner,event),onTool:async()=>{void this.close(owner,false,new HarnessError('ENHANCE_PROVIDER','Enhancement attempted a denied tool.')).catch(()=>{});throw new HarnessError('ENHANCE_TOOL_DENIED','Tools are unavailable to composer enhancement.');}});
   owner.startup=Promise.resolve().then(()=>{if(owner.closed)throw new HarnessError('CANCELLED_RUN','Enhancement context changed.');owner.basis!.assertCurrent();return adapter.start({...owner.context,modelId:owner.basis!.modelId,accountId:owner.basis!.accountId,sessionPath:null,inputId:owner.context.runId,inputIds:[owner.context.runId],resources:[],prompt:enhancePrompt(input.draft,notes)});});
   await owner.startup;
  }catch(error){if(!owner.closed)await this.close(owner,false,error instanceof HarnessError?error:undefined).catch(()=>{});}
 }
 private event(owner:Owner,event:RuntimeEvent):void {
  if(owner.closed||this.owner!==owner||!same(owner.context,event))return;
  if(event.type==='assistant.message'||event.type==='assistant.delta'){
   const value=event.type==='assistant.message'?event.content:event.delta;
   if(typeof value!=='string'){void this.close(owner,false).catch(()=>{});return;}
   owner.text=event.type==='assistant.message'?value:owner.text+value;
   if(Buffer.byteLength(owner.text)>ENHANCE_LIMITS.outputBytes)void this.close(owner,false,new HarnessError('ENHANCE_INVALID_OUTPUT','Enhancement output exceeded its limit.')).catch(()=>{});
  }
  if(event.type==='error')void this.close(owner,false,new HarnessError('ENHANCE_PROVIDER','The configured model failed the enhancement.')).catch(()=>{});
  if(event.type==='settled')void this.close(owner,!event.aborted).catch(()=>{});
 }
 private close(owner:Owner,success:boolean,failure?:HarnessError):Promise<void> {
  if(owner.closing)return owner.closing;
  owner.closed=true;
  if(failure&&!owner.failure)owner.failure=failure;
  owner.closing=Promise.resolve().then(async()=>{
   let cleanupFailed=false;
   try{const adapter=await owner.creating;if(adapter){if(!success)try{await adapter.cancel(owner.context);}catch{/* Disposal must still confirm teardown. */}try{await adapter.dispose();}catch{cleanupFailed=true;}}}
   catch(error){success=false;if(!owner.failure&&error instanceof HarnessError)owner.failure=error;}
   if(owner.startup){const [startup]=await Promise.allSettled([owner.startup]);if(startup.status==='rejected'){success=false;if(!owner.failure&&startup.reason instanceof HarnessError)owner.failure=startup.reason;}}
   // The caller deadline covers settlement and teardown; it never releases the native slot.
   clearTimeout(owner.timer);
   const draft=success&&!owner.timedOut&&!cleanupFailed?parseEnhancement(owner.text):null;
   if(draft===null){
    owner.reject(owner.failure??(owner.timedOut?new HarnessError('ENHANCE_TIMEOUT','Enhancement timed out.'):success?new HarnessError('ENHANCE_INVALID_OUTPUT','The model returned an unusable enhancement.'):new HarnessError('ENHANCE_PROVIDER','The configured model failed the enhancement.')));
   }else{
    try{owner.basis!.assertCurrent();owner.resolve({draft,usedProjectContext:owner.usedProjectContext});}
    catch(error){owner.reject(error);}
   }
   if(!cleanupFailed&&this.owner===owner)this.owner=undefined;
   if(cleanupFailed)throw new HarnessError('ENHANCE_CLEANUP_FAILED','Enhancement cleanup did not finish. Account ownership remains held.');
  });
  return owner.closing;
 }
 async cancel():Promise<void>{if(this.owner)await this.close(this.owner,false,new HarnessError('ENHANCE_CANCELLED','The enhancement was cancelled.'));}
 async dispose():Promise<void>{this.disposed=true;await this.cancel();}
}
