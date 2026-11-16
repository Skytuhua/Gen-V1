import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import type {ChildProcess} from 'node:child_process';
const STARTUP_CODES=['ENOENT','EACCES','EPERM','EADDRINUSE','EADDRNOTAVAIL','EPIPE','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOSPC','EMFILE','ENFILE','EIO','EINVAL','EBUSY','ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_DLOPEN_FAILED','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','ERR_SQLITE_ERROR','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_CANTOPEN','SQLITE_CORRUPT','ERR_CONNECTION_REFUSED','ERR_ABORTED','ERR_FAILED','ERR_FILE_NOT_FOUND','ERR_TIMED_OUT'] as const;
const STARTUP_CATEGORIES=['error','type-error','range-error','syntax-error','aggregate-error','unknown'] as const;
const STARTUP_STAGES=['app-ready','layout-ready','shell-ready','backend-starting','backend-ready','backend-error','backend-stream-error','backend-spawn-error','backend-exit','backend-disconnect','backend-deadline','backend-relay-error','backend-activation-stopped','backend-activation-error','backend-active','backend-output','main-opening','main-document-loaded','main-ready','main-load-failed','main-renderer-gone','main-deadline','startup-failed'] as const;
export type StartupErrorDiagnostic={category:typeof STARTUP_CATEGORIES[number];code:typeof STARTUP_CODES[number]|null};
type StartupOutputSummary={bytes:number;hashedBytes:number;sha256:string;truncated:boolean};
export type StartupObservation={stage:typeof STARTUP_STAGES[number];error:StartupErrorDiagnostic|null};
export type StartupDiagnostic=StartupObservation&{elapsedMs:number;output?:{stdout:StartupOutputSummary;stderr:StartupOutputSummary}};
const PREFIX='HARNESS_STARTUP_V1 ',OUTPUT_LIMIT=262144,LINE_LIMIT=2048,EVENT_LIMIT=32;
const unknownError=():StartupErrorDiagnostic=>({category:'unknown',code:null});
function plainRecord(value:unknown):Record<string,unknown>|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)return;
 if(Object.values(Object.getOwnPropertyDescriptors(value)).some(item=>!('value'in item)))return;
 return value as Record<string,unknown>;
}
function keys(value:Record<string,unknown>,expected:readonly string[]){const actual=Object.keys(value);return actual.length===expected.length&&actual.every(key=>expected.includes(key));}
/** Never inspect or stringify a message, stack, path, arbitrary name or getter. */
export function startupErrorDiagnostic(error:unknown):StartupErrorDiagnostic{
 try{
  const category=error instanceof TypeError?'type-error':error instanceof RangeError?'range-error':error instanceof SyntaxError?'syntax-error':error instanceof AggregateError?'aggregate-error':error instanceof Error?'error':'unknown';
  const descriptor=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'code'):undefined,value=descriptor&&'value'in descriptor?descriptor.value:undefined;
  const code=typeof value==='string'&&value.length<=32&&STARTUP_CODES.includes(value as typeof STARTUP_CODES[number])?value as typeof STARTUP_CODES[number]:null;
  return {category,code};
 }catch{return unknownError();}
}
function parseStartupError(value:unknown):StartupErrorDiagnostic|undefined{
 const item=plainRecord(value);if(!item||!keys(item,['category','code'])||!STARTUP_CATEGORIES.includes(item.category as typeof STARTUP_CATEGORIES[number])||item.code!==null&&!STARTUP_CODES.includes(item.code as typeof STARTUP_CODES[number]))return;
 return {category:item.category as StartupErrorDiagnostic['category'],code:item.code as StartupErrorDiagnostic['code']};
}
function parseOutput(value:unknown):StartupOutputSummary|undefined{
 const item=plainRecord(value);if(!item||!keys(item,['bytes','hashedBytes','sha256','truncated'])||!Number.isSafeInteger(item.bytes)||Number(item.bytes)<0||!Number.isSafeInteger(item.hashedBytes)||Number(item.hashedBytes)<0||Number(item.hashedBytes)!==Math.min(Number(item.bytes),OUTPUT_LIMIT)||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256)||item.truncated!==(Number(item.bytes)>OUTPUT_LIMIT))return;
 return {bytes:Number(item.bytes),hashedBytes:Number(item.hashedBytes),sha256:item.sha256,truncated:item.truncated as boolean};
}
function parseStartupDiagnostic(value:unknown):StartupDiagnostic|undefined{
 try{
  const item=plainRecord(value);if(!item||!STARTUP_STAGES.includes(item.stage as StartupDiagnostic['stage'])||!keys(item,item.stage==='backend-output'?['stage','elapsedMs','error','output']:['stage','elapsedMs','error'])||!Number.isSafeInteger(item.elapsedMs)||Number(item.elapsedMs)<0||Number(item.elapsedMs)>3600000)return;
  const error=item.error===null?null:parseStartupError(item.error);if(error===undefined)return;
  const result:StartupDiagnostic={stage:item.stage as StartupDiagnostic['stage'],elapsedMs:Number(item.elapsedMs),error};
  if(item.stage==='backend-output'){
   const output=plainRecord(item.output);if(!output||!keys(output,['stdout','stderr'])||error!==null)return;
   const stdout=parseOutput(output.stdout),stderr=parseOutput(output.stderr);if(!stdout||!stderr)return;result.output={stdout,stderr};
  }
  return result;
 }catch{return;}
}
/** Optional diagnostics can neither throw nor serialize an unvalidated caller value. */
export function writeStartupDiagnostic(sink:(line:string)=>void,value:unknown):void{
 try{const item=parseStartupDiagnostic(value);if(item)sink(PREFIX+JSON.stringify(item)+'\n');}catch{}
}
function observeStartup(observe:((value:StartupObservation)=>void)|undefined,value:StartupObservation):void{try{observe?.(value);}catch{}}
/** Hash and parse only the first 256 KiB of each stream; continue counting/draining every chunk. */
export function createStartupOutputCapture(clock:()=>number=Date.now,observe?:(value:StartupDiagnostic)=>void){
 const started=clock(),make=()=>({bytes:0,hashedBytes:0,hash:createHash('sha256'),line:[] as number[],dropping:false});
 const streams={stdout:make(),stderr:make()},events:(StartupDiagnostic&{stream:'stdout'|'stderr';observedElapsedMs:number})[]=[];
 let firstFailure:typeof events[number]|null=null,rejectedLines=0,overlongLines=0;
 const retain=(stream:'stdout'|'stderr',line:string)=>{
  if(!line.startsWith(PREFIX))return;
  let value:StartupDiagnostic|undefined;try{value=parseStartupDiagnostic(JSON.parse(line.slice(PREFIX.length)));}catch{}
  if(!value){rejectedLines++;return;}
  const event={...value,stream,observedElapsedMs:Math.max(0,clock()-started)};
  if(value.error!==null||/-(?:failed|error|exit|disconnect|deadline|stopped|gone)$/.test(value.stage))firstFailure??=event;
  if(events.length<EVENT_LIMIT){events.push(event);try{observe?.(value);}catch{}}
 };
 const summary=(value:typeof streams.stdout):StartupOutputSummary=>({bytes:value.bytes,hashedBytes:value.hashedBytes,sha256:value.hash.copy().digest('hex'),truncated:value.bytes>OUTPUT_LIMIT});
 return {
  write(stream:'stdout'|'stderr',chunk:Buffer):void{
   try{
    const value=streams[stream];value.bytes=Math.min(Number.MAX_SAFE_INTEGER,value.bytes+chunk.length);
    const limit=Math.min(chunk.length,OUTPUT_LIMIT-value.hashedBytes);if(limit<=0)return;
    const bytes=chunk.subarray(0,limit);value.hash.update(bytes);value.hashedBytes+=limit;
    for(const byte of bytes){
     if(byte===10){if(!value.dropping)retain(stream,Buffer.from(value.line).toString('utf8'));value.line=[];value.dropping=false;}
     else if(!value.dropping){if(value.line.length===LINE_LIMIT){value.line=[];value.dropping=true;overlongLines++;}else value.line.push(byte);}
    }
    if(value.hashedBytes===OUTPUT_LIMIT){value.line=[];value.dropping=true;}
   }catch{}
  },
  read:()=>({hashScope:'prefix' as const,hashLimitBytes:OUTPUT_LIMIT,lineLimitBytes:LINE_LIMIT,eventLimit:EVENT_LIMIT,streams:{stdout:summary(streams.stdout),stderr:summary(streams.stderr)},events:events.slice(),firstFailure,rejectedLines,overlongLines})
 };
}

