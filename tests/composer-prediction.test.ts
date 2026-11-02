import {afterEach,expect,it,vi} from 'vitest';
import {ComposerPredictions,predictionContext,parsePrediction,PREDICTION_LIMITS,type PredictionBasis} from '../packages/core/composer-prediction.ts';
import type {Message,RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.useRealTimers();for(const close of cleanups.splice(0).reverse())await close();});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};};
function adapter(){let callbacks!:RuntimeCallbacks;const starts:StartRun[]=[];const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:vi.fn(async()=>[]),start:vi.fn(async value=>{starts.push(value);}),followUp:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),compact:vi.fn(async()=>{}),history:vi.fn(async()=>[]),dispose:vi.fn(async()=>{})};return{runtime,starts,get callbacks(){return callbacks;},settle(text='{"suggestion":"What should I check next?"}'){const run=starts[0];callbacks.onEvent({...run,type:'assistant.message',messageId:'prediction-output',content:text});callbacks.onEvent({...run,type:'settled'});}};}
const basis=(threadId='thread'):PredictionBasis=>({threadId,replyId:'reply',modelId:'openai/model',accountId:null,epoch:2,context:'[{"role":"user","content":"Please check."},{"role":"assistant","content":"Checked."}]'});
function fixture(){let current:PredictionBasis|null=basis();const models:ReturnType<typeof adapter>[]=[];const predictions=new ComposerPredictions({factory:()=>{const next=adapter();models.push(next);return next.runtime;},current:id=>current?.threadId===id?current:null});cleanups.push(()=>predictions.dispose());return{predictions,models,get current(){return current;},set current(value:PredictionBasis|null){current=value;}};}
const request=(x:ReturnType<typeof fixture>,signal?:AbortSignal)=>x.predictions.request({threadId:'thread',replyId:'reply',modelId:'openai/model'},signal);

