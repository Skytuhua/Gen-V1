import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, lstatSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage/store';
import {verificationPanelModel} from '../packages/core/verification-read-models';
import {computeAssessment, SecurityFindingLedger} from '../packages/core/verification-gate';
import {sourceDigestSync} from '../packages/core/project-verification';
import type {CheckObservationV1, SecurityFindingV1, VerificationDeclarationV1, VisualObservationV1} from '../packages/contracts/verification';
import type {ToolEffectRecord, ToolOwner} from '../packages/contracts/tool-effects';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });
const owner: ToolOwner = {threadId: 't1', runId: 'r1', epoch: 1, projectId: 'p1', workspaceId: null, accountBinding: null};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'verification-panel-'));
  cleanup.push(() => rmSync(root, {recursive: true, force: true}));
  const store = new Store(join(root, 'state'));
  cleanup.push(() => store.close());
  writeFileSync(join(root, 'app.ts'), 'export const version = 1;\n');
  writeFileSync(join(root, 'lock.yaml'), 'version: 1\n');
  const stamp = new Date().toISOString();
  const info = lstatSync(root, {bigint: true});
  store.internal('test.project', 't1', () => {
    store.put('workspaceProject', 'p1', null, {id: 'p1', name: 'Project', rootPath: root, authority: {kind: 'local'}, createdAt: stamp});
    store.put('workspaceProjectRoot', 'p1', null, {path: root, identity: {dev: String(info.dev), ino: String(info.ino)}});
    store.put('thread', 't1', 't1', {id: 't1', title: 'T', projectName: 'Project', projectId: 'p1', kind: 'main', createdAt: stamp, updatedAt: stamp, status: 'ready', modelId: 'test/model', sessionPath: null, runId: null, epoch: 1});
  });
  const declaration: VerificationDeclarationV1 = {version: 1, rootPath: root, sourceFiles: ['app.ts'], dependencyFiles: ['lock.yaml'], environmentId: 'test-host/node/pnpm', requirements: [{id: 'tests-pass', checkRefs: ['exec-1']}]};
  const observation: CheckObservationV1 = {version: 1, checkId: 'check-1', executionId: 'exec-1', owner, codeDigest: sourceDigestSync(root, declaration.sourceFiles), dependencyDigest: sourceDigestSync(root, declaration.dependencyFiles), recipeDigest: 'a'.repeat(64), environmentId: declaration.environmentId, argv: ['node', 'test.js'], cwdIdentity: root, phase: 'TEST', startedAt: stamp, endedAt: stamp, exitCode: 0, outcome: 'PASS', artifactRefs: [], observationKind: 'process'};
  const save = (observations = [observation], declared = true) => {
    const assessment = computeAssessment({threadId: 't1', sourceCut: {headSha: null, codeDigest: observation.codeDigest, dependencyDigest: observation.dependencyDigest, environmentId: declaration.environmentId}, requirements: declaration.requirements, observations, unresolvedEffects: [], verifierIdentity: 'service/r1', provenance: 'test fixture'});
    store.internal('test.fixture', 't1', () => {
      if (declared) store.put('verificationDeclaration', 't1', 't1', declaration);
      for (const value of observations) store.put('checkObservation', value.checkId, 't1', value);
      store.put('assessment', assessment.assessmentId, 't1', assessment);
    });
    return assessment;
  };
  return {root, store, declaration, observation, stamp, save};
}

it('projects source-bound advisory findings without granting completion and preserves stale source history',()=>{
  const f=fixture(),ledger=new SecurityFindingLedger(f.store);
  f.store.internal('fixture.declaration','t1',()=>f.store.put('verificationDeclaration','t1','t1',f.declaration));
  const finding:Omit<SecurityFindingV1,'updatedAt'>={version:1,findingId:'security-1',source:{path:'app.ts',blobSha:'a'.repeat(40),line:1},authorizedScope:'Read-only review of the approved source files. No external testing.',observation:'<script>untrusted advisory text</script>',impact:'Reported concern requires confirmation.',status:'OPEN',reproduction:'Inspect the approved source location.',createdAt:f.stamp,evidenceQuality:'ADVISORY',provenance:{owner,executionId:f.observation.executionId,codeDigest:f.observation.codeDigest,dependencyDigest:f.observation.dependencyDigest}};
  ledger.record(finding,'t1');
  expect(verificationPanelModel(f.store,'t1')).toMatchObject({label:null,summary:{verified:0},securityFindings:{truncated:false,invalid:0,items:[{findingId:'security-1',evidenceQuality:'ADVISORY',freshness:'CURRENT',scopeAuthority:'HOST_RECORDED',source:finding.source}]}});
  writeFileSync(join(f.root,'app.ts'),'changed after advisory review');
  expect(verificationPanelModel(f.store,'t1')).toMatchObject({label:null,securityFindings:{items:[{evidenceQuality:'ADVISORY',freshness:'STALE'}]}});
  expect(ledger.all('t1')[0]!.observation).toBe(finding.observation);
});