export function nodeSidecarArguments(hostRoot:string):string[]{return ['--import',pathToFileURL(join(hostRoot,'node_modules/tsx/dist/loader.mjs')).href,join(hostRoot,'apps/server/main.ts')];}
export function requestBackendShutdown(child:Pick<ChildProcess,'connected'|'send'>,token:string,failed:()=>void):void{
 if(!child.connected){failed();return;}
 // IPC errors arrive asynchronously; a try/catch alone lets EPIPE escape cleanup.
 try{child.send({type:'harness.shutdown',token},error=>{if(error)failed();});}catch{failed();}
}
export function waitForBackendReady(child:ChildProcess,token:string,port:number,stderr:()=>string,observe?:(value:StartupObservation)=>void):Promise<Record<string,unknown>>{
 return new Promise((resolveReady,reject)=>{
  // Cold original Hermes/Python initialization can exceed the former 25-second bound.
  let done=false;const timer=setTimeout(()=>{observeStartup(observe,{stage:'backend-deadline',error:null});finish(Error('The local backend did not become ready'));},60000);
  const finish=(error?:Error,value?:Record<string,unknown>)=>{if(done)return;done=true;clearTimeout(timer);child.removeListener('message',message);child.removeListener('error',failed);child.removeListener('exit',exited);child.removeListener('disconnect',disconnected);if(error)reject(error);else resolveReady(value!);};
  const failed=(error:Error)=>{observeStartup(observe,{stage:'backend-spawn-error',error:startupErrorDiagnostic(error)});finish(error);},exited=(code:number|null)=>{observeStartup(observe,{stage:'backend-exit',error:null});finish(Error('The local backend stopped during startup ('+code+'). '+stderr().slice(-500)));};
  const disconnected=()=>{observeStartup(observe,{stage:'backend-disconnect',error:null});finish(Error('The local backend disconnected during startup.'));};
  const message=(raw:unknown)=>{if(!raw||typeof raw!=='object')return;const value=raw as Record<string,unknown>;if(value.token!==token)return;if(value.type==='harness.error'){let error=unknownError();try{error=parseStartupError(value.diagnostic)??error;}catch{}observeStartup(observe,{stage:'backend-error',error});finish(Error(typeof value.message==='string'?value.message:'The local backend failed'));}if(value.type==='harness.ready'&&value.origin==='http://127.0.0.1:'+port&&value.pid===child.pid){observeStartup(observe,{stage:'backend-ready',error:null});finish(undefined,value);}};
  child.on('message',message);child.once('error',failed);child.once('exit',exited);child.once('disconnect',disconnected);
 });
}

/** The ready IPC handshake can precede an asynchronous relay handoff. */
export async function finishBackendStartup(child:Pick<ChildProcess,'exitCode'|'signalCode'>,previousRelayClosed:Promise<void>|undefined,stderr:()=>string,activate:()=>void,observe?:(value:StartupObservation)=>void):Promise<void>{
 try{await previousRelayClosed;}catch(error){observeStartup(observe,{stage:'backend-relay-error',error:startupErrorDiagnostic(error)});throw error;}
 const stopped=child.exitCode??child.signalCode;
 if(stopped!==null){observeStartup(observe,{stage:'backend-activation-stopped',error:null});throw Error('The local backend stopped during startup ('+stopped+'). '+stderr().slice(-500));}
 // Publish readiness and install the normal exit listener in the same turn.
 try{activate();}catch(error){observeStartup(observe,{stage:'backend-activation-error',error:startupErrorDiagnostic(error)});throw error;}
 observeStartup(observe,{stage:'backend-active',error:null});
}
