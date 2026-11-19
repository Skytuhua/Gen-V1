import {randomBytes} from 'node:crypto';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {HarnessError} from '../contracts/index.ts';
import {hasCurrentPlatformProof,selectBackend,type ExecutionBackend} from '../core/execution-policy.ts';
import {processEnvironment} from '../capabilities/process.ts';
import {
 WORKER_DRAIN_SETTLE_MS,WORKER_FRAME_MAX_BYTES,WORKER_HANDSHAKE_DEADLINE_MS,WORKER_MAX_INFLIGHT_REQUESTS,WORKER_PROTOCOL_VERSION,WORKER_SHUTDOWN_GRACE_MS,
 workerErrorPayloadSchema,workerFrameV1Schema,workerHelloPayloadSchema,workerReadyPayloadSchema,workerResponsePayloadSchema,
 pluginLeaseV1Schema,pluginManifestV2Schema,
 type ExtensionViewV1,type PluginLeaseState,type PluginLeaseV1,type PluginManifestV2,type WorkerFrameV1,type WorkerReadyPayload,
} from '../contracts/plugin-worker.ts';
import type {PluginManifest} from './contracts.ts';

// M13 isolated extension lane. A worker is a separate owned process talking
// WorkerFrameV1 over private host-created pipes; it is never handed a Store,
// credential manager, native runtime object or generic command client, and a
// frame cannot carry one. Registration is leased to the worker generation:
// revoking the lease revokes every tool and UI contribution at once. The lane
// activates only behind plugins.isolatedV1 with exactly one installed,
// independently approved M03 backend holding a current-platform PASS proof;
// without one the activation path fails closed with a recorded hold.

const utf8=new TextDecoder('utf-8',{fatal:true});
const cloneJson=(value:unknown,maxBytes:number):unknown=>{
 const text=JSON.stringify(value);
 if(text===undefined||Buffer.byteLength(text)>maxBytes)throw new HarnessError('INVALID_INPUT','The plug-in request is too large.');
 return JSON.parse(text);
};
const sessionError=(code:string,message:string)=>new HarnessError(code,message);

/* ------------------------------------------------------------------ */
/* WorkerFrameV1 codec: 4-byte unsigned little-endian byte-length       */
/* prefix followed by UTF-8 JSON. The announced length is rejected      */
/* before any payload allocation or parsing; invalid UTF-8, unknown     */
/* kinds, extra fields and oversize frames never reach dispatch.        */
/* ------------------------------------------------------------------ */

export function encodeWorkerFrame(frame:WorkerFrameV1):Buffer{
 const parsed=workerFrameV1Schema.parse(frame);
 const body=Buffer.from(JSON.stringify(parsed),'utf8');
 if(body.length>WORKER_FRAME_MAX_BYTES)throw new HarnessError('FRAME_TOO_LARGE','The worker frame exceeds the 1 MiB bound.');
 const out=Buffer.alloc(4+body.length);out.writeUInt32LE(body.length,0);body.copy(out,4);return out;
}

export class WorkerFrameDecoder{
 private buffered=Buffer.alloc(0);
 push(chunk:Uint8Array):WorkerFrameV1[]{
  this.buffered=this.buffered.length?Buffer.concat([this.buffered,Buffer.from(chunk)]):Buffer.from(chunk);
  const frames:WorkerFrameV1[]=[];
  for(;;){
   if(this.buffered.length<4)return frames;
   const length=this.buffered.readUInt32LE(0);
   if(length>WORKER_FRAME_MAX_BYTES)throw new HarnessError('FRAME_TOO_LARGE','The worker announced a frame over the 1 MiB bound.');
   if(this.buffered.length<4+length)return frames;
   const body=this.buffered.subarray(4,4+length);this.buffered=this.buffered.subarray(4+length);
   let text:string;try{text=utf8.decode(body);}catch{throw new HarnessError('PROTOCOL_VIOLATION','The worker frame is not valid UTF-8.');}
   let value:unknown;try{value=JSON.parse(text);}catch{throw new HarnessError('PROTOCOL_VIOLATION','The worker frame is not valid JSON.');}
   const parsed=workerFrameV1Schema.safeParse(value);
   if(!parsed.success)throw new HarnessError('PROTOCOL_VIOLATION','The worker frame is malformed.');
   frames.push(parsed.data);
  }
 }
}

