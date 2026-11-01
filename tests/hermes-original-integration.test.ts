import {expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {createHermesRuntime} from '../packages/runtime-hermes/index.ts';
import {HermesSourceLibrary} from '../packages/runtime-hermes/library.ts';
import {hermesSettings} from '../packages/runtime-hermes/settings.ts';
import type {RuntimeAdapter,RuntimeCallbacks,Thread} from '../packages/contracts/index.ts';

it('runs original Python and ACP through the native broker, persists a skill and finishes through the real Service',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hermes-original-host-')),store=new Store(directory),events:string[]=[],prompts:string[]=[],sourceErrors:unknown[]=[];
 let completions=0,service:Service|undefined,resourceId='';
 const native=():RuntimeAdapter=>{let callbacks!:RuntimeCallbacks;return{configure:value=>{callbacks=value;},models:async()=>[{id:'openai/source-proof',provider:'openai',name:'Scripted native transport'}],start:async input=>{
  prompts.push(input.prompt);completions++;
  const document='---\nname: integrated-source\ndescription: Verify original source across the full host transport.\nmetadata:\n  retained: true\n---\n\n# Source integration\n\nVerify the real engine before claiming acceptance.\n';
  const call=(name:string,args:unknown)=>'<tool_call>'+JSON.stringify({id:'proof-'+completions,type:'function',function:{name,arguments:JSON.stringify(args)}})+'</tool_call>';
  const content=completions===1?call('skill_manage',{operations:[{action:'create',name:'integrated-source',content:document}]}):completions===2?call('tool_call',{calls:[{name:'text_import',arguments:{resourceId}}]}):completions===3?call('tool_call',{calls:[{name:'task_finish',arguments:{outcome:'The scripted source integration completed.',evidence:[]}}]}):'The original source completed the scripted transport.';
  callbacks.onEvent({...input,type:'input.processing',inputIds:input.inputIds??[input.inputId]});callbacks.onEvent({...input,type:'assistant.message',content});callbacks.onEvent({...input,type:'usage',usage:{inputTokens:100,outputTokens:20,contextTokens:120,contextWindow:200000,cost:null}});callbacks.onEvent({...input,type:'settled'});
 },followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};};
 store.internal('fixture.settings',null,()=>store.put('settings','global',null,{theme:'dark',modelId:null,preferences:{learningEnabled:false}}));
 const runtime=createHermesRuntime({dataDir:directory,nativeCatalog:native(),settings:input=>hermesSettings(store,input),onSourceEvent:event=>{events.push(event.event);const data=event.data as {error?:unknown;result?:{error?:unknown}}|undefined;if(data?.error||data?.result?.error)sourceErrors.push(data.error??data.result?.error);service?.sourceEvent(event);}},{createNativeRuntime:options=>{expect(options?.modelOnly).toBe(true);return native();}});
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
 }finally{await service.dispose();store.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
},90000);
