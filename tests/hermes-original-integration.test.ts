import {expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {createHermesRuntime} from '../packages/runtime-hermes/index.ts';
import {HermesClient,type HermesHostCall} from '../packages/runtime-hermes/client.ts';
import type {NativeCompactionReceiptV1} from '../packages/contracts/native-compaction.ts';
import {HermesSourceLibrary} from '../packages/runtime-hermes/library.ts';
import {hermesSettings} from '../packages/runtime-hermes/settings.ts';
import type {RuntimeAdapter,RuntimeCallbacks,Thread} from '../packages/contracts/index.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import type {ContextRequestObservationV1} from '../packages/contracts/request-context.ts';

// Full native host custody is exercised by Windows CI. The portable worker and
// broker/Service suites remain separate evidence, without a Linux guard fallback.
it.skipIf(process.platform!=='win32')('persists actual original-worker source generations through the real broker and Service without copying native content',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'m04-original-context-')),store=new Store(directory),prompts:string[]=[],nativeCuts:unknown[]=[];
 const native=():RuntimeAdapter=>{let callbacks!:RuntimeCallbacks;return{configure:value=>{callbacks=value;},models:async()=>[{id:'openai/source-context',provider:'openai',name:'Scripted native source context'}],start:async input=>{
  prompts.push(input.prompt);callbacks.onEvent({...input,type:'input.processing',inputIds:[input.inputId]});
  callbacks.onEvent({...input,type:'assistant.message',content:'The original source retained this completed response.'});
  callbacks.onEvent({...input,type:'usage',usage:{inputTokens:111,outputTokens:9,contextTokens:120,contextWindow:200000,cost:null}});callbacks.onEvent({...input,type:'settled'});
 },followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};};
 __setCapabilityFlagForTests('context.compilerV1',true);
 const runtime=createHermesRuntime({dataDir:directory,nativeCatalog:native(),systemPrompt:'Stable host-owned system policy.',hostTools:[],skillPolicy:{enabled:false},onSourceEvent:event=>{if(event.event==='model_request')nativeCuts.push((event.data as {nativeContextCut?:unknown})?.nativeContextCut);}},{createNativeRuntime:()=>native()});
 const service=new Service(store,runtime);
 try{
  await runtime.sourceRequest('skills.list');await service.recover();const thread=(await service.command({id:crypto.randomUUID(),type:'thread.create',payload:{}})).result as Thread;
  const send=async(id:string,content:string)=>{await service.command({id,threadId:thread.id,type:'message.send',payload:{content,modelId:'openai/source-context'}});await vi.waitFor(()=>expect(store.get<{status:string}>('outbox',id)?.status).toBe('handled'),{timeout:60000,interval:100});return structuredClone(store.get<{value:{lastRequest:ContextRequestObservationV1}}>('usage',thread.id)!.value.lastRequest);};
  const first=await send('native-context-one','PRIVATE_NATIVE_INPUT_ONE');
  expect(first).toMatchObject({sequence:1,visibility:'OPAQUE_NATIVE_CONTEXT',nativeSources:{source:'ORIGINAL_ACP_MESSAGES',generation:1,change:'RESET',reusedSources:0}});
  const second=await send('native-context-two','PRIVATE_NATIVE_INPUT_TWO');
  expect(second).toMatchObject({sequence:2,visibility:'OPAQUE_NATIVE_CONTEXT',nativeSources:{generation:1,change:'APPEND',reusedSources:first.nativeSources!.sourceCount}});
  expect(second.nativeSources!.compiledSources).toBeGreaterThan(0);expect(second.nativeSources!.compiledSources).toBeLessThan(second.nativeSources!.sourceCount);
  expect(nativeCuts).toHaveLength(2);expect(prompts[1]).toContain('PRIVATE_NATIVE_INPUT_ONE');expect(prompts[1]).toContain('PRIVATE_NATIVE_INPUT_TWO');
  expect(JSON.stringify([first,second,nativeCuts])).not.toContain('PRIVATE_NATIVE_INPUT_');
  expect(first.nativeSources!.change).toBe('RESET');expect(first.nativeSources!.compiledSources).toBe(first.nativeSources!.sourceCount);
 }finally{__setCapabilityFlagForTests('context.compilerV1',undefined);await service.dispose();store.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
},90000);