it('uses only twelve canonical text messages within sixteen KiB and restores their order',()=>{
 const messages=Array.from({length:18},(_,i)=>({id:String(i),threadId:'thread',role:i%2?'assistant':'user',content:(i===17?'😀':'x').repeat(2000),runId:null,createdAt:''} as Message));messages.push({...messages[0],role:'activity',content:'SECRET TOOL LOG'});
 const context=predictionContext(messages),parsed=JSON.parse(context) as {role:string;content:string}[];
 expect(parsed.length).toBeLessThanOrEqual(12);expect(Buffer.byteLength(parsed.map(x=>x.content).join(''))).toBeLessThanOrEqual(16*1024);expect(parsed.at(-1)?.content).toBe('😀'.repeat(2000));expect(context).not.toContain('SECRET TOOL LOG');expect(context).not.toContain('�');
});
it('accepts exactly one JSON key, one paragraph and at most 280 Unicode characters',()=>{
 expect(parsePrediction('{"suggestion":"'+ '😀'.repeat(280)+'"}')).toBe('😀'.repeat(280));
 for(const text of ['{"suggestion":"'+ '😀'.repeat(281)+'"}','{"suggestion":"x","approval":true}','{"suggestion":"x","suggestion":"y"}','```json\n{"suggestion":"x"}\n```','{"suggestion":"x\\ny"}','{"suggestion":"x\\u0085y"}','{"suggestion":"x y"}','{"suggestion":"   "}'])expect(parsePrediction(text)).toBeNull();
 expect(parsePrediction('{"suggestion":null}')).toBeNull();
});
it('never creates eligibility from a request and shares one generation for duplicate callers',async()=>{
 const x=fixture();expect(await request(x)).toMatchObject({suggestion:null});expect(x.models).toEqual([]);
 x.predictions.settled(x.current!);const first=request(x),second=request(x);await vi.waitFor(()=>expect(x.models[0]?.starts).toHaveLength(1));
 expect(x.models[0].runtime.models).not.toHaveBeenCalled();expect(x.models[0].starts[0]).toMatchObject({sessionPath:null,resources:[],accountId:null,modelId:'openai/model'});expect(x.models[0].starts[0].threadId).not.toBe('thread');
 x.models[0].settle();expect(await first).toEqual(await second);expect(await request(x)).toMatchObject({suggestion:'What should I check next?'});expect(x.models).toHaveLength(1);
});
it('does not cancel another caller when one disappears, but cancels when all disappear',async()=>{
 const x=fixture();x.predictions.settled(x.current!);const gone=new AbortController(),live=new AbortController(),first=request(x,gone.signal),second=request(x,live.signal);await vi.waitFor(()=>expect(x.models[0]?.starts).toHaveLength(1));gone.abort();expect(await first).toMatchObject({suggestion:null});expect(x.models[0].runtime.cancel).not.toHaveBeenCalled();live.abort();expect(await second).toMatchObject({suggestion:null});await vi.waitFor(()=>expect(x.models[0].runtime.dispose).toHaveBeenCalled());expect(await request(x)).toMatchObject({suggestion:null});expect(x.models).toHaveLength(1);
});
it('reserves global ownership before async startup and never queues another thread',async()=>{
 const ready=deferred<RuntimeAdapter>(),native=adapter();let current=basis(),calls=0;const predictions=new ComposerPredictions({factory:()=>{calls++;return ready.promise;},current:()=>current});cleanups.push(()=>predictions.dispose());predictions.settled(current);const one=predictions.request(current);current=basis('other');predictions.settled(current);expect(await predictions.request(current)).toMatchObject({suggestion:null});expect(calls).toBe(1);ready.resolve(native.runtime);await vi.waitFor(()=>expect(native.starts).toHaveLength(0));await predictions.cancel();expect(await one).toMatchObject({suggestion:null});expect(native.runtime.dispose).toHaveBeenCalled();expect(calls).toBe(1);
});
it('discards results after context, model, account or epoch changes',async()=>{
 for(const change of [{context:'changed'},{modelId:'openai/new'},{accountId:'named-account'},{epoch:3}]){const x=fixture();x.predictions.settled(x.current!);const result=request(x);await vi.waitFor(()=>expect(x.models[0]?.starts).toHaveLength(1));x.current={...x.current!,...change};x.models[0].settle();expect(await result).toMatchObject({suggestion:null});}
});
it('rejects mismatched captured models and unsupported providers before factory creation',async()=>{
 const x=fixture();x.predictions.settled(x.current!);expect(await x.predictions.request({...x.current!,modelId:'anthropic/other'})).toMatchObject({suggestion:null});x.current={...x.current!,modelId:'unrecognized/model'};x.predictions.settled(x.current);expect(await x.predictions.request(x.current)).toMatchObject({suggestion:null});expect(x.models).toEqual([]);
});
it('denies tools, bounds output and exposes only actual reported prediction usage',async()=>{
 const x=fixture();x.predictions.settled(x.current!);const result=request(x);await vi.waitFor(()=>expect(x.models[0]?.starts).toHaveLength(1));const native=x.models[0],run=native.starts[0];native.callbacks.onEvent({...run,type:'usage',usage:{inputTokens:7,outputTokens:2,cost:0.01,sessionPercent:NaN,activity:'running'}});native.settle();expect(await result).toMatchObject({usage:{inputTokens:7,outputTokens:2,cost:0.01}});expect((await result).usage).not.toHaveProperty('activity');expect((await result).usage).not.toHaveProperty('sessionPercent');
 const y=fixture();y.predictions.settled(y.current!);const denied=request(y);await vi.waitFor(()=>expect(y.models[0]?.starts).toHaveLength(1));await expect(y.models[0].callbacks.onTool({name:'task_finish',args:{}},y.models[0].starts[0])).rejects.toMatchObject({code:'PREDICTION_TOOL_DENIED'});expect(await denied).toMatchObject({suggestion:null});
 const z=fixture();z.predictions.settled(z.current!);const overflow=request(z);await vi.waitFor(()=>expect(z.models[0]?.starts).toHaveLength(1));z.models[0].callbacks.onEvent({...z.models[0].starts[0],type:'assistant.delta',delta:'x'.repeat(4097)});expect(await overflow).toMatchObject({suggestion:null});
});
it('times out once and retains ownership through delayed cleanup',async()=>{
 vi.useFakeTimers();const x=fixture(),cleanup=deferred<void>();x.predictions.settled(x.current!);const result=request(x);await vi.advanceTimersByTimeAsync(0);x.models[0].runtime.dispose=vi.fn(()=>cleanup.promise);await vi.advanceTimersByTimeAsync(PREDICTION_LIMITS.timeoutMs);expect(await result).toMatchObject({suggestion:null});x.current=basis('other');x.predictions.settled(x.current);expect(await x.predictions.request(x.current)).toMatchObject({suggestion:null});expect(x.models).toHaveLength(1);cleanup.resolve();await x.predictions.cancel();
});
it('cancels delayed factory startup without starting a model and retains failed cleanup ownership',async()=>{
 const creating=deferred<RuntimeAdapter>(),native=adapter();let calls=0,current=basis();const predictions=new ComposerPredictions({factory:()=>{calls++;return creating.promise;},current:()=>current});predictions.settled(current);const result=predictions.request(current);await Promise.resolve();const cancel=predictions.cancel();expect(await result).toMatchObject({suggestion:null});creating.resolve(native.runtime);await cancel;expect(native.runtime.start).not.toHaveBeenCalled();expect(native.runtime.cancel).toHaveBeenCalled();expect(native.runtime.dispose).toHaveBeenCalled();
 current=basis('other');predictions.settled(current);native.runtime.dispose=vi.fn(async()=>{throw Error('unconfirmed native close');});const next=predictions.request(current);await vi.waitFor(()=>expect(native.starts).toHaveLength(1));const stop=predictions.cancel();expect(await next).toMatchObject({suggestion:null});await expect(stop).rejects.toMatchObject({code:'PREDICTION_CLEANUP_FAILED'});current=basis('third');predictions.settled(current);expect(await predictions.request(current)).toMatchObject({suggestion:null});expect(calls).toBe(2);await expect(predictions.dispose()).rejects.toMatchObject({code:'PREDICTION_CLEANUP_FAILED'});
});
it('evicts old slots and expires them without allowing historical regeneration',async()=>{
 vi.useFakeTimers();const x=fixture();for(let n=0;n<33;n++)x.predictions.settled(basis(String(n)));x.current=basis('0');expect(await x.predictions.request(x.current)).toMatchObject({suggestion:null});x.current=basis('32');await vi.advanceTimersByTimeAsync(10*60*1000);expect(await x.predictions.request(x.current)).toMatchObject({suggestion:null});expect(x.models).toEqual([]);
});
