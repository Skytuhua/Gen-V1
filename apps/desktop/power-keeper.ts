import type {DesktopPowerState} from '../../packages/desktop-contract/index.ts';

export interface PowerBlockerApi {start(type:'prevent-app-suspension'):number;isStarted(id:number):boolean;stop(id:number):void}
export interface PowerActivityRead {tasks:number;schedules:number;keepAwakeTasks:boolean;keepAwakeSchedules:boolean}
export interface PowerKeeperOptions {api:PowerBlockerApi;read:()=>Promise<PowerActivityRead>;onChange?:(state:DesktopPowerState)=>void;pollMs?:number;debounceMs?:number}
export interface PowerKeeper {schedule():void;release():void;dispose():void;state():DesktopPowerState}

/** Serialized reconciliation between host activity reads and one
 * `prevent-app-suspension` blocker. A dirty flag collapses bursts; every
 * failure releases the blocker so a hung read never leaves the PC held. */
export function createPowerKeeper(options:PowerKeeperOptions):PowerKeeper {
 const {api,read,onChange}=options,pollMs=options.pollMs??30_000,debounceMs=options.debounceMs??500;
 let dirty=true,inflight=false,disposed=false,blockerId:number|undefined,consecutiveFailures=0;
 let current:DesktopPowerState={state:'off'},debounce:ReturnType<typeof setTimeout>|undefined,poll:ReturnType<typeof setInterval>|undefined;
 function publish(next:DesktopPowerState){if(current.state===next.state&&current.reason===next.reason)return;current=next;try{onChange?.(next);}catch{}}
 function drop(){if(blockerId!==undefined){const id=blockerId;blockerId=undefined;try{if(api.isStarted(id))api.stop(id);}catch{}}}
 async function reconcile(){
  let activity:PowerActivityRead;
  try{activity=await read();consecutiveFailures=0;}
  catch{consecutiveFailures++;if(consecutiveFailures>=2){drop();publish({state:'unavailable'});}return;}
  const want=(activity.keepAwakeTasks&&activity.tasks>0)||(activity.keepAwakeSchedules&&activity.schedules>0);
  if(!want){drop();publish({state:activity.tasks>0||activity.schedules>0?'idle':'off'});return;}
  if(blockerId===undefined||!safeStarted()){
   try{blockerId=api.start('prevent-app-suspension');}
   catch{drop();publish({state:'unavailable'});return;}
  }
  const reason=activity.tasks>0&&activity.schedules>0?'both':activity.tasks>0?'tasks':'schedules';
  publish({state:'holding',reason});
 }
 function safeStarted(){try{return blockerId!==undefined&&api.isStarted(blockerId);}catch{return false;}}
 async function drain(){if(inflight)return;inflight=true;try{while(dirty&&!disposed){dirty=false;await reconcile();}}finally{inflight=false;}}
 function schedule(){if(disposed)return;dirty=true;clearTimeout(debounce);debounce=setTimeout(()=>void drain(),debounceMs);}
 function release(){drop();if(current.state==='holding'||current.state==='unavailable')publish({state:'off'});else publish({state:'off'});}
 function dispose(){disposed=true;dirty=false;clearTimeout(debounce);if(poll)clearInterval(poll);drop();}
 poll=setInterval(schedule,pollMs);
 schedule();
 return{schedule,release,dispose,state:()=>current};
}
