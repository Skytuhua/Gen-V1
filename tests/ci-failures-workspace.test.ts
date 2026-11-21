import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GitHubTools} from '../packages/workspace/github.ts';
import type {ProjectTools} from '../packages/workspace/tools.ts';
import type {TerminalHost} from '../packages/workspace/terminal.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();__setCapabilityFlagForTests('workspace.ciFixV1',undefined);for(const close of cleanup.splice(0).reverse())await close();});

const TOKEN='fixture-token-value';
const checkRun=(name:string,job:number,repo='example/fixture')=>({__typename:'CheckRun',name,status:'COMPLETED',conclusion:'FAILURE',detailsUrl:`https://github.com/${repo}/actions/runs/55/job/${job}`});
const log=(error='Process completed with exit code 1.')=>`2026-11-21T00:00:00.0000000Z ##[group]Run pnpm test\n2026-11-21T00:00:01.0000000Z ##[error]${error}\n2026-11-21T00:00:02.0000000Z ##[endgroup]\n`;

interface Harness{
 github:GitHubTools;run:ReturnType<typeof vi.fn>;runText:ReturnType<typeof vi.fn>;rollup:(rows:unknown[])=>void;root:string;
}
async function harness():Promise<Harness>{
 const root=await mkdtemp(join(tmpdir(),'gen-gh-ci-'));cleanup.push(()=>rm(root,{recursive:true,force:true,maxRetries:5}));
 let rollup:unknown[]=[];
 const projects={store:{dataDir:root},binding:async()=>({path:root}),git:vi.fn(async()=>'https://github.com/example/fixture.git'),gitStatus:vi.fn(async()=>({head:'a'.repeat(40),branch:'gen/work',revision:'c'.repeat(64),files:[],gitWrite:true}))} as unknown as ProjectTools;
 const github=new GitHubTools(projects,{} as TerminalHost);
 vi.spyOn(github.auth,'token').mockResolvedValue(TOKEN);
 const run=vi.fn(async(_path:string,args:string[])=>{
  if(args[0]==='pr'&&args[1]==='view')return JSON.stringify({number:12,title:'Change',url:'https://github.com/example/fixture/pull/12',state:'OPEN',headRefOid:'a'.repeat(40),headRefName:'gen/work',isDraft:false,statusCheckRollup:rollup});
  if(args[0]==='api'){
   const match=/actions\/jobs\/(\d+)$/.exec(args[1]??'');
   if(match)return JSON.stringify({name:`Job ${match[1]}`,workflow_name:'CI',steps:[{name:'Set up',conclusion:'success'},{name:'Run tests',conclusion:'failure'}]});
  }
  throw Error(`Unexpected run: ${args.join(' ')}`);
 });
 const runText=vi.fn(async(_path:string,args:string[])=>{
  const match=/actions\/jobs\/(\d+)\/logs$/.exec(args[1]??'');
  if(!match)throw Error(`Unexpected runText: ${args.join(' ')}`);
  return{stdout:log()};
 });
 (github as unknown as {run:typeof run;runText:typeof runText}).run=run;
 (github as unknown as {run:typeof run;runText:typeof runText}).runText=runText;
 return{github,run,runText,rollup:(rows:unknown[])=>{rollup=rows;},root};
}

it('returns ready jobs with failed steps for two failed Actions checks',async()=>{
 const{github,rollup}=await harness();
 rollup([checkRun('Tests (1/2)',101),checkRun('Tests (2/2)',102)]);
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 const report=await github.failedChecks('project','thread',12);
 expect(report.jobs).toHaveLength(2);expect(report.omittedJobs).toBe(0);
 for(const[index,job]of report.jobs.entries()){
  expect(job).toMatchObject({id:String(101+index),workflowName:'CI',failedStep:'Run tests',conclusion:'FAILURE',logState:'ready'});
  expect(job.url).toBe(`https://github.com/example/fixture/actions/runs/55/job/${101+index}`);
  expect(job.excerpt).toContain('Process completed with exit code 1.');
  expect(job.excerpt).not.toContain('2026-11-21T');
  expect(job.excerpt).toContain('▸ Run pnpm test');
 }
 expect(report.headOid).toBe('a'.repeat(40));expect(report.localHead).toBe('a'.repeat(40));
 expect(report.id).toMatch(/^[a-f0-9]{64}$/);
});

it.each([
 ['external status check',{__typename:'StatusContext',context:'ci/external',state:'FAILURE',targetUrl:'https://ci.example.com/build/9'},'ext:0',''],
 ['another repository',{__typename:'CheckRun',name:'Tests',status:'COMPLETED',conclusion:'FAILURE',detailsUrl:'https://github.com/other/repo/actions/runs/55/job/101'},'ext:0',''],
])('marks %s as not-actions without fetching',async(_title,row,id,url)=>{
 const{github,runText,rollup}=await harness();rollup([row]);
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 const report=await github.failedChecks('project','thread',12);
 expect(report.jobs[0]).toMatchObject({id,logState:'not-actions',url,excerpt:'',workflowName:null,failedStep:null});
 expect(runText).not.toHaveBeenCalled();
});

