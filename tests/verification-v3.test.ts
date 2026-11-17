import {describe,it,expect,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store';
import {
 ProjectVerificationService,recipeDigest,recipeApprovalCommitment,sourceDigest,environmentId,
 type VerificationLauncher,type LaunchedProcess,type ListenerProbe,
} from '../packages/core/project-verification';
import {BoundedRepairLoop,computeAssessment,observationFreshness} from '../packages/core/verification-gate';
import {verificationRecipeV1Schema,type CheckObservationV1,type VerificationRecipeV1} from '../packages/contracts/verification';
import type {ApprovalV1,ToolEffectRecord,ToolOwner} from '../packages/contracts/tool-effects';
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
interface FakeProc extends LaunchedProcess {terminated:boolean;launchedArgv:string[];end?:()=>void}
function launcher(results:{exitCode:number|null;termination?:'NONE'|'TIMEOUT'|'CANCELLED'|'SPAWN_ERROR';stayAlive?:boolean}[]){
 const launched:FakeProc[]=[];let i=0;
 const fn:VerificationLauncher={launch:async req=>{
  const next=results[Math.min(i++,results.length-1)];
  const proc:FakeProc={pid:4000+i,launchedArgv:req.argv,terminated:false,
   tree:async()=>[4000+i,5000+i],
   wait:()=>next.stayAlive?new Promise(resolve=>{proc.end=()=>resolve({exitCode:143,termination:'NONE'})}):Promise.resolve({exitCode:next.exitCode,termination:next.termination??'NONE'}),
   terminate:async()=>{proc.terminated=true;proc.end?.();},
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

it.each([{runId:'r2'},{epoch:2},{projectId:'project-other'},{workspaceId:'workspace-other'},{accountBinding:'account-other'}])('recipe approval cannot cross the owner binding %j',async changed=>{
 const root=workspace();const store=stateStore();const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner(),r=await recipe(root),ap=approval(store,r,o);
 expect(code(()=>service.registerRecipe(r,ap.approvalId,{...o,...changed}))).toBe('APPROVAL_REQUIRED');
 expect(store.get<ApprovalV1>('approval',ap.approvalId)?.remainingUses).toBe(1);
 expect(service.recipe(r.recipeId)).toBeNull();
});

it.each([{recipeId:'recipe-other'},{revision:2}])('recipe approval binds the exact recipe identity %j',async changed=>{
 const root=workspace();const store=stateStore();const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner(),r=await recipe(root),ap=approval(store,r,o);
 expect(code(()=>service.registerRecipe({...r,...changed},ap.approvalId,o))).toBe('APPROVAL_REQUIRED');
 expect(store.get<ApprovalV1>('approval',ap.approvalId)?.remainingUses).toBe(1);
});

it('recipe registration preserves the exact approved next revision',async()=>{
 const root=workspace();const store=stateStore();const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner(),r=await recipe(root),first=approval(store,r,o);
 service.registerRecipe(r,first.approvalId,o);
 const skipped={...r,revision:7},ap=approval(store,skipped,o);
 expect(code(()=>service.registerRecipe(skipped,ap.approvalId,o))).toBe('RECIPE_REVISION');
 expect(store.get<ApprovalV1>('approval',ap.approvalId)?.remainingUses).toBe(1);
 const next={...r,revision:2},nextApproval=approval(store,next,o);
 expect(service.registerRecipe(next,nextApproval.approvalId,o).revision).toBe(2);
});

it('one thread cannot replace another thread\'s registered recipe',async()=>{
 const root=workspace();const store=stateStore();const service=new ProjectVerificationService(store,FLAGS_ON);
 const originalOwner=owner(),r=await recipe(root);
 service.registerRecipe(r,approval(store,r,originalOwner).approvalId,originalOwner);
 const foreign=owner('t2'),replacement={...r,revision:2},ap=approval(store,replacement,foreign);
 expect(code(()=>service.registerRecipe(replacement,ap.approvalId,foreign))).toBe('CAPABILITY_DENIED');
 expect(service.recipe(r.recipeId)?.revision).toBe(1);
 expect(store.all<VerificationRecipeV1>('verificationRecipe','t1')).toHaveLength(1);
 expect(store.get<ApprovalV1>('approval',ap.approvalId)?.remainingUses).toBe(1);
});

it('one thread cannot execute another thread\'s registered recipe',async()=>{
 const root=workspace();const store=stateStore();const service=new ProjectVerificationService(store,FLAGS_ON);
 const base=await recipe(root),r=await recipe(root,{phases:base.phases.filter(phase=>phase.name==='TEST')}),o=owner();
 service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const launched=launcher([{exitCode:0}]);
 expect(await codeAsync(service.runRecipe(owner('t2'),request(r.recipeId),launched.fn))).toBe('NOT_FOUND');
 expect(launched.launched).toHaveLength(0);
 expect(service.observations('t2')).toEqual([]);
});

it('an approved recipe runs the fixed phase order and records bound observations',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);const ap=approval(store,r,o);
 service.registerRecipe(r,ap.approvalId,o);
 const l=launcher([{exitCode:0},{exitCode:0},{exitCode:0,stayAlive:true}]);
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
 const l=launcher([{exitCode:0},{exitCode:0},{exitCode:0,stayAlive:true}]);
 const l2=launcher([{exitCode:0},{exitCode:0},{exitCode:0,stayAlive:true}]);
 // A stale server answers 200 but the owner cannot be proven: still BLOCKED.
 const stale:ListenerProbe={probe:async()=>({reachable:true,ownerPid:null})};
 const blocked=await service.runRecipe(o,request('recipe-1'),l.fn,stale);
 expect(blocked.outcome).toBe('BLOCKED');
 const readinessObs=blocked.observations.find(obs=>obs.phase==='READINESS');
 expect(readinessObs?.detail).toMatch(/READINESS_OWNER_UNPROVEN/);
 expect(readinessObs?.outcome).toBe('BLOCKED');
 // A foreign PID owning the endpoint is also unproven.
 const foreign:ListenerProbe={probe:async()=>({reachable:true,ownerPid:99999})};
 const again=await service.runRecipe(o,request('recipe-1'),l2.fn,foreign);
 expect(again.observations.find(obs=>obs.phase==='READINESS')?.outcome).toBe('BLOCKED');
});

it('freshness is derived from the current source cut and never rewrites the recorded outcome',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const result=await service.runRecipe(o,request('recipe-1'),launcher([{exitCode:0},{exitCode:0},{exitCode:0,stayAlive:true}]).fn,{probe:async()=>({reachable:true,ownerPid:4003})});
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

it('a passing recipe cannot report success when its owned process cleanup fails',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const base=await recipe(root);
 const r=await recipe(root,{phases:base.phases.filter(phase=>phase.name==='TEST')});
 const o=owner();service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const failing:VerificationLauncher={launch:async()=>({pid:1,tree:async()=>[1],wait:async()=>({exitCode:0,termination:'NONE'}),terminate:async()=>{throw new Error('owned process still running');},log:async()=>({text:'',truncated:false})})};
 const result=await service.runRecipe(o,request('recipe-1'),failing);
 expect(result.observations.find(obs=>obs.phase==='TEST')?.outcome).toBe('PASS');
 expect(result.outcome).toBe('FAIL');
 expect(result.cleanupFailures).toEqual(['owned process still running']);
 expect(result.observations.find(obs=>obs.phase==='TEARDOWN')?.outcome).toBe('FAIL');
});

it('identical runner failures stop repair despite fresh observation IDs on every execution',async()=>{
 const root=workspace();const store=stateStore();const service=new ProjectVerificationService(store,FLAGS_ON);
 const base=await recipe(root),r=await recipe(root,{phases:base.phases.filter(phase=>phase.name==='TEST')}),o=owner();
 service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const loop=new BoundedRepairLoop(store,o,r.recipeId,['tests-pass']),checkIds:string[]=[];
 for(let attempt=0;attempt<2;attempt++){
  const result=await service.runRecipe(o,request(r.recipeId),launcher([{exitCode:1}]).fn);
  const failures=result.observations.filter(obs=>obs.outcome==='FAIL');checkIds.push(failures[0].checkId);
  loop.recordAttempt({requirementIds:['tests-pass'],failures,outcome:result.outcome});
 }
 expect(new Set(checkIds).size).toBe(2);
 expect(loop.nextDecision()).toEqual({allowed:false,reason:'UNCHANGED_FAILURE'});
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

it('recipes reject phases outside the canonical order, duplicates and empty cwd',async()=>{
 const root=workspace();const r=await recipe(root);
 expect(()=>verificationRecipeV1Schema.parse({...r,phases:[...r.phases].reverse()})).toThrow();
 expect(()=>verificationRecipeV1Schema.parse({...r,phases:[r.phases[0],r.phases[0]]})).toThrow();
 // The workspace root itself is a valid phase working directory.
 const rooted=verificationRecipeV1Schema.parse({...r,phases:r.phases.map(p=>({...p,relativeCwd:'.'}))});
 expect(rooted.phases.every(p=>p.relativeCwd==='.')).toBe(true);
});

it('a START server stays owned and alive; early exit fails the phase',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);service.registerRecipe(r,approval(store,r,o).approvalId,o);
 const l=launcher([{exitCode:0},{exitCode:0},{exitCode:0,stayAlive:true}]);
 const result=await service.runRecipe(o,request('recipe-1'),l.fn,{probe:async()=>({reachable:true,ownerPid:4003})});
 expect(result.outcome).toBe('PASS');
 const startObs=result.observations.find(obs=>obs.phase==='START')!;
 expect(startObs.outcome).toBe('PASS');expect(startObs.exitCode).toBeNull();
 expect(l.launched.every(proc=>proc.terminated)).toBe(true);
 // Early exit before readiness is proven fails START and halts the run.
 const dead=await service.runRecipe(o,request('recipe-1'),launcher([{exitCode:0},{exitCode:0},{exitCode:3}]).fn,{probe:async()=>({reachable:true,ownerPid:4003})});
 expect(dead.outcome).toBe('FAIL');
 const deadStart=dead.observations.find(obs=>obs.phase==='START')!;
 expect(deadStart.outcome).toBe('FAIL');expect(deadStart.detail).toMatch(/exited before readiness/);
 expect(dead.observations.some(obs=>obs.phase==='READINESS')).toBe(false);
});

it('owned processes are terminated even when a phase throws outside its error handling',async()=>{
 const root=workspace();const store=stateStore();
 const service=new ProjectVerificationService(store,FLAGS_ON);
 const o=owner();const r=await recipe(root);service.registerRecipe(r,approval(store,r,o).approvalId,o);
 // Delete a declared input mid-run so the next phase's digest recomputation throws.
 let built=false;
 const l=launcher([{exitCode:0},{exitCode:0}]);
 const destructive:VerificationLauncher={launch:async req=>{const proc=await l.fn.launch(req);if(!built){built=true;rmSync(join(root,'app.ts'),{force:true});}return proc;}};
 expect(await codeAsync(service.runRecipe(o,request('recipe-1'),destructive,{probe:async()=>({reachable:true,ownerPid:1})}))).toBe('INVALID_RESOURCE');
 expect(l.launched.length).toBeGreaterThan(0);
 expect(l.launched.every(proc=>proc.terminated)).toBe(true);
});

it('verification_declare is published to runtimes with strict metadata and a real authority schema',async()=>{
 const {createHostTools,VERIFICATION_DECLARE}=await import('../packages/runtime-pi/tool-definitions');
 const {ToolAuthority,buildToolRegistry}=await import('../packages/core/tool-authority');
 const {digest}=await import('../packages/storage/store');
 const tools=createHostTools([],async()=>({}));
 expect(tools.map(tool=>tool.name)).toContain('verification_declare');
 const definition=new ToolAuthority(buildToolRegistry()).definition('verification_declare');
 expect(definition).toBeTruthy();
 expect(definition!.schemaDigest).toBe(digest(VERIFICATION_DECLARE.parameters));
});

it('an audited task_finish does not block its own completion assessment',async()=>{
 const {Service}=await import('../packages/core/service');
 const root=workspace();const store=stateStore();
 const runtime={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime as never,{toolEffectFlags:{'audit.effectsV1':true}});
 const stamp=new Date().toISOString();
 store.internal('test.fixture','t1',()=>store.put('thread','t1','t1',{id:'t1',threadId:'t1',title:'T',kind:'main',mode:'build',projectName:null,status:'working',createdAt:stamp,updatedAt:stamp,modelId:'test/model',sessionPath:null,runId:'r1',epoch:1}));
 const code=await sourceDigest(root,['app.ts']);const dep=await sourceDigest(root,['pnpm-lock.yaml']);
 const envId='win32/24.10.0/pnpm@10.30.3';
 const declaration={version:1,rootPath:root,sourceFiles:['app.ts'],dependencyFiles:['pnpm-lock.yaml'],environmentId:envId,requirements:[{id:'tests-pass',checkRefs:['exec-1']}],declaredAt:stamp};
 const obs:CheckObservationV1={version:1,checkId:'c1',executionId:'exec-1',owner:owner(),codeDigest:code,dependencyDigest:dep,recipeDigest:'a'.repeat(64),environmentId:envId,argv:['pnpm','test'],cwdIdentity:root,phase:'TEST',startedAt:stamp,endedAt:stamp,exitCode:0,outcome:'PASS',artifactRefs:[],observationKind:'process'};
 store.internal('test.fixture','t1',()=>{store.put('verificationDeclaration','t1','t1',declaration);store.put('checkObservation','c1','t1',obs);});
 // Audited path admits this very task_finish as DISPATCHED before the body
 // runs; the assessment must exclude it by argument commitment.
 const saved=process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1;
 process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1='1';
 try{await service.tool({name:'task_finish',args:{commandId:'finish-1',outcome:'done'}},{threadId:'t1',runId:'r1',epoch:1});}
 finally{if(saved===undefined)delete process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1;else process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1=saved;}
 const assessment=store.all<{label:string;unresolvedEffects:string[]}>('assessment','t1').at(-1)!;
 expect(assessment.label).toBe('VERIFIED');
 expect(assessment.unresolvedEffects).toEqual([]);
});

it('verification_declare accepts commandId for receipts without polluting the declaration',async()=>{
 const {Service}=await import('../packages/core/service');
 const root=workspace();const store=stateStore();
 const runtime={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime as never,{});
 const stamp=new Date().toISOString();
 store.internal('test.fixture','t1',()=>store.put('thread','t1','t1',{id:'t1',threadId:'t1',title:'T',kind:'main',mode:'build',projectName:null,status:'working',createdAt:stamp,updatedAt:stamp,modelId:'test/model',sessionPath:null,runId:'r1',epoch:1}));
 const args={commandId:'decl-1',rootPath:root,sourceFiles:['app.ts'],dependencyFiles:['pnpm-lock.yaml'],environmentId:'win32/24.10.0/pnpm@10.30.3',requirements:[{id:'tests-pass',checkRefs:['exec-1']}]};
 const saved=process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1;
 process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1='1';
 try{
  const first=await service.tool({name:'verification_declare',args},{threadId:'t1',runId:'r1',epoch:1});
  expect(first).toEqual({requirements:1});
  // A repeated call hits the command receipt instead of revalidating.
  const second=await service.tool({name:'verification_declare',args},{threadId:'t1',runId:'r1',epoch:1});
  expect(second).toEqual({requirements:1});
  const declaration=store.get<Record<string,unknown>>('verificationDeclaration','t1')!;
  expect('commandId' in declaration).toBe(false);
 }finally{if(saved===undefined)delete process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1;else process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1=saved;}
});

it('the panel shows no completion label until task_finish saved an assessment',async()=>{
 const {verificationPanelModel}=await import('../packages/core/verification-read-models');
 const root=workspace();const store=stateStore();
 const code=await sourceDigest(root,['app.ts']);const dep=await sourceDigest(root,['pnpm-lock.yaml']);
 const envId='win32/24.10.0/pnpm@10.30.3';const stamp=new Date().toISOString();
 const declaration={version:1,rootPath:root,sourceFiles:['app.ts'],dependencyFiles:['pnpm-lock.yaml'],environmentId:envId,requirements:[{id:'tests-pass',checkRefs:['exec-1']}],declaredAt:stamp};
 const obs:CheckObservationV1={version:1,checkId:'c1',executionId:'exec-1',owner:owner(),codeDigest:code,dependencyDigest:dep,recipeDigest:'a'.repeat(64),environmentId:envId,argv:['pnpm','test'],cwdIdentity:root,phase:'TEST',startedAt:stamp,endedAt:stamp,exitCode:0,outcome:'PASS',artifactRefs:[],observationKind:'process'};
 store.internal('test.fixture','t1',()=>{store.put('verificationDeclaration','t1','t1',declaration);store.put('checkObservation','c1','t1',obs);});
 const model=verificationPanelModel(store,'t1');
 // Rows and freshness still compute against the live cut; the label stays
 // absent until the completion boundary records an assessment.
 expect(model.label).toBeNull();
 expect(model.rows.some(row=>row.freshness==='CURRENT')).toBe(true);
});

it('the panel read model re-digests declared inputs so edits never keep a green Verified',async()=>{
 const {verificationPanelModel}=await import('../packages/core/verification-read-models');
 const root=workspace();const store=stateStore();
 const code=await sourceDigest(root,['app.ts']);const dep=await sourceDigest(root,['pnpm-lock.yaml']);
 const envId='win32/24.10.0/pnpm@10.30.3';const stamp=new Date().toISOString();
 const declaration={version:1,rootPath:root,sourceFiles:['app.ts'],dependencyFiles:['pnpm-lock.yaml'],environmentId:envId,requirements:[{id:'tests-pass',checkRefs:['exec-1']}],declaredAt:stamp};
 const obs:CheckObservationV1={version:1,checkId:'c1',executionId:'exec-1',owner:owner(),codeDigest:code,dependencyDigest:dep,recipeDigest:'a'.repeat(64),environmentId:envId,argv:['pnpm','test'],cwdIdentity:root,phase:'TEST',startedAt:stamp,endedAt:stamp,exitCode:0,outcome:'PASS',artifactRefs:[],observationKind:'process'};
 const assessment=computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:code,dependencyDigest:dep,environmentId:envId},requirements:declaration.requirements,observations:[obs],unresolvedEffects:[],verifierIdentity:'service/r1',provenance:'test'});
 store.internal('test.fixture','t1',()=>{store.put('verificationDeclaration','t1','t1',declaration);store.put('checkObservation','c1','t1',obs);store.put('assessment',assessment.assessmentId,'t1',assessment);});
 const before=verificationPanelModel(store,'t1');
 expect(before.label).toBe('VERIFIED');
 // Editing a declared input makes the recorded PASS stale on the next read.
 writeFileSync(join(root,'app.ts'),'export const v=2; // edited after verification\n');
 const after=verificationPanelModel(store,'t1');
 expect(after.label).toBe('COMPLETED_UNVERIFIED');
 expect(after.rows.some(row=>row.freshness==='STALE')).toBe(true);
 // Unavailable declared inputs make freshness indeterminate — never verified.
 rmSync(join(root,'app.ts'),{force:true});
 const unavailable=verificationPanelModel(store,'t1');
 expect(unavailable.rows.every(row=>row.freshness==='INDETERMINATE')).toBe(true);
 expect(unavailable.label).not.toBe('VERIFIED');
});

