import { randomUUID } from 'node:crypto';
import { HarnessError, type Thread, type WorkspaceEvent } from '../contracts/index.ts';
import { attentionCommandSchema, attentionItemSchema, type AttentionCommand, type AttentionDelivery, type AttentionEnvelope, type AttentionItem } from '../contracts/attention.ts';
import { getPreferences } from '../contracts/preferences.ts';
import { Store } from '../storage/store.ts';

interface StoredAttention {item:AttentionItem;claimedKey?:string;pending:boolean;queuedAt?:string;epoch?:number}
const word=(value:string,limit:number)=>value.replace(/\s+/g,' ').trim().slice(0,limit);

/** A durable read projection of the personal Store. No task, approval or scheduler authority. */
export class AttentionRepository {
 constructor(private readonly store:Store,private readonly now:()=>Date=()=>new Date()){}
 private sync(settled?:WorkspaceEvent):AttentionItem[]{
  const snapshot=this.store.snapshot(),threads=new Map(snapshot.threads.map(thread=>[thread.id,thread])),existing=new Map(this.store.all<StoredAttention>('attentionItem').map(value=>[value.item.id,value])),seeded=this.store.get('attentionMeta','initialized')===true,stamp=this.now().toISOString();
  const projected:StoredAttention[]=[];
  const add=(thread:Thread,id:string,kind:AttentionItem['kind'],state:AttentionItem['state'],summary:string,destination:AttentionItem['destination'],occurredAt?:string)=>{
   const previous=existing.get(id),notificationKey=id+':'+state,newFailure=Boolean(previous&&previous.item.state!==state&&state==='failed');
   if(previous&&(previous.item.threadId!==thread.id||previous.item.projectId!==thread.projectId))return;
   const item:AttentionItem={id,kind,threadId:thread.id,...(thread.projectId?{projectId:thread.projectId}:{}),title:word(thread.title,200),summary:word(summary,2000),state,createdAt:previous?.item.createdAt??occurredAt??(seeded?stamp:thread.updatedAt),updatedAt:previous?.item.updatedAt??stamp,read:newFailure?false:previous?.item.read??false,popupDismissed:newFailure?false:previous?.item.popupDismissed??false,actionable:state==='needs-input'||state==='needs-review',notificationKey,destination};
   const comparable=(value:AttentionItem)=>JSON.stringify({...value,updatedAt:''});
   if(previous&&comparable(previous.item)!==comparable(item))item.updatedAt=stamp;
   const pending=state!=='resolved'&&(newFailure?seeded:previous?.pending??seeded)&&!item.read&&!item.popupDismissed;
   projected.push({item:attentionItemSchema.parse(item),...(previous?.claimedKey?{claimedKey:previous.claimedKey}:{}),pending,...(pending?{queuedAt:newFailure?stamp:previous?.queuedAt??stamp}:previous?.queuedAt?{queuedAt:previous.queuedAt}:{}),...(kind==='thread-completed'||kind==='thread-failed'?{epoch:thread.epoch}:{})});
  };
  for(const request of snapshot.requests){const thread=threads.get(request.threadId);if(!thread)continue;add(thread,'request:'+request.id+':'+request.revision,'request',request.status==='pending'?'needs-input':'resolved',request.prompt||request.title,{threadId:thread.id,...(thread.projectId?{projectId:thread.projectId}:{}),requestId:request.id});}
  for(const operation of snapshot.operations){const thread=threads.get(operation.threadId);if(!thread||operation.approved&&operation.status!=='failed'&&operation.status!=='unknown'&&operation.status!=='succeeded'&&operation.status!=='cancelled')continue;const state=operation.status==='failed'||operation.status==='unknown'?'failed':operation.status==='prepared'&&!operation.approved?'needs-review':'resolved';add(thread,'operation:'+operation.id+':'+operation.revision,'operation',state,operation.description,{threadId:thread.id,...(thread.projectId?{projectId:thread.projectId}:{}),operationId:operation.id},operation.createdAt);}
  const settledRun=(settled?.payload as {result?:{runId?:unknown}}|undefined)?.result?.runId;
  const observedRun=typeof settledRun==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(settledRun)&&this.store.get<{kind?:string}>('runtimeIntent',settledRun)?.kind!=='compaction'?settledRun:undefined;
  for(const thread of snapshot.threads)if(thread.status==='completed'||thread.status==='failed'||thread.status==='ready'&&!thread.runId&&settled?.threadId===thread.id&&observedRun){
   const kind=thread.status==='failed'?'thread-failed':'thread-completed',prior=[...existing.values()].find(value=>value.item.threadId===thread.id&&value.item.kind===kind&&value.epoch===thread.epoch),id=prior?.item.id??'thread:'+thread.id+':'+(settled?.threadId===thread.id&&observedRun?observedRun:thread.epoch)+':'+(kind==='thread-failed'?'failed':'completed');
   add(thread,id,kind,kind==='thread-failed'?'failed':'completed',kind==='thread-failed'?'The task could not finish. Open the conversation for details.':'The response finished. Open the conversation to review its result.',{threadId:thread.id,...(thread.projectId?{projectId:thread.projectId}:{})},settled?.threadId===thread.id?settled.occurredAt:thread.updatedAt);
  }
  // Completed observations remain useful history while a later run is active.
  for(const saved of existing.values())if((saved.item.kind==='thread-completed'||saved.item.kind==='thread-failed')&&!projected.some(value=>value.item.id===saved.item.id)){const owner=threads.get(saved.item.threadId);if(owner&&owner.projectId===saved.item.projectId)projected.push(saved);}
  const changed=projected.filter(value=>JSON.stringify(existing.get(value.item.id))!==JSON.stringify(value));
  if(!seeded||changed.length)this.store.internal('attention.projected',null,()=>{for(const value of changed)this.store.put('attentionItem',value.item.id,value.item.threadId,value);if(!seeded)this.store.put('attentionMeta','initialized',null,true);});
  return projected.map(value=>value.item).toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,1000);
 }
 read():AttentionEnvelope{const items=this.sync();return{items,unread:items.filter(item=>!item.read).length,sequence:this.store.sequence};}
 watch():()=>void{return this.store.subscribe(event=>{if(event.type==='runtime.settled')this.sync(event);});}
 destination(eventId:string):AttentionItem['destination']{const item=this.sync().find(value=>value.id===eventId);if(!item)throw new HarnessError('NOT_FOUND','This inbox item is no longer available.');return item.destination;}
 command(input:AttentionCommand){const parsed=attentionCommandSchema.parse(input);this.destination(parsed.eventId);return this.store.command({id:parsed.id,type:'attention.'+parsed.type,payload:{eventId:parsed.eventId}},()=>{const stored=this.store.get<StoredAttention>('attentionItem',parsed.eventId);if(!stored)throw new HarnessError('NOT_FOUND','Inbox item is unavailable.');const item={...stored.item,...(parsed.type==='dismiss-popup'?{popupDismissed:true}:{read:parsed.type==='read'})};this.store.put('attentionItem',item.id,item.threadId,{...stored,item,pending:parsed.type==='unread'?false:stored.pending});return item;});}
 /** Consume a new delivery before presentation: crash/reconnect cannot replay sound. The durable Inbox remains. */
 claimDelivery():AttentionDelivery{const items=this.sync(),queued=items.filter(item=>{const saved=this.store.get<StoredAttention>('attentionItem',item.id);return saved?.pending&&saved.claimedKey!==item.notificationKey&&!item.read&&!item.popupDismissed&&item.state!=='resolved';}),fresh=queued.filter(item=>{const saved=this.store.get<StoredAttention>('attentionItem',item.id);return this.now().getTime()-Date.parse(saved?.queuedAt??item.createdAt)<=5*60_000;});if(queued.length)this.store.internal('attention.delivery.claimed',null,()=>{for(const item of queued){const saved=this.store.get<StoredAttention>('attentionItem',item.id)!;this.store.put('attentionItem',item.id,item.threadId,{...saved,pending:false,claimedKey:item.notificationKey});}});const preferences=getPreferences(this.store.snapshot().settings);return{items:fresh.slice(0,30),preferences:{threadNotifications:preferences.threadNotifications,inAppNotifications:preferences.inAppNotifications,volume:preferences.notificationVolume,preview:preferences.notificationPreview,quietHours:preferences.notificationQuietHours}};}
 markOpen(eventId:string){const destination=this.destination(eventId);this.command({id:randomUUID(),eventId,type:'read'});return destination;}
}
