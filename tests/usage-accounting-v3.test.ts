import {expect,it,vi} from 'vitest';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {createHermesBroker} from '../packages/runtime-hermes/broker.ts';
import {EMPTY_USAGE} from '../packages/contracts/index.ts';
import {runtimeUsageReport,usageCount,usageCost} from '../apps/web/src/usage-presentation.ts';
import {modelRequestObservationV1Schema} from '../packages/contracts/model-request.ts';

const input:StartRun={threadId:'outer',runId:'run',epoch:1,inputId:'i',inputIds:['i'],modelId:'openai/model',accountId:'acct',prompt:'p',sessionPath:null,resources:[]};
function native(){let callbacks!:RuntimeCallbacks;let started!:StartRun;const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[],start:vi.fn(async value=>{started=value;}),followUp:async()=>{},cancel:vi.fn(async()=>{}),compact:async()=>{},history:async()=>[],dispose:vi.fn(async()=>{})};return{runtime,get input(){return started;},event(type:string,data:Record<string,unknown>={}){callbacks.onEvent({...started,type,...data});}};}
const post=(broker:{url:string;key:string},body:unknown)=>fetch(broker.url,{method:'POST',headers:{Authorization:'Bearer '+broker.key,'content-type':'application/json'},body:JSON.stringify(body)});
async function roundTrip(usage:Record<string,unknown>|undefined){
 const n=native(),b=await createHermesBroker({input,createRuntime:()=>n.runtime});
 try{
  b.expect({sequence:1,inputIds:['i'],phase:'foreground'});
  const response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:'opaque'});await vi.waitFor(()=>expect(n.runtime.start).toHaveBeenCalled());
  if(usage)n.event('usage',{usage});n.event('settled');
  const result=await(await response).json();return{result,stored:b.usage(1),observation:b.observation(1)};
 }finally{await b.close();}
}

it('absent cache fields stay unknown — never reported as zero or folded into input tokens',async()=>{
 const {result,stored,observation}=await roundTrip({inputTokens:11,outputTokens:3,cost:null});
 expect(result.usage).toMatchObject({inputTokens:11,outputTokens:3,cacheReadTokens:null,cacheWriteTokens:null});
 expect(stored).toMatchObject({cacheReadTokens:null,cacheWriteTokens:null});
 expect(observation!.usage.cacheReadTokens).toBeNull();
 // Provider convention is kept: cacheRead is a reported breakdown, never
 // added on top of inputTokens.
 expect(result.usage.inputTokens).toBe(11);
});
it('zero and nonzero cache counts are distinct from absent and each other',async()=>{
 const zero=await roundTrip({inputTokens:11,outputTokens:3,cacheReadTokens:0,cacheWriteTokens:0});
 expect(zero.result.usage).toMatchObject({cacheReadTokens:0,cacheWriteTokens:0});
 expect(zero.result.usage.cacheReadTokens).not.toBeNull();
 const hit=await roundTrip({inputTokens:11,outputTokens:3,cacheReadTokens:42,cacheWriteTokens:9});
 expect(hit.result.usage).toMatchObject({cacheReadTokens:42,cacheWriteTokens:9});
 expect(hit.observation!.usage).toMatchObject({cacheReadTokens:42,cacheWriteTokens:9});
});
it('missing usage publishes as unreported, not zero-filled',async()=>{
 const {result,observation}=await roundTrip(undefined);
 expect(result.usage).toMatchObject({inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,cost:null});
 expect(observation!.usageConvention).toBe('unreported');
});
it('runtimeUsageReport carries measured cache counts and unknowns stay Not reported',()=>{
 const thread={id:'t1',title:'Task',modelId:'openai/model'};
 const report=runtimeUsageReport(thread,{...EMPTY_USAGE,inputTokens:5,outputTokens:2,cacheReadTokens:0,cacheWriteTokens:7});
 expect(report).toMatchObject({inputTokens:5,outputTokens:2,cacheReadTokens:0,cacheWriteTokens:7});
 expect(usageCount(report!.cacheReadTokens)).toBe('0');
 expect(usageCount(report!.cacheWriteTokens)).toBe('7');
 const unknown=runtimeUsageReport(thread,{...EMPTY_USAGE});
 expect(unknown!.cacheReadTokens).toBeNull();expect(usageCount(unknown!.cacheReadTokens)).toBe('Not reported');
 expect(usageCost(null)).toBe('Not reported');
});
it('observation schema rejects fabricated or unbounded records',()=>{
 const base={version:1 as const,requestId:'r',owner:{threadId:'t',runId:'r',epoch:1,sequence:1,inputIds:['i'],phase:'foreground' as const},binding:{providerId:'p',modelId:'m',accountId:null},timings:{queued:1,acquired:2,runtimeReady:3,requestSent:4,firstProviderDelta:5,firstPublicDelta:6,settled:7,teardownConfirmed:8},usage:{inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,cost:null},usageConvention:'unreported' as const,measurementSource:'test',outcome:'completed' as const};
 expect(modelRequestObservationV1Schema.parse(base)).toBeTruthy();
 // Extra prompt/content fields are rejected: observations carry no payload.
 expect(modelRequestObservationV1Schema.safeParse({...base,prompt:'secret'}).success).toBe(false);
 expect(modelRequestObservationV1Schema.safeParse({...base,usage:{...base.usage,cacheReadTokens:-1}}).success).toBe(false);
 expect(modelRequestObservationV1Schema.safeParse({...base,outcome:'partial'}).success).toBe(false);
 expect(modelRequestObservationV1Schema.safeParse({...base,owner:{...base.owner,phase:'interactive'}}).success).toBe(false);
});
