import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
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
 const service=new Service(store,runtime,{source:{runtime:controller,library},approvedWriteHooks:true});cleanup.push(async()=>{await service.dispose();store.close();await rm(directory,{recursive:true,force:true,maxRetries:5});});
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:crypto.randomUUID(),type,payload,threadId});
 return {service,store,controller,library,starts,send,sourceCalls,get callbacks(){return callbacks;}};
}
it('initializes the canonical source library and routes explicit UI writes to it',async()=>{
 const x=await fixture();await x.service.recover();expect(x.library.initialize).toHaveBeenCalledOnce();expect(x.store.snapshot().learning?.supported).toBe(true);
 await x.send('skill.manage',{operations:[]});expect(x.library.command).toHaveBeenCalledWith(expect.objectContaining({type:'skill.manage'}));
 expect(await x.service.skillDetail('example')).toMatchObject({content:'source'});expect(await x.service.skillProposal('proposal')).toMatchObject({id:'source'});
});
async function preparedWrite(withProject=true){
 const x=await fixture(),project=await mkdtemp(join(tmpdir(),'approved-write-project-'));cleanup.push(()=>rm(project,{recursive:true,force:true}));
 const path=join(project,'App.tsx');await writeFile(path,'before');const thread=(await x.send('thread.create')).result as Thread;
 if(withProject)x.store.internal('fixture.project',thread.id,()=>{x.store.put('thread',thread.id,thread.id,{...thread,projectId:'project',workspaceId:'workspace'});x.store.put('workspaceProject','project',null,{id:'project',authority:{kind:'local'}});x.store.put('workspaceBinding','workspace',thread.id,{id:'workspace',threadId:thread.id,projectId:'project',path:project});});
 await x.send('message.send',{content:'Edit the granted file',modelId:'openai/source-test'},thread.id);await vi.waitFor(()=>expect(x.starts).toHaveLength(1));const run=x.starts[0];
 x.callbacks.onEvent({...run,type:'session',sessionPath:join(x.store.dataDir,'hermes','sessions','owned.json')});
 const grant=(await x.send('resource.grant',{kind:'file',path,writable:true},thread.id)).result as {id:string};
 const op=await x.service.tool({name:'file_replace_prepare',args:{resourceId:grant.id,content:'after',expectedSha256:createHash('sha256').update('before').digest('hex')}},run) as {id:string;revision:number};
 return {...x,path,thread,run,op};
}
it('carries an actual approved replacement privately to the next idle source turn, never prepare or steering',async()=>{
 const x=await preparedWrite(),{path,thread,run,op}=x;
 expect(await readFile(path,'utf8')).toBe('before');expect(x.store.all('outbox',thread.id)).toHaveLength(1);
 await x.send('operation.approve',{operationId:op.id,revision:op.revision},thread.id);await x.service.dispatchOperation(op.id);
 expect(await readFile(path,'utf8')).toBe('after');expect(x.store.get('operation',op.id)).toMatchObject({status:'succeeded',result:{bytes:5}});
 await new Promise(resolve=>setTimeout(resolve,20));expect(x.starts).toHaveLength(1);
 await x.send('message.send',{content:'Ordinary steering still works',modelId:'openai/source-test'},thread.id);await vi.waitFor(()=>expect(x.starts).toHaveLength(2));expect(x.starts[1].runId).toBe(run.runId);expect(x.starts[1].completedWrites).toBeUndefined();
 const ids=x.starts.flatMap(input=>input.inputIds??[input.inputId]);x.callbacks.onEvent({...run,type:'input.processing',inputIds:ids});x.callbacks.onEvent({...run,type:'assistant.message',content:'Ready',inputIds:ids});x.callbacks.onEvent({...run,type:'settled'});
 await vi.waitFor(()=>expect(x.starts).toHaveLength(3));expect(x.starts[2].runId).not.toBe(run.runId);expect(x.starts[2].completedWrites).toMatchObject([{operationId:op.id,revision:op.revision,path,bytes:5,sha256:createHash('sha256').update('after').digest('hex'),origin:{runId:run.runId,epoch:run.epoch},delivery:{runId:x.starts[2].runId,epoch:x.starts[2].epoch}}]);
 expect(x.starts[2].prompt).not.toContain(path);expect(op).not.toHaveProperty('writeOrigin');
 x.callbacks.onEvent({...x.starts[2],type:'write.hook',diagnostic:{operationId:op.id,revision:op.revision,inputId:'operation-result:'+op.id,status:'failed',message:'Synthetic detector failure'}});
 expect(x.store.get('operation',op.id)).toMatchObject({status:'succeeded'});expect(x.store.get('data',op.id)).toMatchObject({value:{postEditHook:{status:'failed'}}});
 // A duplicate late acknowledgement cannot overwrite a settled diagnostic.
 x.callbacks.onEvent({...x.starts[2],type:'write.hook',diagnostic:{operationId:op.id,revision:op.revision,inputId:'operation-result:'+op.id,status:'applied',message:'late'}});
 expect(x.store.get('data',op.id)).toMatchObject({value:{postEditHook:{status:'failed'}}});
});
it('bounds hook admission while preserving every successful write and ordinary receipt',async()=>{
 const x=await preparedWrite(),operations=[x.op],resourceId=x.store.get<{resourceIds:string[]}>('operation',x.op.id)!.resourceIds[0];let content='before';
 for(let index=0;index<33;index++){
  const next=index===0?'after':'after '+index;
  const op=index===0?x.op:await x.service.tool({name:'file_replace_prepare',args:{resourceId,content:next,expectedSha256:createHash('sha256').update(content).digest('hex')}},x.run) as {id:string;revision:number};
  if(index)operations.push(op);await x.send('operation.approve',{operationId:op.id,revision:op.revision},x.thread.id);await x.service.dispatchOperation(op.id);content=next;
 }
 expect(await readFile(x.path,'utf8')).toBe(content);expect(x.starts).toHaveLength(1);
 x.callbacks.onEvent({...x.run,type:'input.processing',inputIds:x.run.inputIds});x.callbacks.onEvent({...x.run,type:'assistant.message',content:'done',inputIds:x.run.inputIds});x.callbacks.onEvent({...x.run,type:'settled'});
 await vi.waitFor(()=>expect(x.starts).toHaveLength(2));expect(x.starts[1].completedWrites).toHaveLength(32);expect(x.starts[1].inputIds).toHaveLength(33);
 for(const op of operations)expect(x.store.get('operation',op.id)).toMatchObject({status:'succeeded'});
 const overflow=operations.at(-1)!;expect(x.store.get('outbox','operation-result:'+overflow.id)).toMatchObject({hookClaimed:true,hookDiagnostic:{status:'failed',message:expect.stringContaining('batch limit')}});
 expect(x.service.thread(x.thread.id).status).toBe('working');
},60000); // Thirty-three actual approved replacements exercise the admission bound.
it.each(['stop','rebind','revision','recovery'])('does not reauthorize an approved write hook after %s',async change=>{
 const x=await preparedWrite(),{thread,run,op}=x;
 await x.send('operation.approve',{operationId:op.id,revision:op.revision},thread.id);await x.service.dispatchOperation(op.id);
 if(change==='stop')await x.send('run.stop',{},thread.id);
 else if(change==='recovery')await x.service.recover();
 else x.store.internal('fixture.change',thread.id,()=>{
   if(change==='rebind')x.store.put('thread',thread.id,thread.id,{...x.service.thread(thread.id),workspaceId:'another'});
   else {const old=x.store.get<{revision:number}>('operation',op.id)!;x.store.put('operation',op.id,thread.id,{...old,revision:2});}
 });
 if(change==='stop'||change==='recovery')await x.send('run.resume',{modelId:run.modelId},thread.id);
 else {x.callbacks.onEvent({...run,type:'input.processing',inputIds:run.inputIds});x.callbacks.onEvent({...run,type:'assistant.message',content:'ready',inputIds:run.inputIds});x.callbacks.onEvent({...run,type:'settled'});}
 await vi.waitFor(()=>expect(x.starts.length).toBeGreaterThan(1));expect(x.starts.at(-1)?.completedWrites).toBeUndefined();
 expect(x.store.get('operation',op.id)).toMatchObject({status:'succeeded'});expect(x.store.get('outbox','operation-result:'+op.id)).toMatchObject({hookDiagnostic:{status:'stale'}});
});
it('never supplies completed-write custody for unapproved or failed effects',async()=>{
 const x=await preparedWrite();await expect(x.service.dispatchOperation(x.op.id)).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});expect(x.store.get('outbox','operation-result:'+x.op.id)).toBeNull();
 await writeFile(x.path,'changed by user');await x.send('operation.approve',{operationId:x.op.id,revision:x.op.revision},x.thread.id);await vi.waitFor(()=>expect(x.store.get('operation',x.op.id)).toMatchObject({status:'failed'}));
 expect(x.store.get('operation',x.op.id)).toMatchObject({status:'failed'});expect(x.store.get('outbox','operation-result:'+x.op.id)).not.toHaveProperty('completedWrite');
});
it('retains an unknown callback claim across stop/resume without replaying its write',async()=>{
 const x=await preparedWrite(),{thread,run,op}=x;await x.send('operation.approve',{operationId:op.id,revision:op.revision},thread.id);await x.service.dispatchOperation(op.id);
 x.callbacks.onEvent({...run,type:'input.processing',inputIds:run.inputIds});x.callbacks.onEvent({...run,type:'assistant.message',content:'done',inputIds:run.inputIds});x.callbacks.onEvent({...run,type:'settled'});await vi.waitFor(()=>expect(x.starts).toHaveLength(2));
 expect(x.store.get('outbox','operation-result:'+op.id)).toMatchObject({hookClaimed:true,hookDiagnostic:{status:'unknown'}});
 await x.send('run.stop',{},thread.id);await x.send('run.resume',{modelId:run.modelId},thread.id);await vi.waitFor(()=>expect(x.starts).toHaveLength(3));expect(x.starts[2].completedWrites).toBeUndefined();
 expect(await readFile(x.path,'utf8')).toBe('after');expect(x.store.get('operation',op.id)).toMatchObject({status:'succeeded'});
});
it.each(['legacy','no_project'])('does not infer missing %s write authority from current selection',async kind=>{
 const x=await preparedWrite(kind!=='no_project');
 if(kind==='legacy')x.store.internal('fixture.old_operation',x.thread.id,()=>x.store.put('operationWriteOrigin',x.op.id,x.thread.id,null));
 await x.send('operation.approve',{operationId:x.op.id,revision:x.op.revision},x.thread.id);await x.service.dispatchOperation(x.op.id);
 expect(x.store.get('operation',x.op.id)).toMatchObject({status:'succeeded'});expect(x.store.get('data',x.op.id)).toMatchObject({value:{postEditHook:{status:kind==='legacy'?'scope_unavailable':'no_project'}}});
 expect(x.starts.every(input=>!input.completedWrites)).toBe(true);
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
