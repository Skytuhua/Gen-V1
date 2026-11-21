import {join} from 'node:path';
import {runProcess} from '../capabilities/process.ts';
import {type Hook,type HookEvent,type HookRunRecord} from '../contracts/hooks.ts';
import type {HookSettings} from './hook-settings.ts';

export interface HookPayload {hook_event_name:string;session_id:string|null;thread_id:string|null;run_id:string|null;cwd:string;project_dir:string|null;gen_version:string;[key:string]:unknown;}
const OUTPUT_LIMIT=64*1024;
const INPUT_LIMIT=1024*1024;
const IGNORED_FIELDS=['updatedInput','additionalContext','continue'];
const shellArgv=(command:string):[string,string[]]=>process.platform==='win32'
 ?[process.env.ComSpec??join(process.env.SystemRoot??'C:\\Windows','System32','cmd.exe'),['/D','/S','/C',`"${command}"`]]
 :['/bin/sh',['-c',command]];

// Truncates the largest string fields until the payload fits the 1 MiB stdin limit (R05).
function fitInput(original:HookPayload):string{
 const payload={...original};
 const fields=Object.entries(payload).map(([key,value])=>({key,value})).sort((a,b)=>String(b.value).length-String(a.value).length);
 let truncated=false;
 while(JSON.stringify(payload).length>INPUT_LIMIT){
  const field=fields.find(item=>typeof payload[item.key]==='string'&&String(payload[item.key]).length>1024);
  if(!field)break;
  const excess=JSON.stringify(payload).length-INPUT_LIMIT+64;
  payload[field.key]=String(payload[field.key]).slice(0,Math.max(1024,String(payload[field.key]).length-excess));truncated=true;
 }
 if(truncated)payload.truncated=true;
 return JSON.stringify(payload)+'\n';
}

