import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun,Thread} from '../packages/contracts/index.ts';
import type {SkillDetail,SkillProposal} from '../packages/contracts/skills.ts';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'hermes-service-')),store=new Store(directory);let callbacks!:RuntimeCallbacks;const starts:StartRun[]=[];
 const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[{id:'openai/source-test',provider:'openai',name:'Scripted source transport'}],start:async input=>{starts.push(input);},followUp:async input=>{starts.push(input);},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const sourceCalls=vi.fn(async(_method:string,_params?:Record<string,unknown>)=>({prompt:'ORIGINAL LEARN PROMPT'}));
 const controller={reviewBusy:false,sourceBusy:false,cancelBackground:vi.fn(async()=>{}),sourceRequest<T>(method:string,params?:Record<string,unknown>){return sourceCalls(method,params) as Promise<T>;}};
 const detail:SkillDetail={skill:{name:'source',description:'Source fixture',category:'general',revision:1,state:'active',enabled:true,protected:false,origin:'user',managed:false,author:'user',createdAt:'',updatedAt:'',lastUsedAt:null,useCount:0,patchCount:0},content:'source',files:[],versions:[],nextVersionOffset:null};
 const proposal:SkillProposal={id:'source',createdAt:'',status:'pending',actor:{kind:'user'},targets:[],operations:[]};
 const library={initialize:vi.fn(async()=>({migrated:0})),refresh:vi.fn(async()=>{}),command:vi.fn(async(command:{id:string})=>({commandId:command.id,eventSeq:store.sequence,result:{status:'applied',changes:[]}})),view:vi.fn(async()=>detail),proposal:vi.fn(async()=>proposal)};
 const service=new Service(store,runtime,{source:{runtime:controller,library}});cleanup.push(async()=>{await service.dispose();store.close();await rm(directory,{recursive:true,force:true,maxRetries:5});});
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:crypto.randomUUID(),type,payload,threadId});
 return {service,store,controller,library,starts,send,sourceCalls,get callbacks(){return callbacks;}};
}
it('initializes the canonical source library and routes explicit UI writes to it',async()=>{
 const x=await fixture();await x.service.recover();expect(x.library.initialize).toHaveBeenCalledOnce();expect(x.store.snapshot().learning?.supported).toBe(true);
 await x.send('skill.manage',{operations:[]});expect(x.library.command).toHaveBeenCalledWith(expect.objectContaining({type:'skill.manage'}));
 expect(await x.service.skillDetail('example')).toMatchObject({content:'source'});expect(await x.service.skillProposal('proposal')).toMatchObject({id:'source'});
});
it('uses the original learn prompt without injecting a second custom skill catalog',async()=>{
 const x=await fixture();await x.service.recover();const thread=(await x.send('thread.create')).result as Thread;
 await x.send('message.send',{content:'/learn verify releases',modelId:'openai/source-test'},thread.id);await vi.waitFor(()=>expect(x.starts).toHaveLength(1));
 expect(x.sourceCalls).toHaveBeenCalledWith('learn.prompt',{request:'verify releases'});expect(x.starts[0].prompt).toContain('ORIGINAL LEARN PROMPT');expect(x.starts[0].prompt).not.toContain('Current procedure catalog changed');
});
it('projects source review events after foreground UI settlement and cancels source reviews explicitly',async()=>{
 const x=await fixture();await x.service.recover();const thread=(await x.send('thread.create')).result as Thread;
 await x.send('message.send',{content:'A focused source turn',modelId:'openai/source-test'},thread.id);await vi.waitFor(()=>expect(x.starts).toHaveLength(1));const run=x.starts[0];
 x.callbacks.onEvent({...run,type:'input.processing',inputIds:run.inputIds});x.callbacks.onEvent({...run,type:'assistant.message',messageId:'source-message',content:'Source answer',inputIds:run.inputIds});x.callbacks.onEvent({...run,type:'settled'});
 x.service.sourceEvent({event:'review_started',ctx:{threadId:run.threadId,runId:run.runId,epoch:run.epoch},data:{}});expect(x.store.snapshot().learning?.status).toBe('reviewing');
 x.controller.reviewBusy=true;await x.send('learning.cancel');expect(x.controller.cancelBackground).toHaveBeenCalledOnce();
 x.service.sourceEvent({event:'library',data:{}});await vi.waitFor(()=>expect(x.library.refresh).toHaveBeenCalledOnce());
});
it('requires source foreground settlement before acknowledging a new learning policy',async()=>{
 const x=await fixture();await x.service.recover();x.controller.sourceBusy=true;
 await expect(x.send('settings.update',{preferences:{learningApproval:true}})).rejects.toMatchObject({code:'HERMES_POLICY_BUSY'});
 await expect(x.send('settings.update',{preferences:{learningEnabled:false}})).rejects.toMatchObject({code:'HERMES_POLICY_BUSY'});
 await expect(x.send('settings.update',{theme:'light'})).resolves.toMatchObject({result:{theme:'light'}});
});
it('expands a learn follow-up and delivers it without interrupting the active run',async()=>{
 const x=await fixture();await x.service.recover();const thread=(await x.send('thread.create')).result as Thread;
 await x.send('message.send',{content:'Start a source turn',modelId:'openai/source-test'},thread.id);await vi.waitFor(()=>expect(x.starts).toHaveLength(1));const runId=x.service.thread(thread.id).runId;
 await x.send('message.send',{content:'/learn the current workflow',modelId:'openai/source-test'},thread.id);await vi.waitFor(()=>expect(x.starts).toHaveLength(2));
 expect(x.starts[1].runId).toBe(runId);expect(x.starts[1].prompt).toContain('ORIGINAL LEARN PROMPT');expect(x.service.thread(thread.id).status).toBe('working');
});
