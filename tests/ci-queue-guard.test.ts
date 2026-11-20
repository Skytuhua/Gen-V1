import {expect,it} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const path=new URL('../.github/workflows/ci-queue-guard.yml',import.meta.url);
const workflow=existsSync(path)?readFileSync(path,'utf8').replaceAll('\r\n','\n'):'';
const script=(workflow.split('          script: |\n')[1]??'').split('\n').map(line=>line.replace(/^ {12}/,'')).join('\n');
const admission=/^    if: >-\n((?: {6}.+\n)+)/m.exec(workflow)?.[1]??'false';
const oldSha='a'.repeat(40),newSha='b'.repeat(40);
const makeRun=()=>({id:501,name:'CI',path:'.github/workflows/ci.yml',event:'pull_request',status:'queued',head_sha:oldSha,head_branch:'stack/feature',repository:{id:71},head_repository:{id:72},pull_requests:[{number:42,base:{repo:{id:71}},head:{repo:{id:72},ref:'stack/feature',sha:oldSha}}]});
const makePull=()=>({number:42,state:'open',draft:true as boolean|undefined,base:{ref:'stack/base',repo:{id:71}},head:{repo:{id:72},ref:'stack/feature',sha:oldSha}});
type Run=ReturnType<typeof makeRun>;
type Pull=ReturnType<typeof makePull>;
type Options={run?:Run;pull?:Pull;pulls?:Pull[];source?:Partial<Run>|null;readRun?:(index:number,run:Run)=>Run;readPull?:(index:number,pull:Pull)=>Pull;cancelStatus?:number;eventName?:string;action?:string;ref?:string;queued?:Run[];running?:Run[]};
function makeContext(options:Options={}){return {repo:{owner:'owner',repo:'repo'},runId:900,eventName:options.eventName??'workflow_run',ref:options.ref??'refs/heads/main',payload:{action:options.action??'requested',repository:{id:71,default_branch:'main'},workflow_run:options.source===null?undefined:{...makeRun(),...options.source}}};}
function admitted(options:Options={}){
  const context=makeContext(options),github={event_name:context.eventName,run_id:String(context.runId),ref:context.ref,event:{...context.payload,workflow_run:context.payload.workflow_run??{}}};
  // Boolean/string/numeric comparisons agree with Actions for these fixtures.
  return runInNewContext('('+admission+')',{github,format:(template:string,value:string)=>template.replace('{0}',value)},{timeout:100});
}
async function execute(options:Options={}){
  const requests:{method:string;id?:number;status?:string;page?:number;per_page?:number}[]=[],cancelled:number[]=[],logs:string[]=[];
  let runReads=0,pullReads=0;
  const check=(args:{owner:string;repo:string})=>{expect(args.owner).toBe('owner');expect(args.repo).toBe('repo');};
  const github={rest:{actions:{
    listWorkflowRuns:async(args:{owner:string;repo:string;workflow_id:string;event:string;status:string;page:number;per_page:number})=>{
      check(args);expect(args.workflow_id).toBe('ci.yml');expect(args.event).toBe('pull_request');
      requests.push({method:'list',status:args.status,page:args.page,per_page:args.per_page});
      const runs=args.status==='queued'?(options.queued??[options.run??makeRun()]):(options.running??[]);
      return {data:{total_count:runs.length,workflow_runs:runs.slice(0,args.per_page)}};
    },
    getWorkflowRun:async(args:{owner:string;repo:string;run_id:number})=>{
      check(args);requests.push({method:'run',id:args.run_id});
      const source=options.source?.id===args.run_id?options.source:undefined;
      const run=structuredClone([...(options.queued??[]),...(options.running??[])].find(run=>run.id===args.run_id)??{...makeRun(),...options.run,...source,id:args.run_id});
      return {data:options.readRun?.(++runReads,run)??run};
    },
    cancelWorkflowRun:async(args:{owner:string;repo:string;run_id:number})=>{
      check(args);requests.push({method:'cancel',id:args.run_id});
      if(options.cancelStatus&&options.cancelStatus!==202)throw Object.assign(Error('cancel failed'),{status:options.cancelStatus});
      cancelled.push(args.run_id);return {status:202};
    }
  },pulls:{get:async(args:{owner:string;repo:string;pull_number:number})=>{
    check(args);requests.push({method:'pull',id:args.pull_number});
    const pull=structuredClone(options.pulls?.find(pull=>pull.number===args.pull_number)??options.pull??makePull());
    return {data:options.readPull?.(++pullReads,pull)??pull};
  }}}};
  const context=makeContext(options);
  const result=await runInNewContext('(async()=>{'+script+'\n})()',{github,context,core:{info:(value:string)=>logs.push(value)}},{timeout:1000});
  return {result,requests,cancelled,logs};
}