/* ------------------------------------------------------------------ */
/* WorkerTransport — the owned channel to one worker process tree.       */
/* onFrame/onExit REPLACE the current handler. A production transport is  */
/* created by the proven backend's confined launch over host-created      */
/* pipes; terminate() kills the exact owned process tree and reports      */
/* whether termination was confirmed.                                   */
/* ------------------------------------------------------------------ */

export interface WorkerExit{code:number|null;signal:string|null}
export interface WorkerTransport{
 send(frame:WorkerFrameV1):void;
 onFrame(handler:(frame:WorkerFrameV1)=>void):void;
 onExit(handler:(exit:WorkerExit)=>void):void;
 /** Kill the exact owned process tree. Resolves true only when termination
  * is confirmed; false means cleanup is uncertain. */
 terminate():Promise<boolean>;
}

export interface WorkerLaunchSpec{
 packageDir:string;dataDir:string;generation:number;
 /** Child environment built from the host allowlist, never process.env. */
 env:Record<string,string|undefined>;
}
export interface WorkerLauncher{launch(spec:WorkerLaunchSpec):Promise<WorkerTransport>}

/** Real private-pipe transport over a spawned child process' stdio. The pipes
 * are created by the host for exactly this child; nothing is shared. */
export class PipeWorkerTransport implements WorkerTransport{
 private frameHandler:((frame:WorkerFrameV1)=>void)|undefined;
 private exitHandler:((exit:WorkerExit)=>void)|undefined;
 private exitInfo:WorkerExit|undefined;
 private readonly exited:Promise<WorkerExit>;
 constructor(private readonly child:ChildProcess){
  const decoder=new WorkerFrameDecoder();
  this.exited=new Promise<WorkerExit>(resolve=>this.child.once('exit',(code,signal)=>{this.exitInfo={code,signal};this.exitHandler?.(this.exitInfo);resolve(this.exitInfo);}));
  this.child.once('error',()=>{this.exitInfo??={code:null,signal:null};this.exitHandler?.(this.exitInfo);});
  this.child.stdout?.on('data',(chunk:Buffer)=>{
   let frames:WorkerFrameV1[];
   try{frames=decoder.push(chunk);}catch{void this.terminate();return;}
   for(const frame of frames)this.frameHandler?.(frame);
  });
  this.child.stdin?.on('error',()=>{});
 }
 send(frame:WorkerFrameV1):void{
  if(this.exitInfo)throw new HarnessError('WORKER_EXITED','The isolated extension exited.');
  this.child.stdin!.write(encodeWorkerFrame(frame));
 }
 onFrame(handler:(frame:WorkerFrameV1)=>void):void{this.frameHandler=handler;}
 onExit(handler:(exit:WorkerExit)=>void):void{this.exitHandler=handler;if(this.exitInfo)handler(this.exitInfo);}
 /** SIGKILL the exact owned process tree (process group on POSIX, tree on
  * Windows) and confirm the exit inside a bounded wait. */
 async terminate():Promise<boolean>{
  if(this.exitInfo)return true;
  try{
   if(this.child.pid){
    if(process.platform==='win32')spawnSync('taskkill',['/pid',String(this.child.pid),'/T','/F'],{stdio:'ignore'});
    else process.kill(-this.child.pid,'SIGKILL');
   }else this.child.kill('SIGKILL');
  }catch{try{this.child.kill('SIGKILL');}catch{/* already gone */}}
  const deadline=Date.now()+5_000;
  while(!this.exitInfo&&Date.now()<deadline)await Promise.race([this.exited,new Promise<void>(resolve=>setTimeout(resolve,25))]);
  return this.exitInfo!==undefined;
 }
}

export interface SpawnWorkerOptions{
 /** Absolute path of packages/plugins/worker-entry.ts (or its built output). */
 entryPath:string;
 genVersion:string;
 execPath?:string;
 /** ESM loader URL (tsx) passed as --import when running the TypeScript entry. */
 importLoader?:string;
}
/** Development/test launcher: spawns the worker entry on private stdio pipes
 * with the allowlisted environment. Production confined launch binds the M03
 * backend's launch to the same WorkerTransport shape. */
