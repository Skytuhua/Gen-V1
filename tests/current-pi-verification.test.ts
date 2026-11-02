import {describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import type {RuntimeAdapter} from '../packages/contracts/index.ts';
import {parseCurrentPiArguments,CurrentPiVerificationService,SYNTHETIC_TRACE_BASE64,buildCurrentPiPrompt,assertCurrentCatalog} from '../scripts/verify-current-pi-ui.ts';
import {discoverCapabilities} from '../packages/core/discovery.ts';

const modelId='openai/gpt-6.1-sol';
const runtime:RuntimeAdapter={configure(){},async models(){return []},async start(){},async followUp(){},async cancel(){},async compact(){},async history(){return []},async dispose(){}};

describe('fresh-source primary Pi verification',()=>{
 it('requires explicit profile and model arguments and refuses inferred or unrelated options',()=>{
  const profile=process.platform==='win32'?'C:\\explicit\\runtime-profile':'/explicit/runtime-profile';
  expect(parseCurrentPiArguments(['--runtime-profile',profile,'--model-id',modelId])).toEqual({runtimeProfile:profile,modelId});
  for(const args of [[],['--runtime-profile',profile],['--model-id',modelId],['--runtime-profile','relative','--model-id',modelId],['--runtime-profile',profile,'--model-id','openai'],['--runtime-profile',profile,'--model-id',modelId,'--api-key','do-not-accept'],['--runtime-profile',profile,'--runtime-profile',profile,'--model-id',modelId]])expect(()=>parseCurrentPiArguments(args)).toThrow();
 });
 it('rejects a stale or incomplete catalog before requesting inference',async()=>{
  const current=await discoverCapabilities({});expect(()=>assertCurrentCatalog(current)).not.toThrow();
  expect(()=>assertCurrentCatalog({...current,components:current.components.filter(item=>item.name!=='TraceWaterfall')})).toThrow(/catalog/i);
 });
 it('uses an ordinary read-only request with the source attached rather than prescribing presentation',()=>{
  const prompt=buildCurrentPiPrompt('source-123');
  expect(prompt).toContain('source-123');expect(prompt).toContain('1,200');expect(prompt).toContain('read-only');
  expect(prompt).not.toMatch(/\b(?:UI|layout|component|TraceWaterfall|Comparison|table|graph)\b/i);
 });
 it('fences all grants to one exact synthetic upload in its own thread',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-current-pi-')),store=new Store(directory);
  const service=new CurrentPiVerificationService(store,runtime,modelId,()=>{});
  try{
   const create={id:'create',type:'thread.create',payload:{title:'Fixture'}};const [created,replayed]=await Promise.all([service.command(create),service.command(create)]);const threadId=(created.result as {id:string}).id;expect(replayed).toEqual(created);
   expect(await service.command(create)).toEqual(created);expect(store.all('thread')).toHaveLength(1);
   await expect(service.command({id:'grant',type:'resource.grant',threadId,payload:{path:directory,kind:'project',writable:true}})).rejects.toThrow(/grant/i);
   await expect(service.command({id:'wrong-source',type:'resource.upload',threadId,payload:{name:'checkout-trace.json',base64:Buffer.from('foreign').toString('base64')}})).rejects.toThrow(/synthetic|source/i);
   await expect(service.command({id:'wrong-thread',type:'resource.upload',threadId:'foreign',payload:{name:'checkout-trace.json',base64:SYNTHETIC_TRACE_BASE64}})).rejects.toThrow(/thread/i);
   const command={id:'source',type:'resource.upload',threadId,payload:{name:'checkout-trace.json',base64:SYNTHETIC_TRACE_BASE64}};
   const pending=service.command(command);await expect(service.command({...command,id:'concurrent-source'})).rejects.toThrow(/source|upload/i);await pending;await service.command(command);expect(store.all('resource',threadId)).toHaveLength(1);
   await expect(service.command({...command,id:'second-source'})).rejects.toThrow(/source|upload/i);
   await expect(service.command({id:'approve',type:'operation.approve',threadId,payload:{operationId:'none'}})).rejects.toThrow(/approv/i);
   await expect(service.command({id:'second-thread',type:'thread.create',payload:{}})).rejects.toThrow(/thread/i);
   await expect(service.command({id:'other-model',type:'message.send',threadId,payload:{modelId:'other/model',content:'No'}})).rejects.toThrow(/model/i);
  }finally{await service.dispose();store.close();await rm(directory,{recursive:true,force:true});}
 });
 it('observes current discovery through the real scoped Service tool path using metadata only',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-current-pi-')),store=new Store(directory),seen:unknown[]=[];
  const service=new CurrentPiVerificationService(store,runtime,modelId,value=>seen.push(value));
  try{
   const created=await service.command({id:'create',type:'thread.create',payload:{title:'Fixture'}}),thread=(created.result as {id:string;epoch:number});
   const context={threadId:thread.id,runId:'fixture-run',epoch:thread.epoch};
   store.internal('fixture.run',thread.id,()=>store.put('thread',thread.id,thread.id,{...thread,runId:context.runId,status:'working'}));
   await service.tool({name:'ui_discover',args:{}},context);
   expect(seen).toHaveLength(1);expect(seen[0]).toMatchObject({query:'',total:61,componentNames:expect.arrayContaining(['TraceWaterfall','Comparison'])});
   expect(JSON.stringify(seen)).not.toContain('dataSchemas');expect(JSON.stringify(seen)).not.toContain('props');
   await expect(service.tool({name:'task_delegate',args:{}},context)).rejects.toThrow(/primary/i);
   await expect(service.tool({name:'operation_execute',args:{operationId:'foreign'}},context)).rejects.toThrow(/primary/i);
  }finally{await service.dispose();store.close();await rm(directory,{recursive:true,force:true});}
 });
});
