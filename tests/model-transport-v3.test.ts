import {expect,it,vi} from 'vitest';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {createHermesBroker} from '../packages/runtime-hermes/broker.ts';
import {RequestMetrics,RequestMetricsLog} from '../packages/runtime/request-metrics.ts';
import {assertCapabilities,hermesModelTransportCapabilities} from '../packages/runtime/request-capabilities.ts';
import {modelRequestObservationV1Schema,requestCapabilitiesV1Schema} from '../packages/contracts/model-request.ts';

const input:StartRun={threadId:'outer',runId:'run',epoch:3,inputId:'input',inputIds:['input'],modelId:'openai/model',accountId:'selected-account',prompt:'user',sessionPath:null,resources:[]};
function native(){let callbacks!:RuntimeCallbacks;let started!:StartRun;const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[],start:vi.fn(async value=>{started=value;}),followUp:async()=>{},cancel:vi.fn(async()=>{}),compact:async()=>{},history:async()=>[],dispose:vi.fn(async()=>{})};return{runtime,get input(){return started;},event(type:string,data:Record<string,unknown>={}){callbacks.onEvent({...started,type,...data});}};}
const post=(broker:{url:string;key:string},body:unknown,signal?:AbortSignal)=>fetch(broker.url,{method:'POST',headers:{Authorization:'Bearer '+broker.key,'content-type':'application/json'},body:JSON.stringify(body),signal});