export class HookRunner {
 private readonly regexes=new Map<string,RegExp>();
 private readonly stopQueue:(()=>Promise<void>)[]=[];
 private stopActive=0;
 lastRuns=new Map<string,HookRunRecord>();
 onRecord:(record:HookRunRecord)=>void=()=>{};
 constructor(private readonly settings:HookSettings,private readonly cwdFor:()=>string=()=>process.cwd()){}
 private matcher(expression:string){let compiled=this.regexes.get(expression);if(!compiled){compiled=new RegExp('^(?:'+expression+')$');this.regexes.set(expression,compiled);}return compiled;}
 async matching(event:HookEvent,matchKey:string):Promise<Hook[]>{
  const document=await this.settings.snapshot();
  if(!document.enabled)return[];
  return document.hooks.filter(hook=>hook.enabled&&hook.event===event&&(event!=='PreToolUse'&&event!=='PostToolUse'||hook.matcher===''||hook.matcher==='*'||this.matcher(hook.matcher).test(matchKey)));
 }
 async run(hook:Hook,payload:HookPayload,signal:AbortSignal):Promise<HookRunRecord>{
  const [command,args]=shellArgv(hook.command),started=new Date(),clock=Date.now();
  const environment:NodeJS.ProcessEnv={GEN_HOOK_EVENT:hook.event};
  if(payload.thread_id)environment.GEN_THREAD_ID=payload.thread_id;
  if(payload.project_dir)environment.GEN_PROJECT_DIR=payload.project_dir;
  if(typeof payload.tool_name==='string')environment.GEN_TOOL_NAME=payload.tool_name;
  if(typeof payload.file_path==='string')environment.GEN_FILE_PATH=payload.file_path;
  const done=(outcome:HookRunRecord['outcome'],partial:Partial<HookRunRecord>={}):HookRunRecord=>{
   const record:HookRunRecord={hookId:hook.id,event:hook.event,matchKey:typeof payload.tool_name==='string'?payload.tool_name:null,startedAt:started.toISOString(),durationMs:Date.now()-clock,outcome,exitCode:null,reason:null,systemMessage:null,stdout:'',stderr:'',truncated:false,ignoredFields:[],...partial};
   this.lastRuns.set(hook.id,record);try{this.onRecord(record);}catch{}return record;
  };
  let result;
  try{result=await runProcess(command,args,this.cwdFor(),signal,()=>{},hook.timeoutSeconds*1000,environment,OUTPUT_LIMIT,{input:fitInput(payload),label:`hook ${hook.name||hook.id}`});}
  catch{return done('spawn_failed',{reason:'Could not start the shell'});}
  const shared={exitCode:result.exitCode,stdout:result.stdout,stderr:result.stderr,truncated:result.truncated};
  if(result.cancelled)return done('cancelled',shared);
  if(result.timedOut)return done('timed_out',{reason:`Timed out after ${hook.timeoutSeconds} s`,...shared});
  const name=hook.name||hook.id;
  if(result.exitCode===0){
   const text=result.stdout.trim();
   if(text.startsWith('{')){
    let parsed:Record<string,unknown>;
    try{parsed=JSON.parse(text);}catch{return done('failed',{reason:'Invalid JSON on stdout',...shared});}
    const ignoredFields=[...IGNORED_FIELDS.filter(field=>field in parsed),...(parsed.permissionDecision==='ask'?['permissionDecision:"ask"']:'permissionDecision' in parsed&&parsed.permissionDecision!=='deny'?['permissionDecision']:[])];
    const decision=parsed.decision??(parsed.hookSpecificOutput as Record<string,unknown>|undefined)?.permissionDecision;
    const reason=(parsed.reason??(parsed.hookSpecificOutput as Record<string,unknown>|undefined)?.permissionDecisionReason)as string|undefined;
    if(decision==='block'||decision==='deny')return done('blocked',{reason:reason||`Blocked by hook ${name}.`,systemMessage:typeof parsed.systemMessage==='string'?parsed.systemMessage:null,ignoredFields,...shared});
    return done('succeeded',{systemMessage:typeof parsed.systemMessage==='string'?parsed.systemMessage:null,ignoredFields,...shared});
   }
   return done('succeeded',shared);
  }
  if(result.exitCode===2){
   const reason=result.stderr.trim().slice(0,2000)||`Blocked by hook ${name}.`;
   if(hook.event==='PreToolUse'||hook.event==='UserPromptSubmit')return done('blocked',{reason,...shared});
   return done('failed',{reason,...shared});
  }
  return done('failed',{reason:`Exited with code ${result.exitCode}`,...shared});
 }
 async pre(event:'PreToolUse'|'UserPromptSubmit',key:string|null,payload:HookPayload,signal:AbortSignal):Promise<{blocked:false}|{blocked:true;reason:string;record:HookRunRecord}>{
  for(const hook of await this.matching(event,key??'')){
   const record=await this.run(hook,payload,signal);
   if(record.outcome==='blocked')return{blocked:true,reason:record.reason??'Blocked by hook.',record};
   if(record.outcome!=='succeeded'&&hook.onError==='block')return{blocked:true,reason:`Hook ${hook.name||hook.id} failed: ${record.reason??record.outcome}`,record};
   if(signal.aborted)return{blocked:false};
  }
  return{blocked:false};
 }
 async post(event:'PostToolUse',key:string,payload:HookPayload,signal:AbortSignal):Promise<HookRunRecord[]>{
  const records:HookRunRecord[]=[];
  for(const hook of await this.matching(event,key)){records.push(await this.run(hook,payload,signal));if(signal.aborted)break;}
  return records;
 }
 /** Detached turn-end hooks: at most 4 run concurrently, the rest queue (R08). */
 stop(payload:HookPayload):void{void this.runStop(payload);}
 private async runStop(payload:HookPayload){
  const hooks=await this.matching('Stop','').catch(()=>[]);
  for(const hook of hooks)this.stopQueue.push(()=>this.run(hook,payload,new AbortController().signal).then(()=>{}));
  const pump=async()=>{while(this.stopQueue.length){const next=this.stopQueue.shift()!;try{await next();}catch{}};this.stopActive--;};
  while(this.stopActive<4&&this.stopQueue.length){this.stopActive++;void pump();}
 }
}
export function hookRunnerFor(settings:HookSettings,cwdFor?:()=>string){return new HookRunner(settings,cwdFor);}
