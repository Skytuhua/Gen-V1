import {createServer,type ServerResponse} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {EMPTY_USAGE,HarnessError,type RuntimeAdapter,type RuntimeEvent,type RuntimeUsage,type StartRun} from '../contracts/index.ts';
import type {ModelRequestObservationV1,ModelRequestUsageV1} from '../contracts/model-request.ts';
import {MODEL_ONLY_MAX_PROMPT_BYTES,MODEL_ONLY_MAX_WIRE_BYTES} from '../runtime/model-only.ts';
import type {ModelCapacity} from '../runtime/model-capacity.ts';
import {hermesRequestScheduler,requestClassFor,type RequestBudget,type RequestScheduler} from '../runtime/request-scheduler.ts';
import type {ModelRequestStage} from '../runtime/request-metrics.ts';
import {RequestMetrics} from '../runtime/request-metrics.ts';

export interface ModelRequest {sequence:number;inputIds:string[];phase:'foreground'|'background_review'}
export interface HermesBrokerOptions {
 input:StartRun;createRuntime:()=>RuntimeAdapter;
 onInput?:(ids:string[])=>void|Promise<void>;
 onUsage?:(usage:RuntimeUsage,request:ModelRequest)=>void;
 onStage?:(stage:ModelRequestStage|'queued',request:ModelRequest)=>void;
 onObservation?:(observation:ModelRequestObservationV1,request:ModelRequest)=>void;
 capacity?:ModelCapacity;
 scheduler?:RequestScheduler;
 budget?:RequestBudget;
}
export interface HermesBroker {
 readonly url:string;readonly key:string;
 expect(request:ModelRequest):void;
 usage(sequence:number):RuntimeUsage|null;
 observation(sequence:number):ModelRequestObservationV1|null;
 close():Promise<void>;
}
const invalid=()=>new HarnessError('HERMES_BROKER_PROTOCOL','The owned model request is invalid.');
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function measured(value:unknown):RuntimeUsage {
 const usage={...EMPTY_USAGE};if(!record(value))return usage;
 for(const field of ['contextTokens','contextWindow','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','cost','sessionPercent','weeklyPercent'] as const){const amount=value[field];usage[field]=typeof amount==='number'&&Number.isFinite(amount)&&amount>=0?amount:null;}
 return usage;
}
const usageV1=(usage:RuntimeUsage|null):ModelRequestUsageV1|null=>usage?{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,cacheReadTokens:usage.cacheReadTokens??null,cacheWriteTokens:usage.cacheWriteTokens??null,cost:usage.cost}:null;
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

