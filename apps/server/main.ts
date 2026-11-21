import {timingSafeEqual} from 'node:crypto';
import {writeSync} from 'node:fs';
import {launchHost,readHostOptions,type RunningHost} from './host.ts';
import {handleDesktopControl} from './desktop-controls.ts';
import {createControlSidecarChannel} from '../../packages/core/control-sidecar-driver.ts';

const STARTUP_CODES=['ENOENT','EACCES','EPERM','EADDRINUSE','EADDRNOTAVAIL','EPIPE','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOSPC','EMFILE','ENFILE','EIO','EINVAL','EBUSY','ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_DLOPEN_FAILED','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','ERR_SQLITE_ERROR','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_CANTOPEN','SQLITE_CORRUPT','ERR_CONNECTION_REFUSED','ERR_ABORTED','ERR_FAILED','ERR_FILE_NOT_FOUND','ERR_TIMED_OUT'] as const;
// Keep the packaged server self-contained; only finite metadata crosses this boundary.
function startupErrorDiagnostic(error:unknown):{category:string;code:string|null}{
 try{
  const category=error instanceof TypeError?'type-error':error instanceof RangeError?'range-error':error instanceof SyntaxError?'syntax-error':error instanceof AggregateError?'aggregate-error':error instanceof Error?'error':'unknown';
  const descriptor=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'code'):undefined,value=descriptor&&'value'in descriptor?descriptor.value:undefined;
  const code=typeof value==='string'&&value.length<=32&&STARTUP_CODES.includes(value as typeof STARTUP_CODES[number])?value as typeof STARTUP_CODES[number]:null;
  return {category,code};
 }catch{return {category:'unknown',code:null};}
}

const startupStarted=Date.now(),token=process.env.HARNESS_DESKTOP_LAUNCH_TOKEN;
const validToken=token!==undefined&&/^[a-f0-9]{32,128}$/i.test(token);
let host:RunningHost|undefined,closing=false,requestedClose=false,deadline:ReturnType<typeof setTimeout>|undefined;
const message=(value:Record<string,unknown>)=>new Promise<void>(resolve=>{
 if(!process.send||!process.connected){resolve();return;}
 process.send(value,undefined,undefined,()=>resolve());
});
const sameToken=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{32,128}$/i.test(value)&&validToken&&value.length===token!.length&&timingSafeEqual(Buffer.from(value),Buffer.from(token!));
async function close(){
 requestedClose=true;
 deadline??=setTimeout(()=>{process.stderr.write('Harness shutdown exceeded its deadline.\n');process.exit(1);},10000);
 if(closing||!host)return;closing=true;controlChannel?.reset();
 try{await host.close();if(validToken)await message({type:'harness.stopped',token});process.exit(0);}
 catch(error){process.stderr.write((error instanceof Error?error.message:'Harness shutdown failed.')+'\n');process.exit(1);}
 finally{clearTimeout(deadline);}
}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
process.on('disconnect',()=>void close());
// M16 control bridge: backend→desktop driver calls share the launch-token
// channel. Replies route to pending calls before the request dispatcher.
const controlChannel=validToken?createControlSidecarChannel({send:value=>message(value),token:token!}):undefined;
process.on('message',(value:unknown)=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const input=value as Record<string,unknown>;
 if(Object.keys(input).length===2&&input.type==='harness.shutdown'&&sameToken(input.token))void close();
 else if(controlChannel?.handleReply(input))return;
 else if(host&&validToken&&!requestedClose)void handleDesktopControl(input,token!,host,message);
});

try{
 if(token!==undefined&&!validToken)throw new Error('HARNESS_DESKTOP_LAUNCH_TOKEN must be 32 to 128 hexadecimal characters.');
 host=await launchHost({...readHostOptions(),controlChannel});
 if(requestedClose)await close();
 else{
  process.stdout.write(`Harness host: ${host.origin}\n`);
  if(validToken)await message({type:'harness.ready',token,origin:host.origin,pid:host.pid,...(host.nativeLayout?{nativeLayout:host.nativeLayout}:{})});
 }
}catch(error){
 const detail=error instanceof Error?error.message:'Could not start the local harness.';
 const diagnostic=startupErrorDiagnostic(error);
 if(validToken&&process.env.HARNESS_DESKTOP_TEST_DATA_DIR)try{writeSync(1,'HARNESS_STARTUP_V1 '+JSON.stringify({stage:'backend-error',elapsedMs:Math.max(0,Date.now()-startupStarted),error:diagnostic})+'\n');}catch{}
 if(validToken)await message({type:'harness.error',token,message:detail,diagnostic});
 process.stderr.write(detail+'\n');process.exit(1);
}
