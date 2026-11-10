import {expect,it,vi} from 'vitest';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import type {RuntimeAdapter,RuntimeCallbacks,RuntimeEvent,StartRun} from '../packages/contracts/index.ts';
import {createHermesRuntime,type HermesRuntimeOptions,type HermesSourceClient} from '../packages/runtime-hermes/index.ts';
import type {HermesClient,HermesEvent} from '../packages/runtime-hermes/client.ts';
import {encodeInput} from '../packages/runtime-pi/input-envelope.ts';

it('keeps private completed-write metadata off the default/company path and model envelope',async()=>{
 const f=await fixture(),input=run({completedWrites:[{operationId:'op',revision:1,inputId:'operation-result:op',origin:{threadId:'thread',runId:'before',epoch:0,sessionPath:'not-admitted',modelId:'openai/model',accountId:null,projectId:'project',workspaceId:'worktree',projectRoot:'C:/private-project'},path:'C:/private-project/App.tsx',sha256:'a'.repeat(64),bytes:1}]});
 try{await f.runtime.start(input);expect(f.start()).not.toHaveProperty('completedWrites');expect(f.start().prompt).not.toContain('private-project');await expect(f.runtime.followUp({...input,inputId:'next'})).rejects.toMatchObject({code:'HERMES_INPUT_INVALID'});await f.settle();}finally{await f.runtime.dispose();}
});
it('passes only a matching idle receipt through the optional host channel and rejects stale delivery',async()=>{
 const f=await fixture({approvedWriteHooks:true,projectRoot:'C:/private-project'});
 try{
 await f.runtime.start(run());const session=f.start().sessionPath as string;await f.settle();
 const input=run({runId:'after',epoch:2,inputId:'operation-result:op',sessionPath:session}),receipt={operationId:'op',revision:1,inputId:input.inputId,origin:{threadId:input.threadId,runId:'run',epoch:1,modelId:input.modelId,accountId:null,sessionPath:session,projectId:'project',workspaceId:'workspace',projectRoot:'C:/private-project'},delivery:{threadId:input.threadId,runId:input.runId,epoch:input.epoch},path:'C:/private-project/App.tsx',sha256:'a'.repeat(64),bytes:1};
 await f.runtime.start({...input,completedWrites:[receipt]});expect(f.start().completedWrites).toEqual([receipt]);expect(f.start().prompt).not.toContain('private-project');await f.settle();
 await f.runtime.start({...input,runId:'changed',epoch:3,inputId:'operation-result:op',completedWrites:[receipt]});expect(f.start().completedWrites).toEqual([]);expect(f.events).toContainEqual(expect.objectContaining({type:'write.hook',diagnostic:expect.objectContaining({status:'stale'})}));await f.settle();
 }finally{await f.runtime.dispose();}
});