it('runs original Python and ACP through the native broker, persists a skill and finishes through the real Service',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hermes-original-host-')),store=new Store(directory),events:string[]=[],prompts:string[]=[],sourceErrors:unknown[]=[],instances:string[]=[],sequences:number[]=[];
 let completions=0,service:Service|undefined,resourceId='';
 const native=():RuntimeAdapter=>{let callbacks!:RuntimeCallbacks;return{configure:value=>{callbacks=value;},models:async()=>[{id:'openai/source-proof',provider:'openai',name:'Scripted native transport'}],start:async input=>{
  prompts.push(input.prompt);completions++;
  const document='---\nname: integrated-source\ndescription: Verify original source across the full host transport.\nmetadata:\n  retained: true\n---\n\n# Source integration\n\nVerify the real engine before claiming acceptance.\n';
  const call=(name:string,args:unknown)=>'<tool_call>'+JSON.stringify({id:'proof-'+completions,type:'function',function:{name,arguments:JSON.stringify(args)}})+'</tool_call>';
  const content=completions===1?call('skill_manage',{operations:[{action:'create',name:'integrated-source',content:document}]}):completions===2?call('tool_call',{calls:[{name:'text_import',arguments:{resourceId}}]}):completions===3?call('tool_call',{calls:[{name:'task_finish',arguments:{outcome:'The scripted source integration completed.',evidence:[]}}]}):'The original source completed the scripted transport.';
  callbacks.onEvent({...input,type:'input.processing',inputIds:input.inputIds??[input.inputId]});callbacks.onEvent({...input,type:'assistant.message',content});callbacks.onEvent({...input,type:'usage',usage:{inputTokens:100,outputTokens:20,contextTokens:120,contextWindow:200000,cost:null}});callbacks.onEvent({...input,type:'settled'});
 },followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};};
 store.internal('fixture.settings',null,()=>store.put('settings','global',null,{theme:'dark',modelId:null,preferences:{learningEnabled:false}}));
 const runtime=createHermesRuntime({dataDir:directory,nativeCatalog:native(),settings:input=>hermesSettings(store,input),onSourceEvent:event=>{events.push(event.event);const data=event.data as {error?:unknown;result?:{error?:unknown};agentInstance?:string;sequence?:number}|undefined;if(event.event==='started'&&data?.agentInstance)instances.push(data.agentInstance);if(event.event==='model_request'&&data?.sequence)sequences.push(data.sequence);if(data?.error||data?.result?.error)sourceErrors.push(data.error??data.result?.error);service?.sourceEvent(event);}},{createNativeRuntime:options=>{expect(options?.modelOnly).toBe(true);return native();}});
 const library=new HermesSourceLibrary({store,source:{request:(method,params)=>runtime.sourceRequest(method,params)}});service=new Service(store,runtime,{source:{runtime,library}});
 try{
  await service.recover();const thread=(await service.command({id:crypto.randomUUID(),type:'thread.create',payload:{}})).result as Thread;
  const sourcePath=join(directory,'granted-source.txt');await writeFile(sourcePath,'A source granted through the actual host boundary.');resourceId=((await service.command({id:crypto.randomUUID(),threadId:thread.id,type:'resource.grant',payload:{kind:'file',path:sourcePath,writable:false}})).result as {id:string}).id;
  await service.command({id:'source-input-proof',threadId:thread.id,type:'message.send',payload:{content:'Use the scripted transport to verify original source execution.',modelId:'openai/source-proof'}});
  await vi.waitFor(()=>expect(['completed','interrupted','failed']).toContain(store.get<Thread>('thread',thread.id)?.status),{timeout:60000,interval:100});
  expect(store.get<Thread>('thread',thread.id)?.status,JSON.stringify({thread:store.get<Thread>('thread',thread.id),events,completions,sourceErrors})).toBe('completed');
  await runtime.cancelBackground();await library.refresh();
  expect(events).toContain('started');expect(events).toContain('foreground_settled');expect(completions).toBe(4);expect(prompts[0]).toContain('skill_manage');expect(prompts[3]).toContain('A source granted through the actual host boundary.');
  expect(store.get<{enteredRuntime:boolean;status:string}>('outbox','source-input-proof')).toMatchObject({enteredRuntime:true,status:'handled'});
  const detail=await library.view('integrated-source',{includeInactive:true});expect(detail.content).toContain('Verify the real engine');expect(detail.document).toContain('retained: true');
  expect(detail.skill.managed).toBe(false);expect(store.snapshot().messages.filter(message=>message.content==='The original source completed the scripted transport.')).toHaveLength(1);
  await service.command({id:'source-next-turn',threadId:thread.id,type:'message.send',payload:{content:'Continue the same conversation using its existing evidence.',modelId:'openai/source-proof'}});
  await vi.waitFor(()=>expect(store.get<{status:string}>('outbox','source-next-turn')?.status,JSON.stringify({events,sourceErrors})).toBe('handled'),{timeout:60000,interval:100});await runtime.cancelBackground();
  expect(store.get<{enteredRuntime:boolean}>('outbox','source-next-turn')?.enteredRuntime).toBe(true);expect(completions).toBe(5);expect(instances).toHaveLength(2);expect(instances[1]).toBe(instances[0]);expect(sequences).toEqual([1,2,3,4,5]);expect(sourceErrors).toEqual([]);
 }finally{await service.dispose();store.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
},90000);