describe('M07 advisory evidence feed',()=>{
 it('records review-advisory observations that inform review without satisfying requirements',async()=>{
  const root=workspace();const store=stateStore();
  const service=new ProjectVerificationService(store,FLAGS_ON);
  const code=await sourceDigest(root,['app.ts']);const dep=await sourceDigest(root,['pnpm-lock.yaml']);
  const envId='win32/24.10.0/pnpm@10.30.3';
  const advisory={version:1 as const,executionId:'intel-test-1',codeDigest:code,dependencyDigest:dep,recipeDigest:'b'.repeat(64),environmentId:envId,argv:['typescript-language-server','--stdio'],cwdIdentity:root,phase:'BUILD' as const,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),exitCode:null,outcome:'PASS' as const,artifactRefs:[],detail:'diagnostics=0'};
  const recorded=service.recordAdvisory(owner(),advisory);
  expect(recorded.observationKind).toBe('review-advisory');
  expect(recorded.checkId).toMatch(/^obs-/);
  expect(service.observations('t1')).toHaveLength(1);
  // An advisory PASS is evidence, not verification — it can never satisfy a declared requirement.
  const assessed=computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:code,dependencyDigest:dep,environmentId:envId},requirements:[{id:'diagnostics-clean',checkRefs:['intel-test-1']}],observations:[recorded],unresolvedEffects:[],verifierIdentity:'service/r1',provenance:'test'});
  expect(assessed.requirements[0].assessment).toBe('UNVERIFIED');
  // A failing advisory still counts against completion.
  const failed=service.recordAdvisory(owner(),{...advisory,executionId:'intel-test-2',outcome:'FAIL',detail:'diagnostics=2 errors=1'});
  const failing=computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:code,dependencyDigest:dep,environmentId:envId},requirements:[{id:'diagnostics-clean',checkRefs:['intel-test-2']}],observations:[failed],unresolvedEffects:[],verifierIdentity:'service/r1',provenance:'test'});
  expect(failing.requirements[0].assessment).toBe('FAILED');
 });
 it('advisory recording stays disabled until the verification flag enables it',()=>{
  const root=workspace();const store=stateStore();
  const service=new ProjectVerificationService(store,{});
  expect(code(()=>service.recordAdvisory(owner(),{version:1,executionId:'x',codeDigest:'a'.repeat(64),dependencyDigest:'a'.repeat(64),recipeDigest:'a'.repeat(64),environmentId:'e',argv:['x'],cwdIdentity:root,phase:'BUILD',startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),exitCode:null,outcome:'PASS',artifactRefs:[]}))).toBe('CAPABILITY_DENIED');
 });
});