const run=(extra:Partial<StartRun>={}):StartRun=>({threadId:'thread',runId:'run',epoch:1,inputId:'input',modelId:'openai/model',accountId:null,sessionPath:null,prompt:'Original user prompt',resources:[],...extra});
async function fixture(extra:Partial<HermesRuntimeOptions>={}){
 const dataDir=await mkdtemp(join(tmpdir(),'hermes-runtime-')),events:RuntimeEvent[]=[],sourceEvents:HermesEvent[]=[],sources:{options:ConstructorParameters<typeof HermesClient>[0];calls:{method:string;params:Record<string,unknown>}[];client:HermesSourceClient}[]=[],natives:{callbacks:RuntimeCallbacks;input:StartRun;runtime:RuntimeAdapter}[]=[];
 const accounts={get:()=>null,claimUse:vi.fn(()=>({id:'lease',nonce:'nonce'})),releaseUse:vi.fn()},catalog:RuntimeAdapter={configure(){},models:vi.fn(async()=>[]),start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:vi.fn(async()=>['old-receipt']),dispose:vi.fn(async()=>{})};
 const runtime=createHermesRuntime({dataDir,nativeCatalog:catalog,accounts,hostTools:[{name:'skills_list',description:'old',parameters:{}},{name:'host_task',description:'host',parameters:{type:'object'}}],onSourceEvent:event=>sourceEvents.push(event),...extra},{createClient(options){const entry={options,calls:[] as {method:string;params:Record<string,unknown>}[],client:{} as HermesSourceClient};entry.client={request:vi.fn(async(method,params={})=>{entry.calls.push({method,params});if(method==='hello')return{protocolVersion:1,engineClass:'run_agent.AIAgent',sourceCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7'} as any;if(method==='agent.start'||method==='agent.followUp'||method==='agent.cancel')return{accepted:true} as any;if(method==='agent.compact')return{compacted:true} as any;return{} as any;}),dispose:vi.fn(async()=>{})};sources.push(entry);return entry.client;},createNativeRuntime(value){expect(value).toMatchObject({dataDir,accounts,modelOnly:true});const entry={} as typeof natives[number];entry.runtime={configure:next=>{entry.callbacks=next;},models:async()=>[],start:vi.fn(async input=>{entry.input=input;}),followUp:async()=>{},cancel:vi.fn(async()=>{}),compact:async()=>{},history:async()=>[],dispose:vi.fn(async()=>{})};natives.push(entry);return entry.runtime;}});
 runtime.configure({onEvent:event=>events.push(event),onTool:vi.fn(async()=>({ok:true}))});
 const source=()=>sources.at(-1)!,start=()=>source().calls.filter(call=>call.method==='agent.start').at(-1)!.params;
 const event=(name:string,data:Record<string,unknown>={},phase='foreground')=>source().options.onEvent?.({event:name,ctx:{...(start().ctx as Record<string,unknown>),phase},data});
 const settle=async(data:Record<string,unknown>={})=>{event('foreground_settled',data);event('settled',data);await vi.waitFor(()=>expect(runtime.reviewBusy).toBe(false));};
 return{runtime,events,sourceEvents,sources,natives,catalog,accounts,source,start,event,settle,dataDir};
}
it('boots the shared source for library recovery, captures async settings and excludes legacy skill schemas',async()=>{
 const f=await fixture({settings:async()=>({config:{skills:{creation_nudge_interval:7}},skillPolicy:{enabled:true,allowWrites:false},systemPrompt:'captured system'})});try{
 await f.runtime.sourceRequest('skills.list');expect(f.source().calls[0]).toMatchObject({method:'hello',params:{acpCommand:process.execPath,config:{skills:{creation_nudge_interval:7}}}});
 await f.runtime.start(run());expect(f.start()).toMatchObject({prompt:encodeInput(run()),modelId:'openai/model',accountId:null,systemPrompt:'captured system',skillPolicy:{enabled:true,allowWrites:false},hostTools:[{name:'host_task'}]});expect(f.start().jobKey).toMatch(/^[A-Za-z0-9_-]{16,256}$/);expect(f.source().calls[0].params.acpArgs).not.toContain(f.start().jobKey);await f.settle();
 }finally{await f.runtime.dispose();}expect(f.catalog.dispose).toHaveBeenCalledOnce();
});
it('builds the original learn prompt while the foreground keeps its captured source owner',async()=>{
 const f=await fixture();try{await f.runtime.start(run());await expect(f.runtime.sourceRequest('learn.prompt',{request:'the current workflow'})).resolves.toEqual({});expect(f.source().calls).toContainEqual({method:'learn.prompt',params:{request:'the current workflow'}});expect(f.runtime.sourceBusy).toBe(true);await f.settle();}finally{await f.runtime.dispose();}
});
it('closes actual source and catalog owners when a graceful dispose acknowledgement fails',async()=>{
 const f=await fixture();await f.runtime.sourceRequest('skills.list');const source=f.source().client,request=source.request.bind(source);
 source.request=async<T>(method:string,params?:Record<string,unknown>)=>{if(method==='agent.dispose')throw Error('Synthetic worker already exited');return request<T>(method,params);};
 await expect(f.runtime.dispose()).resolves.toBeUndefined();expect(source.dispose).toHaveBeenCalledOnce();expect(f.catalog.dispose).toHaveBeenCalledOnce();
});
it('maps only actual native receipts and returns actual usage to the original source client',async()=>{
 const f=await fixture();try{await f.runtime.start(run());f.event('model_request',{sequence:1,inputIds:['input']});expect(f.events.some(event=>event.type==='input.processing')).toBe(false);
 const response=fetch(f.start().brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+f.start().jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'acp',modelId:'openai/model',prompt:'Original Hermes transcript <tool_call>'})});await vi.waitFor(()=>expect(f.natives).toHaveLength(1));const n=f.natives[0];await vi.waitFor(()=>expect(n.input).toBeDefined());n.callbacks.onEvent({...n.input,type:'input.processing',inputIds:[n.input.inputId]});n.callbacks.onEvent({...n.input,type:'assistant.message',content:'native text'});n.callbacks.onEvent({...n.input,type:'usage',usage:{inputTokens:11,outputTokens:3,cost:null}});n.callbacks.onEvent({...n.input,type:'agent_end'});expect(f.events.some(event=>event.type==='settled')).toBe(false);n.callbacks.onEvent({...n.input,type:'settled'});expect((await response).status).toBe(200);
 expect(f.events.find(event=>event.type==='input.processing')?.inputIds).toEqual(['input']);const actual=await f.source().options.onHostCall?.({id:'usage',name:'$transport.usage',args:{jobKey:f.start().jobKey,sequence:1},ctx:f.start().ctx as Record<string,unknown>});expect(actual).toMatchObject({inputTokens:11,outputTokens:3});
 await writeFile(f.start().sessionPath as string,JSON.stringify({format:'hermes-source-session-v1',sourceCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7',ownership:{threadId:'thread',accountId:null,sessionPath:f.start().sessionPath,sourceCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7'},messages:[]}));expect(await f.runtime.history(f.start().sessionPath as string)).toEqual(['input']);await f.settle({text:'Original Hermes final response'});
 }finally{await f.runtime.dispose();}
});
it('holds the account through the actual review barrier and settles the UI only once',async()=>{
 const f=await fixture();try{await f.runtime.start(run());f.event('foreground_settled',{text:'done'});f.event('review_started');expect(f.runtime.sourceBusy).toBe(false);expect(f.runtime.reviewBusy).toBe(true);expect(f.accounts.releaseUse).not.toHaveBeenCalled();
 let accepted=false;const next=f.runtime.start(run({runId:'second',epoch:2,inputId:'second'})).then(()=>{accepted=true;});await Promise.resolve();expect(accepted).toBe(false);f.event('review_settled');f.event('settled');await next;expect(f.accounts.releaseUse).toHaveBeenCalledOnce();expect(f.events.filter(event=>event.type==='settled'&&event.runId==='run')).toHaveLength(1);await f.settle();
 }finally{await f.runtime.dispose();}
});
it('buffers steering without claiming entry and denies changed account/model ownership',async()=>{
 const f=await fixture();try{await f.runtime.start(run());await f.runtime.followUp(run({inputId:'follow',prompt:'next'}));expect(f.events.some(event=>event.type==='input.processing')).toBe(false);await expect(f.runtime.followUp(run({inputId:'wrong',accountId:'different'}))).rejects.toMatchObject({code:'HERMES_STALE_RUN'});await expect(f.runtime.followUp(run({inputId:'wrong',modelId:'other/model'}))).rejects.toMatchObject({code:'HERMES_STALE_RUN'});await f.settle({unconsumedInputIds:['follow']});}finally{await f.runtime.dispose();}
});
it('does not release ownership on a cancellation acknowledgement before actual source settlement',async()=>{
 const f=await fixture();try{await f.runtime.start(run());let finished=false;const cancelling=f.runtime.cancel(run()).then(()=>{finished=true;});await vi.waitFor(()=>expect(f.source().calls.some(call=>call.method==='agent.cancelBackground')).toBe(true));expect(finished).toBe(false);expect(f.accounts.releaseUse).not.toHaveBeenCalled();f.event('settled',{cancelled:true});await cancelling;expect(f.accounts.releaseUse).toHaveBeenCalledOnce();}finally{await f.runtime.dispose();}
});
it('rejects compaction of a different retained task, account or model',async()=>{
 const f=await fixture();try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();for(const value of [run({threadId:'different'}),run({accountId:'different'}),run({modelId:'other/model'})])await expect(f.runtime.compact(value,path,value.modelId,value.accountId)).rejects.toMatchObject({code:'HERMES_SESSION_INVALID'});expect(f.source().calls.some(call=>call.method==='agent.compact')).toBe(false);
 await f.runtime.compact(run({runId:'compact',epoch:2}),path,'openai/model',null);expect(f.source().calls.filter(call=>call.method==='agent.compact')).toHaveLength(1);
 }finally{await f.runtime.dispose();}
});
it('requires explicit canonical transcript migration for a legacy native session',async()=>{
 const canonical=[{role:'user',content:'Earlier canonical message'}],migration=vi.fn(async()=>canonical),f=await fixture({initialHistory:migration});try{await f.runtime.start(run({sessionPath:join(f.dataDir,'legacy-native.json')}));expect(migration).toHaveBeenCalledOnce();expect(f.start().history).toEqual(canonical);expect(f.events.find(event=>event.type==='session')?.migrated).toBe(true);await f.settle();}finally{await f.runtime.dispose();}
 const rejected=await fixture();try{await expect(rejected.runtime.start(run({sessionPath:join(rejected.dataDir,'legacy-native.json')}))).rejects.toMatchObject({code:'HERMES_SESSION_INVALID'});}finally{await rejected.runtime.dispose();}
});
it('deduplicates the original interim callback when foreground completion repeats its text',async()=>{
 const f=await fixture();try{await f.runtime.start(run());f.event('assistant',{args:['The same final response']});await f.settle({text:'The same final response'});expect(f.events.filter(event=>event.type==='assistant.message')).toHaveLength(1);}finally{await f.runtime.dispose();}
});
it('keeps all durable IDs attached to one original steering ticket and expands withdrawn batches',async()=>{
 const f=await fixture();try{await f.runtime.start(run());await f.runtime.followUp(run({inputId:'batch-a',inputIds:['batch-a','batch-b'],prompt:'batched message'}));await f.runtime.followUp(run({inputId:'unused-a',inputIds:['unused-a','unused-b'],prompt:'not drained'}));f.event('model_request',{sequence:1,inputIds:['input','batch-a']});
 const response=fetch(f.start().brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+f.start().jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'acp',modelId:'openai/model',prompt:'Transcript with the drained steering batch'} )});await vi.waitFor(()=>expect(f.natives[0]?.input).toBeDefined());const n=f.natives[0];n.callbacks.onEvent({...n.input,type:'input.processing',inputIds:[n.input.inputId]});n.callbacks.onEvent({...n.input,type:'settled'});await response;
 expect(f.events.find(event=>event.type==='input.processing')?.inputIds).toEqual(['input','batch-a','batch-b']);await f.settle({unconsumedInputIds:['unused-a']});expect((f.sourceEvents.findLast(event=>event.event==='settled')?.data as any).unconsumedInputIds).toEqual(['unused-a','unused-b']);
 }finally{await f.runtime.dispose();}
});
it('keeps captured frozen settings during an active library read and restarts explicitly when idle',async()=>{
 let interval=7;const f=await fixture({settings:async input=>({config:{skills:{creation_nudge_interval:input?7:interval}}})});try{await f.runtime.start(run());interval=11;await f.runtime.sourceRequest('skills.list');expect(f.sources).toHaveLength(1);await f.settle();await f.runtime.sourceRequest('skills.list');expect(f.sources).toHaveLength(2);expect(f.sources[0].client.dispose).toHaveBeenCalledOnce();expect(f.sourceEvents.some(event=>event.event==='configuration_restarted')).toBe(true);}finally{await f.runtime.dispose();}
});
it.each(['agent.compact','skills.curate'])('owns a fresh authenticated broker for the original %s maintenance RPC',async method=>{
 const f=await fixture({config:{model:{provider:'harness',default:'openai/model'}}});try{await f.runtime.start(run());const originalJob=f.start();await f.settle();const previous=vi.mocked(f.source().client.request).getMockImplementation()!;let captured:Record<string,unknown>|undefined;
 vi.spyOn(f.source().client,'request').mockImplementation(async(name,params={})=>{if(name!==method)return previous(name,params);captured=params;f.event('model_request',{sequence:42,inputIds:[]});const response=fetch(params.brokerURL as string,{method:'POST',headers:{Authorization:'Bearer '+params.jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:'maintenance',modelId:params.modelId,prompt:'Original maintenance prompt'})});await vi.waitFor(()=>expect(f.natives[0]?.input).toBeDefined());const n=f.natives[0];n.callbacks.onEvent({...n.input,type:'input.processing',inputIds:[n.input.inputId]});n.callbacks.onEvent({...n.input,type:'assistant.message',content:'Original maintenance model text'});n.callbacks.onEvent({...n.input,type:'usage',usage:{inputTokens:31,outputTokens:4}});n.callbacks.onEvent({...n.input,type:'settled'});expect((await response).status).toBe(200);return{compacted:true,summary:'source curator result'} as any;});
 if(method==='agent.compact')await f.runtime.compact(run({runId:'maintenance',epoch:2}),originalJob.sessionPath as string,'openai/model',null);else expect(await f.runtime.sourceRequest('skills.curate',{consolidate:true})).toMatchObject({summary:'source curator result'});
 expect(captured).toMatchObject({modelId:'openai/model',accountId:null,sessionPath:originalJob.sessionPath});expect(captured?.jobKey).not.toBe(originalJob.jobKey);expect(f.events.filter(event=>event.type==='input.processing')).toHaveLength(0);expect(f.accounts.claimUse).toHaveBeenCalledTimes(2);expect(f.accounts.releaseUse).toHaveBeenCalledTimes(2);expect(f.source().options.timeoutMs).toBe(240_000);
 }finally{await f.runtime.dispose();}
});
it('keeps deterministic curation available and refuses LLM curation without a selected retained owner',async()=>{
 const f=await fixture();try{await f.runtime.sourceRequest('skills.curate',{consolidate:false});await expect(f.runtime.sourceRequest('skills.curate',{consolidate:true})).rejects.toMatchObject({code:'HERMES_CURATOR_OWNER_REQUIRED'});}finally{await f.runtime.dispose();}
});
it('waits for pending admission before disposal and never starts work after disposal',async()=>{
 let release!:()=>void;const settings=new Promise<{}>(done=>{release=()=>done({});}),f=await fixture({settings:()=>settings});const starting=f.runtime.start(run()).catch(error=>error),disposing=f.runtime.dispose();release();expect(await starting).toMatchObject({code:'HERMES_DISPOSED'});await disposing;expect(f.sources).toHaveLength(0);expect(f.accounts.claimUse).not.toHaveBeenCalled();
});
it('revokes a reserved startup while settings are pending before any source start or account claim',async()=>{
 let release!:()=>void;const settings=new Promise<{}>(done=>{release=()=>done({});}),f=await fixture({settings:()=>settings});try{const starting=f.runtime.start(run()).catch(error=>error),cancelling=f.runtime.cancel(run());release();expect(await starting).toMatchObject({code:'HERMES_RUN_ABORTED'});await cancelling;expect(f.sources.every(source=>source.calls.every(call=>call.method!=='agent.start'))).toBe(true);expect(f.accounts.claimUse).not.toHaveBeenCalled();}finally{await f.runtime.dispose();}
});
it('waits for Plan admission before a concurrent library read and retains its captured settings',async()=>{
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),f=await fixture({settings:async input=>{if(input)await gate;return{config:{skills:{creation_nudge_interval:input?0:7}}};}});try{const starting=f.runtime.start(run()),reading=f.runtime.sourceRequest('skills.list');release();await starting;await reading;expect(f.sources).toHaveLength(1);expect(f.source().calls[0]).toMatchObject({method:'hello',params:{config:{skills:{creation_nudge_interval:0}}}});expect(f.source().client.dispose).not.toHaveBeenCalled();await f.settle();}finally{await f.runtime.dispose();}
});
it('revokes a maintenance admission before it acquires a new account lease or source RPC',async()=>{
 const f=await fixture();try{await f.runtime.start(run());const path=f.start().sessionPath as string;await f.settle();const compacting=f.runtime.compact(run({runId:'compact',epoch:2}),path,'openai/model',null).catch(error=>error),cancelling=f.runtime.cancel(run({runId:'compact',epoch:2}));expect(await compacting).toMatchObject({code:'HERMES_RUN_ABORTED'});await cancelling;expect(f.source().calls.some(call=>call.method==='agent.compact')).toBe(false);expect(f.accounts.claimUse).toHaveBeenCalledOnce();}finally{await f.runtime.dispose();}
});
it('confirms actual source cleanup before an idle reconfiguration even when the graceful acknowledgement fails',async()=>{
 let interval=7;const f=await fixture({settings:()=>({config:{skills:{creation_nudge_interval:interval}}})});try{await f.runtime.sourceRequest('skills.list');const first=f.source().client,request=first.request.bind(first);first.request=async<T>(method:string,params?:Record<string,unknown>)=>{if(method==='agent.dispose')throw Error('Synthetic exited worker');return request<T>(method,params);};interval=9;await f.runtime.sourceRequest('skills.list');expect(first.dispose).toHaveBeenCalledOnce();expect(f.sources).toHaveLength(2);}finally{await f.runtime.dispose();}
});
it('attempts forced source and catalog cleanup when active graceful cancellation fails',async()=>{
 const f=await fixture();await f.runtime.start(run());const source=f.source().client,request=source.request.bind(source);source.request=async<T>(method:string,params?:Record<string,unknown>)=>{if(['agent.cancel','agent.cancelBackground','agent.dispose'].includes(method))throw Error('Synthetic exited worker');return request<T>(method,params);};await expect(f.runtime.dispose()).resolves.toBeUndefined();expect(source.dispose).toHaveBeenCalledOnce();expect(f.catalog.dispose).toHaveBeenCalledOnce();expect(f.accounts.releaseUse).toHaveBeenCalledOnce();
});
it('aggregates actual source/catalog cleanup failures and retains an unconfirmed active account lease',async()=>{
 const f=await fixture();await f.runtime.start(run());vi.mocked(f.source().client.dispose).mockRejectedValue(Error('Synthetic actual source teardown failure'));vi.mocked(f.catalog.dispose).mockRejectedValue(Error('Synthetic actual catalog teardown failure'));const failure=await f.runtime.dispose().catch(error=>error);expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors).toHaveLength(2);expect(f.source().client.dispose).toHaveBeenCalledOnce();expect(f.catalog.dispose).toHaveBeenCalledOnce();expect(f.accounts.releaseUse).not.toHaveBeenCalled();
});
it('captures current approval policy for curator maintenance after an idle settings change',async()=>{
 let approval=false;const f=await fixture({settings:async()=>({config:{model:{provider:'harness',default:'openai/model'},skills:{write_approval:approval}},skillPolicy:{enabled:true,allowWrites:true}})});try{await f.runtime.start(run());const initial=f.start();await f.settle();approval=true;await f.runtime.sourceRequest('skills.curate',{consolidate:true});expect(f.sources).toHaveLength(2);const hello=f.source().calls.find(call=>call.method==='hello')!,curate=f.source().calls.find(call=>call.method==='skills.curate')!;expect(hello.params.config).toMatchObject({skills:{write_approval:true},model:{provider:'harness',default:'openai/model'}});expect(curate.params).toMatchObject({modelId:initial.modelId,accountId:initial.accountId,sessionPath:initial.sessionPath,ctx:initial.ctx,skillPolicy:{enabled:true,allowWrites:true}});expect(f.accounts.releaseUse).toHaveBeenCalledTimes(2);await expect(f.runtime.compact(run(),initial.sessionPath as string,'openai/model',null)).rejects.toMatchObject({code:'HERMES_SESSION_INVALID'});}finally{await f.runtime.dispose();}
});
it('supports captured read-only bulk snapshots during an active Plan turn',async()=>{
 const f=await fixture({settings:input=>({config:{skills:{creation_nudge_interval:input?0:7}}})});try{await f.runtime.start(run());await f.runtime.sourceRequest('skills.snapshot');expect(f.sources).toHaveLength(1);expect(f.source().calls.some(call=>call.method==='skills.snapshot')).toBe(true);await f.settle();}finally{await f.runtime.dispose();}
});
it('cancels pending curator admission through the background cancellation boundary',async()=>{
 let block=false,release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),f=await fixture({settings:async()=>{if(block)await gate;return{config:{model:{provider:'harness',default:'openai/model'}}};}});try{await f.runtime.start(run());await f.settle();block=true;const curating=f.runtime.sourceRequest('skills.curate',{consolidate:true}).catch(error=>error),cancelling=f.runtime.cancelBackground();release();expect(await curating).toMatchObject({code:'HERMES_RUN_ABORTED'});await cancelling;expect(f.accounts.claimUse).toHaveBeenCalledOnce();expect(f.source().calls.some(call=>call.method==='skills.curate')).toBe(false);}finally{await f.runtime.dispose();}
});
it('launches the actual ACP server with an absolute loader from an isolated working directory',async()=>{
 const f=await fixture();let child:ReturnType<typeof spawn>|undefined;try{await f.runtime.sourceRequest('skills.list');const hello=f.source().calls.find(call=>call.method==='hello')!.params;expect((hello.acpArgs as string[])[1]).toMatch(/^file:/);child=spawn(hello.acpCommand as string,hello.acpArgs as string[],{cwd:f.dataDir,env:{...process.env,HARNESS_HERMES_BROKER_URL:'http://127.0.0.1:1/model',HARNESS_HERMES_JOB_KEY:'isolated-test-job-1234567890'},stdio:['pipe','pipe','pipe'],windowsHide:true});const messages:any[]=[];let output='';child.stdout!.setEncoding('utf8');child.stdout!.on('data',chunk=>{output+=chunk;let newline:number;while((newline=output.indexOf('\n'))>=0){messages.push(JSON.parse(output.slice(0,newline)));output=output.slice(newline+1);}});child.stderr!.resume();const exited=new Promise<number|null>(done=>child!.once('exit',done));child.stdin!.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:1}})+'\n');await vi.waitFor(()=>expect(messages[0]?.result?.protocolVersion).toBe(1),{timeout:10000});child.stdin!.end();expect(await exited).toBe(0);}finally{child?.kill();await f.runtime.dispose();}
});
it('preserves original skill tools and avoids the built-in session_search collision in default host metadata',async()=>{
 const f=await fixture({hostTools:undefined});try{await f.runtime.start(run());const names=(f.start().hostTools as {name:string}[]).map(tool=>tool.name);expect(names).toContain('harness_session_search');expect(names).not.toContain('session_search');expect(names).not.toContain('skills_list');expect(names).not.toContain('skill_view');expect(names).not.toContain('skill_manage');await f.settle();}finally{await f.runtime.dispose();}
});

