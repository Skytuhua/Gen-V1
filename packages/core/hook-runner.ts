import {runProcess} from '../capabilities/process.ts';
import {HarnessError} from '../contracts/index.ts';
import type {Hook,HookEvent,HookRunRecord,HooksDocument} from '../contracts/hooks.ts';
import type {HookSettings} from './hook-settings.ts';

// Runs the user's own shell hooks for host tool calls, prompt submits and turn
// settlements. Commands come only from the user's Settings input (protected
// storage); output is untrusted text — captured, truncated, never executed.
const SUPPORTED_JSON=new Set(['decision','reason','systemMessage','hookSpecificOutput','suppressOutput','permissionDecision','permissionDecisionReason']);
const shell=(command:string):{command:string;args:string[]}=>process.platform==='win32'
 ?{command:process.env.ComSpec??`${process.env.SystemRoot??'C:\\Windows'}\\System32\\cmd.exe`,args:['/D','/S','/C',`"${command}"`]}
 :{command:'/bin/sh',args:['-c',command]};
const isBlockEvent=(event:HookEvent)=>event==='PreToolUse'||event==='UserPromptSubmit';
const label=(hook:Hook)=>hook.name||hook.command.slice(0,60);

function truncatePayload(payload:Record<string,unknown>):Record<string,unknown>{
 const limit=1024*1024;
 let serialized=JSON.stringify(payload);
 if(Buffer.byteLength(serialized,'utf8')<=limit)return payload;
 const clone=JSON.parse(serialized) as Record<string,unknown>;
 const strings:{holder:Record<string,unknown>;key:string;value:string}[]=[];
 const collect=(value:unknown,holder:Record<string,unknown>,key:string)=>{if(typeof value==='string')strings.push({holder,key,value});else if(value&&typeof value==='object'&&!Array.isArray(value))for(const[k,v]of Object.entries(value))collect(v,value as Record<string,unknown>,k);};
 for(const[key,value]of Object.entries(clone))collect(value,clone,key);
 strings.sort((a,b)=>b.value.length-a.value.length);
 for(const entry of strings){
  serialized=JSON.stringify(clone);const excess=Buffer.byteLength(serialized,'utf8')-limit;
  if(excess<=0)break;
  entry.holder[entry.key]=entry.value.slice(0,Math.max(0,entry.value.length-excess));
 }
 return{...clone,truncated:true};
}

