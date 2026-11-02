import type {DesktopWorkspaceChange} from '../../packages/desktop-contract/index.ts';

// Chromium shares six HTTP/1 connections across all trusted windows. Keep the
// one persistent workspace stream in Node's separate pool, and relay only its
// sequence so every renderer still obtains its own authenticated snapshot.
export function workspaceEvents(origin:string,notify:(change:DesktopWorkspaceChange)=>void){
 if(!/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(origin))throw Error('Workspace events require the owned loopback host');
 let stopped=false,sequence=0,connected=false,controller:AbortController|undefined,stream:ReadableStreamDefaultReader<Uint8Array>|undefined,wake:undefined|(()=>void),retry=250;
 const cancel=()=>{const pending=stream?.cancel().catch(()=>{});controller?.abort();return pending;};
 const publish=(online:boolean)=>{connected=online;notify({connected,sequence});};
 const task=(async()=>{
  while(!stopped){
   controller=new AbortController();let watchdog:ReturnType<typeof setTimeout>|undefined;
   const bounded=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>void cancel(),45000);};
   try{
    watchdog=setTimeout(()=>controller?.abort(),5000);
    const bootstrap=await fetch(origin+'/api/bootstrap',{redirect:'error',signal:controller.signal});
    const token=/(?:^|;\s*)harness_session=([a-f0-9]+)(?:;|$)/.exec(bootstrap.headers.get('set-cookie')??'')?.[1];
    await bootstrap.body?.cancel();
    if(stopped)break;
    if(!bootstrap.ok||!token)throw Error('The workspace event session could not open');
    const response=await fetch(origin+'/api/events?after='+sequence,{headers:{Cookie:'harness_session='+token},redirect:'error',signal:controller.signal});
    if(stopped){await response.body?.cancel();break;}
    if(!response.ok||!response.headers.get('content-type')?.startsWith('text/event-stream')||!response.body){await response.body?.cancel();throw Error('The workspace event stream is unavailable');}
    bounded();retry=250;publish(true);
    const reader=response.body.getReader(),decoder=new TextDecoder();stream=reader;let line='',discard=false;
    try{
     for(;;){
      const chunk=await reader.read();if(chunk.done)break;bounded();
      const text=decoder.decode(chunk.value,{stream:true});let start=0;
      for(let index=0;index<=text.length;index++){
       if(index<text.length&&text[index]!=='\n')continue;
       if(!discard){line+=text.slice(start,index);if(line.length>256){line='';discard=true;}}
       if(index<text.length){
        const id=!discard?/^id: ?([0-9]+)\r?$/.exec(line):null;
        if(id){const next=Number(id[1]);if(Number.isSafeInteger(next)&&next>sequence){sequence=next;publish(true);}}
        line='';discard=false;
       }
       start=index+1;
      }
     }
    }finally{await reader.cancel().catch(()=>{});stream=undefined;}
   }catch{/* The next connection obtains a fresh session after a host restart. */}
   finally{clearTimeout(watchdog);controller?.abort();}
   if(stopped)break;
   publish(false);
   await new Promise<void>(resolve=>{const timer=setTimeout(resolve,retry);wake=()=>{clearTimeout(timer);resolve();};});wake=undefined;retry=Math.min(retry*2,5000);
  }
 })();
 return {state:()=>({connected,sequence}),close:async()=>{stopped=true;if(connected)publish(false);const cancelled=cancel();wake?.();await cancelled;await task;}};
}
