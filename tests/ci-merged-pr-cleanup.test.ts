import {expect,it} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {publicSourceAllowed,publicRuntimeSourceAllowed} from '../scripts/public-source.ts';

function readWorkflow(path:string){const url=new URL('../'+path,import.meta.url);return existsSync(url)?readFileSync(url,'utf8').replaceAll('\r\n','\n'):'';}
function block(workflow:string,key:string){return new RegExp('^'+key+':\\n((?:[ \\t].*\\n|\\n)*)','m').exec(workflow)?.[1]??'';}
function name(workflow:string){return /^name:\s*(.+)$/m.exec(workflow)?.[1]??'';}
const policies=[
  {path:'.github/workflows/ci-merged-pr-cleanup.yml',source:'.github/workflows/ci.yml',prefix:'CI',fallback:'ci-merged-pr-cleanup'},
  {path:'.github/workflows/m01-m03-audit-merged-pr-cleanup.yml',source:'.github/workflows/m01-m03-audit.yml',prefix:'m01-m03-audit',fallback:'m01-m03-audit-merged-pr-cleanup'}
].map(policy=>({...policy,workflow:readWorkflow(policy.path),sourceWorkflow:readWorkflow(policy.source)}));
type Event={merged?:boolean|null;number?:number;runId?:number;ref?:string};
function evaluate(expression:string,workflow:string,event:Event):unknown {
  const github={workflow:name(workflow),ref:event.ref??'refs/heads/main',run_id:String(event.runId??900),event_name:'pull_request_target',event:{action:'closed',pull_request:{number:event.number??42,merged:event.merged}}};
  // These fixtures use only the boolean/null comparisons, property access and
  // string formatting whose JavaScript and Actions semantics agree here.
  return runInNewContext('('+expression.replace(/^\$\{\{\s*|\s*\}\}$/g,'')+')',{github,format:(template:string,value:string|number)=>template.replace('{0}',String(value))},{timeout:100});
}
function groupFor(workflow:string,event:Event){
  const group=/^  group:\s*(.+)$/m.exec(block(workflow,'concurrency'))?.[1]??'';
  return group.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g,(_,expression:string)=>String(evaluate(expression,workflow,event)));
}

it.each(policies)('$path listens only for trusted PR closure events and requests no token permissions',({workflow})=>{
  expect(block(workflow,'on').trim()).toBe('pull_request_target:\n    types: [closed]');
  expect(workflow).toMatch(/^permissions: \{\}$/m);
  expect([...workflow.matchAll(/^(\w[\w-]*):/gm)].map(match=>match[1])).toEqual(['name','on','permissions','concurrency','jobs']);
});
it.each(policies)('$path targets only the merged PR source workflow group',({workflow,sourceWorkflow,prefix})=>{
  for(const number of [42,43,100001]){
    const group=groupFor(workflow,{merged:true,number});
    expect(group).toBe(prefix+'-refs/pull/'+number+'/merge');
    expect(group).toBe(groupFor(sourceWorkflow,{ref:'refs/pull/'+number+'/merge'}));
    expect(group).not.toBe(groupFor(workflow,{merged:true,number:number+1}));
  }
  expect(block(workflow,'concurrency')).toMatch(/^  cancel-in-progress: true$/m);
});
it.each(policies)('$path preserves unmerged closures and unknown merge states in separate groups',({workflow,fallback,prefix})=>{
  for(const merged of [false,null,undefined]){
    const group=groupFor(workflow,{merged,runId:900});
    expect(group).toBe(fallback+'-900');
    expect(group).not.toBe(groupFor(workflow,{merged,runId:901}));
    expect(group).not.toBe(prefix+'-refs/pull/42/merge');
  }
});
it.each(policies)('$path cannot cancel main or any other branch CI from the target event ref',({workflow,sourceWorkflow,prefix})=>{
  for(const merged of [true,false,null,undefined])for(const ref of ['refs/heads/main','refs/heads/agent/m05-v3','refs/heads/stack/base']){
    const group=groupFor(workflow,{merged,ref});
    expect(group).not.toBe(groupFor(sourceWorkflow,{ref}));
    expect(group).not.toBe(prefix+'-'+ref);
    expect(group).toBe(groupFor(workflow,{merged,ref:'refs/heads/main'}));
  }
});
it.each(policies)('$path admits no runner, action, checkout, API call or executable script',({workflow})=>{
  const jobs=block(workflow,'jobs');
  expect(jobs.trim()).toBe("cleanup:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 1\n    steps:\n      - run: ':'");
  const condition=/^    if:\s*(.+)$/m.exec(jobs)?.[1]??'true';
  for(const merged of [true,false,null,undefined])expect(evaluate(condition,workflow,{merged})).toBe(false);
  expect(workflow).not.toMatch(/\buses:|\bscript:|\bsecrets\b|\bgithub\.token\b/);
});
it('keeps cleanup workflow names distinct from required CI, the audit and the queue guard',()=>{
  const names=[...policies.flatMap(policy=>[name(policy.workflow),name(policy.sourceWorkflow)]),name(readWorkflow('.github/workflows/ci-queue-guard.yml'))];
  expect(names.every(Boolean)).toBe(true);expect(new Set(names).size).toBe(names.length);
});
it('keeps both cleanup workflows and their decision test in the source manifest only',()=>{
  for(const path of [...policies.map(policy=>policy.path),'tests/ci-merged-pr-cleanup.test.ts']){
    expect(publicSourceAllowed(path),path).toBe(true);expect(publicRuntimeSourceAllowed(path),path).toBe(false);
  }
});
