import {expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHermesRuntime} from '../packages/runtime-hermes/index.ts';
import type {RuntimeAdapter,RuntimeCallbacks,RuntimeEvent,StartRun} from '../packages/contracts/index.ts';

it('runs two real original engines against one canonical library with isolated sessions and bounded scripted native calls',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hermes-multi-source-')),events:RuntimeEvent[]=[],errors:unknown[]=[],calls=new Map<string,number>(),firstCalls:(()=>void)[]=[];
 let active=0,peak=0;
 const native=():RuntimeAdapter=>{let callbacks!:RuntimeCallbacks;return{configure(value){callbacks=value;},models:async()=>[],start:async input=>{
  const name=input.prompt.includes('PARENT_A')?'a':'b',turn=(calls.get(name)??0)+1;calls.set(name,turn);active++;peak=Math.max(peak,active);
  const finish=()=>{const document=`---\nname: shared-${name}\ndescription: Verify concurrent original source sessions.\n---\n\nCanonical procedure ${name}.\n`;
   const content=turn===1?'<tool_call>'+JSON.stringify({id:'create-'+name,type:'function',function:{name:'skill_manage',arguments:JSON.stringify({operations:[{action:'create',name:'shared-'+name,content:document}]})}})+'</tool_call>':'Finished '+name;
   callbacks.onEvent({...input,type:'input.processing',inputIds:[input.inputId]});callbacks.onEvent({...input,type:'assistant.message',content});callbacks.onEvent({...input,type:'settled'});active--;
  };
  if(turn===1){firstCalls.push(finish);if(firstCalls.length===2)for(const complete of firstCalls.splice(0))complete();}else finish();
 },followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};};
 const runtime=createHermesRuntime({dataDir:directory,nativeCatalog:native(),config:{auxiliary:{background_review:{enabled:false}}},skillPolicy:{enabled:true,allowWrites:true},hostTools:[],onSourceEvent:event=>{const data=event.data as {error?:unknown}|undefined;if(data?.error)errors.push(data.error);}},{createNativeRuntime:native});
 runtime.configure({onEvent:event=>events.push(event),onTool:async()=>{throw Error('No host tools were granted');}});
 const run=(name:string):StartRun=>({threadId:'source-'+name,runId:'run-'+name,epoch:1,inputId:'input-'+name,modelId:'openai/scripted',accountId:null,sessionPath:null,resources:[],prompt:'PARENT_'+name.toUpperCase()+': Create your assigned shared procedure.'});
 try{
  await Promise.all([runtime.start(run('a')),runtime.start(run('b'))]);
  await vi.waitFor(()=>expect(events.filter(event=>event.type==='settled'),JSON.stringify({errors,calls:[...calls],events:events.map(event=>({type:event.type,threadId:event.threadId,message:event.message}))})).toHaveLength(2),{timeout:60000,interval:100});
  await vi.waitFor(()=>expect(runtime.reviewBusy).toBe(false),{timeout:10000});expect(errors).toEqual([]);expect(peak).toBe(2);expect([...calls.values()]).toEqual([2,2]);
  const snapshot=await runtime.sourceRequest<{skills:{name:string}[]}>('skills.list');expect(snapshot.skills.map(skill=>skill.name).sort()).toEqual(['shared-a','shared-b']);
  const sessions=events.filter(event=>event.type==='session').map(event=>event.sessionPath);expect(new Set(sessions).size).toBe(2);
  for(const name of ['a','b'])expect(events).toContainEqual(expect.objectContaining({threadId:'source-'+name,type:'assistant.message',content:'Finished '+name}));
 }finally{await runtime.dispose();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
},90000);