it('runs two same-account original source parents and cancels only the matching worker',async()=>{
 const f=await fixture();try{
  const first=run(),second=run({threadId:'other-thread',runId:'other-run',inputId:'other-input'});
  await f.runtime.start(first);await f.runtime.start(second);expect(f.sources).toHaveLength(2);
  const owner=f.sources[0],params=owner.calls.find(call=>call.method==='agent.start')!.params;
  const cancelling=f.runtime.cancel(first);await vi.waitFor(()=>expect(owner.calls.some(call=>call.method==='agent.cancel')).toBe(true));
  expect(f.sources[1].calls.some(call=>call.method==='agent.cancel')).toBe(false);
  owner.options.onEvent?.({event:'settled',ctx:params.ctx as Record<string,unknown>,data:{cancelled:true}});await cancelling;
  owner.options.onEvent?.({event:'assistant',ctx:params.ctx as Record<string,unknown>,data:{args:['stale']}});
  expect(f.events.some(event=>event.content==='stale')).toBe(false);expect(f.runtime.sourceBusy).toBe(true);await f.settle();
 }finally{await f.runtime.dispose();}
});

it('admits three main engines plus independent read-only readers through the canonical library',async()=>{
 const f=await fixture({skillPolicy:{enabled:true,allowWrites:true}}),reader=f.runtime.createTaskRuntime();reader.configure({onEvent(){},onTool:async()=>({})});
 try{
  for(let i=0;i<3;i++)await f.runtime.start(run({threadId:'main-'+i,runId:'main-run-'+i,inputId:'input-'+i}));
  await expect(f.runtime.start(run({threadId:'fourth',runId:'fourth'}))).rejects.toMatchObject({code:'HERMES_SOURCE_BUSY'});
  await reader.start(run({threadId:'reader',runId:'reader-run',inputId:'reader-input'}));
  const source=f.source(),params=f.start();expect(params.skillPolicy).toMatchObject({allowWrites:false,backgroundReview:false});expect(source.calls[0].params.sharedLibrary).toBe(true);
  await source.options.onHostCall?.({id:'skill',name:'$library.tool',args:{name:'skill_view',args:{name:'source-procedure'},kw:{}},ctx:params.ctx as Record<string,unknown>});
  expect(f.sources[0].calls.find(call=>call.method==='skills.tool')?.params).toMatchObject({name:'skill_view',policy:{allowWrites:false},ctx:{threadId:'reader',runId:'reader-run'}});
 }finally{await reader.dispose();await f.runtime.dispose();}
});

