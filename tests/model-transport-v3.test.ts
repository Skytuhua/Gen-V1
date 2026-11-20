import {expect,it,vi} from 'vitest';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {createHermesBroker} from '../packages/runtime-hermes/broker.ts';
import {RequestMetrics,RequestMetricsLog} from '../packages/runtime/request-metrics.ts';
import {RequestScheduler} from '../packages/runtime/request-scheduler.ts';
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
  expect(observation!.timings.teardownConfirmed!).toBeLessThanOrEqual(observation!.timings.firstPublicDelta!);
  expect(observation!.timings.settled!).toBeLessThanOrEqual(observation!.timings.teardownConfirmed!);
  // The observation is emitted once at teardown and again when the response
  // actually commits with the final firstPublicDelta stamp.
  expect(observations).toHaveLength(2);
  expect(observations[0]).toMatchObject({ timings: { firstPublicDelta: null } });
  expect(observations[1]).toMatchObject({ timings: { firstPublicDelta: observation!.timings.firstPublicDelta } });
 }finally{await b.close();}
});
it('records dispatch before output emitted while the native start promise is pending',async()=>{
 const n=native(),start=n.runtime.start,stages:string[]=[];
 let acknowledge!:()=>void;
 const pending=new Promise<void>(resolve=>{acknowledge=resolve;});
 n.runtime.start=vi.fn(async value=>{await start(value);n.event('assistant.delta',{content:'early'});await pending;});
 const b=await createHermesBroker({input,createRuntime:()=>n.runtime,onStage:stage=>stages.push(stage)});
 try{
  b.expect({sequence:1,inputIds:['input'],phase:'foreground'});
  const response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:'opaque'});
  await vi.waitFor(()=>expect(n.input).toBeDefined());
  acknowledge();
  await vi.waitFor(()=>expect(stages).toContain('requestSent'));
  n.event('assistant.message',{content:'early'});n.event('settled');
  expect((await response).status).toBe(200);
  const timings=b.observation(1)!.timings;
  expect(timings.requestSent!).toBeLessThanOrEqual(timings.firstProviderDelta!);
  expect(stages.filter(stage=>stage==='firstProviderDelta')).toHaveLength(1);
  expect(stages.indexOf('requestSent')).toBeLessThan(stages.indexOf('firstProviderDelta'));
 }finally{acknowledge();await b.close();}
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
it('thrown failures record a failed outcome and failed disposal never confirms teardown',async()=>{
 const n=native();n.runtime.start=vi.fn(async()=>{throw new Error('engine refused');});
 const b=await createHermesBroker({input,createRuntime:()=>n.runtime});try{
  b.expect({sequence:1,inputIds:[],phase:'foreground'});
  const response=await post(b,{sessionId:'acp',modelId:input.modelId,prompt:'x'});
  expect(response.status).toBe(400);
  const observation=b.observation(1)!;
  expect(observation.outcome).toBe('failed');expect(observation.error).toBe('The owned model request failed.');
  // The runtime was created so teardown still ran and was confirmed.
  expect(observation.timings.teardownConfirmed).not.toBeNull();
 }finally{await b.close();}
 const n2=native();n2.runtime.dispose=vi.fn(async()=>{throw new Error('leak');});
 const b2=await createHermesBroker({input,createRuntime:()=>n2.runtime});try{
  b2.expect({sequence:1,inputIds:[],phase:'foreground'});
  const response=post(b2,{sessionId:'acp',modelId:input.modelId,prompt:'x'});await vi.waitFor(()=>expect(n2.runtime.start).toHaveBeenCalled());
  n2.event('assistant.message',{content:'hi'});n2.event('settled');
  expect((await response).status).toBe(400);
  const observation=b2.observation(1)!;
  expect(observation.outcome).toBe('failed');expect(observation.timings.teardownConfirmed).toBeNull();
 }finally{await b2.close().catch(()=>{});}
});
it.each(['start','dispose'] as const)('%s failure never copies source prose or credential text into broker observations',async phase=>{
 const source='Private source prose: the release handoff codeword is scarlet ibis.',credential='sk-test-M05_TELEMETRY_ONLY_NOT_A_REAL_KEY_7c31f81e';
 const failure=new Error(`${source} Credential: ${credential}`),n=native(),scheduler=new RequestScheduler(1),emitted:unknown[]=[],log=new RequestMetricsLog();
 if(phase==='start')n.runtime.start=vi.fn(async()=>{throw failure;});else n.runtime.dispose=vi.fn(async()=>{throw failure;});
 const b=await createHermesBroker({input,createRuntime:()=>n.runtime,scheduler,onObservation:value=>{emitted.push(structuredClone(value));log.record(structuredClone(value));}});
 try{
  b.expect({sequence:1,inputIds:['input'],phase:'foreground'});
  const response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:source});
  if(phase==='dispose'){
   await vi.waitFor(()=>expect(n.runtime.start).toHaveBeenCalled());
   n.event('assistant.message',{content:'Buffered output is withheld after failed teardown.'});
   n.event('usage',{usage:{inputTokens:7,outputTokens:3}});n.event('settled');
  }
  expect((await response).status).toBe(400);
  const stored=b.observation(1)!;expect(stored).not.toBeNull();expect(emitted).toHaveLength(1);expect(log.list()).toHaveLength(1);
  for(const [channel,value] of [['stored',stored],['callback',emitted[0]],['log',log.list()[0]]] as const){
   const serialized=JSON.stringify(value);
   expect.soft(serialized,`${channel} source custody`).not.toContain(source);
   expect.soft(serialized,`${channel} credential custody`).not.toContain(credential);
   expect.soft(value,`${channel} safe diagnostic and ownership`).toMatchObject({outcome:'failed',error:'The owned model request failed.',measurementSource:'hermes-broker',owner:{threadId:'outer',runId:'run',epoch:3,sequence:1,inputIds:['input'],phase:'foreground'},binding:{providerId:'openai',modelId:'openai/model',accountId:'selected-account'}});
  }
  expect(modelRequestObservationV1Schema.safeParse(stored).success).toBe(true);
  expect(stored.timings.queued).toBeGreaterThan(0);expect(stored.timings.acquired).toBeGreaterThanOrEqual(0);expect(stored.timings.runtimeReady).toBeGreaterThanOrEqual(stored.timings.acquired!);
  expect(stored.timings.firstPublicDelta).toBeNull();
  if(phase==='start'){
   expect(stored.timings.requestSent).toBeNull();expect(stored.timings.firstProviderDelta).toBeNull();expect(stored.timings.settled).toBeNull();
   expect(stored.timings.teardownConfirmed).toBeGreaterThanOrEqual(stored.timings.runtimeReady!);expect(stored.usageConvention).toBe('unreported');
   expect(stored.usage).toEqual({inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,cost:null});
  }else{
   expect(stored.timings.requestSent).toBeGreaterThanOrEqual(stored.timings.runtimeReady!);expect(stored.timings.firstProviderDelta).toBeGreaterThanOrEqual(stored.timings.requestSent!);expect(stored.timings.settled).toBeGreaterThanOrEqual(stored.timings.firstProviderDelta!);
   expect(stored.timings.teardownConfirmed).toBeNull();expect(stored.usageConvention).toBe('provider-reported');expect(stored.usage).toMatchObject({inputTokens:7,outputTokens:3});
   // Failed native disposal still owns its permit; telemetry redaction must not release it.
   const abort=new AbortController(),queued=scheduler.acquire('openai','selected-account',abort.signal);abort.abort();await expect(queued).rejects.toMatchObject({code:'MODEL_REQUEST_CANCELLED'});
  }
 }finally{if(phase==='dispose')await expect(b.close()).rejects.toBe(failure);else await b.close();}
});
it('RequestMetrics finishes exactly once and first mark wins',()=>{
 let tick=0;const metrics=new RequestMetrics({version:1,requestId:'r1',owner:{threadId:'t',runId:'r',epoch:1,sequence:1,inputIds:['i'],phase:'foreground'},binding:{providerId:'p',modelId:'m',accountId:null},measurementSource:'test'},()=>tick);
 tick=5;expect(metrics.mark('acquired')).toBe(5);tick=9;expect(metrics.mark('acquired')).toBe(5);
 tick=12;metrics.mark('teardownConfirmed');const observation=metrics.finish('completed',{inputTokens:null,outputTokens:null,cacheReadTokens:0,cacheWriteTokens:null,cost:null});
 expect(observation.timings.teardownConfirmed).toBe(12);expect(observation.usageConvention).toBe('provider-reported');
 expect(observation.usage.cacheReadTokens).toBe(0);expect(observation.usage.cacheReadTokens).not.toBeNull();
 expect(metrics.finish('failed',null)).toBe(observation);expect(metrics.mark('settled')).toBeNull();
 tick=13;expect(metrics.mark('firstPublicDelta')).toBe(13);
 expect(metrics.mark('settled')).toBeNull();
 expect(observation.timings.settled).toBeNull();
 tick=20;expect(metrics.mark('firstPublicDelta')).toBe(13);
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
 const reasons = Object.freeze({supportsSteering:'Supplied note', supportsPublicStreaming:'No public streaming'});
 const fromFrozen = assertCapabilities({supportsSteering:true}, reasons, 'proof');
 expect(fromFrozen.reasons.supportsSteering).toBeUndefined();
 expect(fromFrozen.reasons.supportsPublicStreaming).toBe('No public streaming');
 expect(reasons).toEqual({supportsSteering:'Supplied note', supportsPublicStreaming:'No public streaming'});
});

it('leaves teardown unknown when a request never creates a native runtime',async()=>{
 const stages:string[]=[];
 const b=await createHermesBroker({input,createRuntime:()=>{throw new Error('adapter unavailable');},onStage:stage=>stages.push(stage)});
 try{
  b.expect({sequence:1,inputIds:[],phase:'foreground'});
  expect((await post(b,{sessionId:'acp',modelId:input.modelId,prompt:'x'})).status).toBe(400);
  expect(b.observation(1)).toMatchObject({outcome:'failed',timings:{runtimeReady:null,teardownConfirmed:null}});
  expect(stages).toEqual(['queued','acquired']);
 }finally{await b.close();}
});
