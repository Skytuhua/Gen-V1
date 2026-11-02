import {afterEach,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store';
import {Service} from '../packages/core/service';
import type {Thread,RuntimeAdapter,StartRun,InputRequest,RuntimeCallbacks} from '../packages/contracts';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
async function setup(){const dir=mkdtempSync(join(tmpdir(),'plan-host-')),store=new Store(join(dir,'data'));let run:StartRun,events:RuntimeCallbacks;
 const runtime:RuntimeAdapter={configure:value=>{events=value;},models:async()=>[{id:'test/model',provider:'test',name:'Test'}],start:async input=>{run=input;},followUp:async input=>{run=input;},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime);cleanups.push(async()=>{await service.dispose();store.close();rmSync(dir,{recursive:true,force:true});});
 const send=(type:string,payload:Record<string,unknown>,threadId?:string,id:string=crypto.randomUUID())=>service.command({id,type,payload,threadId});const thread=(await send('thread.create',{})).result as Thread;
 await send('message.send',{content:'Help decide the next step',modelId:'test/model'},thread.id);
 return {store,service,send,id:thread.id,events:()=>events,ctx:()=>({threadId:thread.id,runId:run.runId,epoch:run.epoch})};}
const args={title:'Choose the next step',prompt:'Which direction fits?',responseSchema:{type:'string'},presentation:{options:[{id:'repair',label:'Repair',description:'Fix the current failure'},{id:'investigate',label:'Investigate'}],allowCustom:true}};
it('makes an unanswered explanation retryable after settlement and Stop while preserving the pending decision',async()=>{
 const x=await setup(),created=await x.service.tool({name:'ui_request_input',args},x.ctx()) as {requestId:string};
 await x.send('request.detail',{requestId:created.requestId,revision:1,kind:'explain',optionId:'repair'},x.id,'detail-1');
 const ctx=x.ctx(),inputIds=x.store.all<{id:string}>('outbox',x.id).map(item=>item.id);
 x.events().onEvent({...ctx,type:'input.processing',inputIds});x.events().onEvent({...ctx,type:'assistant.message',messageId:'response',content:'Some details in the conversation',inputIds});x.events().onEvent({...ctx,type:'settled',aborted:false});
 expect(x.store.get<InputRequest>('request',created.requestId)).toMatchObject({status:'pending',revision:2,detailRequests:[{status:'failed',error:expect.any(String)}]});
 await x.send('request.detail',{requestId:created.requestId,revision:2,kind:'explain',optionId:'repair'},x.id,'detail-2');
 await x.send('run.stop',{},x.id);expect(x.store.get<InputRequest>('request',created.requestId)?.detailRequests?.at(-1)?.status).toBe('failed');
 await expect(x.send('request.detail',{requestId:created.requestId,revision:3,kind:'explain',optionId:'repair'},x.id,'detail-3')).rejects.toMatchObject({code:'RESUME_REQUIRED'});
});
it('persists explanation requests once, continues Pi without consuming the pending decision, and updates the same question',async()=>{
 const x=await setup();const created=await x.service.tool({name:'ui_request_input',args},x.ctx()) as {requestId:string};
 const detail={requestId:created.requestId,revision:1,kind:'explain',optionId:'repair'};
 const first=await x.send('request.detail',detail,x.id,'explain-retry');expect(await x.send('request.detail',detail,x.id,'explain-retry')).toEqual(first);
 const pending=x.store.get<InputRequest>('request',created.requestId)!;expect(pending).toMatchObject({status:'pending',detailRequests:[{optionId:'repair',kind:'explain',status:'pending'}]});
 await x.service.tool({name:'ui_request_input',args:{...args,requestId:created.requestId,baseRevision:1,presentation:{...args.presentation,options:[{...args.presentation.options[0],explanation:'Repair preserves the existing API.'},args.presentation.options[1]]}}},x.ctx());
 expect(x.store.all('request',x.id)).toHaveLength(1);expect(x.store.get('request',created.requestId)).toMatchObject({revision:2,status:'pending',detailRequests:[{status:'resolved'}]});
});
it('rejects foreign option images and stale explanation clicks without consuming a decision',async()=>{
 const x=await setup();await expect(x.service.tool({name:'ui_request_input',args:{...args,presentation:{options:[{id:'x',label:'Example',examples:[{resourceId:'foreign',alt:'Example'}]}]}}},x.ctx())).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 const request=await x.service.tool({name:'ui_request_input',args},x.ctx()) as {requestId:string};
 await expect(x.send('request.detail',{requestId:request.requestId,revision:99,kind:'explain',optionId:'repair'},x.id)).rejects.toMatchObject({code:'STALE_REQUEST'});
});
it('keeps plan mode read-only through actual operation admission, not only instructions',async()=>{
 const x=await setup();await x.send('run.stop',{},x.id);await x.send('thread.mode',{mode:'plan'},x.id);
 await x.send('run.resume',{},x.id);expect(x.store.get<Thread>('thread',x.id)).toMatchObject({mode:'plan'});
 const context=(x.service as unknown as {context:(id:string)=>{prepareOperation:(...args:unknown[])=>unknown}}).context(x.id);
 expect(()=>context.prepareOperation('file.replace',{},[],{},'Replace a file')).toThrow(/plan mode/i);
});
