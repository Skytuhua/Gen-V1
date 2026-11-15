import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store';
import {
 ProjectVerificationService,recipeDigest,recipeApprovalCommitment,sourceDigest,environmentId,
 type VerificationLauncher,type LaunchedProcess,type ListenerProbe,
} from '../packages/core/project-verification';
import {computeAssessment,observationFreshness} from '../packages/core/verification-gate';
import {verificationRecipeV1Schema,type CheckObservationV1,type VerificationRecipeV1} from '../packages/contracts/verification';
import type {ApprovalV1,ToolOwner} from '../packages/contracts/tool-effects';
import {hostFlagEnabled} from '../packages/core/host-flags';
import {HarnessError} from '../packages/contracts/index';
const code=(fn:()=>unknown):string=>{try{fn();}catch(e){return (e as HarnessError).code;}return 'NO_THROW';};
const codeAsync=async(p:Promise<unknown>):Promise<string>=>{try{await p;}catch(e){return (e as HarnessError).code;}return 'NO_THROW';};


const stores:Store[]=[];
function stateStore(){const store=new Store(join(tempDir('verify-state-'),'state'));stores.push(store);return store;}
const dirs:string[]=[];
function tempDir(prefix:string){const dir=mkdtempSync(join(tmpdir(),prefix));dirs.push(dir);return dir;}
afterEach(()=>{for(const store of stores.splice(0))store.close();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const FLAGS_ON={HARNESS_FLAG_VERIFICATION_WORKFLOW_V1:'1'};

const owner=(threadId='t1'):ToolOwner=>({threadId,runId:'r1',epoch:1,projectId:null,workspaceId:null,accountBinding:null});

function workspace(){
 const root=tempDir('verify-root-');
 mkdirSync(join(root,'sub'));
 writeFileSync(join(root,'app.ts'),'export const v=1;\n');
 writeFileSync(join(root,'pnpm-lock.yaml'),'lockfileVersion: 1\n');
 return root;
}
async function statIdentity(root:string){
 const info=await import('node:fs/promises').then(fs=>fs.stat(root,{bigint:true}));
 return {canonicalPath:root,dev:String(info.dev),ino:String(info.ino)};
}
async function recipe(root:string,over:Record<string,unknown>={}):Promise<VerificationRecipeV1>{
 const base:VerificationRecipeV1=verificationRecipeV1Schema.parse({
  version:1,recipeId:'recipe-1',
  workspaceIdentity:await statIdentity(root),
  approvedDigest:'0'.repeat(64),
  environment:{platform:'win32',nodeVersion:'24.10.0',packageManager:'pnpm@10.30.3'},
  phases:[
   {name:'BUILD',executableId:'pnpm',argv:['build'],relativeCwd:'sub',environmentRefs:[],timeoutMs:60_000},
   {name:'TEST',executableId:'pnpm',argv:['test'],relativeCwd:'sub',environmentRefs:[],timeoutMs:60_000},
   {name:'START',executableId:'pnpm',argv:['start'],relativeCwd:'sub',environmentRefs:[],timeoutMs:60_000},
   {name:'READINESS',executableId:'probe',argv:['http://127.0.0.1:4100/health'],relativeCwd:'sub',environmentRefs:[],timeoutMs:15_000},
   {name:'TEARDOWN',executableId:'cleanup',argv:[],relativeCwd:'sub',environmentRefs:[],timeoutMs:15_000},
  ],
  createdAt:new Date().toISOString(),revision:1,...over,
 });
 return {...base,approvedDigest:recipeDigest(base)};
}
function approval(store:Store,recipe:VerificationRecipeV1,o:ToolOwner):ApprovalV1{
 const value:ApprovalV1={approvalId:'ap-'+Math.random().toString(36).slice(2),operationId:'op-1',
  actionCommitment:recipeApprovalCommitment(recipe),owner:o,targetPreconditions:[],
  issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+900_000).toISOString(),remainingUses:1,issuer:'test'};
 store.internal('test.fixture',o.threadId,()=>store.put('approval',value.approvalId,o.threadId,value));
 return value;
}
interface FakeProc extends LaunchedProcess {terminated:boolean;launchedArgv:string[]}
function launcher(results:{exitCode:number|null;termination?:'NONE'|'TIMEOUT'|'CANCELLED'|'SPAWN_ERROR'}[]){
 const launched:FakeProc[]=[];let i=0;
 const fn:VerificationLauncher={launch:async req=>{
  const next=results[Math.min(i++,results.length-1)];
  const proc:FakeProc={pid:4000+i,launchedArgv:req.argv,terminated:false,
   tree:async()=>[4000+i,5000+i],
   wait:async()=>({exitCode:next.exitCode,termination:next.termination??'NONE'}),
   terminate:async()=>{proc.terminated=true;},
   log:async()=>({text:'bounded log output',truncated:false})};
  launched.push(proc);return proc;
 }};
 return {fn,launched};
}
const request=(recipeId:string)=>({recipeId,sourceFiles:['app.ts'],dependencyFiles:['pnpm-lock.yaml'],readiness:{host:'127.0.0.1' as const,port:4100,path:'/health'}});

it('the verification workflow stays disabled until the host flag enables it',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,{});
 const r=await recipe(root);
 expect(hostFlagEnabled('verification.workflowV1',{})).toBe(false);
 expect(code(()=>service.registerRecipe(r,'any',owner()))).toBe('CAPABILITY_DENIED');
 expect(await codeAsync(service.runRecipe(owner(),request('recipe-1'),launcher([{exitCode:0}]).fn))).toBe('CAPABILITY_DENIED');
});