it('serializes original reviews across workers and cancels a queued review admission',async()=>{
 const f=await fixture();try{
  await f.runtime.start(run());await f.runtime.start(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));
  const [first,second]=f.sources,firstCtx=first.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>,secondCtx=second.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>;
  expect(await first.options.onHostCall?.({id:'review-1',name:'$background.acquire',args:{},ctx:firstCtx})).toEqual({acquired:true});
  let granted=false;const queued=second.options.onHostCall!({id:'review-2',name:'$background.acquire',args:{},ctx:secondCtx}).then(()=>{granted=true;}).catch(error=>error);
  await Promise.resolve();expect(granted).toBe(false);const cancelling=f.runtime.cancel({threadId:'peer',runId:'peer-run',epoch:1});
  expect(await queued).toMatchObject({code:'MODEL_REQUEST_CANCELLED'});second.options.onEvent?.({event:'settled',ctx:secondCtx,data:{cancelled:true}});await cancelling;
  first.options.onEvent?.({event:'foreground_settled',ctx:firstCtx,data:{}});first.options.onEvent?.({event:'settled',ctx:firstCtx,data:{}});
 }finally{await f.runtime.dispose();}
});

it('revokes only requested integrations from each captured worker profile',async()=>{
 const f=await fixture({settings:input=>({integrations:{enabled:input?.threadId==='peer'?['graphify']:['humanizer','impeccable'],ponytailMode:'full'}})});
 try{
  await f.runtime.start(run());await f.runtime.start(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));await f.runtime.refreshIntegrations(['humanizer']);
  expect(f.sources[0].calls.findLast(call=>call.method==='integrations.refresh')?.params).toMatchObject({config:{enabled:['impeccable'],ponytailMode:'full'}});
  expect(f.sources[1].calls.findLast(call=>call.method==='integrations.refresh')?.params).toMatchObject({config:{enabled:['graphify'],ponytailMode:'full'}});
 }finally{await f.runtime.dispose();}
});

