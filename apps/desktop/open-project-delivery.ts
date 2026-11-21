// Cold/warm "--open-project" request queue for the desktop main process. Pure
// state machine, no Electron import: at most one undelivered pending path
// (newest wins), one delivered request waits for its requestId acknowledgement,
// stale acknowledgements never clear newer work, and a handler that unmounts,
// reloads or crashes drops its unacked request — the plan promises no replay.
export type OpenProjectEnvelope={requestId:string;path:string};
export interface OpenProjectDelivery {
 enqueue(path:string):void;
 deliver():OpenProjectEnvelope|undefined;
 rendererReady():void;
 rendererNotReady():void;
 acknowledge(requestId:string):'acked'|'stale';
 snapshot():{pending?:string;active?:string;handlerReady:boolean};
}
export function createOpenProjectDelivery(backendUp:()=>boolean):OpenProjectDelivery {
 let sequence=0,pending:OpenProjectEnvelope|undefined,active:OpenProjectEnvelope|undefined,handlerReady=false;
 return {
  enqueue(path){pending={requestId:'open-project-'+String(++sequence),path};},
  deliver(){
   if(!handlerReady||active||!pending||!backendUp())return undefined;
   active=pending;pending=undefined;return active;
  },
  rendererReady(){handlerReady=true;},
  rendererNotReady(){handlerReady=false;active=undefined;},
  acknowledge(requestId){if(!active||active.requestId!==requestId)return 'stale';active=undefined;return 'acked';},
  snapshot(){return {...(pending?{pending:pending.requestId}:{}),...(active?{active:active.requestId}:{}),handlerReady};}
 };
}
