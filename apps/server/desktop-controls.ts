import {timingSafeEqual} from 'node:crypto';

interface DesktopHostControls{stopAll():Promise<{stopped:number;errors?:string[]}>;saveNativeLayout(layout:unknown):Promise<void>;validatePluginSurface?:(surface:unknown)=>Promise<boolean>;updateReadiness?:()=>Promise<{idle:boolean}>;prepareUpdateClose?:()=>Promise<{idle:boolean}>}
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
 if(input.type==='harness.plugin.validate'&&Object.keys(input).length===4&&Object.hasOwn(input,'surface')){
  try{await send({type:'harness.plugin.validated',token,requestId:input.requestId,allowed:await host.validatePluginSurface?.(input.surface)===true});}
  catch{await send({type:'harness.plugin.validated',token,requestId:input.requestId,allowed:false});}return true;
 }
 if(input.type==='harness.layout.save'&&Object.keys(input).length===4&&Object.hasOwn(input,'layout')){
  try{await host.saveNativeLayout(input.layout);await send({type:'harness.layout.saved',token,requestId:input.requestId});}
  catch{await send({type:'harness.layout.saved',token,requestId:input.requestId,error:'The workspace layout could not be saved.'});}
  return true;
 }
 return false;
}