it('applies explicit integration revocation to settings captured by a pending startup',async()=>{
 let release!:()=>void;const pending=new Promise<void>(done=>{release=done;}),f=await fixture({settings:async()=>{await pending;return{integrations:{enabled:['humanizer'],ponytailMode:'full'}};}});
 try{const starting=f.runtime.start(run());await f.runtime.refreshIntegrations(['humanizer']);release();await starting;expect(f.start().integrations).toMatchObject({enabled:[]});await f.settle();}finally{release?.();await f.runtime.dispose();}
});

it('sends explicit revocations and captured revisions while agent.start is already in flight',async()=>{
 const f=await fixture({settings:input=>({integrations:{enabled:input?['humanizer']:[],ponytailMode:'full'}})});let release!:()=>void;
 try{
  await f.runtime.sourceRequest('skills.list');const source=f.source(),previous=source.client.request.bind(source.client),gate=new Promise<void>(done=>{release=done;});
  source.client.request=async<T>(method:string,params:Record<string,unknown>={})=>{const reply=await previous<T>(method,params);if(method==='agent.start')await gate;return reply;};
  const starting=f.runtime.start(run());await vi.waitFor(()=>expect(source.calls.some(call=>call.method==='agent.start')).toBe(true));await f.runtime.refreshIntegrations(['humanizer']);
  const start=source.calls.find(call=>call.method==='agent.start')!.params,refresh=source.calls.findLast(call=>call.method==='integrations.refresh')!.params;
  release();await starting;await f.settle();
  expect(start).toMatchObject({integrationRevision:0,integrations:{enabled:['humanizer']}});
  expect(refresh).toMatchObject({integrationRevision:1,disabledIds:['humanizer'],config:{enabled:[]}});
  await f.runtime.start(run({runId:'later',epoch:2,inputId:'later'}));expect(f.start()).toMatchObject({integrationRevision:1,integrations:{enabled:['humanizer']}});await f.settle();
 }finally{release?.();await f.runtime.dispose();}
});

