import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store';
import {admitQaSpawn,createQaWorkerRole,BoundedRepairLoop,SecurityFindingLedger} from '../packages/core/verification-gate';
import {digest} from '../packages/storage/store';
import {HarnessError} from '../packages/contracts/index';
const code=(fn:()=>unknown):string=>{try{fn();}catch(e){return (e as HarnessError).code;}return 'NO_THROW';};

import type {ToolOwner} from '../packages/contracts/tool-effects';

const stores:Store[]=[];
function stateStore(){const store=new Store(join(tempDir('verify-state-'),'state'));stores.push(store);return store;}
const dirs:string[]=[];
function tempDir(prefix:string){const dir=mkdtempSync(join(tmpdir(),prefix));dirs.push(dir);return dir;}
afterEach(()=>{for(const store of stores.splice(0))store.close();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const owner:ToolOwner={threadId:'t1',runId:'r1',epoch:1,projectId:null,workspaceId:null,accountBinding:null};
const commitment=digest({kind:'qa.delegate',checklist:'cl-1'});
const liveApproval={actionCommitment:commitment,remainingUses:1,expiresAt:new Date(Date.now()+900_000).toISOString()};
const spawn=(over:Record<string,unknown>={})=>({threadId:'t1',approvalId:'ap-1',...over});

it('the QA worker holds no shell, browser or write tool — only verification and read context',()=>{
 const role=createQaWorkerRole(owner);
 expect(role.kind).toBe('qa-v1');
 expect(role.describe().tools).toEqual([]);
 expect(role.allows('verification.run')).toBe(true);
 expect(role.allows('verification.observe')).toBe(true);
 expect(role.allows('context.read')).toBe(true);
 for(const denied of ['shell.exec','browser.launch','fs.write','ui_present','task_delegate','operation_execute']) expect(role.allows(denied)).toBe(false);
});

it('QA spawn requires an exact approval, rejects recursive spawn and cancelled requests before any worker exists',()=>{
 expect(code(()=>admitQaSpawn(spawn(),null,commitment,owner))).toBe('APPROVAL_REQUIRED');
 expect(code(()=>admitQaSpawn(spawn(),{...liveApproval,actionCommitment:'other'},commitment,owner))).toBe('APPROVAL_REQUIRED');
 expect(code(()=>admitQaSpawn(spawn(),{...liveApproval,remainingUses:0},commitment,owner))).toBe('APPROVAL_REQUIRED');
 expect(code(()=>admitQaSpawn(spawn(),{...liveApproval,expiresAt:new Date(Date.now()-1000).toISOString()},commitment,owner))).toBe('APPROVAL_REQUIRED');
 expect(code(()=>admitQaSpawn(spawn({parentIsQa:true}),liveApproval,commitment,owner))).toBe('CAPABILITY_DENIED');
 expect(code(()=>admitQaSpawn(spawn({cancelled:true}),liveApproval,commitment,owner))).toBe('CANCELLED_RUN');
 const role=admitQaSpawn(spawn(),liveApproval,commitment,owner);
 expect(role.owner.threadId).toBe('t1');
});

it('bounded repair enforces one recipe, the same requirements and at most three attempts',()=>{
 const store=stateStore();
 const loop=new BoundedRepairLoop(store,owner,'recipe-1',['req-a','req-b']);
 expect(loop.nextDecision().allowed).toBe(true);
 loop.recordAttempt({requirementIds:['req-a','req-b'],failures:[{checkId:'c1',outcome:'FAIL',detail:'x'}],outcome:'FAIL'});
 loop.recordAttempt({requirementIds:['req-a','req-b'],failures:[{checkId:'c1',outcome:'FAIL',detail:'y'}],outcome:'FAIL'});
 loop.recordAttempt({requirementIds:['req-a','req-b'],failures:[{checkId:'c1',outcome:'FAIL',detail:'z'}],outcome:'FAIL'});
 expect(code(()=>loop.recordAttempt({requirementIds:['req-a','req-b'],failures:[],outcome:'PASS'}))).toBe('REPAIR_BUDGET');
 expect(loop.stopped).toBe('BUDGET');
});

it('an unchanged failure digest twice stops repair before the budget',()=>{
 const store=stateStore();
 const loop=new BoundedRepairLoop(store,owner,'recipe-1',['req-a']);
 const failure=[{checkId:'c1',outcome:'FAIL',detail:'same failure'}];
 loop.recordAttempt({requirementIds:['req-a'],failures:failure,outcome:'FAIL'});
 loop.recordAttempt({requirementIds:['req-a'],failures:failure,outcome:'FAIL'});
 expect(loop.nextDecision()).toEqual({allowed:false,reason:'UNCHANGED_FAILURE'});
 expect(loop.stopped).toBe('UNCHANGED_FAILURE');
});

it('repair stops on revocation or conflicting evidence and a repair may verify',()=>{
 const store=stateStore();
 const revoked=new BoundedRepairLoop(store,{...owner,threadId:'t2'},'recipe-1',['req-a']);
 revoked.recordAttempt({requirementIds:['req-a'],failures:[],outcome:'FAIL',revoked:true});
 expect(revoked.stopped).toBe('REVOKED');
 const conflict=new BoundedRepairLoop(store,{...owner,threadId:'t3'},'recipe-1',['req-a']);
 conflict.recordAttempt({requirementIds:['req-a'],failures:[],outcome:'FAIL',conflict:true});
 expect(conflict.stopped).toBe('CONFLICT');
 const fixed=new BoundedRepairLoop(store,{...owner,threadId:'t4'},'recipe-1',['req-a']);
 fixed.recordAttempt({requirementIds:['req-a'],failures:[{checkId:'c1',outcome:'FAIL'}],outcome:'FAIL'});
 fixed.recordAttempt({requirementIds:['req-a'],failures:[],outcome:'PASS'});
 expect(fixed.stopped).toBe('VERIFIED');
 expect(fixed.attempts).toHaveLength(2);
});

it('a repair attempt must keep the same requirement IDs — scope drift is rejected',()=>{
 const store=stateStore();
 const loop=new BoundedRepairLoop(store,owner,'recipe-1',['req-a']);
 loop.recordAttempt({requirementIds:['req-a'],failures:[{checkId:'c1',outcome:'FAIL'}],outcome:'FAIL'});
 expect(code(()=>loop.recordAttempt({requirementIds:['req-a','req-b'],failures:[],outcome:'PASS'}))).toBe('REPAIR_SCOPE');
 expect(loop.stopped).toBeNull();
});

it('requirement IDs containing commas cannot collide with a different repair scope',()=>{
 const store=stateStore(),loop=new BoundedRepairLoop(store,owner,'recipe-1',['req,a','b']);
 expect(code(()=>loop.recordAttempt({requirementIds:['req','a,b'],failures:[],outcome:'PASS'}))).toBe('REPAIR_SCOPE');
 expect(loop.attempts).toEqual([]);
});

it('reopening a repair rejects a different requirement scope',()=>{
 const store=stateStore();new BoundedRepairLoop(store,owner,'recipe-1',['req-a']);
 expect(code(()=>new BoundedRepairLoop(store,owner,'recipe-1',['req-b']))).toBe('REPAIR_SCOPE');
});

it('a cancelled attempt stops repair before another attempt can run',()=>{
 const loop=new BoundedRepairLoop(stateStore(),owner,'recipe-1',['req-a']);
 loop.recordAttempt({requirementIds:['req-a'],failures:[],outcome:'CANCELLED'});
 expect(loop.nextDecision()).toEqual({allowed:false,reason:'CANCELLED'});
 expect(code(()=>loop.recordAttempt({requirementIds:['req-a'],failures:[],outcome:'PASS'}))).toBe('REPAIR_BUDGET');
});

it('overlapping repair controllers retain every attempt and share the three-attempt budget',()=>{
 const store=stateStore(),first=new BoundedRepairLoop(store,owner,'recipe-1',['req-a']),second=new BoundedRepairLoop(store,owner,'recipe-1',['req-a']);
 first.recordAttempt({requirementIds:['req-a'],failures:[{checkId:'c1',outcome:'FAIL',detail:'first'}],outcome:'FAIL'});
 second.recordAttempt({requirementIds:['req-a'],failures:[{checkId:'c1',outcome:'FAIL',detail:'second'}],outcome:'FAIL'});
 first.recordAttempt({requirementIds:['req-a'],failures:[{checkId:'c1',outcome:'FAIL',detail:'third'}],outcome:'FAIL'});
 expect(second.nextDecision()).toEqual({allowed:false,reason:'BUDGET'});
 expect(second.attempts.map(attempt=>attempt.attempt)).toEqual([1,2,3]);
});

it('security findings dedupe by source plus identity and keep evidence fields',()=>{
 const store=stateStore();
 const ledger=new SecurityFindingLedger(store);
 const base={version:1 as const,findingId:'f-1',source:{path:'src/app.ts',blobSha:'a'.repeat(40),line:12},authorizedScope:'workspace t1',observation:'eval of unsanitized input',impact:'remote code execution',status:'OPEN' as const,reproduction:'send payload',createdAt:new Date().toISOString()};
 ledger.record(base,'t1');
 const again=ledger.record({...base,impact:'remote code execution (updated)'},'t1');
 expect(again.findingId).toBe('f-1');
 expect(ledger.all('t1')).toHaveLength(1); // same source + identity merged, not duplicated
 const other=ledger.record({...base,findingId:'f-2'},'t1');
 expect(ledger.all('t1')).toHaveLength(2);
 expect(other.source.blobSha).toBe('a'.repeat(40));
});

it('identical security findings in different threads keep their original owners and observations',()=>{
 const ledger=new SecurityFindingLedger(stateStore());
 const finding={version:1 as const,findingId:'shared-finding',source:{path:'src/app.ts',blobSha:'b'.repeat(40),line:4},authorizedScope:'first workspace',observation:'first observed behavior',impact:'reported impact',status:'OPEN' as const,reproduction:null,createdAt:'2026-01-01T00:00:00.000Z'};
 ledger.record(finding,'first');ledger.record({...finding,authorizedScope:'second workspace',observation:'second observed behavior'},'second');
 expect(ledger.all('first')).toHaveLength(1);expect(ledger.all('first')[0]!.observation).toBe('first observed behavior');
 expect(ledger.all('second')).toHaveLength(1);expect(ledger.all('second')[0]!.observation).toBe('second observed behavior');
});

it('updates only the owning thread legacy finding without duplicating it or changing its creation time',()=>{
 const store=stateStore(),ledger=new SecurityFindingLedger(store);
 const finding={version:1 as const,findingId:'legacy-finding',source:{path:'src/app.ts',blobSha:'c'.repeat(40),line:8},authorizedScope:'original scope',observation:'original behavior',impact:'reported impact',status:'OPEN' as const,reproduction:null,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};
 const legacyId=`finding-${digest({source:finding.source,findingId:finding.findingId}).slice(0,24)}`;
 store.internal('fixture.legacy-finding','first',()=>store.put('securityFinding',legacyId,'first',finding));
 ledger.record({...finding,observation:'other thread'},'second');
 const updated=ledger.record({...finding,createdAt:'2026-02-01T00:00:00.000Z',observation:'updated original'},'first');
 expect(updated.createdAt).toBe(finding.createdAt);expect(ledger.all('first')).toHaveLength(1);
 expect(ledger.all('first')[0]!.observation).toBe('updated original');expect(ledger.all('second')[0]!.observation).toBe('other thread');
});

it('does not combine host-stamped findings from different logical owners of the same thread',()=>{
 const ledger=new SecurityFindingLedger(stateStore()),stamp='2026-01-01T00:00:00.000Z';
 const finding={version:1 as const,findingId:'same-source',source:{path:'src/app.ts',blobSha:'d'.repeat(40),line:1},authorizedScope:'Read-only approved source',observation:'First account advisory',impact:'Reported concern',status:'OPEN' as const,reproduction:null,createdAt:stamp,evidenceQuality:'ADVISORY' as const,provenance:{owner,executionId:'execution-1',codeDigest:'e'.repeat(64),dependencyDigest:'f'.repeat(64)}};
 ledger.record(finding,owner.threadId);
 ledger.record({...finding,observation:'Other account advisory',provenance:{...finding.provenance,owner:{...owner,accountBinding:'other-account'}}},owner.threadId);
 expect(ledger.all(owner.threadId)).toHaveLength(2);
 expect(()=>ledger.record({...finding,provenance:{...finding.provenance,owner:{...owner,threadId:'foreign-thread'}}},owner.threadId)).toThrow(/owner|thread/i);
});
