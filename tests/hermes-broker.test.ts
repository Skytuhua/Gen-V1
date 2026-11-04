import {expect,it,vi} from 'vitest';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';
import {createHermesBroker} from '../packages/runtime-hermes/broker.ts';

const input:StartRun={threadId:'outer',runId:'run',epoch:3,inputId:'input',inputIds:['input'],modelId:'openai/model',accountId:'selected-account',prompt:'user',sessionPath:null,resources:[]};
function native(){let callbacks!:RuntimeCallbacks;let started!:StartRun;const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[],start:vi.fn(async value=>{started=value;}),followUp:async()=>{},cancel:vi.fn(async()=>{}),compact:async()=>{},history:async()=>[],dispose:vi.fn(async()=>{})};return{runtime,get input(){return started;},event(type:string,data:Record<string,unknown>={}){callbacks.onEvent({...started,type,...data});},tool(){return callbacks.onTool({name:'write',args:{}},started);}};}
const post=(broker:{url:string;key:string},body:unknown,signal?:AbortSignal)=>fetch(broker.url,{method:'POST',headers:{Authorization:'Bearer '+broker.key,'content-type':'application/json'},body:JSON.stringify(body),signal});
it('authenticates and seals the model/account/context before starting any native runtime',async()=>{
 const n=native(),factory=vi.fn(()=>n.runtime),b=await createHermesBroker({input,createRuntime:factory});try{
 expect((await fetch(b.url,{method:'POST',body:'{}'})).status).toBe(403);b.expect({sequence:1,inputIds:['input'],phase:'foreground'});
 expect((await post(b,{sessionId:'acp',modelId:'other/model',prompt:'opaque'})).status).toBe(400);expect(factory).not.toHaveBeenCalled();
 const response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:'opaque'});await vi.waitFor(()=>expect(n.runtime.start).toHaveBeenCalled());
 expect(n.input).toMatchObject({modelId:input.modelId,accountId:input.accountId,prompt:'opaque',resources:[],sessionPath:null});expect(n.input.threadId).not.toBe(input.threadId);await expect(n.tool()).rejects.toMatchObject({code:'MODEL_ONLY_TOOL_DENIED'});
 n.event('settled');expect((await response).status).toBe(200);
 }finally{await b.close();}
});
it('requires real native entry and settled, preserves raw text and returns measured usage',async()=>{
 const n=native(),onInput=vi.fn(async()=>{}),b=await createHermesBroker({input,createRuntime:()=>n.runtime,onInput});try{
 b.expect({sequence:4,inputIds:['input'],phase:'foreground'});let finished=false;const response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:'opaque'}).then(value=>{finished=true;return value;});await vi.waitFor(()=>expect(n.runtime.start).toHaveBeenCalled());
 n.event('agent_end');await Promise.resolve();expect(finished).toBe(false);expect(onInput).not.toHaveBeenCalled();n.event('input.processing',{inputIds:['wrong']});expect(onInput).not.toHaveBeenCalled();
 n.event('input.processing',{inputIds:[n.input.inputId]});n.event('assistant.message',{content:'<tool_call>{"name":"skill_manage"}</tool_call>\n日本語'});n.event('usage',{usage:{inputTokens:123,outputTokens:17,cost:null}});n.event('settled');
 const result=await(await response).json();expect(onInput).toHaveBeenCalledExactlyOnceWith(['input']);expect(result).toMatchObject({content:'<tool_call>{"name":"skill_manage"}</tool_call>\n日本語',usage:{inputTokens:123,outputTokens:17,cost:null}});expect(b.usage(4)).toMatchObject({inputTokens:123,outputTokens:17});expect(n.runtime.dispose).toHaveBeenCalledOnce();
 }finally{await b.close();}
});
it('keeps missing usage unknown and never treats background review as user input entry',async()=>{
 const n=native(),onInput=vi.fn(),b=await createHermesBroker({input,createRuntime:()=>n.runtime,onInput});try{b.expect({sequence:1,inputIds:[],phase:'background_review'});const response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:'review'});await vi.waitFor(()=>expect(n.runtime.start).toHaveBeenCalled());n.event('input.processing',{inputIds:[n.input.inputId]});n.event('settled');expect((await(await response).json()).usage).toMatchObject({inputTokens:null,outputTokens:null,cost:null});expect(onInput).not.toHaveBeenCalled();}finally{await b.close();}
});
it('waits for native cancellation/disposal after an HTTP disconnect',async()=>{
 const n=native();let release!:()=>void;n.runtime.cancel=vi.fn(()=>new Promise<void>(done=>{release=done;}));const b=await createHermesBroker({input,createRuntime:()=>n.runtime});
 try{b.expect({sequence:1,inputIds:['input'],phase:'foreground'});const abort=new AbortController(),response=post(b,{sessionId:'acp',modelId:input.modelId,prompt:'wait'},abort.signal).catch(()=>null);await vi.waitFor(()=>expect(n.runtime.start).toHaveBeenCalled());abort.abort();await vi.waitFor(()=>expect(n.runtime.cancel).toHaveBeenCalled());let closed=false;const closing=b.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);release();await closing;await response;expect(n.runtime.dispose).toHaveBeenCalledOnce();}finally{release?.();await b.close();}
});

