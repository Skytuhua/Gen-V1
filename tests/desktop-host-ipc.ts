import type {ChildProcess} from 'node:child_process';

export function nextMessage(child:ChildProcess,type:string):Promise<Record<string,unknown>>{
 return new Promise((resolve,reject)=>{
  const clear=()=>{clearTimeout(timer);child.off('message',message);child.off('exit',exit);};
  const message=(value:unknown)=>{
   if(!value||typeof value!=='object')return;
   const event=value as Record<string,unknown>;
   if(event.type===type){clear();resolve(event);}
   else if(event.type==='harness.error'){
    clear();
    // Report the lifecycle failure without printing raw IPC, paths, or tokens.
    reject(new Error('Desktop host reported a startup error before '+type));
   }
  };
  const exit=(code:number|null,signal:NodeJS.Signals|null)=>{
   clear();reject(new Error('Host exited before '+type+': '+(signal??code)));
  };
  const timer=setTimeout(()=>{clear();reject(new Error('Desktop host IPC timed out: '+type));},type==='harness.ready'?25000:8000);
  child.on('message',message);child.once('exit',exit);
 });
}