it.each(['draft','closed','superseded'])('cancels a proven %s PR run from a stacked base',async reason=>{
  const pull=makePull();if(reason==='closed'){pull.state='closed';pull.draft=false;}if(reason==='superseded'){pull.draft=false;pull.head.sha=newSha;}
  const result=await execute({pull});expect(result.cancelled).toEqual([501]);expect(result.result.cancellationRequested).toBe(1);
  expect(result.requests.map(request=>request.method)).toEqual(['list','list','run','pull','run','pull','cancel']);
});
it('coalesces all guard events into one constant group without interrupting the active sweep',()=>{
  expect(workflow).not.toMatch(/^concurrency:/m);
  expect(workflow.split('\n    concurrency:\n')[1]?.split('\n    runs-on:')[0].trim()).toBe('group: ci-queue-guard\n      cancel-in-progress: false');
});
it('rejects non-PR and wrong-path notifications before shared job group admission',()=>{
  for(const source of [{event:'push'},{event:'workflow_dispatch'},{path:'.github/workflows/other.yml'},{name:'CI queue guard'},{repository:{id:99}},{id:0},{id:900},null])expect(admitted({source})).toBe(false);
  for(const options of [{action:'completed'},{eventName:'workflow_dispatch'},{eventName:'push',ref:'refs/heads/feature'}])expect(admitted(options)).toBe(false);
});
it('admits requested, in-progress, completed-source notifications and the main bootstrap',()=>{
  for(const options of [{},{action:'in_progress'},{source:{status:'completed'}},{eventName:'push'}])expect(admitted(options)).toBe(true);
});
it('handles in-progress reruns without trusting the event run metadata',async()=>{
  const run=makeRun();run.status='in_progress';expect((await execute({run,action:'in_progress',source:{head_sha:newSha,pull_requests:[]}})).cancelled).toEqual([501]);
});
it.each(['requested','in_progress'])('uses a ready source %s event to clean another queued draft while preserving ready work',async action=>{
  const draft=makeRun(),ready=makeRun();ready.id=502;ready.pull_requests[0].number=43;
  const readyPull=makePull();readyPull.number=43;readyPull.draft=false;
  const result=await execute({action,source:ready,queued:[ready,draft],pulls:[readyPull,makePull()]});
  expect(result.cancelled).toEqual([501]);expect(result.result.checked).toBe(2);expect(result.result.preserved).toBe(1);
});
it('sweeps queued work even when the valid source event has already completed',async()=>{
  const source=makeRun();source.id=502;source.status='completed';source.pull_requests=[];
  const result=await execute({source,queued:[makeRun()]});expect(result.cancelled).toEqual([501]);
  expect(result.requests.filter(request=>request.method==='run').map(request=>request.id)).toEqual([501,501]);
});
it('preserves a current ready PR and its complete check matrix',async()=>{
  const pull=makePull();pull.draft=false;const result=await execute({pull});expect(result.cancelled).toEqual([]);expect(result.result.preserved).toBe(1);
});
const preservedRuns:[string,(run:Run)=>void][]=[
  ['push',run=>{run.event='push';}],['manual',run=>{run.event='workflow_dispatch';}],
  ['other workflow',run=>{run.name='M15 evidence';}],['other path',run=>{run.path='.github/workflows/m15-evidence.yml';}],
  ['foreign repository',run=>{run.repository.id=99;}],['guard itself',run=>{run.id=900;}],
  ['completed',run=>{run.status='completed';}],['unassociated',run=>{run.pull_requests=[];}],
  ['ambiguous',run=>{run.pull_requests.push(structuredClone(run.pull_requests[0]));}],
  ['foreign associated base',run=>{run.pull_requests[0].base.repo.id=99;}],
  ['unproven associated head',run=>{run.pull_requests[0].head.repo.id=99;}],
  ['different associated branch',run=>{run.pull_requests[0].head.ref='other';}]
];
it.each(preservedRuns)('preserves %s runs without requesting cancellation',async(_name,change)=>{
  const run=makeRun();change(run);const result=await execute({run});expect(result.cancelled).toEqual([]);expect(result.requests.some(request=>request.method==='pull')).toBe(false);
});
it('preserves ready work when the run SHA is not proven to be the recorded PR head',async()=>{
  const run=makeRun();run.pull_requests[0].head.sha=newSha;const pull=makePull();pull.draft=false;pull.head.sha=newSha;
  expect((await execute({run,pull})).cancelled).toEqual([]);
});
it('preserves a PR whose fetched identity does not match the run association',async()=>{
  const pull=makePull();pull.head.repo.id=99;expect((await execute({pull})).cancelled).toEqual([]);
});
it('preserves an unknown draft state instead of treating it as reviewable superseded work',async()=>{
  const pull=makePull();pull.draft=undefined;pull.head.sha=newSha;expect((await execute({pull})).cancelled).toEqual([]);
});
it.each(['draft','closed','superseded'])('preserves %s work that becomes current and ready during the final PR read',async reason=>{
  const pull=makePull();if(reason==='closed'){pull.state='closed';pull.draft=false;}if(reason==='superseded'){pull.draft=false;pull.head.sha=newSha;}
  const result=await execute({pull,readPull:(index,pr)=>index===1?pr:{...pr,state:'open',draft:false,head:{...pr.head,sha:oldSha}}});
  expect(result.cancelled).toEqual([]);expect(result.result.raced).toBe(1);
});
it('preserves a run that completes during the fresh check',async()=>{
  const result=await execute({readRun:(index,run)=>({...run,status:index===1?'queued':'completed'})});expect(result.cancelled).toEqual([]);expect(result.result.raced).toBe(1);
});
it.each([404,409])('tolerates cancellation race HTTP %s without force cancellation',async cancelStatus=>{
  const result=await execute({cancelStatus});expect(result.cancelled).toEqual([]);expect(result.result.raced).toBe(1);expect(result.result.cancellationRequested).toBe(0);
});
it('preserves a run whose association disappears or changes during the fresh check',async()=>{
  for(const readRun of [(index:number,run:Run)=>{if(index===2)throw Object.assign(Error('gone'),{status:404});return run;},(index:number,run:Run)=>{if(index===2)run.pull_requests[0].number=43;return run;}]){
    const result=await execute({readRun});expect(result.cancelled).toEqual([]);expect(result.result.raced).toBe(1);
  }
});
it('exposes a permission failure instead of claiming the queue was cleared',async()=>{
  await expect(execute({cancelStatus:403})).rejects.toMatchObject({status:403});
});
it.each(['push','requested','in_progress'])('bounds the %s sweep to two discovery pages and 100 distinct candidates',async event=>{
  const queued=Array.from({length:101},(_,index)=>({...makeRun(),id:501+index}));
  const running=[queued[0],{...makeRun(),id:1000,status:'in_progress'}];
  const result=await execute({...(event==='push'?{eventName:event}:{action:event}),queued,running});
  expect(result.requests.slice(0,2)).toEqual([{method:'list',status:'queued',page:1,per_page:100},{method:'list',status:'in_progress',page:1,per_page:100}]);
  expect(result.requests.filter(request=>request.method==='list')).toHaveLength(2);
  expect(result.cancelled).toContain(1000);
  expect(result.cancelled).toHaveLength(100);expect(new Set(result.cancelled).size).toBe(100);expect(result.result.checked).toBe(100);expect(result.result.limited).toBe(true);
});
it('does not sweep on pushes outside the default branch or unsupported events',async()=>{
  for(const options of [{eventName:'push',ref:'refs/heads/feature'},{eventName:'workflow_dispatch'},{action:'completed'}])expect((await execute(options)).requests).toEqual([]);
});
it.each([null,{id:0},{id:1.5},{id:900},{event:'push'},{event:'workflow_dispatch'},{name:'CI queue guard'},{path:'.github/workflows/other.yml'},{repository:{id:99}}])('rejects an invalid source event before scanning: %j',async source=>{
  expect((await execute({source})).requests).toEqual([]);
});
