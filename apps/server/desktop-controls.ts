import {timingSafeEqual} from 'node:crypto';
import type {AttentionDelivery} from '../../packages/contracts/attention.ts';
import {HarnessError} from '../../packages/contracts/index.ts';

interface DesktopHostControls{attentionRead?():Promise<AttentionDelivery>;attentionAction?(type:'open'|'dismiss',eventId:string):Promise<{threadId?:string;dismissed?:boolean}>;stopAll():Promise<{stopped:number;errors?:string[]}>;saveNativeLayout(layout:unknown):Promise<void>;validatePluginSurface?:(surface:unknown)=>Promise<boolean>;updateReadiness?:()=>Promise<{idle:boolean}>;prepareUpdateClose?:()=>Promise<{idle:boolean}>;controlAttach?:(manifest:unknown)=>Promise<{registered:boolean}>}
/** Private parent IPC has the same launch-token custody as shutdown. No HTTP bypass. */
export async function handleDesktopControl(value:unknown,token:string,host:DesktopHostControls,send:(value:Record<string,unknown>)=>unknown):Promise<boolean>{
 if(!value||typeof value!=='object'||Array.isArray(value)||!/^[a-f0-9]{32,128}$/i.test(token))return false;
 const input=value as Record<string,unknown>;
 if(typeof input.token!=='string'||!/^[a-f0-9]{32,128}$/i.test(input.token)||input.token.length!==token.length||!timingSafeEqual(Buffer.from(input.token),Buffer.from(token))||typeof input.requestId!=='string'||!/^[a-zA-Z0-9:_-]{1,200}$/.test(input.requestId))return false;
 if(input.type==='harness.stopAll'&&Object.keys(input).length===3){
  try{await send({type:'harness.stoppedAll',token,requestId:input.requestId,...await host.stopAll()});}
  catch{await send({type:'harness.stoppedAll',token,requestId:input.requestId,stopped:0,errors:['Some tasks could not confirm cancellation.']});}
  return true;
 }
 if((input.type==='harness.update.readiness'||input.type==='harness.update.prepare')&&Object.keys(input).length===3){
  try{const method=input.type==='harness.update.prepare'?host.prepareUpdateClose:host.updateReadiness;const result=await method?.call(host);await send({type:input.type+'.result',token,requestId:input.requestId,idle:result?.idle===true});}
  catch{await send({type:input.type+'.result',token,requestId:input.requestId,idle:false});}return true;
 }
 if(input.type==='harness.attention.read'&&Object.keys(input).length===3){
  try{if(!host.attentionRead)throw Error('Unavailable');await send({type:input.type+'.result',token,requestId:input.requestId,delivery:await host.attentionRead()});}catch{await send({type:input.type+'.result',token,requestId:input.requestId,error:'Notification delivery is unavailable.'});}return true;
 }
 if((input.type==='harness.attention.open'||input.type==='harness.attention.dismiss')&&Object.keys(input).length===4&&typeof input.eventId==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,999}$/.test(input.eventId)){
  try{if(!host.attentionAction)throw Error('Unavailable');await send({type:input.type+'.result',token,requestId:input.requestId,...await host.attentionAction(input.type==='harness.attention.open'?'open':'dismiss',input.eventId)});}catch{await send({type:input.type+'.result',token,requestId:input.requestId,error:'This inbox item is unavailable.'});}return true;
 }
 if(input.type==='harness.plugin.validate'&&Object.keys(input).length===4&&Object.hasOwn(input,'surface')){
  try{await send({type:'harness.plugin.validated',token,requestId:input.requestId,allowed:await host.validatePluginSurface?.(input.surface)===true});}
  catch{await send({type:'harness.plugin.validated',token,requestId:input.requestId,allowed:false});}return true;
 }
 // M16 C3/C4: the single host-owned driver registration arrives over the same
 // launch-token channel as shutdown. The host verifies the built artifact
 // digest; a failure reply carries the exact error so the bridge stays closed.
 if(input.type==='harness.control.register'&&Object.keys(input).length===4&&Object.hasOwn(input,'manifest')){
  try{
   if(!host.controlAttach)throw new HarnessError('DRIVER_UNAVAILABLE','The host has no control driver attachment.');
   await send({type:'harness.control.register.result',token,requestId:input.requestId,...await host.controlAttach(input.manifest)});
  }catch(error){
   await send({type:'harness.control.register.result',token,requestId:input.requestId,registered:false,error:{code:error instanceof HarnessError?error.code:'DRIVER_ERROR',message:error instanceof Error?error.message.slice(0,500):'The control driver could not be registered.'}});
  }
  return true;
 }
 if(input.type==='harness.layout.save'&&Object.keys(input).length===4&&Object.hasOwn(input,'layout')){
  try{await host.saveNativeLayout(input.layout);await send({type:'harness.layout.saved',token,requestId:input.requestId});}
  catch{await send({type:'harness.layout.saved',token,requestId:input.requestId,error:'The workspace layout could not be saved.'});}
  return true;
 }
 return false;
}
