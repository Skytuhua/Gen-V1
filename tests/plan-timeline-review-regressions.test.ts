import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,realpathSync,lstatSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {PlanningCoordinator} from '../packages/core/planning.ts';
import {projectPlanTimeline} from '../packages/core/plan-timeline.ts';
import type {PlanRecord,AgentJob} from '../packages/contracts/planning.ts';
const cleanups:(()=>void)[]=[];afterEach(()=>{for(const close of cleanups.splice(0).reverse())close();});
const stamp='2026-11-06T00:00:00.000Z',ctx={threadId:'parent',runId:'current-run',epoch:2};
const step=(id:string)=>({id,title:id,status:'completed' as const,requirements:[]});
const job=(extra:Partial<AgentJob>={}):AgentJob=>({id:'host-job',commandId:'batch',taskId:'read',name:'Read source',task:'Read source',status:'failed',requirements:[],completedRequirementIds:[],reportedPercent:null,createdAt:stamp,updatedAt:stamp,...extra});
function setup(plan:PlanRecord){
 const base=realpathSync(tmpdir()),dir=mkdtempSync(join(base,'plancore-independent-')),store=new Store(dir);
 cleanups.push(()=>{store.close();if(resolve(dir)!==realpathSync(dir)||!dir.startsWith(base+sep)||lstatSync(dir).isSymbolicLink())throw Error('Unsafe probe cleanup');rmSync(dir,{recursive:true,force:true,maxRetries:3});});
 store.internal('fixture',ctx.threadId,()=>{store.put('thread',ctx.threadId,ctx.threadId,{id:ctx.threadId,status:'working',runId:ctx.runId,epoch:ctx.epoch});store.put('data','plan:parent',ctx.threadId,{id:'plan:parent',threadId:ctx.threadId,revision:1,provenance:'harness:plan',createdAt:stamp,value:plan});});
 const coordinator=new PlanningCoordinator({store,assertRun:()=>{},domainContext:()=>{throw Error('No execution in projection probe');}});return{store,coordinator};
}
it('model proposals must not attach an unassigned canonical job through a newly introduced step',()=>{
 const x=setup({version:1,title:'Task',run:{runId:ctx.runId,epoch:ctx.epoch},steps:[step('existing')],agents:[job({status:'working'})]});
 expect(()=>x.coordinator.updatePlan(ctx,{title:'Task',baseRevision:1,steps:[step('existing'),{...step('model-created'),agentIds:['host-job']}]})).toThrow(/host|assign/i);
});
it('an old source run must not override the result of a current run that has no matching jobs',()=>{
 const x=setup({version:1,title:'Task',run:{runId:ctx.runId,epoch:ctx.epoch},runState:'running',steps:[{...step('done'),state:'completed'}],agents:[]});
 const view=projectPlanTimeline(x.coordinator.inspect(ctx.threadId)!,{runId:ctx.runId,epoch:ctx.epoch,status:'working'},{threadId:ctx.threadId,runId:'prior-run',epoch:1,jobs:[job({stepId:'done'})]});
 expect(view.steps[0].status).toBe('completed');
});
it.each(['working','cancelled'] as const)('host-confirmed run failure remains failed with a %s child lane',async childStatus=>{
 const x=setup({version:1,title:'Task',run:{runId:ctx.runId,epoch:ctx.epoch},runState:'running',steps:[{...step('work'),status:'working',state:'running',agentIds:['host-job']}],agents:[job({stepId:'work',status:childStatus,parentRun:{runId:ctx.runId,epoch:ctx.epoch}})]});
 x.store.internal('run.failed',ctx.threadId,()=>x.coordinator.endRun(ctx,'failed'));
 await x.coordinator.cancel(ctx);
 expect(x.coordinator.inspect(ctx.threadId)!.value.runState).toBe('failed');
 expect(x.coordinator.timeline(ctx.threadId)!.steps[0].status).toBe('failed');
});