it('shares two request slots across same-account brokers and cancels queued work without starting native',async()=>{
 const natives=Array.from({length:3},native),brokers=await Promise.all(natives.map((n,index)=>createHermesBroker({input:{...input,threadId:'parent-'+index,runId:'run-'+index},createRuntime:()=>n.runtime})));
 const requests:Promise<Response|null>[]=[];
 try{
  for(const b of brokers)b.expect({sequence:1,inputIds:['input'],phase:'foreground'});
  for(let i=0;i<3;i++)requests.push(post(brokers[i],{sessionId:'acp',modelId:input.modelId,prompt:'work'}).catch(()=>null));
  await vi.waitFor(()=>expect(natives.filter(n=>vi.mocked(n.runtime.start).mock.calls.length)).toHaveLength(2));
  await brokers[2].close();expect(natives[2].runtime.start).not.toHaveBeenCalled();
  natives[0].event('settled');natives[1].event('settled');await Promise.all(requests);
 }finally{await Promise.all(brokers.map(b=>b.close()));}
});

it('holds shared capacity through confirmed native disposal and yields it between parent and child calls',async()=>{
 const natives=Array.from({length:3},native);let release!:()=>void;
 natives[0].runtime.dispose=vi.fn(()=>new Promise<void>(done=>{release=done;}));
 const brokers=await Promise.all(natives.map((n,index)=>createHermesBroker({input:{...input,threadId:'capacity-'+index},createRuntime:()=>n.runtime})));
 const requests:Promise<Response|null>[]=[];
 try{
  for(const b of brokers)b.expect({sequence:1,inputIds:['input'],phase:'foreground'});
  for(let i=0;i<3;i++)requests.push(post(brokers[i],{sessionId:'acp',modelId:input.modelId,prompt:i===2?'delegated child':'parent'}).catch(()=>null));
  await vi.waitFor(()=>expect(natives[0].runtime.start).toHaveBeenCalled());await vi.waitFor(()=>expect(natives[1].runtime.start).toHaveBeenCalled());
  natives[0].event('settled');await vi.waitFor(()=>expect(natives[0].runtime.dispose).toHaveBeenCalled());
  expect(natives[2].runtime.start).not.toHaveBeenCalled();release();
  await vi.waitFor(()=>expect(natives[2].runtime.start).toHaveBeenCalled());natives[1].event('settled');natives[2].event('settled');await Promise.all(requests);
 }finally{release?.();await Promise.all(brokers.map(b=>b.close()));}
});
