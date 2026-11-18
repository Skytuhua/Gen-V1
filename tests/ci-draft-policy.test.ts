import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const workflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');
const jobSource=workflow.split(/^jobs:\n/m)[1]??'';
const starts=[...jobSource.matchAll(/^  ([\w-]+):\n/gm)];
const jobs=starts.map((match,index)=>{
  const block=jobSource.slice(match.index,starts[index+1]?.index);
  const shards=/^        shard:\s*(\[[^\]\n]+\])/m.exec(block)?.[1];
  return {id:match[1],condition:/^    if:\s*(.+)$/m.exec(block)?.[1]??'true',shards:shards?JSON.parse(shards) as number[]:null};
});
const requiredJobs=['checks','test/1','test/2','test/3','test/4','browser','hermes','desktop','installed-memory'];
const types=/^  pull_request:\n    types:\s*\[([^\]\n]+)\]/m.exec(workflow)?.[1].split(',').map(value=>value.trim())??['opened','synchronize','reopened'];
type CiEvent={name:'pull_request'|'push'|'workflow_dispatch';action?:string;draft?:boolean;ref?:string};
function context(event:CiEvent){return {workflow:'CI',ref:event.ref??'refs/pull/42/merge',event_name:event.name,event:event.name==='pull_request'?{action:event.action,pull_request:{number:42,draft:event.draft}}:{}};}
function evaluate(expression:string,event:CiEvent):unknown {
  // The policy uses boolean/string comparisons and property access, whose
  // JavaScript and Actions semantics agree for these boolean/string fixtures.
  return runInNewContext('('+expression.replace(/^\$\{\{\s*|\s*\}\}$/g,'')+')',{github:context(event)},{timeout:100});
}
function scheduledJobs(event:CiEvent):string[]|null {
  if(event.name==='pull_request'&&!types.includes(event.action??''))return null;
  if(event.name==='push'){
    const branches=/^  push:\n    branches:\s*\[([^\]\n]+)\]/m.exec(workflow)?.[1].split(',').map(value=>value.trim())??[];
    if(!branches.includes((event.ref??'').replace(/^refs\/heads\//,'')))return null;
  }
  if(event.name==='workflow_dispatch'&&!/^  workflow_dispatch:/m.test(workflow))return null;
  return jobs.filter(job=>evaluate(job.condition,event)).flatMap(job=>job.shards?job.shards.map(shard=>job.id+'/'+shard):[job.id]);
}

it.each(['opened','synchronize','reopened'])('keeps draft %s events out of every runner job',action=>{
  expect(scheduledJobs({name:'pull_request',action,draft:true})).toEqual([]);
});
it.each(['opened','synchronize','reopened'])('runs every required job for reviewable %s events',action=>{
  expect(scheduledJobs({name:'pull_request',action,draft:false})).toEqual(requiredJobs);
});
it('starts all nine jobs when a draft becomes ready without another commit',()=>{
  expect(scheduledJobs({name:'pull_request',action:'opened',draft:true})).toEqual([]);
  expect(scheduledJobs({name:'pull_request',action:'ready_for_review',draft:false})).toEqual(requiredJobs);
});
it('cancels the same PR run when reviewable work becomes draft and admits no replacement jobs',()=>{
  const ready:CiEvent={name:'pull_request',action:'ready_for_review',draft:false};
  const draft:CiEvent={...ready,action:'converted_to_draft',draft:true};
  expect(scheduledJobs(ready)).toEqual(requiredJobs);
  expect(scheduledJobs(draft)).toEqual([]);
  const concurrency=/^concurrency:\n((?: {2}.*\n)+)/m.exec(workflow)?.[1]??'';
  const group=/^  group:\s*(.+)$/m.exec(concurrency)?.[1];
  const cancel=/^  cancel-in-progress:\s*(.+)$/m.exec(concurrency)?.[1];
  expect(group).toBeDefined();expect(cancel).toBeDefined();
  const groupFor=(event:CiEvent)=>group!.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g,(_,expression:string)=>String(evaluate(expression,event)));
  expect(groupFor(draft)).toBe(groupFor(ready));
  expect(groupFor(draft)).not.toBe(groupFor({...draft,ref:'refs/pull/43/merge'}));
  expect(evaluate(cancel!,draft)).toBe(true);
});
it.each(['main','agent/m05-v3'])('preserves every job for pushes to %s without a pull request payload',branch=>{
  expect(scheduledJobs({name:'push',ref:'refs/heads/'+branch})).toEqual(requiredJobs);
});
it('preserves every job for a manual dispatch without a pull request payload',()=>{
  expect(scheduledJobs({name:'workflow_dispatch',ref:'refs/heads/main'})).toEqual(requiredJobs);
});