export function createSpawnWorkerLauncher(options:SpawnWorkerOptions):WorkerLauncher{
 return{async launch(spec){
  const args=[...(options.importLoader?['--import',options.importLoader]:[]),options.entryPath,spec.packageDir,spec.dataDir,options.genVersion];
  const child=spawn(options.execPath??process.execPath,args,{cwd:spec.dataDir,env:spec.env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
  return new PipeWorkerTransport(child);
 }};
}

/* ------------------------------------------------------------------ */
/* IsolatedWorkerSession — one authenticated generation on one transport.*/
/* ------------------------------------------------------------------ */

interface PendingCall{operation:string;startedAt:string;signal?:AbortSignal;abort?:()=>void;resolve:(value:unknown)=>void;reject:(error:unknown)=>void}
const GENERATION_ZERO=0;

/** One termination per owned transport: every layer (handshake failure,
 * protocol violation, shutdown, activation cleanup) shares the same attempt
 * and its confirmed/unconfirmed result, so cleanup is never duplicated and a
 * confirmed exit is never overwritten by a second attempt. */
const terminations=new WeakMap<WorkerTransport,Promise<boolean>>();
function terminateOnce(transport:WorkerTransport):Promise<boolean>{
 let attempt=terminations.get(transport);
 if(!attempt){attempt=Promise.resolve().then(()=>transport.terminate()).catch(()=>false);terminations.set(transport,attempt);}
 return attempt;
}

export class IsolatedWorkerSession{
 private readonly pending=new Map<number,PendingCall>();
 private nextRequestId=1;
 private open=true;
 private handshakeDone=false;
 private staleCount=0;
 private exited:WorkerExit|undefined;
 private readonly waiters=new Set<()=>void>();
 /** Host notification hook: fired when the session can no longer dispatch. */
 onClosed:((reason:'violation'|'exit')=>void)|undefined;
 private constructor(readonly generation:number,readonly pluginId:string,private readonly transport:WorkerTransport){}

 /** HELLO -> READY on the private pipes: matching protocol, generation,
  * plugin/package digest and echoed nonce inside the handshake deadline. */
 static async connect(transport:WorkerTransport,hello:{pluginId:string;packageDigest:string;dataNamespace:string;generation:number},deadlineMs=WORKER_HANDSHAKE_DEADLINE_MS):Promise<{session:IsolatedWorkerSession;ready:WorkerReadyPayload}>{
  const nonce=randomBytes(16).toString('hex');
  const session=new IsolatedWorkerSession(hello.generation,hello.pluginId,transport);
  const ready=await new Promise<WorkerReadyPayload>((resolve,reject)=>{
   const timer=setTimeout(()=>finish(()=>reject(sessionError('HANDSHAKE_FAILED','The isolated extension did not complete its handshake in time.'))),deadlineMs);
   let settled=false;
   const finish=(fn:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);fn();};
   transport.onExit(()=>finish(()=>reject(sessionError('WORKER_EXITED','The isolated extension exited before its handshake completed.'))));
   transport.onFrame(frame=>{
    if(frame.generation!==hello.generation){session.staleCount++;return;}
    if(frame.kind==='ERROR'){finish(()=>reject(sessionError('HANDSHAKE_FAILED','The isolated extension refused the handshake.')));return;}
    if(frame.kind!=='READY'){finish(()=>reject(sessionError('PROTOCOL_VIOLATION','The isolated extension sent an unexpected frame during the handshake.')));return;}
    const parsed=workerReadyPayloadSchema.safeParse(frame.payload);
    if(!parsed.success||parsed.data.nonce!==nonce||parsed.data.pluginId!==hello.pluginId||parsed.data.packageDigest!==hello.packageDigest){finish(()=>reject(sessionError('PROTOCOL_VIOLATION','The isolated extension handshake identity did not match.')));return;}
    finish(()=>resolve(parsed.data));
   });
   const payload=workerHelloPayloadSchema.parse({nonce,pluginId:hello.pluginId,packageDigest:hello.packageDigest,dataNamespace:hello.dataNamespace});
   try{transport.send({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:GENERATION_ZERO,generation:hello.generation,kind:'HELLO',payload});}catch(cause){finish(()=>reject(cause));}
  }).catch(cause=>{void terminateOnce(transport);throw cause;});
  session.handshakeDone=true;
  session.bind();
  return {session,ready};
 }

 private bind():void{
  this.transport.onFrame(frame=>{
   if(frame.generation!==this.generation){this.staleCount++;return;}
   switch(frame.kind){
    case 'RESPONSE':{
     const call=this.pending.get(frame.requestId);
     if(!call){this.violate(sessionError('PROTOCOL_VIOLATION','The isolated extension replied with an unknown or duplicate request id.'));return;}
     this.pending.delete(frame.requestId);this.settleCall(call);
     const parsed=workerResponsePayloadSchema.safeParse(frame.payload);
     if(!parsed.success){call.reject(sessionError('PROTOCOL_VIOLATION','The isolated extension returned a malformed response.'));return;}
     if(parsed.data.ok)call.resolve(parsed.data.value);else call.reject(sessionError('OPERATION_FAILED',`The isolated extension operation could not complete.${parsed.data.error?` ${parsed.data.error}`:''}`));
     return;
    }
    case 'ERROR':{
     const call=frame.requestId===GENERATION_ZERO?undefined:this.pending.get(frame.requestId);
     if(call){
      this.pending.delete(frame.requestId);this.settleCall(call);
      call.reject(sessionError('OPERATION_FAILED','The isolated extension operation could not complete.'));
      return;
     }
     const parsed=workerErrorPayloadSchema.safeParse(frame.payload);
     if(!parsed.success){this.violate(sessionError('PROTOCOL_VIOLATION','The isolated extension returned a malformed error frame.'));return;}
     this.onClosed?.('violation');
     return;
    }
    case 'BYE':this.closedByWorker();return;
    default:this.violate(sessionError('PROTOCOL_VIOLATION','The isolated extension sent a frame kind reserved for the host.'));
   }
  });
  this.transport.onExit(exit=>{this.exited=exit;this.closedByWorker();});
 }
 private settleCall(call:PendingCall):void{if(call.signal&&call.abort)call.signal.removeEventListener('abort',call.abort);for(const waiter of this.waiters)waiter();}
 private violate(error:unknown):void{
  if(!this.open)return;this.open=false;
  for(const call of this.pending.values()){this.settleCall(call);call.reject(error);}this.pending.clear();
  void terminateOnce(this.transport);this.onClosed?.('violation');
 }
 private closedByWorker():void{
  if(!this.open)return;this.open=false;
  for(const call of this.pending.values()){this.settleCall(call);call.reject(sessionError('WORKER_EXITED','The isolated extension exited.'));}this.pending.clear();
  this.onClosed?.('exit');
 }
 get isOpen():boolean{return this.open;}
 get staleReplies():number{return this.staleCount;}
 get activeCalls():PendingCall[]{return [...this.pending.values()].map(call=>({...call}));}

 async request(operation:string,input:unknown,signal?:AbortSignal):Promise<unknown>{
  if(!this.open||!this.handshakeDone)throw sessionError('WORKER_UNAVAILABLE','The isolated extension is unavailable.');
  if(this.pending.size>=WORKER_MAX_INFLIGHT_REQUESTS)throw sessionError('PLUGIN_BUSY','The isolated extension already has 32 in-flight requests.');
  if(signal?.aborted)throw sessionError('CANCELLED','The plug-in request was aborted.');
  const requestId=this.nextRequestId++%0xffffffff;
  const body=cloneJson(input,256*1024);
  const result=new Promise<unknown>((resolve,reject)=>{
   const call:PendingCall={operation,startedAt:new Date().toISOString(),signal,resolve,reject};
   if(signal){
    const abort=()=>{if(this.pending.delete(requestId)){this.settleCall(call);try{if(this.open)this.transport.send({protocolVersion:WORKER_PROTOCOL_VERSION,requestId,generation:this.generation,kind:'CANCEL',payload:{requestId}});}catch{/* best effort */}reject(sessionError('CANCELLED','The plug-in request was aborted.'));}};
    call.abort=abort;signal.addEventListener('abort',abort,{once:true});
   }
   this.pending.set(requestId,call);
  });
  try{this.transport.send({protocolVersion:WORKER_PROTOCOL_VERSION,requestId,generation:this.generation,kind:'REQUEST',payload:{operation,input:body}});}catch(cause){this.pending.delete(requestId);throw cause;}
  return result;
 }

 /** Stop admitting calls and wait a bounded window for in-flight work. */
 async drain(settleMs=WORKER_DRAIN_SETTLE_MS):Promise<'settled'|'unconfirmed'>{
  const deadline=Date.now()+settleMs;
  while(this.pending.size){
   const remaining=deadline-Date.now();if(remaining<=0)break;
   await new Promise<void>(resolve=>{
    const waiter=()=>{clearTimeout(timer);this.waiters.delete(waiter);resolve();};
    const timer=setTimeout(()=>{this.waiters.delete(waiter);resolve();},Math.min(remaining,50));
    this.waiters.add(waiter);
   });
  }
  return this.pending.size?'unconfirmed':'settled';
 }

 /** SHUTDOWN, bounded grace, then terminate the exact owned process tree.
  * 'stopped' only when exit or kill is confirmed; otherwise 'unconfirmed'. */
 async shutdown(graceMs=WORKER_SHUTDOWN_GRACE_MS):Promise<'stopped'|'unconfirmed'>{
  if(this.exited){this.closedByWorker();return'stopped';}
  if(this.open){try{this.transport.send({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:GENERATION_ZERO,generation:this.generation,kind:'SHUTDOWN',payload:null});}catch{/* transport already gone */}}
  const exited=await new Promise<boolean>(resolve=>{
   if(this.exited)return resolve(true);
   const timer=setTimeout(()=>resolve(false),graceMs);
   this.transport.onExit(()=>{clearTimeout(timer);resolve(true);});
   if(this.exited){clearTimeout(timer);resolve(true);}
  });
  if(exited){this.exited??={code:0,signal:null};this.closedByWorker();return'stopped';}
  const confirmed=await terminateOnce(this.transport);
  this.closedByWorker();
  return confirmed?'stopped':'unconfirmed';
 }
}

/* ------------------------------------------------------------------ */
/* IsolatedExtensionHost — host-owned leases over worker generations.    */
/* ------------------------------------------------------------------ */

export interface IsolatedExtensionRecord{
 manifest:PluginManifestV2;
 packageDir:string;
 dataDir:string;
 ownerScopes:string[];
 lease:PluginLeaseV1|null;
 session:IsolatedWorkerSession|null;
 blocked:string|null;
 retainedData:boolean;
 stopping:Promise<'stopped'|'unconfirmed'>|null;
 /** Admitted STARTING generation, tracked from admission until its launch and
  * handshake settle. Stop revokes it and fences replacement on its outcome. */
 starting?:StartingGeneration|null;
}

export interface StartingGeneration{
 lease:PluginLeaseV1;
 /** Resolves (never rejects) once the launch/handshake path has finished and
  * any late worker was cleaned up; carries whether exit was confirmed. */
 settled:Promise<'stopped'|'unconfirmed'>;
}

export interface IsolatedHostOptions{
 enabled:()=>boolean;
 approvedBackendId:()=>string|null|undefined;
 backends:()=>readonly ExecutionBackend[];
 /** Development/test transport seam. In production wiring this is never
  * reached: activation launches only through the launcher returned by
  * productionLauncher. */
 launcher:WorkerLauncher;
 /** Production binding: the worker launcher confined by the selected
  * backend's launch(), or undefined when no approved backend-bound
  * launcher exists. When wired, activation holds
  * HOLD_BACKEND_LAUNCH_BINDING unless it returns a launcher for the
  * selected backend — backend metadata alone never promotes the
  * development/test transport. */
 productionLauncher?:(backend:ExecutionBackend)=>WorkerLauncher|undefined;
 drainSettleMs?:number;
 shutdownGraceMs?:number;
 handshakeDeadlineMs?:number;
}

export type UpdateResult=
 |{status:'UPDATED';lease:PluginLeaseV1}
 |{status:'MIGRATION_PLAN_REQUIRED'}
 |{status:'BLOCKED';reason:string}
 |{status:'UNKNOWN';reason:string};

const declaredOperations=(manifest:PluginManifestV2)=>new Set([...manifest.toolSchemas.map(tool=>tool.name),...Object.values(manifest.lifecycle??{}).filter((value):value is string=>Boolean(value))]);

export class IsolatedExtensionHost{
 private readonly records=new Map<string,IsolatedExtensionRecord>();
 private readonly generations=new Map<string,number>();
 private readonly drainSettleMs:number;
 private readonly shutdownGraceMs:number;
 private readonly handshakeDeadlineMs:number;
 constructor(private readonly options:IsolatedHostOptions){
  this.drainSettleMs=options.drainSettleMs??WORKER_DRAIN_SETTLE_MS;
  this.shutdownGraceMs=options.shutdownGraceMs??WORKER_SHUTDOWN_GRACE_MS;
  this.handshakeDeadlineMs=options.handshakeDeadlineMs??WORKER_HANDSHAKE_DEADLINE_MS;
 }

 private nextGeneration(pluginId:string):number{const generation=(this.generations.get(pluginId)??0)+1;this.generations.set(pluginId,generation);return generation;}

 /** Admission gate: flag on, exactly one installed approved backend with a
  * current-platform PASS proof, and — when production wiring declares
  * productionLauncher — a worker launcher bound to that backend's confined
  * launch. Zero or ambiguous identities hold; the gate never resolves the
  * ambiguity itself and never falls back. */
 private admission():{ok:true;launcher:WorkerLauncher}|{ok:false;hold:string;reason:string}{
  if(!this.options.enabled())return{ok:false,hold:'ACTIVATION_DISABLED',reason:'The isolated extension lane is disabled on this host.'};
  const selection=selectBackend(this.options.approvedBackendId(),this.options.backends());
  if(selection.status!=='SELECTED')return{ok:false,hold:'HOLD_BACKEND_SELECTION',reason:selection.reason};
  if(!hasCurrentPlatformProof(selection.backend))return{ok:false,hold:'HOLD_PLATFORM_PROOF',reason:'The approved backend has no PASS platform proof for this host platform.'};
  if(this.options.productionLauncher){
   const bound=this.options.productionLauncher(selection.backend);
   if(!bound)return{ok:false,hold:'HOLD_BACKEND_LAUNCH_BINDING',reason:'No worker launcher is bound to the approved backend\u2019s confined launch; the development/test transport is never a production binding.'};
   return{ok:true,launcher:bound};
  }
  return{ok:true,launcher:this.options.launcher};
 }

 /** Register an installed, already-verified package for the isolated lane. No
  * archive, upload, download or install script is admitted here. */
 register(manifest:unknown,dirs:{packageDir:string;dataDir:string},ownerScopes:string[]=[]):IsolatedExtensionRecord{
  const parsed=pluginManifestV2Schema.parse(manifest);
  const existing=this.records.get(parsed.pluginId);if(existing)return existing;
  const record:IsolatedExtensionRecord={manifest:parsed,packageDir:dirs.packageDir,dataDir:dirs.dataDir,ownerScopes,lease:null,session:null,blocked:null,retainedData:true,stopping:null};
  this.records.set(parsed.pluginId,record);return record;
 }

 private bind(record:IsolatedExtensionRecord,session:IsolatedWorkerSession,lease:PluginLeaseV1):void{
  session.onClosed=()=>{if(record.session===session)record.session=null;if(record.lease===lease&&lease.state==='ACTIVE')lease.state='FAILED';};
 }

 async activate(pluginId:string):Promise<PluginLeaseV1>{
  const record=this.records.get(pluginId);if(!record)throw new HarnessError('NOT_FOUND','The isolated extension is not registered.');
  if(record.lease&&['STARTING','ACTIVE','DRAINING','UNKNOWN'].includes(record.lease.state))throw new HarnessError('INVALID_STATE','The isolated extension already has a writable generation.');
  const gate=this.admission();
  if(!gate.ok){record.blocked=gate.hold;throw new HarnessError(gate.hold,gate.reason);}
  const generation=this.nextGeneration(pluginId);record.blocked=null;
  const lease:PluginLeaseV1=pluginLeaseV1Schema.parse({pluginId:record.manifest.pluginId,version:record.manifest.version,generation,ownerScopes:record.ownerScopes,activeCalls:[],registrations:[],state:'STARTING'});
  record.lease=lease;
  let markSettled!:(outcome:'stopped'|'unconfirmed')=>void;
  const starting:StartingGeneration={lease,settled:new Promise(resolve=>{markSettled=resolve;})};
  record.starting=starting;
  const revoked=()=>lease.state!=='STARTING';
  let transport:WorkerTransport|undefined;
  let owned:IsolatedWorkerSession|undefined;
  let cleanup:'stopped'|'unconfirmed'='stopped';
  try{
   transport=await gate.launcher.launch({packageDir:record.packageDir,dataDir:record.dataDir,generation,env:processEnvironment()});
   // Stop may have revoked this generation while the launch was in flight:
   // the late worker is cleaned up by the single owner below and never
   // connected or published.
   if(revoked())throw new HarnessError('INVALID_STATE','The isolated extension lease was revoked during activation.');
   const {session,ready}=await IsolatedWorkerSession.connect(transport,{pluginId:record.manifest.pluginId,packageDigest:record.manifest.packageDigest,dataNamespace:record.manifest.dataNamespace,generation},this.handshakeDeadlineMs);
   owned=session;
   // A worker claim is never permission: only operations the manifest
   // declared may register; anything else is a protocol violation.
   const declared=declaredOperations(record.manifest);
   for(const operation of ready.operations)if(!declared.has(operation))throw new HarnessError('PROTOCOL_VIOLATION','The isolated extension claimed an undeclared operation.');
   // A concurrent drain/disable may have revoked this lease while the
   // handshake was in-flight; never publish ACTIVE over a revoked lease.
   if(revoked())throw new HarnessError('INVALID_STATE','The isolated extension lease was revoked during activation.');
   record.session=session;this.bind(record,session,lease);
   lease.state='ACTIVE';
   lease.registrations=[...record.manifest.toolSchemas.map(tool=>({kind:'tool' as const,id:tool.name})),...(record.manifest.declaredCapabilities.includes('ui.contribute')?[{kind:'ui' as const,id:'catalog-frame'}]:[])];
   return structuredClone(lease);
  }catch(cause){
   const code=cause instanceof HarnessError?cause.code:'ACTIVATION_FAILED';
   // Diagnostics are recorded before any state mutation. A revoked startup
   // is Stop's outcome, not a failure, so it records a diagnostic only when
   // its cleanup is unconfirmed.
   if(!revoked())record.blocked=code;
   // Exactly one cleanup outcome per admitted startup. Lower layers share the
   // same termination attempt (terminateOnce), so nothing is repeated.
   if(transport)cleanup=owned?await owned.shutdown(this.shutdownGraceMs).catch(()=>'unconfirmed' as const):(await terminateOnce(transport))?'stopped':'unconfirmed';
   if(cleanup==='unconfirmed'){
    // Never report Stopped or free the writable namespace for a worker whose
    // exit was not proven.
    record.blocked=code;record.session=null;lease.state='UNKNOWN';
   }else if(lease.state==='STARTING')lease.state='FAILED';
   throw cause;
  }finally{
   if(record.starting===starting)record.starting=null;
   markSettled(cleanup);
  }
 }

 async dispatch(pluginId:string,operation:string,input:unknown,signal?:AbortSignal):Promise<unknown>{
  const record=this.records.get(pluginId);
  if(!record||!record.lease||record.lease.state!=='ACTIVE'||!record.session?.isOpen)throw new HarnessError('UNAVAILABLE','The isolated extension is unavailable.');
  // Host mediation: only a registered tool lease may be invoked. A plug-in
  // cannot grant itself a missing tool or promote a hidden schema.
  if(!record.lease.registrations.some(registration=>registration.kind==='tool'&&registration.id===operation))throw new HarnessError('UNAVAILABLE','This plug-in operation is unavailable.');
  const generation=record.lease.generation,session=record.session;
  const result=await session.request(operation,input,signal);
  if(!record.lease||record.lease.state!=='ACTIVE'||record.lease.generation!==generation)throw new HarnessError('GENERATION_STALE','The isolated extension generation changed during the call.');
  return result;
 }

 private stop(record:IsolatedExtensionRecord):Promise<'stopped'|'unconfirmed'>{
  if(record.stopping)return record.stopping;
  const lease=record.lease,session=record.session,starting=record.starting;
  if(!lease||lease.state==='STOPPED'||lease.state==='FAILED')return Promise.resolve('stopped');
  // UNKNOWN with no session left to confirm: cleanup was never proven, so a
  // repeated Stop must not report Stopped or unfence the namespace.
  if(lease.state==='UNKNOWN'&&!session)return Promise.resolve('unconfirmed');
  record.stopping=(async()=>{
   // Registrations are revoked before calls are cancelled or settled.
   if(lease.state==='ACTIVE'||lease.state==='STARTING'||lease.state==='DRAINING')lease.state='DRAINING';
   lease.registrations=[];
   if(starting&&starting.lease===lease){
    // Admitted but not yet published: wait, bounded, for the in-flight launch
    // and handshake to settle and clean up. Never report Stopped, and never
    // let a replacement start, until the late worker's exit is confirmed.
    const bound=this.handshakeDeadlineMs+this.shutdownGraceMs+this.drainSettleMs;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const outcome=await Promise.race([starting.settled,new Promise<'unconfirmed'>(resolve=>{timer=setTimeout(()=>resolve('unconfirmed'),bound);})]);
    if(timer)clearTimeout(timer);
    if(outcome==='stopped'&&!record.session){lease.state='STOPPED';return'stopped';}
    lease.state='UNKNOWN';record.session=null;return'unconfirmed';
   }
   if(session)await session.drain(this.drainSettleMs);
   const shutdown=session?await session.shutdown(this.shutdownGraceMs):'stopped';
   if(shutdown==='stopped'){lease.state='STOPPED';record.session=null;return'stopped';}
   // Cleanup is uncertain: never report Stopped and never start a
   // replacement with an overlapping writable namespace.
   lease.state='UNKNOWN';record.session=null;return'unconfirmed';
  })().finally(()=>{record.stopping=null;});
  return record.stopping;
 }

 async disable(pluginId:string):Promise<PluginLeaseState>{
  const record=this.records.get(pluginId);if(!record)throw new HarnessError('NOT_FOUND','The isolated extension is not registered.');
  await this.stop(record);
  return record.lease?.state??'STOPPED';
 }

 async update(pluginId:string,next:{manifest:unknown;packageDir:string;dataDir:string;requiresMigration?:boolean;migrationPlan?:unknown}):Promise<UpdateResult>{
  const record=this.records.get(pluginId);if(!record)throw new HarnessError('NOT_FOUND','The isolated extension is not registered.');
  const manifest=pluginManifestV2Schema.parse(next.manifest);
  if(manifest.pluginId!==record.manifest.pluginId)throw new HarnessError('INVALID_INPUT','The updated manifest does not match the installed plug-in.');
  if(next.requiresMigration){
   // Fail closed: no verified migration execution/validation path exists on
   // this host, so a migration-needing update stays blocked even when the
   // supplied contract is complete. Old package and data stay untouched; the
   // contract is only ever validated here, never executed.
   return{status:'MIGRATION_PLAN_REQUIRED'};
  }
  const gate=this.admission();if(!gate.ok){record.blocked=gate.hold;return{status:'BLOCKED',reason:gate.hold};}
  const stopped=await this.stop(record);
  if(stopped!=='stopped')return{status:'UNKNOWN',reason:'The previous generation could not be confirmed stopped; no new writable generation was started.'};
  const previous={manifest:record.manifest,packageDir:record.packageDir,dataDir:record.dataDir};
  record.manifest=manifest;record.packageDir=next.packageDir;record.dataDir=next.dataDir;
  try{return{status:'UPDATED',lease:await this.activate(pluginId)};}
  catch(cause){record.manifest=previous.manifest;record.packageDir=previous.packageDir;record.dataDir=previous.dataDir;return{status:'UNKNOWN',reason:cause instanceof Error?cause.message:'The new generation could not start.'};}
 }

 record(pluginId:string):IsolatedExtensionRecord|undefined{return this.records.get(pluginId);}
 get droppedStaleReplies():number{let count=0;for(const record of this.records.values())count+=record.session?.staleReplies??0;return count;}

 catalog(trusted:readonly PluginManifest[]=[]):ExtensionViewV1[]{
  // Flag off: the Extensions surface contributes nothing, trusted rows included.
  if(!this.options.enabled())return[];
  const rows:ExtensionViewV1[]=trusted.map(manifest=>({pluginId:manifest.id,name:manifest.name,version:manifest.version,hostKind:'trusted' as const,state:'ACTIVE' as const}));
  for(const record of this.records.values()){
   rows.push({pluginId:record.manifest.pluginId,name:record.manifest.pluginId,version:record.manifest.version,hostKind:'isolated',state:record.lease?.state??'STOPPED',packageDigest:record.manifest.packageDigest,...(record.lease?{generation:record.lease.generation}:{}),declaredCapabilities:[...record.manifest.declaredCapabilities],dataScope:record.manifest.dataNamespace,...(record.blocked?{updateBlocked:record.blocked}:{}),retainedData:record.retainedData});
  }
  return rows;
 }

 async close():Promise<void>{for(const record of this.records.values())await this.stop(record);}
}