export interface HookRunnerOptions {progress?:(message:string)=>void;onRecord?:(hook:Hook,record:HookRunRecord,threadId:string|null)=>void;runProcess?:typeof runProcess;}
export class HookRunner {
 readonly lastRuns=new Map<string,HookRunRecord>();
 private readonly settings:HookSettings|{snapshot():HooksDocument};
 private readonly runProcessImpl:typeof runProcess;
 private readonly progress:(message:string)=>void;
 private readonly onRecord:(hook:Hook,record:HookRunRecord,threadId:string|null)=>void;
 private readonly compiled=new Map<string,RegExp>();
 private readonly stopPending:{hook:Hook;payload:Record<string,unknown>}[]=[];
 private stopRunning=0;
 constructor(settings:HookSettings|{snapshot():HooksDocument},options:HookRunnerOptions={}){this.settings=settings;this.runProcessImpl=options.runProcess??runProcess;this.progress=options.progress??(()=>{});this.onRecord=options.onRecord??(()=>{});}
 private matcher(matcher:string):RegExp|null{if(!matcher||matcher==='*')return null;let regex=this.compiled.get(matcher);if(!regex){regex=new RegExp(`^(?:${matcher})$`);this.compiled.set(matcher,regex);}return regex;}
 /** One in-memory lookup per call: cached document, no file read, no spawn when empty. */
 matching(event:HookEvent,matchKey:string|null):Hook[]{const document=this.settings.snapshot();if(!document.enabled)return[];return document.hooks.filter(hook=>{if(!hook.enabled||hook.event!==event)return false;const regex=this.matcher(hook.matcher);return !regex||regex.test(matchKey??'');});}
 private parse(hook:Hook,event:HookEvent,matchKey:string|null,startedAt:string,started:number,result:{status:string;exitCode:number|null;stdout:string;stderr:string;timedOut:boolean;cancelled:boolean;truncated:boolean}):HookRunRecord{
  const record:HookRunRecord={hookId:hook.id,event,matchKey,startedAt,durationMs:Date.now()-started,outcome:'failed',exitCode:result.exitCode,reason:null,systemMessage:null,stdout:result.stdout,stderr:result.stderr,truncated:result.truncated,ignoredFields:[]};
  if(result.cancelled){record.outcome='cancelled';record.reason='Cancelled.';return record;}
  if(result.timedOut){record.outcome='timed_out';record.reason=`Hook ${label(hook)} timed out after ${hook.timeoutSeconds} s.`;return record;}
  if(result.exitCode===0){
   record.outcome='succeeded';
   const text=result.stdout.trim();
   if(text.startsWith('{')){
    let output:Record<string,unknown>|undefined;
    try{const parsed=JSON.parse(text);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))output=parsed as Record<string,unknown>;}catch{/* invalid */}
    if(!output){record.outcome='failed';record.reason=`Hook ${label(hook)} printed invalid JSON.`;return record;}
    record.ignoredFields=Object.keys(output).filter(key=>!SUPPORTED_JSON.has(key)||key==='permissionDecision'&&output[key]==='ask');
    if(typeof output.systemMessage==='string')record.systemMessage=output.systemMessage.slice(0,4096);
    if(isBlockEvent(event)){
     if(output.decision==='block'){record.outcome='blocked';record.reason=(typeof output.reason==='string'&&output.reason.trim()||`Blocked by hook ${label(hook)}.`).slice(0,2000);return record;}
     const specific=output.hookSpecificOutput as Record<string,unknown>|undefined;
     if(specific?.permissionDecision==='deny'||output.permissionDecision==='deny'){record.outcome='blocked';const why=(specific?.permissionDecisionReason??output.permissionDecisionReason);record.reason=(typeof why==='string'&&why.trim()||`Blocked by hook ${label(hook)}.`).slice(0,2000);}
    }
   }
   return record;
  }
  if(result.exitCode===2&&isBlockEvent(event)){record.outcome='blocked';record.reason=(result.stderr.trim()||`Blocked by hook ${label(hook)}.`).slice(0,2000);return record;}
  record.outcome='failed';record.reason=`Hook ${label(hook)} exited ${result.exitCode??'with no exit code'}.`;
  return record;
 }
 async run(hook:Hook,event:HookEvent,matchKey:string|null,payload:Record<string,unknown>,signal:AbortSignal):Promise<HookRunRecord>{
  const startedAt=new Date().toISOString(),started=Date.now(),spec=shell(hook.command);
  const environment:Record<string,string>={GEN_HOOK_EVENT:event,GEN_THREAD_ID:String(payload.thread_id??'')};
  if(payload.project_dir)environment.GEN_PROJECT_DIR=String(payload.project_dir);
  if(matchKey)environment.GEN_TOOL_NAME=matchKey;
  if(payload.file_path)environment.GEN_FILE_PATH=String(payload.file_path);
  let record:HookRunRecord;
  try{
   const result=await this.runProcessImpl(spec.command,spec.args,String(payload.cwd??process.env.HOME??'.'),signal,this.progress,hook.timeoutSeconds*1000,environment,64*1024,{input:JSON.stringify(truncatePayload(payload))+'\n',label:`hook "${label(hook)}" (${event})`});
   record=this.parse(hook,event,matchKey,startedAt,started,result);
  }catch(error){
   record={hookId:hook.id,event,matchKey,startedAt,durationMs:Date.now()-started,outcome:signal.aborted?'cancelled':'spawn_failed',exitCode:null,reason:signal.aborted?'Cancelled.':`Hook ${label(hook)} could not start: ${error instanceof Error?error.message:'spawn failed'}.`,systemMessage:null,stdout:'',stderr:'',truncated:false,ignoredFields:[]};
  }
  this.lastRuns.set(hook.id,record);this.onRecord(hook,record,payload.thread_id===undefined?null:String(payload.thread_id));
  return record;
 }
 /** R05 tool_response: success results are truncated to 64 KiB and flagged. */
 private static toolResponse(result:unknown,error?:{code:string;message:string}){if(error)return{status:'failed',error};const text=JSON.stringify(result??null);return Buffer.byteLength(text,'utf8')>64*1024?{status:'succeeded',result:{truncated:true,text:text.slice(0,64*1024)}}:{status:'succeeded',result:result??null};}
 /** Wraps one host tool call: Pre hooks, then the body, then Post hooks (R08, R11). */
 async aroundTool(matchKey:string,payload:Record<string,unknown>,signal:AbortSignal,body:()=>Promise<unknown>):Promise<unknown>{
  if(!this.matching('PreToolUse',matchKey).length&&!this.matching('PostToolUse',matchKey).length)return body();
  const blocked=await this.pre('PreToolUse',matchKey,payload,signal);
  if(blocked.blocked)throw new HarnessError('HOOK_BLOCKED',blocked.reason);
  const postPayload={...payload,hook_event_name:'PostToolUse'};
  try{const result=await body();await this.post(matchKey,{...postPayload,tool_response:HookRunner.toolResponse(result)},signal);return result;}
  catch(error){await this.post(matchKey,{...postPayload,tool_response:HookRunner.toolResponse(undefined,{code:error instanceof HarnessError?error.code:'HOST_ERROR',message:error instanceof Error?error.message:'The tool call failed'})},signal).catch(()=>{});throw error;}
 }
 /** Sequential; the first block (or onError:block failure) stops the rest. */
 async pre(event:'PreToolUse'|'UserPromptSubmit',matchKey:string|null,payload:Record<string,unknown>,signal:AbortSignal):Promise<{blocked:false}|{blocked:true;reason:string;record:HookRunRecord}>{
  for(const hook of this.matching(event,matchKey)){
   const record=await this.run(hook,event,matchKey,payload,signal);
   if(record.outcome==='blocked')return{blocked:true,reason:record.reason??`Blocked by hook ${label(hook)}.`,record};
   if(record.outcome!=='succeeded'&&hook.onError==='block')return{blocked:true,reason:`Hook ${label(hook)} failed: ${record.reason}`.slice(0,2000),record};
  }
  return{blocked:false};
 }
 async post(matchKey:string|null,payload:Record<string,unknown>,signal:AbortSignal):Promise<HookRunRecord[]>{
  const records:HookRunRecord[]=[];
  for(const hook of this.matching('PostToolUse',matchKey))records.push(await this.run(hook,'PostToolUse',matchKey,payload,signal));
  return records;
 }
 /** Detached settlement queue: at most 4 Stop hooks running concurrently, extras queued. */
 stop(payload:Record<string,unknown>):void{
  for(const hook of this.matching('Stop',null))this.stopPending.push({hook,payload});
  void this.pumpStop();
 }
 private pumpStop():void{
  while(this.stopRunning<4&&this.stopPending.length){
   const job=this.stopPending.shift() as {hook:Hook;payload:Record<string,unknown>};
   this.stopRunning++;
   this.run(job.hook,'Stop',null,job.payload,new AbortController().signal).finally(()=>{this.stopRunning--;this.pumpStop();});
  }
 }
}