it('marks legacy and foreign-owner findings unverified and reports bounded or invalid history',()=>{
  const f=fixture(),ledger=new SecurityFindingLedger(f.store);
  const finding={version:1 as const,findingId:'legacy',source:{path:'app.ts',blobSha:'b'.repeat(40),line:null},authorizedScope:'Historical reported scope',observation:'Historical report',impact:'Not independently tested',status:'OPEN' as const,reproduction:null,createdAt:f.stamp};
  ledger.record(finding,'t1');
  ledger.record({...finding,findingId:'foreign',evidenceQuality:'EXECUTED',provenance:{owner:{...owner,accountBinding:'other-account'},executionId:'foreign-execution',codeDigest:f.observation.codeDigest,dependencyDigest:f.observation.dependencyDigest}},'t1');
  expect(verificationPanelModel(f.store,'t1')).toMatchObject({label:null,securityFindings:{items:[{evidenceQuality:'UNVERIFIED',freshness:'INDETERMINATE',scopeAuthority:'UNVERIFIED'},{evidenceQuality:'UNVERIFIED',freshness:'INDETERMINATE',scopeAuthority:'UNVERIFIED'}]}});
  f.store.internal('fixture.finding-bound','t1',()=>{for(let i=0;i<51;i++)f.store.put('securityFinding','bound-'+i,'t1',{...finding,findingId:'bound-'+i,updatedAt:f.stamp});f.store.put('securityFinding','invalid','t1',{...finding,observation:'x'.repeat(2001)});});
  const model=verificationPanelModel(f.store,'t1') as unknown as {securityFindings:{items:unknown[];truncated:boolean;invalid:number}};
  expect(model.securityFindings.items.length).toBeLessThanOrEqual(50);expect(model.securityFindings).toMatchObject({truncated:true,invalid:1});
});

it('shows every check from a bound execution under its actual requirement', () => {
  const f = fixture();
  f.save([{...f.observation, checkId: 'failed-build', phase: 'BUILD', outcome: 'FAIL', exitCode: 1}, {...f.observation, checkId: 'passed-cleanup', phase: 'TEARDOWN'}]);
  const model = verificationPanelModel(f.store, 't1');
  expect(model.rows.filter(row => row.requirement === 'tests-pass').map(row => row.checkId)).toEqual(['failed-build', 'passed-cleanup']);
  expect(model.rows.filter(row => row.requirement === '—')).toEqual([]);
  expect(model.label).toBe('FAILED');
});

it('retains the recorded outcome while reporting changed source freshness separately', () => {
  const f = fixture(); f.save();
  writeFileSync(join(f.root, 'app.ts'), 'export const version = 2;\n');
  const model = verificationPanelModel(f.store, 't1');
  expect(model.label).toBe('COMPLETED_UNVERIFIED');
  expect(model.rows[0]).toMatchObject({outcome: 'PASS', freshness: 'STALE'});
  expect(f.store.get<CheckObservationV1>('checkObservation', 'check-1')?.outcome).toBe('PASS');
});

it('does not infer current source freshness from a historical assessment without a declaration', () => {
  const f = fixture(); const saved = f.save(undefined, false);
  expect(saved.label).toBe('VERIFIED');
  const model = verificationPanelModel(f.store, 't1');
  expect(model.label).toBe('COMPLETED_UNVERIFIED');
  expect(model.rows[0]).toMatchObject({outcome: 'PASS', freshness: 'INDETERMINATE'});
  expect(model.summary.verified).toBe(0);
  expect(f.store.get<typeof saved>('assessment', saved.assessmentId)?.label).toBe('VERIFIED');
});

