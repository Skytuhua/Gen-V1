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
