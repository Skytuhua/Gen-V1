import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {ChildProcess} from 'node:child_process';
export function nodeSidecarArguments(hostRoot:string):string[]{return ['--import',pathToFileURL(join(hostRoot,'node_modules/tsx/dist/loader.mjs')).href,join(hostRoot,'apps/server/main.ts')];}
export function requestBackendShutdown(child:Pick<ChildProcess,'connected'|'send'>,token:string,failed:()=>void):void{
 if(!child.connected){failed();return;}
 // IPC errors arrive asynchronously; a try/catch alone lets EPIPE escape cleanup.
 try{child.send({type:'harness.shutdown',token},error=>{if(error)failed();});}catch{failed();}
}
export function waitForBackendReady(child:ChildProcess,token:string,port:number,stderr:()=>string):Promise<Record<string,unknown>>{
 return new Promise((resolveReady,reject)=>{
  // Cold original Hermes/Python initialization can exceed the former 25-second bound.
  let done=false;const timer=setTimeout(()=>finish(Error('The local backend did not become ready')),60000);
  const finish=(error?:Error,value?:Record<string,unknown>)=>{if(done)return;done=true;clearTimeout(timer);child.removeListener('message',message);child.removeListener('error',failed);child.removeListener('exit',exited);if(error)reject(error);else resolveReady(value!);};
  const failed=(error:Error)=>finish(error),exited=(code:number|null)=>finish(Error('The local backend stopped during startup ('+code+'). '+stderr().slice(-500)));
  const message=(raw:unknown)=>{if(!raw||typeof raw!=='object')return;const value=raw as Record<string,unknown>;if(value.token!==token)return;if(value.type==='harness.error')finish(Error(typeof value.message==='string'?value.message:'The local backend failed'));if(value.type==='harness.ready'&&value.origin==='http://127.0.0.1:'+port&&value.pid===child.pid)finish(undefined,value);};
  child.on('message',message);child.once('error',failed);child.once('exit',exited);
 });
}