it.each(['queue','admission'])('never dispatches a cancelled secondary library write after the canonical %s wait',async wait=>{
 let holdSettings=false,release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),f=await fixture({settings:async input=>{if(holdSettings&&input?.threadId==='thread')await gate;return{};}});
 try{
  await f.runtime.start(run());await f.runtime.start(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));
  const canonical=f.sources[0],peer=f.sources[1],ctx=peer.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>,previous=canonical.client.request.bind(canonical.client),dispatched:string[]=[];
  canonical.client.request=async<T>(method:string,params:Record<string,unknown>={})=>{if(method==='skills.tool'){dispatched.push(String(params.name));if(params.name==='skills_list')await gate;}return previous<T>(method,params);};
  let blocker:Promise<unknown>;
  if(wait==='queue'){blocker=f.runtime.sourceTool({name:'skills_list'});await vi.waitFor(()=>expect(dispatched).toEqual(['skills_list']));}
  else{canonical.options.onEvent?.({event:'settled',ctx:canonical.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>,data:{}});await vi.waitFor(()=>expect(f.runtime.sourceBusy).toBe(true));holdSettings=true;blocker=f.runtime.start(run({runId:'next',epoch:2,inputId:'next'}));}
  const writing=peer.options.onHostCall!({id:'queued-write',name:'$library.tool',args:{name:'skill_manage',args:{action:'create',name:'cancelled'}},ctx}).catch(error=>error);
  const cancelling=f.runtime.cancel(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));peer.options.onEvent?.({event:'settled',ctx,data:{cancelled:true}});await cancelling;
  expect(dispatched).not.toContain('skill_manage');release();await blocker;expect(await writing).toMatchObject({code:'HERMES_STALE_TOOL'});expect(dispatched).not.toContain('skill_manage');
 }finally{release?.();await f.runtime.dispose();}
});

