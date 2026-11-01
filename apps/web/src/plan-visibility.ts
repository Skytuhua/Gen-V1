import type {Snapshot,Thread} from '../../../packages/contracts';
import {planDataId,PlanRecordSchema,PLANNING_PROVENANCE,type PlanRecord} from '../../../packages/contracts/planning';

export interface SelectedPlan {revision:number;plan:PlanRecord|null}
/** Rendering and presentation share the same trusted, bounded validation path. */
export function selectPlanRecord(snapshot:Pick<Snapshot,'data'>,threadId?:string):SelectedPlan|undefined {
 if(!threadId)return;
 const record=snapshot.data.filter(item=>item.threadId===threadId&&item.id===planDataId(threadId)&&item.provenance===PLANNING_PROVENANCE).sort((left,right)=>right.revision-left.revision)[0];
 if(!record)return;
 const raw=record.value as {steps?:unknown;agents?:unknown}|null;
 const bounded=raw&&typeof raw==='object'&&Array.isArray(raw.steps)&&raw.steps.length<=24&&Array.isArray(raw.agents)&&raw.agents.length<=24;
 const parsed=bounded?PlanRecordSchema.safeParse(raw):null;
 return {revision:record.revision,plan:parsed?.success?parsed.data:null};
}

type PlanPreferenceStorage=Pick<Storage,'getItem'|'setItem'>;
const dismissalsKey='harness:plan-dismissals:v1';
const browserStorage=():PlanPreferenceStorage|undefined=>{try{return localStorage;}catch{return undefined;}};
export function createPlanVisibility(storage:PlanPreferenceStorage|undefined=browserStorage()){
 const dismissed=new Map<string,{threadId:string;run:string|null;revision:number|undefined}>();
 try{
  const raw=storage?.getItem(dismissalsKey);
  if(raw&&raw.length<=16384){
   const rows:unknown=JSON.parse(raw);
   if(Array.isArray(rows)&&rows.length<=32)for(const row of rows){
    if(row&&typeof row==='object'&&typeof row.threadId==='string'&&row.threadId.length<=160&&(row.run===null||typeof row.run==='string'&&row.run.length<=160)&&(row.revision===undefined||Number.isSafeInteger(row.revision)&&row.revision>=0))dismissed.set(row.threadId,row);
   }
  }
 }catch{/* Optional layout preferences never block plan presentation. */}
 const remember=(threadId:string,state:{run:string|null;revision:number|undefined})=>{
  dismissed.delete(threadId);dismissed.set(threadId,{threadId,run:state.run,revision:state.revision});
  while(dismissed.size>32)dismissed.delete(dismissed.keys().next().value!);
  try{storage?.setItem(dismissalsKey,JSON.stringify([...dismissed.values()]));}catch{/* The in-memory dismissal remains authoritative for this session. */}
 };
 const threads=new Map<string,{run:string|null;revision:number|undefined;presented:boolean;dismissed:boolean;waitingForRevision:number|undefined}>();
 return {
  observe(thread:Thread|undefined,selected:SelectedPlan|undefined){
   if(!thread)return false;
   let state=threads.get(thread.id);
   if(!state){
    const saved=dismissed.get(thread.id),sameRun=Boolean(saved&&(!thread.runId||saved.run===thread.runId));
    state={run:thread.runId??saved?.run??null,revision:saved?.revision,presented:false,dismissed:sameRun,waitingForRevision:saved&&!sameRun?selected?.revision:undefined};threads.set(thread.id,state);
   }
   // Clearing runId is settlement, not another plan publication. A new run
   // must publish a fresh revision before the previous plan can open again.
   else if(thread.runId&&state.run!==thread.runId){state={run:thread.runId,revision:state.revision,presented:false,dismissed:false,waitingForRevision:state.revision};threads.set(thread.id,state);}
   state.revision=selected?.revision??state.revision;
   if(state.dismissed&&state.revision!==dismissed.get(thread.id)?.revision)remember(thread.id,state);
   if(state.presented||state.dismissed||!selected?.plan||!selected.plan.steps.length&&!selected.plan.agents.length||selected.revision===state.waitingForRevision)return false;
   state.presented=true;return true;
  },
  dismiss(thread:Thread|undefined){
   if(!thread)return;
   const state=threads.get(thread.id);
   if(state){state.dismissed=true;remember(thread.id,state);}
   else {const initial={run:thread.runId,revision:undefined,presented:false,dismissed:true,waitingForRevision:undefined};threads.set(thread.id,initial);remember(thread.id,initial);}
  },
  isOpen(threadId:string|undefined){const state=threadId?threads.get(threadId):undefined;return Boolean(state?.presented&&!state.dismissed);},
  show(thread:Thread|undefined){if(!thread)return;let state=threads.get(thread.id);if(!state){state={run:thread.runId,revision:undefined,presented:true,dismissed:false,waitingForRevision:undefined};threads.set(thread.id,state);}state.presented=true;state.dismissed=false;dismissed.delete(thread.id);try{storage?.setItem(dismissalsKey,JSON.stringify([...dismissed.values()]));}catch{/* Explicit opening still works for this session. */}},
 };
}
