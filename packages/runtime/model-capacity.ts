import {HarnessError} from '../contracts/index.ts';
import {hermesRequestScheduler} from './request-scheduler.ts';

type Waiter = {signal?:AbortSignal;grant(release:()=>void):void;reject(error:unknown):void;abort?:()=>void};
type Lane = {active:number;queue:Waiter[]};

/** A permit owns one actual model request, including its confirmed native teardown. */
export class ModelCapacity {
 private readonly lanes=new Map<string,Lane>();
 constructor(private readonly limit=2){if(!Number.isInteger(limit)||limit<1)throw new Error('Capacity must be positive');}
 acquire(providerId:string,accountId:string|null,signal?:AbortSignal):Promise<()=>void>{
  if(signal?.aborted)return Promise.reject(new HarnessError('MODEL_REQUEST_CANCELLED','The queued model request was cancelled.'));
  const key=JSON.stringify([providerId,accountId]),lane=this.lanes.get(key)??{active:0,queue:[]};this.lanes.set(key,lane);
  return new Promise((resolve,reject)=>{
   const waiter:Waiter={signal,grant:resolve,reject};
   waiter.abort=()=>{const index=lane.queue.indexOf(waiter);if(index<0)return;lane.queue.splice(index,1);reject(new HarnessError('MODEL_REQUEST_CANCELLED','The queued model request was cancelled.'));this.drain(key,lane);};
   lane.queue.push(waiter);signal?.addEventListener('abort',waiter.abort,{once:true});this.drain(key,lane);
  });
 }
 private drain(key:string,lane:Lane):void{
  while(lane.active<this.limit&&lane.queue.length){
   const waiter=lane.queue.shift()!;waiter.signal?.removeEventListener('abort',waiter.abort!);lane.active++;let released=false;
   waiter.grant(()=>{if(released)return;released=true;lane.active--;this.drain(key,lane);});
  }
  if(!lane.active&&!lane.queue.length&&this.lanes.get(key)===lane)this.lanes.delete(key);
 }
}

/** Structural gate shared by broker and integration model traffic. */
export interface ModelRequestGate {acquire(providerId:string,accountId:string|null,signal?:AbortSignal):Promise<()=>void>;}

// One per-account gate for every model caller: the shared request scheduler
// owns class scheduling, and hermesModelCapacity is the same lanes through the
// legacy acquire() signature so broker and integration traffic never double up.
export const hermesModelCapacity:ModelRequestGate={
 acquire(providerId,accountId,signal){return hermesRequestScheduler.acquire(providerId,accountId,signal).then(permit=>permit.release);},
};
export const hermesReviewCapacity=new ModelCapacity(1);