it('recipe registration requires an exact M02 approval for this recipe and owner',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);
 expect(code(()=>service.registerRecipe(r,'missing-approval',o))).toBe('APPROVAL_REQUIRED');
 const wrong={...r,approvedDigest:r.approvedDigest};const bad:ApprovalV1={approvalId:'ap-bad',operationId:'op-1',actionCommitment:'other',owner:o,targetPreconditions:[],issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+900_000).toISOString(),remainingUses:1,issuer:'test'};
 store.internal('test.fixture',o.threadId,()=>store.put('approval','ap-bad',o.threadId,bad));
 expect(code(()=>service.registerRecipe(wrong,'ap-bad',o))).toBe('APPROVAL_REQUIRED');
 const ap=approval(store,r,o);
 const recorded=service.registerRecipe(r,ap.approvalId,o);
 expect(recorded.recipeId).toBe('recipe-1');expect(recorded.revision).toBe(1);
 // The approval was consumed; re-registration of the identical recipe needs a new approval.
 expect(code(()=>service.registerRecipe(r,ap.approvalId,o))).toBe('APPROVAL_REQUIRED');
});

it('an approved recipe runs the fixed phase order and records bound observations',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);const ap=approval(store,r,o);
 service.registerRecipe(r,ap.approvalId,o);
 const l=launcher([{exitCode:0},{exitCode:0},{exitCode:0}]);
 const probe:ListenerProbe={probe:async()=>({reachable:true,ownerPid:4003})};
 const result=await service.runRecipe(o,request('recipe-1'),l.fn,probe);
 expect(result.outcome).toBe('PASS');
 const phases=result.observations.map(obs=>obs.phase);
 expect(phases.slice(0,4)).toEqual(['BUILD','TEST','START','READINESS']);
 expect(phases).toContain('TEARDOWN');
 for(const obs of result.observations){
  expect(obs.recipeDigest).toBe(recipeDigest(r));
  expect(obs.codeDigest).toBe(await sourceDigest(root,['app.ts']));
  expect(obs.dependencyDigest).toBe(await sourceDigest(root,['pnpm-lock.yaml']));
  expect(obs.environmentId).toBe(environmentId(r));
  expect(obs.owner.threadId).toBe('t1');
 }
 // Every launched process tree was terminated by the owned teardown.
 expect(l.launched.every(proc=>proc.terminated)).toBe(true);
});

it('a failing phase prevents the start, readiness and browser phases',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const l=launcher([{exitCode:0},{exitCode:1}]);
 const result=await service.runRecipe(o,request('recipe-1'),l.fn,{probe:async()=>({reachable:true,ownerPid:4003})});
 expect(result.outcome).toBe('FAIL');
 const phases=result.observations.map(obs=>obs.phase);
 expect(phases).toEqual(['BUILD','TEST','TEARDOWN']);
 expect(l.launched).toHaveLength(2); // no start process was ever created
});

it('readiness requires the launched process tree to own the approved endpoint',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const l=launcher([{exitCode:0},{exitCode:0},{exitCode:0}]);
 // A stale server answers 200 but the owner cannot be proven: still BLOCKED.
 const stale:ListenerProbe={probe:async()=>({reachable:true,ownerPid:null})};
 const blocked=await service.runRecipe(o,request('recipe-1'),l.fn,stale);
 expect(blocked.outcome).toBe('BLOCKED');
 const readinessObs=blocked.observations.find(obs=>obs.phase==='READINESS');
 expect(readinessObs?.detail).toMatch(/READINESS_OWNER_UNPROVEN/);
 expect(readinessObs?.outcome).toBe('BLOCKED');
 // A foreign PID owning the endpoint is also unproven.
 const foreign:ListenerProbe={probe:async()=>({reachable:true,ownerPid:99999})};
 const again=await service.runRecipe(o,request('recipe-1'),l.fn,foreign);
 expect(again.observations.find(obs=>obs.phase==='READINESS')?.outcome).toBe('BLOCKED');
});

