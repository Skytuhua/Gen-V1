import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HarnessError} from '../contracts/index.ts';
import {terminateProcessTree} from '../runtime-pi/process-tree.ts';
import {assertHermesTree,withHermesHome} from './home.ts';

export interface HermesEvent {event:string;ctx?:Record<string,unknown>;data?:unknown}
export interface HermesHostCall {id:string;name:string;args:Record<string,unknown>;ctx?:Record<string,unknown>}
export interface PythonCommand {executable:string;args:string[]}
interface Pending {resolve(value:unknown):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}
interface ClientOptions {
 home:string;python?:PythonCommand;workerPath?:string;timeoutMs?:number;
 onEvent?:(event:HermesEvent)=>void;
 onHostCall?:(call:HermesHostCall)=>Promise<unknown>;
 onFailure?:(error:Error)=>void;
}
const MAX_FRAME_BYTES=32*1024*1024;
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');

function environment(home:string):NodeJS.ProcessEnv {
 const allowed=['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','COMSPEC','SYSTEMDRIVE','OS','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS','LANG','LC_ALL'];
 const env:NodeJS.ProcessEnv={};for(const key of allowed)if(process.env[key]!==undefined)env[key]=process.env[key];
 return {...env,HOME:home,USERPROFILE:home,HERMES_HOME:home,APPDATA:join(home,'roaming'),LOCALAPPDATA:join(home,'local'),XDG_CONFIG_HOME:join(home,'config'),PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHON_MANAGER_AUTOMATIC_INSTALL:'false',HERMES_DISABLE_LAZY_INSTALLS:'1'};
}