/** Each URL/key owns one source run; the body can never select another account or context. */
export async function createHermesBroker(options:HermesBrokerOptions):Promise<HermesBroker>{
 const input=structuredClone(options.input),key=randomBytes(32).toString('base64url'),authorization=Buffer.from('Bearer '+key);
 let closed=false,pending:ModelRequest|undefined,lastSequence=0,closing:Promise<void>|undefined,cleanupError:unknown;
 let active:{runtime?:RuntimeAdapter;ctx:StartRun;controller:AbortController;cancelled:boolean;completion:ReturnType<typeof deferred<void>>;operation:Promise<unknown>;cancel?:Promise<void>}|undefined;
 const usages=new Map<number,RuntimeUsage>(),observations=new Map<number,ModelRequestObservationV1>();
 const scheduler=options.scheduler??(options.capacity?undefined:hermesRequestScheduler);
 const cancel=()=>{const owner=active;if(!owner)return Promise.resolve();return owner.cancel??=(async()=>{owner.cancelled=true;owner.controller.abort();try{await owner.runtime?.cancel(owner.ctx);owner.completion.reject(new HarnessError('HERMES_MODEL_CANCELLED','The owned model request was cancelled.'));}catch(error){cleanupError=error;owner.completion.reject(error);throw error;}})();};
 const send=(response:ServerResponse,status:number,value:unknown)=>{if(response.destroyed)return;const text=JSON.stringify(value);if(Buffer.byteLength(text)>MODEL_ONLY_MAX_WIRE_BYTES)throw invalid();response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(text);};
 const server=createServer((request,response)=>{
  const supplied=Buffer.from(typeof request.headers.authorization==='string'?request.headers.authorization:'');
  if(closed||request.method!=='POST'||request.url!=='/model'||supplied.length!==authorization.length||!timingSafeEqual(supplied,authorization)){request.resume();response.writeHead(403).end();return;}
  let owner:typeof active;response.once('close',()=>{if(!response.writableEnded&&owner&&active===owner)void cancel().catch(()=>{});});
  void(async()=>{
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of request){size+=Buffer.byteLength(chunk);if(size>MODEL_ONLY_MAX_WIRE_BYTES){response.writeHead(413).end();return;}chunks.push(Buffer.from(chunk));}
   const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!record(body)||Object.keys(body).some(name=>!['sessionId','modelId','prompt'].includes(name))||typeof body.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(body.sessionId)||body.modelId!==input.modelId||typeof body.prompt!=='string'||Buffer.byteLength(body.prompt)>MODEL_ONLY_MAX_PROMPT_BYTES)throw invalid();
   if(closed||response.destroyed||active||!pending)throw invalid();
   const metadata=pending;pending=undefined;
   const id=randomUUID(),nativeInput:StartRun={threadId:'hermes-model-'+id,runId:id,epoch:1,inputId:id,modelId:input.modelId,accountId:input.accountId??null,thinkingLevel:input.thinkingLevel,sessionPath:null,prompt:body.prompt,resources:[]};
   const providerId=input.modelId.split('/')[0];
   const metrics=new RequestMetrics({version:1,requestId:id,owner:{threadId:input.threadId,runId:input.runId,epoch:input.epoch,sequence:metadata.sequence,inputIds:[...metadata.inputIds],phase:metadata.phase==='foreground'?'foreground':'background'},binding:{providerId,modelId:input.modelId,accountId:input.accountId??null},measurementSource:'hermes-broker'});
   const stage=(name:ModelRequestStage)=>{if(metrics.mark(name)!==null){try{options.onStage?.(name,metadata);}catch{/* Stage observers cannot release a live request. */}}};
   const completion=deferred<void>();void completion.promise.catch(()=>{});let content='',usage:RuntimeUsage|null=null,failure:unknown,entered=false,writes=Promise.resolve();
   owner=active={ctx:nativeInput,controller:new AbortController(),cancelled:false,completion,operation:Promise.resolve()};
   const owned=owner;
   owned.operation=(async()=>{
    let release:(()=>void)|undefined,dispatched=false;
    try{
     try{options.onStage?.('queued',metadata);}catch{/* Stage observers cannot release a live request. */}
     options.budget?.admit();
     if(scheduler){const permit=await scheduler.acquire(providerId,input.accountId??null,owned.controller.signal,{requestClass:requestClassFor(metadata.phase==='foreground'?'foreground':'background')});release=permit.release;}
     else release=await options.capacity!.acquire(providerId,input.accountId??null,owned.controller.signal);
     stage('acquired');
     if(closed||owned.cancelled)throw new HarnessError('HERMES_MODEL_CANCELLED','The owned model request was cancelled.');
     const runtime=owned.runtime=options.createRuntime();
     runtime.configure({onTool:async()=>{throw new HarnessError('MODEL_ONLY_TOOL_DENIED','The model transport cannot execute host tools.');},onEvent(event:RuntimeEvent){
    if(active!==owned||owned.cancelled||event.threadId!==nativeInput.threadId||event.runId!==nativeInput.runId||event.epoch!==nativeInput.epoch)return;
    if(event.type==='input.processing'&&!entered&&Array.isArray(event.inputIds)&&event.inputIds.includes(id)){entered=true;if(metadata.phase==='foreground')writes=writes.then(()=>options.onInput?.([...metadata.inputIds]));}
    if(event.type==='assistant.delta')stage('firstProviderDelta');
    if(event.type==='assistant.message'&&typeof event.content==='string'&&!failure){stage('firstProviderDelta');if(Buffer.byteLength(event.content)>MODEL_ONLY_MAX_WIRE_BYTES-Buffer.byteLength(content))failure=invalid();else content+=event.content;}
    if(event.type==='usage')usage=measured(event.usage);
    if(event.type==='error')failure=new HarnessError('HERMES_NATIVE_FAILED','The selected native model could not complete its request.');
    if(event.type==='settled'){if(event.aborted===true)failure=new HarnessError('HERMES_MODEL_CANCELLED','The selected native model was cancelled.');completion.resolve();}
     }});
     stage('runtimeReady');
     await runtime.start(nativeInput);dispatched=true;stage('requestSent');await completion.promise;stage('settled');await writes;if(owned.cancelled||failure)throw failure??invalid();return{content,usage:usage??{...EMPTY_USAGE}};
    }catch(error){
     if(failure===undefined)failure=error;
     throw error;
    }finally{
     if(owned.runtime){const actual=usage??{...EMPTY_USAGE};usages.set(metadata.sequence,actual);try{options.onUsage?.(actual,metadata);}catch{/* Usage projection cannot prevent native teardown. */}}
     try{await owned.runtime?.dispose();release?.();stage('teardownConfirmed');}catch(error){cleanupError=error;if(failure===undefined)failure=error;throw error;}finally{
      const outcome=owned.cancelled?'cancelled':failure?'failed':'completed';
      const observation=metrics.finish(outcome,usageV1(usage),failure instanceof Error?failure.message:undefined);
      observations.set(metadata.sequence,observation);if(observations.size>256)observations.delete(observations.keys().next().value!);
      try{options.onObservation?.(observation,metadata);}catch{/* Observation cannot prevent native teardown. */}
      // Every dispatched request spends a call, usage report or not; missing
      // usage never means zero spend. A request cancelled before dispatch
      // consumed no model call.
      try{if(dispatched)options.budget?.reconcile(usage);}catch{/* Budget conflicts surface through the next admission. */}
      if(active===owned)active=undefined;
     }
    }
   })();
   // The native router emits settled only after its owned SDK/account teardown.
   const result=await owned.operation;
   if(!owned.cancelled){
    // The buffered transport's first public output is the completed response
    // committing to the wire — after teardown, never earlier.
    send(response,200,result);
    if(content){metrics.mark('firstPublicDelta');const published=metrics.result;if(published){observations.set(metadata.sequence,published);try{options.onObservation?.(published,metadata);}catch{/* Observation cannot prevent native teardown. */}}}
   }
  })().catch(()=>{if(!response.headersSent)send(response,400,{error:'The owned model request could not finish.'});else response.destroy();});
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw invalid();
 return{
  url:`http://127.0.0.1:${address.port}/model`,key,
  expect(request){if(closed||active||pending||!Number.isSafeInteger(request.sequence)||request.sequence<=lastSequence||!Array.isArray(request.inputIds)||request.inputIds.some(id=>typeof id!=='string'||!id)||!['foreground','background_review'].includes(request.phase))throw invalid();lastSequence=request.sequence;pending=structuredClone(request);},
  usage(sequence){const value=usages.get(sequence);return value?structuredClone(value):null;},
  observation(sequence){const value=observations.get(sequence);return value?structuredClone(value):null;},
  close(){return closing??=(async()=>{closed=true;pending=undefined;const operation=active?.operation;await cancel().catch(()=>{});await Promise.allSettled(operation?[operation]:[]);await new Promise<void>(done=>{server.close(()=>done());server.closeAllConnections();});if(cleanupError)throw cleanupError;})();},
 };
}
