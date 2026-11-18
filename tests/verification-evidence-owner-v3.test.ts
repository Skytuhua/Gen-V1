import {afterEach, expect, it, vi} from 'vitest';
import {lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage/store';
import {Service} from '../packages/core/service';
import {sourceDigestSync} from '../packages/core/project-verification';
import {computeAssessment} from '../packages/core/verification-gate';
import {verificationPanelModel} from '../packages/core/verification-read-models';
import type {RuntimeAdapter, Thread} from '../packages/contracts';
import type {CheckObservationV1, DeliverableAssessmentV1, VerificationDeclarationV1} from '../packages/contracts/verification';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {for (const dispose of cleanup.splice(0).reverse()) await dispose(); vi.unstubAllEnvs();});
const ctx = {threadId: 't1', runId: 'current-run', epoch: 2};
function fixture() {
  vi.stubEnv('HARNESS_FLAG_VERIFICATION_WORKFLOW_V1', '1');
  const directory = mkdtempSync(join(tmpdir(), 'verification-evidence-owner-'));
  cleanup.push(() => rmSync(directory, {recursive: true, force: true}));
  const root = join(directory, 'original'), replacement = join(directory, 'replacement');
  for (const path of [root, replacement]) {mkdirSync(path); writeFileSync(join(path, 'app.ts'), 'export const ready = true;\n');}
  const store = new Store(join(directory, 'state')); cleanup.push(() => store.close());
  const runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime, {}); cleanup.push(() => service.dispose());
  const stamp = new Date().toISOString();
  const thread: Thread = {id: ctx.threadId, title: 'Verification', projectName: 'Project', projectId: 'p1', accountId: null, kind: 'main', mode: 'build', status: 'working', createdAt: stamp, updatedAt: stamp, modelId: 'test/model', sessionPath: null, runId: ctx.runId, epoch: ctx.epoch};
  const physical = (path: string) => {const stat = lstatSync(path, {bigint: true}); return {path, identity: {dev: String(stat.dev), ino: String(stat.ino)}};};
  const declaration: VerificationDeclarationV1 = {version: 1, rootPath: root, sourceFiles: ['app.ts'], dependencyFiles: [], environmentId: 'test/node/pnpm', requirements: [{id: 'app-works', checkRefs: ['execution-1']}]};
  const observation: CheckObservationV1 = {version: 1, checkId: 'check-1', executionId: 'execution-1', owner: {threadId: ctx.threadId, runId: 'previous-run', epoch: 1, projectId: 'p1', workspaceId: null, accountBinding: null}, codeDigest: sourceDigestSync(root, ['app.ts']), dependencyDigest: sourceDigestSync(root, []), recipeDigest: 'a'.repeat(64), environmentId: declaration.environmentId, argv: ['node', 'test.js'], cwdIdentity: root, phase: 'TEST', startedAt: stamp, endedAt: stamp, exitCode: 0, outcome: 'PASS', artifactRefs: [], observationKind: 'process'};
  const recorded = computeAssessment({threadId: ctx.threadId, sourceCut: {headSha: null, codeDigest: observation.codeDigest, dependencyDigest: observation.dependencyDigest, environmentId: observation.environmentId}, requirements: declaration.requirements, observations: [observation], unresolvedEffects: [], verifierIdentity: 'previous-run', provenance: 'fixture'});
  store.internal('test.fixture', ctx.threadId, () => {
    store.put('thread', thread.id, thread.id, thread);
    store.put('workspaceProject', 'p1', null, {id: 'p1', name: 'Project', rootPath: root, authority: {kind: 'local'}, createdAt: stamp});
    store.put('workspaceProjectRoot', 'p1', null, physical(root));
    store.put('verificationDeclaration', thread.id, thread.id, declaration);
    store.put('checkObservation', observation.checkId, thread.id, observation);
    store.put('assessment', recorded.assessmentId, thread.id, recorded);
  });
  const changeOwner = (kind: 'account' | 'project' | 'workspace') => store.internal('test.current-owner', thread.id, () => {
    if (kind === 'account') store.put('thread', thread.id, thread.id, {...thread, accountId: 'other-account'});
    else {
      if (kind === 'project') {
        store.put('workspaceProject', 'p2', null, {id: 'p2', name: 'Other project', rootPath: replacement, authority: {kind: 'local'}, createdAt: stamp});
        store.put('workspaceProjectRoot', 'p2', null, physical(replacement));
        store.put('thread', thread.id, thread.id, {...thread, projectId: 'p2'});
      } else {
        store.put('workspaceBinding', 'w2', thread.id, {id: 'w2', threadId: thread.id, projectId: 'p1', ...physical(replacement)});
        store.put('thread', thread.id, thread.id, {...thread, workspaceId: 'w2'});
      }
      store.put('verificationDeclaration', thread.id, thread.id, {...declaration, rootPath: replacement});
    }
  });
  const finish = async () => {
    await service.tool({name: 'task_finish', args: {outcome: 'done'}}, ctx);
    return store.all<DeliverableAssessmentV1>('assessment', thread.id).at(-1)!;
  };
  return {store, observation, changeOwner, finish};
}

it.each(['account', 'project', 'workspace'] as const)('does not grade an earlier %s owner as current in the live panel', kind => {
  const f = fixture();
  expect(verificationPanelModel(f.store, ctx.threadId).label).toBe('VERIFIED');
  f.changeOwner(kind);
  const model = verificationPanelModel(f.store, ctx.threadId);
  expect(model.label).toBe('COMPLETED_UNVERIFIED');
  expect(model.summary.verified).toBe(0);
  expect(model.rows.find(row => row.checkId === f.observation.checkId)).toMatchObject({outcome: 'PASS', freshness: 'INDETERMINATE'});
  expect(model.summary.missing).not.toEqual([]);
  expect(f.store.get('checkObservation', f.observation.checkId)).toEqual(f.observation);
});

it.each(['account', 'project', 'workspace'] as const)('does not verify an earlier %s owner at task_finish', async kind => {
  const f = fixture(); f.changeOwner(kind);
  expect((await f.finish()).label).toBe('COMPLETED_UNVERIFIED');
  expect(f.store.get('checkObservation', f.observation.checkId)).toEqual(f.observation);
});

it('reuses earlier run evidence when the durable owner still matches', async () => {
  const f = fixture();
  expect(verificationPanelModel(f.store, ctx.threadId).label).toBe('VERIFIED');
  expect((await f.finish()).label).toBe('VERIFIED');
});

it('keeps previous failures visible without lending them to another owner', () => {
  const f = fixture(), failure = {...f.observation, outcome: 'FAIL' as const, exitCode: 1};
  f.store.internal('test.failed', ctx.threadId, () => f.store.put('checkObservation', failure.checkId, ctx.threadId, failure));
  expect(verificationPanelModel(f.store, ctx.threadId).label).toBe('FAILED');
  f.changeOwner('account');
  const model = verificationPanelModel(f.store, ctx.threadId);
  expect(model.label).toBe('COMPLETED_UNVERIFIED');
  expect(model.rows.find(row => row.checkId === failure.checkId)).toMatchObject({outcome: 'FAIL', freshness: 'INDETERMINATE'});
  expect(f.store.get('checkObservation', failure.checkId)).toEqual(failure);
});