it('freshness is derived from the current source cut and never rewrites the recorded outcome',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const result=await service.runRecipe(o,request('recipe-1'),launcher([{exitCode:0},{exitCode:0},{exitCode:0}]).fn,{probe:async()=>({reachable:true,ownerPid:4003})});
 const obs=result.observations[0];
 const current={codeDigest:await sourceDigest(root,['app.ts']),dependencyDigest:await sourceDigest(root,['pnpm-lock.yaml']),environmentId:environmentId(r)};
 expect(observationFreshness(obs,current)).toBe('CURRENT');
 writeFileSync(join(root,'app.ts'),'export const v=2; // edited after the check\n');
 const drifted={...current,codeDigest:await sourceDigest(root,['app.ts'])};
 expect(observationFreshness(obs,drifted)).toBe('STALE');
 // The stored observation keeps its original outcome and digest.
 const stored=store.get<CheckObservationV1>('checkObservation',obs.checkId)!;
 expect(stored.outcome).toBe('PASS');expect(stored.codeDigest).toBe(obs.codeDigest);
});

it('a drifted workspace identity blocks the run before any launch',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root,{workspaceIdentity:{...(await statIdentity(root)),ino:'0'}});
 // Registration binds the digest; tamper the stored identity instead.
 service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const l=launcher([{exitCode:0}]);
 expect(await codeAsync(service.runRecipe(o,request('recipe-1'),l.fn))).toBe('BLOCKED_SOURCE_DRIFT');
 expect(l.launched).toHaveLength(0);
});

it('cleanup failures are recorded as their own observation',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const failing:VerificationLauncher={launch:async()=>({pid:1,tree:async()=>[1],wait:async()=>({exitCode:0,termination:'NONE' as const}),terminate:async()=>{throw new Error('still running');},log:async()=>({text:'',truncated:false})})};
 const result=await service.runRecipe(o,request('recipe-1'),failing,{probe:async()=>({reachable:true,ownerPid:1})});
 expect(result.cleanupFailures.length).toBeGreaterThan(0);
 const teardown=result.observations.filter(obs=>obs.observationKind==='cleanup').at(-1)!;
 expect(teardown.outcome).toBe('FAIL');
});

it('the completion projection marks fresh trusted evidence verified and names missing checks',async()=>{
 const root=workspace();
 const code=await sourceDigest(root,['app.ts']);const dep=await sourceDigest(root,['pnpm-lock.yaml']);
 const envId='win32/24.10.0/pnpm@10.30.3';
 const obs:CheckObservationV1={version:1,checkId:'c1',executionId:'exec-1',owner:owner(),codeDigest:code,dependencyDigest:dep,recipeDigest:'a'.repeat(64),environmentId:envId,argv:['pnpm','test'],cwdIdentity:root,phase:'TEST',startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),exitCode:0,outcome:'PASS',artifactRefs:[],observationKind:'process'};
 const verified=computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:code,dependencyDigest:dep,environmentId:envId},requirements:[{id:'tests-pass',checkRefs:['exec-1']}],observations:[obs],unresolvedEffects:[],verifierIdentity:'service/r1',provenance:'test'});
 expect(verified.label).toBe('VERIFIED');expect(verified.requirements[0].assessment).toBe('VERIFIED');
 // A conversation-only task still finishes — visibly unverified, naming what is missing.
 const bare=computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:code,dependencyDigest:dep,environmentId:envId},requirements:[],observations:[],unresolvedEffects:[],verifierIdentity:'service/r1',provenance:'test'});
 expect(bare.label).toBe('COMPLETED_UNVERIFIED');
 const missing=computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:code,dependencyDigest:dep,environmentId:envId},requirements:[{id:'tests-pass',checkRefs:['exec-9']}],observations:[obs],unresolvedEffects:[],verifierIdentity:'service/r1',provenance:'test'});
 expect(missing.label).toBe('COMPLETED_UNVERIFIED');expect(missing.requirements[0].missing[0]).toMatch(/no observation bound/);
 // Stale evidence cannot verify.
 const stale=computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:'b'.repeat(64),dependencyDigest:dep,environmentId:envId},requirements:[{id:'tests-pass',checkRefs:['exec-1']}],observations:[obs],unresolvedEffects:[],verifierIdentity:'service/r1',provenance:'test'});
 expect(stale.label).toBe('COMPLETED_UNVERIFIED');expect(stale.requirements[0].missing[0]).toMatch(/stale/);
 const failed=computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:code,dependencyDigest:dep,environmentId:envId},requirements:[{id:'tests-pass',checkRefs:['exec-1']}],observations:[{...obs,outcome:'FAIL'}],unresolvedEffects:[],verifierIdentity:'service/r1',provenance:'test'});
 expect(failed.label).toBe('FAILED');
 const blocked=computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:code,dependencyDigest:dep,environmentId:envId},requirements:[{id:'tests-pass',checkRefs:['exec-1']}],observations:[obs],unresolvedEffects:['effect-x'],verifierIdentity:'service/r1',provenance:'test'});
 expect(blocked.label).toBe('BLOCKED');expect(blocked.unresolvedEffects).toEqual(['effect-x']);
});