it('waits for an already dispatched shared write before confirming cancellation',async()=>{
 const f=await fixture();let release!:()=>void;
 try{
  await f.runtime.start(run());await f.runtime.start(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'}));const canonical=f.sources[0],peer=f.sources[1],ctx=peer.calls.find(call=>call.method==='agent.start')!.params.ctx as Record<string,unknown>,previous=canonical.client.request.bind(canonical.client),gate=new Promise<void>(done=>{release=done;});let dispatched=false,completed=false,cancelled=false;
  canonical.client.request=async<T>(method:string,params:Record<string,unknown>={})=>{if(method==='skills.tool'&&params.name==='skill_manage'){dispatched=true;await gate;completed=true;}return previous<T>(method,params);};
  const writing=peer.options.onHostCall!({id:'active-write',name:'$library.tool',args:{name:'skill_manage',args:{action:'create',name:'owned'}},ctx}).catch(error=>error);await vi.waitFor(()=>expect(dispatched).toBe(true));
  const cancelling=f.runtime.cancel(run({threadId:'peer',runId:'peer-run',inputId:'peer-input'})).then(()=>{cancelled=true;});peer.options.onEvent?.({event:'settled',ctx,data:{cancelled:true}});
  await new Promise<void>(done=>setImmediate(done));const acknowledgedBeforeWriteCompleted=cancelled;release();await cancelling;expect(acknowledgedBeforeWriteCompleted).toBe(false);expect(completed).toBe(true);expect(await writing).toMatchObject({code:'HERMES_STALE_TOOL'});
 }finally{release?.();await f.runtime.dispose();}
});
