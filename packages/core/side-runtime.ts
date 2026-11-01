import {HarnessError,type RunContext,type RuntimeAdapter,type RuntimeCallbacks,type StartRun} from '../contracts/index.ts';

interface Owner {context:RunContext;adapter?:RuntimeAdapter;closed:boolean;cancelled:boolean;release():void;closing?:Promise<void>}
const same=(left:RunContext,right:RunContext)=>left.threadId===right.threadId&&left.runId===right.runId&&left.epoch===right.epoch;

/** Two independent read-only sessions; cancellation ownership precedes async startup. */
export class SideRuntime {
 private owners=new Map<string,Owner>();
 private closing=new Set<Promise<void>>();
 private starting=new Set<Promise<RuntimeAdapter>>();
 private cleanupFailures:unknown[]=[];
 private closed=false;
 constructor(private factory:()=>RuntimeAdapter|Promise<RuntimeAdapter>,private callbacks:RuntimeCallbacks){}
 async start(input:StartRun):Promise<void>{
  input={...input};
  if(this.closed)throw new HarnessError('RUNTIME_DISPOSED','Side conversations have closed.');
  if(this.owners.has(input.threadId))throw new HarnessError('RUN_BUSY','Wait for this side response to finish.');
  if(this.owners.size>=2)throw new HarnessError('SIDE_CHAT_LIMIT','At most two side conversations may work at once.');
  let release!:()=>void;const stopped=new Promise<void>(done=>{release=done;});
  const owner:Owner={context:{threadId:input.threadId,runId:input.runId,epoch:input.epoch},closed:false,cancelled:false,release};
  this.owners.set(input.threadId,owner);
  const assert=()=>{if(owner.closed||this.owners.get(input.threadId)!==owner)throw new HarnessError('CANCELLED_RUN','This side response no longer has authority.');};
  const creating=Promise.resolve().then(()=>this.factory()).then(async adapter=>{
   if(owner.closed){await this.track(Promise.resolve().then(()=>adapter.dispose()));throw new HarnessError('CANCELLED_RUN','Side startup was cancelled.');}
   owner.adapter=adapter;
   adapter.configure({
    onEvent:event=>{
     if(owner.closed||!same(owner.context,event))return;
     if(event.type==='settled')this.close(owner,false);
     this.callbacks.onEvent(event);
    },
    onTool:async(call,ctx)=>{assert();if(!same(owner.context,ctx))throw new HarnessError('CANCELLED_RUN','This side response no longer has authority.');const result=await this.callbacks.onTool(call,ctx);assert();return result;},
   });return adapter;
  });
  this.starting.add(creating);void creating.then(()=>this.starting.delete(creating),()=>this.starting.delete(creating));
  try{
   const adapter=await Promise.race([creating,stopped.then(()=>{throw new HarnessError('CANCELLED_RUN','Side startup was cancelled.');})]);
   assert();await Promise.race([adapter.start(input),stopped.then(()=>{throw new HarnessError('CANCELLED_RUN','Side startup was cancelled.');})]);
  }catch(error){await this.close(owner,true);throw error;}
 }
 private track(result:Promise<void>):Promise<void>{
  this.closing.add(result);void result.then(()=>this.closing.delete(result),error=>{this.closing.delete(result);this.cleanupFailures.push(error);});return result;
 }
 private close(owner:Owner,cancel:boolean):Promise<void>{
  if(owner.closed)return owner.closing??Promise.resolve();
  owner.closed=true;owner.release();if(this.owners.get(owner.context.threadId)===owner)this.owners.delete(owner.context.threadId);
  const adapter=owner.adapter;if(!adapter)return Promise.resolve();
  // Cancel the exact original context before disposing even if start failed.
  const finish=async()=>{try{if(cancel&&!owner.cancelled){owner.cancelled=true;await adapter.cancel(owner.context);}}finally{await adapter.dispose();}};
  return owner.closing=this.track(finish());
 }
 async cancel(ctx:RunContext):Promise<void>{const owner=this.owners.get(ctx.threadId);if(owner&&same(owner.context,ctx))await this.close(owner,true);}
 async dispose():Promise<void>{this.closed=true;for(const owner of this.owners.values())this.close(owner,true);while(this.starting.size||this.closing.size)await Promise.allSettled([...this.starting,...this.closing]);if(this.cleanupFailures.length)throw new AggregateError([...this.cleanupFailures],'Could not close the side conversations. Native cleanup remains unconfirmed.');}
}
