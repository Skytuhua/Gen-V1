import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,realpathSync,lstatSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Store} from '../packages/storage/store';
import {Service} from '../packages/core/service';
import {AgentProjection} from '../packages/agent-projection';
import type {RuntimeCallbacks} from '../packages/contracts';

const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const clean of cleanups.splice(0).reverse())await clean();});
function setup(){
 const base=realpathSync(tmpdir()),dir=mkdtempSync(join(base,'agent-review-regression-')),store=new Store(dir);let callbacks:RuntimeCallbacks|undefined;
 const runtime={configure:(value:RuntimeCallbacks)=>{callbacks=value;},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime),ctx={threadId:'parent',runId:'owned-run',epoch:1},stamp='2026-11-06T00:00:00.000Z';
 store.internal('fixture','parent',()=>store.put('thread','parent','parent',{...ctx,id:'parent',title:'Parent',kind:'main',projectName:null,status:'working',createdAt:stamp,updatedAt:stamp,modelId:'test/model',sessionPath:null}));
 callbacks!.onEvent({...ctx,type:'activity',messageId:'activity-before',content:'Previous activity'});callbacks!.onEvent({...ctx,type:'assistant.message',messageId:'history-long',content:'a'.repeat(10000)});
 const projection=new AgentProjection(store);cleanups.push(async()=>{projection.dispose();await service.dispose();store.close();if(resolve(dir)!==realpathSync(dir)||!dir.startsWith(base+sep)||lstatSync(dir).isSymbolicLink())throw Error('Unsafe fixture cleanup');rmSync(dir,{recursive:true,force:true,maxRetries:5});});
 return{projection,service,store,ctx,callbacks:callbacks!};
}
it('observes real executor progress in both current activity and visible transcript invalidation',()=>{
 const x=setup(),first=x.projection.inventory({});expect(first.items[0].currentAction).toBe('Previous activity');
 const context=Reflect.apply(Reflect.get(x.service,'context'),x.service,['parent',undefined,undefined,x.ctx]) as {progress(message:string,progress:{completed:number;total:number}):void};
 context.progress('Current executor progress',{completed:1,total:2});
 expect(x.projection.inventory({}).items[0].currentAction).toBe('Current executor progress');const updates=x.projection.updates({after:first.sequence,scopeKey:first.scopeKey,visibleAgentIds:['thread:parent']});
 expect(updates.upserts.map(item=>item.agentId)).toContain('thread:parent');expect(updates.transcripts).toEqual(expect.arrayContaining([expect.objectContaining({agentId:'thread:parent'})]));
});
it('continues an unchanged long historical message while another message streams',()=>{
 const x=setup(),first=x.projection.history({agentId:'thread:parent'}).messages.find(message=>message.id==='history-long')!;
 x.callbacks.onEvent({...x.ctx,type:'assistant.delta',messageId:'unrelated-stream',delta:'new streamed output'});
 const second=x.projection.content({agentId:'thread:parent',cursor:first.nextContentCursor!});expect(second.content).toBe('a'.repeat(4096));expect(second.contentOffset).toBe(4096);
});
it('rejects a continuation when its exact message is replaced with different content of the same length',()=>{
 const x=setup(),first=x.projection.history({agentId:'thread:parent'}).messages.find(message=>message.id==='history-long')!;
 x.callbacks.onEvent({...x.ctx,type:'assistant.message',messageId:'history-long',content:'b'.repeat(10000)});
 expect(()=>x.projection.content({agentId:'thread:parent',cursor:first.nextContentCursor!})).toThrow(/resync/i);
});