describe('complete requirement evidence',()=>{
 const sourceCut={headSha:null,codeDigest:'a'.repeat(64),dependencyDigest:'b'.repeat(64),environmentId:'linux/test'};
 const observation=(checkId:string,over:Partial<CheckObservationV1>={}):CheckObservationV1=>({
  version:1,checkId,executionId:'exec-complete',owner:owner(),codeDigest:sourceCut.codeDigest,dependencyDigest:sourceCut.dependencyDigest,environmentId:sourceCut.environmentId,recipeDigest:'c'.repeat(64),
  argv:['node','test.mjs'],cwdIdentity:'/trusted/project',phase:'TEST',startedAt:'2026-11-17T00:00:00Z',endedAt:'2026-11-17T00:00:01Z',
  exitCode:0,outcome:'PASS',artifactRefs:[],observationKind:'process',...over,
 });
 const assess=(checkRefs:string[],observations:CheckObservationV1[])=>computeAssessment({
  threadId:'t1',sourceCut,requirements:[{id:'build-and-test',checkRefs}],observations,
  unresolvedEffects:[],verifierIdentity:'service/r1',provenance:'test',
 });

 it('one passing check cannot hide a missing required reference',()=>{
  const result=assess(['build','test'],[observation('build')]);
  expect(result.label).toBe('COMPLETED_UNVERIFIED');
  expect(result.requirements[0].missing.some(value=>value.includes('test'))).toBe(true);
 });

 it.each([
  ['unknown',{outcome:'UNKNOWN' as const,exitCode:null}],
  ['stale',{codeDigest:'d'.repeat(64)}],
  ['advisory',{observationKind:'review-advisory' as const}],
 ])('one passing check cannot hide a required %s check',(_reason,over)=>{
  const result=assess(['build','test'],[observation('build'),observation('test',over)]);
  expect(result.label).toBe('COMPLETED_UNVERIFIED');
  expect(result.requirements[0].assessment).toBe('UNVERIFIED');
  expect(result.requirements[0].missing.some(value=>value.includes('test'))).toBe(true);
 });

 it('an execution reference requires all of its observed checks to be current and settled',()=>{
  const result=assess(['exec-complete'],[observation('build'),observation('test',{outcome:'UNKNOWN',exitCode:null})]);
  expect(result.label).toBe('COMPLETED_UNVERIFIED');
  expect(result.requirements[0].missing.some(value=>value.includes('exec-complete'))).toBe(true);
 });

 it('every required check with fresh executed PASS evidence verifies',()=>{
  const result=assess(['build','test'],[observation('build'),observation('test')]);
  expect(result.label).toBe('VERIFIED');
  expect(result.requirements[0].missing).toEqual([]);
 });

 it('a browser artifact reference cannot attest its own screenshot custody',()=>{
  const result=assess(['browser'],[observation('browser',{phase:'BROWSER',observationKind:'browser',artifactRefs:['untrusted://capture.png']})]);
  expect(result.label).toBe('BLOCKED');
  expect(result.requirements[0].missing).toEqual(['screenshot custody is unavailable for build-and-test (browser)']);
 });

 it('missing artifact metadata cannot make a visual dependency trusted',()=>{
  const result=assess(['build'],[observation('build'),observation('image',{observationKind:'visual',artifactRefs:[]})]);
  expect(result.label).toBe('BLOCKED');
 });

 it('a screenshot from a different complete owner cannot block the selected execution',()=>{
  const result=assess(['build'],[observation('build'),observation('image',{owner:{...owner(),accountBinding:'other-account'},observationKind:'visual',artifactRefs:['untrusted://capture.png']})]);
  expect(result.label).toBe('VERIFIED');
 });

 it.each([
  ['failed cleanup',{phase:'TEARDOWN' as const,observationKind:'cleanup' as const,outcome:'FAIL' as const,exitCode:null},'FAILED'],
  ['cancelled execution',{outcome:'CANCELLED' as const,exitCode:null},'FAILED'],
  ['blocked execution',{outcome:'BLOCKED' as const,exitCode:null},'BLOCKED'],
  ['unsettled execution',{outcome:'UNKNOWN' as const,exitCode:null},'COMPLETED_UNVERIFIED'],
 ])('a direct passing check reference cannot hide %s',(_reason,over,label)=>{
  const result=assess(['build'],[observation('build'),observation('execution-status',over)]);
  expect(result.label).toBe(label);
 });

 it('failures from a separate execution remain historical when a fresh check is bound',()=>{
  const result=assess(['build'],[observation('build'),observation('prior-failure',{executionId:'exec-prior',outcome:'FAIL',exitCode:1})]);
  expect(result.label).toBe('VERIFIED');
 });

 it.each([
  {threadId:'another-thread'}, {runId:'another-run'}, {epoch:2},
  {projectId:'another-project'}, {workspaceId:'another-workspace'}, {accountBinding:'another-account'},
 ])('an execution ID collision cannot import failure from owner %j',changedOwner=>{
  const result=assess(['build'],[observation('build'),observation('foreign-failure',{owner:{...owner(),...changedOwner},outcome:'FAIL',exitCode:1})]);
  expect(result.label).toBe('VERIFIED');
 });

 it('the largest requirement still reports incomplete execution evidence within the contract bound',()=>{
  const refs=Array.from({length:64},(_,index)=>`check-${index}`);
  const result=assess(refs,[observation('check-0',{outcome:'UNKNOWN',exitCode:null})]);
  expect(result.label).toBe('COMPLETED_UNVERIFIED');
  expect(result.requirements[0].missing).toHaveLength(64);
 });
});