async function protectedOriginalCompaction(revokeDuringSummary:boolean) {
 const directory=await mkdtemp(join(tmpdir(),'m04-original-protected-')),store=new Store(directory);
 const privateCommits:HermesHostCall[]=[],providerPrompts:string[]=[],sourceEvents:string[]=[];
 let summary=false,summaryStarted=false,foregroundCalls=0,summaryCalls=0,releaseSummary!:()=>void;
 const summaryGate=new Promise<void>(resolve=>{releaseSummary=resolve;});
 const native=():RuntimeAdapter=>{let callbacks!:RuntimeCallbacks;return{
  configure:value=>{callbacks=value;},models:async()=>[{id:'openai/protected-source',provider:'openai',name:'Scripted protected compaction'}],
  start:async input=>{
   providerPrompts.push(input.prompt);
   const isSummary=summary;
   if(isSummary){summaryCalls++;summaryStarted=true;if(revokeDuringSummary)await summaryGate;}
   else foregroundCalls++;
   callbacks.onEvent({...input,type:'input.processing',inputIds:[input.inputId]});
   callbacks.onEvent({...input,type:'assistant.message',content:isSummary?'Earlier explanatory work is complete. Exact protected records retain requirements and current evidence.':
    foregroundCalls<5?'Completed explanatory investigation. '.repeat(600):'The current response remains in the recent native tail.'});
   callbacks.onEvent({...input,type:'usage',usage:{inputTokens:111,outputTokens:9,contextTokens:120,contextWindow:200000,cost:null}});
   callbacks.onEvent({...input,type:'settled',aborted:false});
  },followUp:async()=>{},cancel:async()=>{releaseSummary();},compact:async()=>{},history:async()=>[],dispose:async()=>{releaseSummary();},
 };};
 const runtime=createHermesRuntime({dataDir:directory,nativeCatalog:native(),systemPrompt:'Stable host policy. Retain the exact user requirements.',
  onSourceEvent:event=>{if(sourceEvents.length<32)sourceEvents.push(event.event);},
  hostTools:[],skillPolicy:{enabled:false},config:{compression:{enabled:true,protect_first_n:0,protect_last_n:2,abort_on_summary_failure:true},
   auxiliary:{background_review:{enabled:false}}}},{
  createNativeRuntime:options=>{expect(options.modelOnly).toBe(true);return native();},
  createClient:options=>new HermesClient({...options,onHostCall:async call=>{
   if(call.name==='$context.compaction.commit')privateCommits.push(structuredClone(call));
   if(!options.onHostCall)throw new Error('The real runtime host callback is missing.');
   return options.onHostCall(call);
  }}),
 });
 const service=new Service(store,runtime,{requestContextEnabled:true});
 const {buildServer}=await import('../apps/server/server.ts'),app=await buildServer(service,{port:4317,dev:false});
 let pending:Promise<unknown>|undefined;
 try{
  await service.recover();
  const host={host:'127.0.0.1:4317'},bootstrap=await app.inject({url:'/api/bootstrap',headers:host});
  const headers={...host,cookie:String(bootstrap.headers['set-cookie']).split(';')[0],'x-harness-csrf':bootstrap.json().csrfToken};
  const command=async(value:Record<string,unknown>)=>{
   const response=await app.inject({method:'POST',url:'/api/commands',headers,payload:value});
   expect(response.statusCode,response.body).toBe(200);return response.json();
  };
  const thread=(await command({id:crypto.randomUUID(),type:'thread.create',payload:{}})).result as Thread;
  for(let index=0;index<5;index++){
   const id='protected-source-input-'+index;
   await command({id,type:'message.send',threadId:thread.id,payload:{content:'M04_EXACT_USER_'+index+': retain the original public API and this 日本語 requirement.',modelId:'openai/protected-source'}});
   // Preserve the exact handled requirement; report source-bound state on a timeout.
   // A plain 'processing' does not reveal whether the native worker was invoked.
   await vi.waitFor(()=>expect(store.get<{status:string}>('outbox',id)?.status,JSON.stringify({
    index,threadStatus:store.get<Thread>('thread',thread.id)?.status,
    // Only disclose allowlisted failure categories and event types, not native
    // prompts, error text, history, paths, or any provider-supplied output.
    failureCode:String(store.get<Thread>('thread',thread.id)?.error??'').match(/(?:HERMES|STALE|REQUEST|ACCOUNT|RUN|CANCELLED|SOURCE|MODEL)_[A-Z0-9_]+/)?.[0]??'UNCLASSIFIED',
    sourceEvents,
    foregroundCalls,summaryCalls,summaryStarted,
   })).toBe('handled'),{timeout:60000,interval:100});
   await runtime.cancelBackground();
  }
  expect(foregroundCalls).toBe(5);
  await command({id:'protect-decision',type:'memory.save',threadId:thread.id,payload:{key:'api',content:'M04_RETAINED_DECISION: preserve the approved API.',baseRevision:0}});
  const previous=service.thread(thread.id),path=previous.sessionPath!;
  const before=await runtime.nativeHistoryDigest!({threadId:thread.id,runId:'inspect-before-compaction',epoch:previous.epoch},path,null);
  expect(before).not.toBeNull();
  const oldMessages=before!.messages as Record<string,unknown>[];
  expect(JSON.parse(await readFile(path,'utf8')).messages).toEqual(oldMessages);
  const beforeGeneration=store.get<{generation:number}>('requestContextGeneration',thread.id)!.generation;
  summary=true;__setCapabilityFlagForTests('context.lossAwareCompactionV1',true);
  const request={id:'protected-native-command',type:'run.compact',threadId:thread.id,payload:{}};
  const applying=app.inject({method:'POST',url:'/api/commands',headers,payload:request});pending=applying;
  if(revokeDuringSummary){
   await vi.waitFor(()=>expect(summaryStarted).toBe(true),{timeout:60000,interval:100});
   await command({id:'change-protected-decision',type:'memory.save',threadId:thread.id,payload:{key:'api',content:'A newer user decision must revoke the prepared compaction.',baseRevision:1}});
   releaseSummary();
  }
  const response=await applying;
  expect(summaryCalls).toBeGreaterThan(0);
  expect(privateCommits).toHaveLength(1);
  expect(privateCommits[0].args.sourceSha256).toBe(before!.sha256);
  expect(privateCommits[0].ctx).toMatchObject({threadId:thread.id,epoch:previous.epoch});
  const archive=await readFile(path+'.history-'+before!.sha256+'.json');
  expect(createHash('sha256').update(archive).digest('hex')).toBe(before!.sha256);
  expect(JSON.parse(archive.toString('utf8'))).toEqual(oldMessages);
  const current=service.thread(thread.id);
  const after=await runtime.nativeHistoryDigest!({threadId:thread.id,runId:'inspect-after-compaction',epoch:current.epoch},path,null);
  expect(after).not.toBeNull();
  expect(JSON.parse(await readFile(path,'utf8')).messages).toEqual(after!.messages);
  if(revokeDuringSummary){
   expect(response.statusCode,response.body).toBe(400);expect(response.json()).toMatchObject({error:{code:'COMPACTION_FAILED'}});
   expect(after!.messages).toEqual(oldMessages);
   expect(store.all('compactionUsage',thread.id)).toEqual([]);
   expect(store.get('requestContextGeneration',thread.id)).toEqual({generation:beforeGeneration});
  }else{
   expect(response.statusCode,response.body).toBe(200);
   const accepted=response.json().result as {runId:string;epoch:number};
   expect(accepted.epoch).toBe(previous.epoch+1);
   expect(privateCommits[0].ctx?.runId).not.toBe(accepted.runId);
   const proof=store.all<{nativeReceipt:NativeCompactionReceiptV1}>('compactionUsage',thread.id)[0].nativeReceipt;
   expect(proof).toMatchObject({status:'APPLIED',sourceSha256:before!.sha256,archiveRef:'native-archive:'+before!.sha256,archiveSha256:before!.sha256});
   expect(proof.afterBytes!).toBeLessThan(proof.beforeBytes);expect(proof.referenceCount).toBe(1);
   const publicRecord=(message:Record<string,unknown>)=>Object.fromEntries(Object.entries(message).filter(([key])=>!key.startsWith('_')));
   const lastUser=oldMessages.findLastIndex(message=>message.role==='user'),kept=oldMessages.filter((message,index)=>
    ['user','system','developer','tool'].includes(String(message.role))||Array.isArray(message.tool_calls)&&message.tool_calls.length>0||index>=lastUser).map(publicRecord);
   const actual=(after!.messages as Record<string,unknown>[]).map(publicRecord);let position=0;
   for(const expected of kept){const offset=actual.slice(position).findIndex(message=>isDeepStrictEqual(message,expected));expect(offset,'An original protected native record was lost or reordered.').toBeGreaterThanOrEqual(0);position+=offset+1;}
   expect(JSON.stringify(after!.messages)).toContain('M04_RETAINED_DECISION');
   expect(store.get('requestContextGeneration',thread.id)).toEqual({generation:beforeGeneration+1});
   const replay=await app.inject({method:'POST',url:'/api/commands',headers,payload:request});
   expect(replay.json()).toEqual(response.json());expect(privateCommits).toHaveLength(1);
   const snapshot=(await app.inject({url:'/api/snapshot',headers})).json();
   expect(snapshot.usage[thread.id].compaction.candidates).toEqual([expect.objectContaining({status:'APPLIED',verdict:'APPLIED',
    metadata:expect.objectContaining({sourceInterval:null}),measuredBeforeBytes:proof.beforeBytes,measuredAfterBytes:proof.afterBytes})]);
   expect(JSON.stringify(snapshot.usage[thread.id])).not.toContain('M04_EXACT_USER_');
  }
  expect(providerPrompts.some(prompt=>prompt.includes('M04_EXACT_USER_0'))).toBe(true);
 }finally{
  releaseSummary();__setCapabilityFlagForTests('context.lossAwareCompactionV1',undefined);
  await service.dispose();await pending?.catch(()=>{});await app.close();store.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
}

it.skipIf(process.platform!=='win32')('applies protected original Hermes compaction through authenticated Service HTTP',
 ()=>protectedOriginalCompaction(false),180000);
it.skipIf(process.platform!=='win32')('rejects original Hermes compaction when a host decision changes during its summary',
 ()=>protectedOriginalCompaction(true),180000);