it('records a stable request id and monotonic stage timings with owned binding',async()=>{
 const n=native(),observations:unknown[]=[],b=await createHermesBroker({input,createRuntime:()=>n.runtime,onObservation:value=>observations.push(value)});try{
  b.expect({sequence:1,inputIds:['input'],phase:'foreground'});
  const response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:'opaque'});await vi.waitFor(()=>expect(n.runtime.start).toHaveBeenCalled());
  n.event('assistant.message',{content:'hello'});n.event('usage',{usage:{inputTokens:10,outputTokens:4,cacheReadTokens:7,cacheWriteTokens:3}});n.event('settled');
  expect((await response).status).toBe(200);
  const observation=b.observation(1);expect(observation).not.toBeNull();
  expect(modelRequestObservationV1Schema.parse(observation)).toBeTruthy();
  expect(observation).toMatchObject({version:1,outcome:'completed',usageConvention:'provider-reported',measurementSource:'hermes-broker',owner:{threadId:'outer',runId:'run',epoch:3,sequence:1,phase:'foreground'},binding:{providerId:'openai',modelId:input.modelId,accountId:'selected-account'}});
  expect(observation!.usage).toMatchObject({inputTokens:10,outputTokens:4,cacheReadTokens:7,cacheWriteTokens:3});
  for(const stage of ['acquired','runtimeReady','requestSent','firstProviderDelta','firstPublicDelta','settled','teardownConfirmed'] as const)expect(typeof observation!.timings[stage],stage).toBe('number');
  // Startup/capacity/inference/cleanup stay separate, and the first
  // user-visible mark can never precede the provider's first bytes.
  expect(observation!.timings.acquired!).toBeLessThanOrEqual(observation!.timings.runtimeReady!);
  expect(observation!.timings.requestSent!).toBeLessThanOrEqual(observation!.timings.firstProviderDelta!);
  expect(observation!.timings.firstProviderDelta!).toBeLessThanOrEqual(observation!.timings.firstPublicDelta!);
  expect(observation!.timings.settled!).toBeLessThanOrEqual(observation!.timings.firstPublicDelta!);
  expect(observation!.timings.firstPublicDelta!).toBeLessThanOrEqual(observation!.timings.teardownConfirmed!);
  expect(observation!.timings.settled!).toBeLessThanOrEqual(observation!.timings.teardownConfirmed!);
  expect(observations).toHaveLength(1);
 }finally{await b.close();}
});
it('marks no firstPublicDelta when buffered output never publishes, and keeps absent usage unknown',async()=>{
 const n=native(),b=await createHermesBroker({input,createRuntime:()=>n.runtime});try{
  b.expect({sequence:1,inputIds:[],phase:'background_review'});
  const response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:'review'});await vi.waitFor(()=>expect(n.runtime.start).toHaveBeenCalled());
  n.event('settled');expect((await response).status).toBe(200);
  const observation=b.observation(1)!;
  expect(observation.outcome).toBe('completed');expect(observation.owner.phase).toBe('background');
  expect(observation.timings.firstPublicDelta).toBeNull();expect(observation.timings.firstProviderDelta).toBeNull();
  expect(observation.usageConvention).toBe('unreported');
  // Absent is not zero: every usage field stays null, never fabricated.
  expect(observation.usage).toMatchObject({inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,cost:null});
 }finally{await b.close();}
});
it('records a cancelled outcome through the failed teardown path and preserves account custody',async()=>{
 const n=native();let release!:()=>void;n.runtime.cancel=vi.fn(()=>new Promise<void>(done=>{release=done;}));
 const b=await createHermesBroker({input,createRuntime:()=>n.runtime});try{
  b.expect({sequence:1,inputIds:['input'],phase:'foreground'});
  const abort=new AbortController(),response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:'wait'},abort.signal).catch(()=>null);
  await vi.waitFor(()=>expect(n.runtime.start).toHaveBeenCalled());abort.abort();
  await vi.waitFor(()=>expect(n.runtime.cancel).toHaveBeenCalled());release();
  await Promise.allSettled([response]);await vi.waitFor(()=>expect(b.observation(1)).not.toBeNull());
  const observation=b.observation(1)!;
  expect(observation.outcome).toBe('cancelled');
  expect(observation.timings.firstPublicDelta).toBeNull();
  expect(observation.timings.teardownConfirmed).not.toBeNull();
 }finally{release?.();await b.close();}
});
it('RequestMetrics finishes exactly once and first mark wins',()=>{
 let tick=0;const metrics=new RequestMetrics({version:1,requestId:'r1',owner:{threadId:'t',runId:'r',epoch:1,sequence:1,inputIds:['i'],phase:'foreground'},binding:{providerId:'p',modelId:'m',accountId:null},measurementSource:'test'},()=>tick);
 tick=5;expect(metrics.mark('acquired')).toBe(5);tick=9;expect(metrics.mark('acquired')).toBe(5);
 tick=12;const observation=metrics.finish('completed',{inputTokens:null,outputTokens:null,cacheReadTokens:0,cacheWriteTokens:null,cost:null});
 expect(observation.timings.teardownConfirmed).toBe(12);expect(observation.usageConvention).toBe('provider-reported');
 expect(observation.usage.cacheReadTokens).toBe(0);expect(observation.usage.cacheReadTokens).not.toBeNull();
 expect(metrics.finish('failed',null)).toBe(observation);expect(metrics.mark('settled')).toBeNull();
 const log=new RequestMetricsLog(2);log.record(observation);log.record(observation);log.record({...observation,requestId:'r2'});
 expect(log.list()).toHaveLength(2);
});
it('adapter capabilities are asserted with reasons and proof, never inferred from a model name',()=>{
 const capabilities=hermesModelTransportCapabilities();
 expect(requestCapabilitiesV1Schema.parse(capabilities)).toBeTruthy();
 expect(capabilities.supportsPublicStreaming).toBe(false);expect(capabilities.reasons.supportsPublicStreaming).toBeTruthy();
 expect(capabilities.supportsStatelessReuse).toBe(false);expect(capabilities.reasons.supportsStatelessReuse).toBeTruthy();
 expect(capabilities.supportsUsageCacheBreakdown).toBe(true);expect(capabilities.supportsNativeCompaction).toBe(true);expect(capabilities.supportsSteering).toBe(true);
 expect(capabilities.proofRef).toContain('tests/');
 const asserted=assertCapabilities({supportsSteering:true},{supportsPublicStreaming:'No typed public delta channel exists.'},'proof');
 expect(asserted.supportsSteering).toBe(true);expect(asserted.supportsPublicStreaming).toBe(false);
 expect(asserted.reasons.supportsStatelessReuse).toBeTruthy();
});