describe('bounded unresolved effect projection',()=>{
 const assess=(count:number,provenance='test')=>computeAssessment({
  threadId:'t1',sourceCut:{headSha:null,codeDigest:'a'.repeat(64),dependencyDigest:'b'.repeat(64),environmentId:'test'},
  requirements:[],observations:[],unresolvedEffects:Array.from({length:count},(_,index)=>`effect-${index}`),
  verifierIdentity:'test',provenance,
 });
 it.each([65,128,1024])('keeps %i unresolved effects blocked with bounded references and the full count',count=>{
  const result=assess(count);
  expect(result.label).toBe('BLOCKED');
  expect(result.unresolvedEffects).toEqual(Array.from({length:64},(_,index)=>`effect-${index}`));
  expect(result.provenance).toContain(`Unresolved effects: ${count}`);
  expect(result.provenance).toContain('references shown: 64');
 });
 it('keeps the effect count visible when existing provenance fills its bound',()=>{
  const result=assess(65,'p'.repeat(500));
  expect(result.label).toBe('BLOCKED');
  expect(result.provenance.length).toBeLessThanOrEqual(500);
  expect(result.provenance).toContain('Unresolved effects: 65');
  expect(result.provenance).toContain('provenance shortened');
 });
});

it('task_finish and the live panel keep 65 unresolved ledger effects blocked without dropping records',async()=>{
 const {Service}=await import('../packages/core/service');
 const {verificationPanelModel}=await import('../packages/core/verification-read-models');
 const root=workspace(),identity=await statIdentity(root),store=stateStore(),stamp=new Date().toISOString();
 const runtime={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime as never,{});
 store.internal('test.fixture','t1',()=>{
  store.put('thread','t1','t1',{id:'t1',threadId:'t1',title:'T',kind:'main',mode:'build',projectId:'p1',workspaceId:null,accountId:null,projectName:'P',status:'working',createdAt:stamp,updatedAt:stamp,modelId:'test/model',sessionPath:null,runId:'r1',epoch:1});
  store.put('workspaceProject','p1',null,{id:'p1',name:'P',rootPath:root,authority:{kind:'local'},createdAt:stamp});
  store.put('workspaceProjectRoot','p1',null,{path:root,identity:{dev:identity.dev,ino:identity.ino}});
  store.put('verificationDeclaration','t1','t1',{version:1,rootPath:root,sourceFiles:['app.ts'],dependencyFiles:['pnpm-lock.yaml'],environmentId:'test',requirements:[]});
  for(let index=0;index<65;index++){
   const id=`effect-${index}`;
   const effect:ToolEffectRecord={effectId:id,invocationId:id,attemptId:1,parentInvocationId:null,owner:{...owner(),projectId:'p1'},toolId:'repository_read',definitionDigest:'c'.repeat(64),privateArgumentCommitment:'d'.repeat(64),publicRedactedSummary:'pending read',targetPreconditions:[],approvalId:null,state:'DISPATCHED',providerReceiptRef:null,createdAt:stamp,updatedAt:stamp,threadId:'t1',transitions:[{from:null,to:'PREPARED',at:stamp},{from:'PREPARED',to:'DISPATCHED',at:stamp}]};
   store.put('toolEffect',id,'t1',effect);
  }
 });
 const saved=process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1;process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1='1';
 try{await service.tool({name:'task_finish',args:{commandId:'finish-overflow',outcome:'done'}},{threadId:'t1',runId:'r1',epoch:1});}
 finally{if(saved===undefined)delete process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1;else process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1=saved;}
 const assessment=store.all<{label:string;unresolvedEffects:string[];provenance:string}>('assessment','t1').at(-1)!;
 expect(assessment.label).toBe('BLOCKED');expect(assessment.unresolvedEffects).toHaveLength(64);expect(assessment.provenance).toContain('Unresolved effects: 65');
 expect(verificationPanelModel(store,'t1').label).toBe('BLOCKED');
 expect(store.all<ToolEffectRecord>('toolEffect','t1')).toHaveLength(65);
});
