import {desktopId,type LaunchRequest,type LaunchRequestDelivery} from '../../packages/desktop-contract/index.ts';

const MAX_ENTRIES=64,MAX_CHARS=8192;
const JUMP='--gen-jump=',PROJECT='--gen-project-id=';
/** Scans at most 64 argv entries / 8192 chars. Accepts exactly one
 * --gen-jump=new-thread, or exactly one --gen-jump=open-project plus exactly one
 * valid --gen-project-id. Everything else yields no request; open-project with a
 * missing/invalid id yields a non-sensitive error. */
export function parseLaunchRequest(argv:readonly string[]):{request?:LaunchRequest;error?:string}{
 const args=argv.slice(0,MAX_ENTRIES);
 const jumps:string[]=[],ids:string[]=[];
 let budget=MAX_CHARS;
 for(const arg of args){
  budget-=arg.length;
  if(budget<0)break;
  if(arg.startsWith(JUMP))jumps.push(arg);
  else if(arg.startsWith(PROJECT))ids.push(arg);
 }
 if(jumps.length!==1)return{};
 const value=jumps[0]!.slice(JUMP.length);
 if(value==='new-thread')return ids.length?{}:{request:{type:'new-thread'}};
 if(value!=='open-project')return{};
 if(!ids.length||ids.length>1)return{error:'The requested project could not be identified.'};
 const id=ids[0]!.slice(PROJECT.length);
 return desktopId(id)?{request:{type:'open-project-id',projectId:id}}:{error:'The requested project could not be identified.'};
}

const STALE_MS=60000;
interface QueueDeps {deliver(delivery:LaunchRequestDelivery):void;id():string;now():number}
/** Latest-wins queue, delivered only after the main renderer reports ready;
 * acknowledged by request id, re-delivered after renderer reload. */
export function createLaunchRequestQueue(deps:QueueDeps){
 let pending:(LaunchRequestDelivery&{offeredAt:number})|undefined,ready=false;
 const flush=()=>{
  if(!ready||!pending)return;
  if(deps.now()-pending.offeredAt>STALE_MS){pending=undefined;return;}
  const {offeredAt:_,...delivery}=pending;
  deps.deliver(delivery);
 };
 return{
  offer(request:LaunchRequest){pending={...request,requestId:deps.id(),offeredAt:deps.now()};flush();},
  markReady(){ready=true;flush();},
  markNotReady(){ready=false;},
  acknowledge(requestId:string){if(pending&&pending.requestId===requestId)pending=undefined;},
  pendingId(){return pending?.requestId;},
 };
}