it('keeps an unavailable live source unverified even when a historical digest equals the fallback value', () => {
  const f = fixture();
  f.observation.codeDigest = f.observation.dependencyDigest = '0'.repeat(64);
  f.save(); rmSync(join(f.root, 'app.ts'));
  const model = verificationPanelModel(f.store, 't1');
  expect(model.label).toBe('COMPLETED_UNVERIFIED');
  expect(model.summary.verified).toBe(0);
  expect(model.rows[0].freshness).toBe('INDETERMINATE');
});

it('recomputes unresolved external effects instead of trusting the earlier completion snapshot', () => {
  const f = fixture(); f.save();
  const effect: ToolEffectRecord = {effectId: 'effect-1', invocationId: 'effect-1', attemptId: 1, parentInvocationId: null, owner, toolId: 'external_write', definitionDigest: 'definition', privateArgumentCommitment: 'arguments', publicRedactedSummary: 'Write is not settled', targetPreconditions: [], approvalId: null, state: 'UNKNOWN_EXTERNAL_OUTCOME', providerReceiptRef: null, createdAt: f.stamp, updatedAt: f.stamp, threadId: 't1', transitions: [{from: 'DISPATCHED', to: 'UNKNOWN_EXTERNAL_OUTCOME', at: f.stamp}]};
  f.store.internal('test.effect', 't1', () => f.store.put('toolEffect', effect.invocationId, 't1', effect));
  expect(verificationPanelModel(f.store, 't1').label).toBe('BLOCKED');
  f.store.internal('test.effect', 't1', () => f.store.put('toolEffect', effect.invocationId, 't1', {...effect, state: 'SUCCEEDED'}));
  expect(verificationPanelModel(f.store, 't1').label).toBe('VERIFIED');
});

it('shows a missing reference even when another reference already has an observation', () => {
  const f = fixture(); f.declaration.requirements[0].checkRefs.push('missing-check'); f.save();
  const model = verificationPanelModel(f.store, 't1');
  expect(model.rows.some(row => row.requirement === 'tests-pass' && row.checkId === null && row.missing.some(value => value.includes('missing-check')))).toBe(true);
});

it('does not duplicate a check when both its check and execution are bound', () => {
  const f = fixture(); f.declaration.requirements[0].checkRefs.push('check-1'); f.save();
  expect(verificationPanelModel(f.store, 't1').rows.filter(row => row.checkId === 'check-1')).toHaveLength(1);
});

it('retains exact execution details for bound and unbound observations without joining arguments', () => {
  const f = fixture();
  f.observation.argv = ['node', 'checks/with spaces.mjs', '', 'a b', '"quoted"', 'line\nbreak', 'tail'.repeat(80)];
  f.observation.cwdIdentity = '/physical/workspace with spaces/dev=5/ino=39';
  f.observation.detail = 'Bounded recorded process detail.';
  f.save([f.observation, {...f.observation, checkId: 'unbound-check', executionId: 'unbound-execution'}]);
  const model = verificationPanelModel(f.store, 't1');
  expect(model.rows).toHaveLength(2);
  for (const row of model.rows) expect(row.details).toEqual({
    argv: f.observation.argv, cwdIdentity: f.observation.cwdIdentity, codeDigest: f.observation.codeDigest,
    dependencyDigest: f.observation.dependencyDigest, recipeDigest: f.observation.recipeDigest,
    environmentId: f.observation.environmentId, startedAt: f.observation.startedAt, endedAt: f.observation.endedAt,
    exitCode: 0, observationKind: 'process', detail: f.observation.detail, visual: null,
  });
});

it('projects browser assertion details by their fields even when the observation kind is browser', () => {
  const f = fixture();
  const visual = {checklistItemId: 'button-save', actionTraceId: 'trace-save', origin: 'http://127.0.0.1:4100', viewport: {width: 390, height: 844}, assertion: 'The save state is visible.', observed: 'The save state is hidden.', screenshotDigest: null};
  const observation: VisualObservationV1 = {...f.observation, observationKind: 'browser', phase: 'BROWSER', outcome: 'FAIL', exitCode: null, ...visual};
  f.save([]);
  f.store.internal('test.visual', 't1', () => f.store.put('visualObservation', observation.checkId, 't1', observation));
  const model = verificationPanelModel(f.store, 't1');
  expect(model.rows[0].details).toMatchObject({observationKind: 'browser', exitCode: null, detail: null, visual});
  expect(model.rows[0]).toMatchObject({outcome: 'FAIL', freshness: 'CURRENT'});
});