/** Private transport only. Agent policy and skill algorithms stay in upstream Python. */
export class HermesClient {
 private child?:ChildProcessWithoutNullStreams;
 private startup?:Promise<ChildProcessWithoutNullStreams>;
 private stopping?:Promise<void>;
 private closed=false;
 private buffer='';
 private pending=new Map<string,Pending>();
 private hostCalls=new Set<Promise<unknown>>();
 private guard?:Promise<void>;
 private releaseGuard?:()=>void;
 constructor(private options:ClientOptions){}
 private ensure():Promise<ChildProcessWithoutNullStreams> {
  if(this.closed)return Promise.reject(new HarnessError('HERMES_CLOSED','The Hermes source worker has closed.'));
  return this.startup??=(async()=>{
   const home=resolve(this.options.home);
   const held=new Promise<void>(done=>{this.releaseGuard=done;});
   await new Promise<void>((ready,reject)=>{this.guard=withHermesHome(home,async()=>{ready();await held;},()=>this.fail('HERMES_STORAGE_CHANGED'));void this.guard.catch(error=>{reject(error);if(this.child&&!this.closed)this.fail('HERMES_STORAGE_CHANGED');});});
   if(this.closed)throw new HarnessError('HERMES_CLOSED','The Hermes source worker has closed.');
   const bundled=join(root,'hermes-python','python.exe'),useBundle=process.platform==='win32'&&existsSync(bundled);
   const python=this.options.python??{executable:useBundle?bundled:process.env.HARNESS_HERMES_PYTHON??(process.platform==='win32'?join(process.env.SystemRoot??'C:/Windows','py.exe'):'python3.14'),args:[...(process.platform==='win32'&&!useBundle&&!process.env.HARNESS_HERMES_PYTHON?['-3.14']:[]),'-I','-S','-B',this.options.workerPath??join(root,'packages/runtime-hermes/worker.py')]};
   const child=spawn(python.executable,python.args,{cwd:home,env:environment(home),windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});this.child=child;
   child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>this.receive(chunk));
   child.stdout.on('error',()=>this.fail('HERMES_PIPE'));
   child.stderr.on('data',()=>{});child.stderr.on('error',()=>this.fail('HERMES_PIPE'));
   child.stdin.on('error',()=>this.fail('HERMES_PIPE'));
   child.on('error',()=>this.fail('HERMES_START_FAILED'));
   child.once('exit',()=>{if(!this.closed)this.fail('HERMES_EXITED');});
   await new Promise<void>((done,reject)=>{child.once('spawn',done);child.once('error',()=>reject(new HarnessError('HERMES_START_FAILED','The pinned Python 3.14 runtime could not start.')));});
   return child;
  })();
 }
 private send(value:unknown):void {
  if(!this.child||this.closed)throw new HarnessError('HERMES_CLOSED','The Hermes source worker has closed.');
  const frame=JSON.stringify(value)+'\n';if(Buffer.byteLength(frame)>MAX_FRAME_BYTES)throw new HarnessError('HERMES_FRAME_LIMIT','The source-worker message exceeds its transport limit.');
  this.child.stdin.write(frame,error=>{if(error)this.fail('HERMES_PIPE');});
 }
 private receive(chunk:string):void {
  if(this.closed)return;
  this.buffer+=chunk;if(Buffer.byteLength(this.buffer)>MAX_FRAME_BYTES){this.fail('HERMES_FRAME_LIMIT');return;}
  let newline:number;
  while((newline=this.buffer.indexOf('\n'))>=0){
   const line=this.buffer.slice(0,newline);this.buffer=this.buffer.slice(newline+1);if(!line.trim())continue;
   let value:unknown;try{value=JSON.parse(line);}catch{this.fail('HERMES_PROTOCOL');return;}
   if(!record(value)){this.fail('HERMES_PROTOCOL');return;}
   if(typeof value.id==='string'){
    const pending=this.pending.get(value.id);if(!pending)continue;clearTimeout(pending.timer);this.pending.delete(value.id);
    if(record(value.error)){const code=typeof value.error.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(value.error.code)?value.error.code:'HERMES_SOURCE_ERROR';pending.reject(new HarnessError(code,'The Hermes source worker could not complete this request.'));}
    else if(Object.hasOwn(value,'result'))pending.resolve(value.result);else pending.reject(new HarnessError('HERMES_PROTOCOL','The Hermes source worker returned an invalid reply.'));
    continue;
   }
   if(record(value.hostCall)){
    const call=value.hostCall;if(typeof call.id!=='string'||typeof call.name!=='string'||!record(call.args)){this.fail('HERMES_PROTOCOL');return;}
    const work=Promise.resolve().then(()=>{if(this.closed)throw new HarnessError('HERMES_CLOSED','The Hermes source worker has closed.');if(!this.options.onHostCall)throw new HarnessError('HERMES_TOOL_DENIED','No host tool is available to this source worker.');return this.options.onHostCall(call as unknown as HermesHostCall);});
    this.hostCalls.add(work);void work.then(result=>{if(!this.closed)this.send({hostResult:{id:call.id,result}});},()=>{if(!this.closed)this.send({hostResult:{id:call.id,error:{code:'HERMES_HOST_TOOL_FAILED',message:'The host tool could not complete.'}}});}).catch(()=>this.fail('HERMES_PIPE')).finally(()=>this.hostCalls.delete(work));
    continue;
   }
   if(typeof value.event==='string'){try{this.options.onEvent?.(value as unknown as HermesEvent);}catch{this.fail('HERMES_OBSERVER');return;}continue;}
   this.fail('HERMES_PROTOCOL');return;
  }
 }
 async request<T=unknown>(method:string,params:Record<string,unknown>={}):Promise<T> {
  if(method==='hello'&&params.home!==undefined&&resolve(String(params.home))!==resolve(this.options.home))throw new HarnessError('CAPABILITY_DENIED','The source home cannot change after the worker is owned.');
  await this.ensure();if(this.closed)throw new HarnessError('HERMES_CLOSED','The Hermes source worker has closed.');
  await assertHermesTree(resolve(this.options.home));
  const id=randomUUID();return new Promise<T>((resolve,reject)=>{
   const timer=setTimeout(()=>this.fail('HERMES_REQUEST_TIMEOUT'),this.options.timeoutMs??30_000);timer.unref();
   this.pending.set(id,{resolve:value=>resolve(value as T),reject,timer});
   try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
  });
 }
 private fail(code:string):void {
  if(this.closed)return;const error=new HarnessError(code,'The Hermes source worker stopped before completing its request.');
  this.closed=true;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();
  try{this.options.onFailure?.(error);}catch{/* An observer cannot prevent owned teardown. */}
  this.stopping??=this.stop();void this.stopping.catch(()=>{});
 }
 private async stop():Promise<void> {
  const results=await Promise.allSettled([this.child?terminateProcessTree(this.child):Promise.resolve(),...this.hostCalls]);
  // Keep the namespace lease when descendant cancellation is unconfirmed.
  if(results[0].status==='fulfilled'){this.releaseGuard?.();if(this.guard)await this.guard;}
  if(results[0].status==='rejected')throw new AggregateError([results[0].reason],'Could not close the source-worker process owner.');
 }
 async dispose():Promise<void> {
  if(!this.closed){this.closed=true;const error=new HarnessError('HERMES_CLOSED','The Hermes source worker has closed.');for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();}
  if(this.startup)await this.startup.catch(()=>{});
  try{await(this.stopping??=this.stop());}catch(error){this.stopping=undefined;throw error;}
 }
}
