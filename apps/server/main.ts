import {timingSafeEqual} from 'node:crypto';
import {launchHost,readHostOptions,type RunningHost} from './host.ts';

const token=process.env.HARNESS_DESKTOP_LAUNCH_TOKEN;
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
 if(closing||!host)return;closing=true;
 try{await host.close();if(validToken)await message({type:'harness.stopped',token});process.exit(0);}
 catch(error){process.stderr.write((error instanceof Error?error.message:'Harness shutdown failed.')+'\n');process.exit(1);}
 finally{clearTimeout(deadline);}
}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
process.on('disconnect',()=>void close());
process.on('message',(value:unknown)=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const input=value as Record<string,unknown>;
 if(Object.keys(input).length===2&&input.type==='harness.shutdown'&&sameToken(input.token))void close();
});

try{
 if(token!==undefined&&!validToken)throw new Error('HARNESS_DESKTOP_LAUNCH_TOKEN must be 32 to 128 hexadecimal characters.');
 host=await launchHost(readHostOptions());
 if(requestedClose)await close();
 else{
  process.stdout.write(`Harness host: ${host.origin}\n`);
  if(validToken)await message({type:'harness.ready',token,origin:host.origin,pid:host.pid});
 }
}catch(error){
 const detail=error instanceof Error?error.message:'Could not start the local harness.';
 if(validToken)await message({type:'harness.error',token,message:detail});
 process.stderr.write(detail+'\n');process.exit(1);
}