it.each([
 ['404','Error: Command failed\ngh: HTTP 404: Not Found'],
 ['BlobNotFound','<?xml version="1.0"?><Error><Code>BlobNotFound</Code></Error>'],
])('marks job logs as unavailable on %s',async(_title,error)=>{
 const{github,rollup}=await harness();rollup([checkRun('Tests',101)]);
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 (github as unknown as {runText:(...a:unknown[])=>Promise<{stdout:string}|{error:string}>}).runText=vi.fn(async()=>({error}));
 const report=await github.failedChecks('project','thread',12);
 expect(report.jobs[0]!.logState).toBe('unavailable');expect(report.jobs[0]!.excerpt).toBe('');
});

it('marks oversized logs as too-large',async()=>{
 const{github,rollup}=await harness();rollup([checkRun('Tests',101)]);
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 (github as unknown as {runText:(...a:unknown[])=>Promise<{stdout:string}|{error:string}>}).runText=vi.fn(async()=>({error:'Error: stdout maxBuffer length exceeded'}));
 const report=await github.failedChecks('project','thread',12);
 expect(report.jobs[0]!.logState).toBe('too-large');
});

it('caps at six jobs and counts the rest as omitted',async()=>{
 const{github,rollup}=await harness();
 rollup(Array.from({length:8},(_v,index)=>checkRun(`Job ${index}`,200+index)));
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 const report=await github.failedChecks('project','thread',12);
 expect(report.jobs).toHaveLength(6);expect(report.omittedJobs).toBe(2);
});

it('redacts the credential inside log text',async()=>{
 const{github,rollup}=await harness();rollup([checkRun('Tests',101)]);
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 (github as unknown as {runText:(...a:unknown[])=>Promise<{stdout:string}|{error:string}>}).runText=vi.fn(async()=>({stdout:log(`secret ${TOKEN} leaked`)}));
 const report=await github.failedChecks('project','thread',12);
 expect(report.jobs[0]!.excerpt).not.toContain(TOKEN);
 expect(report.jobs[0]!.excerpt).toContain('[REDACTED]');
});

it('serves the cache within its TTL, bypasses on refresh, refetches a new head',async()=>{
 const{github,run,rollup}=await harness();rollup([checkRun('Tests',101)]);
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 const first=await github.failedChecks('project','thread',12);
 expect(run.mock.calls.filter(call=>call[1][0]==='api')).toHaveLength(1);
 const again=await github.failedChecks('project','thread',12);
 expect(again).toEqual(first);expect(run.mock.calls.filter(call=>call[1][0]==='api')).toHaveLength(1);
 await github.failedChecks('project','thread',12,{refresh:true});
 expect(run.mock.calls.filter(call=>call[1][0]==='api')).toHaveLength(2);
});

it('refetches when the pull request head changed',async()=>{
 const{github,run,rollup}=await harness();rollup([checkRun('Tests',101)]);
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 await github.failedChecks('project','thread',12);
 const otherHead='b'.repeat(40);
 run.mockImplementation(async(_p:string,args:string[])=>{
  if(args[0]==='pr'&&args[1]==='view')return JSON.stringify({number:12,headRefOid:otherHead,statusCheckRollup:[checkRun('Tests',101)]});
  if(args[0]==='api')return JSON.stringify({workflow_name:'CI',steps:[]});
  throw Error('Unexpected');
 });
 const next=await github.failedChecks('project','thread',12);
 expect(next.headOid).toBe(otherHead);
});

it('rejects when every Actions log fetch fails systemically',async()=>{
 const{github,rollup}=await harness();rollup([checkRun('Tests',101)]);
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 (github as unknown as {runText:(...a:unknown[])=>Promise<{stdout:string}|{error:string}>}).runText=vi.fn(async()=>({error:'Error: gh: HTTP 500: Internal Server Error'}));
 await expect(github.failedChecks('project','thread',12)).rejects.toThrow(/could be fetched/);
});

it('denies the call while the ciFixV1 flag is off',async()=>{
 const{github,rollup}=await harness();rollup([checkRun('Tests',101)]);
 await expect(github.failedChecks('project','thread',12)).rejects.toThrow(/disabled/);
});

it('looks reports up by id for the owning thread only',async()=>{
 const{github,rollup,root}=await harness();rollup([checkRun('Tests',101)]);
 __setCapabilityFlagForTests('workspace.ciFixV1',true);
 const report=await github.failedChecks('project','thread',12);
 const owner=JSON.stringify(['project','thread',root,'example/fixture']);
 expect(github.failureReports.get(owner,report.id).id).toBe(report.id);
 expect(()=>github.failureReports.get('other-owner',report.id)).toThrow(/expired/);
});
