import {afterEach, expect, it, vi} from 'vitest';
import {lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage/store';
import {Service} from '../packages/core/service';
import {sourceDigestSync} from '../packages/core/project-verification';
import {computeAssessment} from '../packages/core/verification-gate';
import {verificationPanelModel} from '../packages/core/verification-read-models';
import type {RuntimeAdapter, Thread} from '../packages/contracts';
import type {CheckObservationV1, VerificationDeclarationV1} from '../packages/contracts/verification';

const cleanup: (() => void)[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dispose of cleanup.splice(0).reverse()) dispose(); });
const ctx = {threadId: 't1', runId: 'r1', epoch: 1};
function fixture() {
  vi.stubEnv('HARNESS_FLAG_VERIFICATION_WORKFLOW_V1', '1');
  const directory = mkdtempSync(join(tmpdir(), 'verification-authority-'));
  cleanup.push(() => rmSync(directory, {recursive: true, force: true}));
  const root = join(directory, 'project'), outside = join(directory, 'outside');
  for (const path of [root, outside]) { mkdirSync(path); writeFileSync(join(path, 'app.ts'), 'export const value = 1;\n'); }
  const store = new Store(join(directory, 'state')); cleanup.push(() => store.close());
  const runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime, {}), stamp = new Date().toISOString();
  const thread: Thread = {id: ctx.threadId, title: 'Verification', projectName: 'Project', projectId: 'p1', kind: 'main', mode: 'build', status: 'working', createdAt: stamp, updatedAt: stamp, modelId: 'test/model', sessionPath: null, runId: ctx.runId, epoch: ctx.epoch};
  const stat = lstatSync(root, {bigint: true});
  store.internal('test.fixture', ctx.threadId, () => {
    store.put('thread', ctx.threadId, ctx.threadId, thread);
    store.put('workspaceProject', 'p1', null, {id: 'p1', name: 'Project', rootPath: root, authority: {kind: 'local'}, createdAt: stamp});
    store.put('workspaceProjectRoot', 'p1', null, {path: root, identity: {dev: String(stat.dev), ino: String(stat.ino)}});
  });
  const declaration: VerificationDeclarationV1 = {version: 1, rootPath: root, sourceFiles: ['app.ts'], dependencyFiles: [], environmentId: 'test/node/pnpm', requirements: [{id: 'app-works', checkRefs: ['execution-1']}]};
  const {version: _version, ...argumentsForTool} = declaration;
  const declare = (rootPath = root) => service.tool({name: 'verification_declare', args: {...argumentsForTool, rootPath}}, ctx);
  const saveEvidence = (rootPath = root) => {
    const observation: CheckObservationV1 = {version: 1, checkId: 'check-1', executionId: 'execution-1', owner: {...ctx, projectId: 'p1', workspaceId: null, accountBinding: null}, codeDigest: sourceDigestSync(rootPath, ['app.ts']), dependencyDigest: sourceDigestSync(rootPath, []), recipeDigest: 'a'.repeat(64), environmentId: declaration.environmentId, argv: ['node', 'test.js'], cwdIdentity: rootPath, phase: 'TEST', startedAt: stamp, endedAt: stamp, exitCode: 0, outcome: 'PASS', artifactRefs: [], observationKind: 'process'};
    const assessment = computeAssessment({threadId: ctx.threadId, sourceCut: {headSha: null, codeDigest: observation.codeDigest, dependencyDigest: observation.dependencyDigest, environmentId: observation.environmentId}, requirements: declaration.requirements, observations: [observation], unresolvedEffects: [], verifierIdentity: 'fixture', provenance: 'fixture'});
    store.internal('test.evidence', ctx.threadId, () => {
      store.put('verificationDeclaration', ctx.threadId, ctx.threadId, {...declaration, rootPath});
      store.put('checkObservation', observation.checkId, ctx.threadId, observation);
      store.put('assessment', assessment.assessmentId, ctx.threadId, assessment);
    });
  };
  return {directory, root, outside, store, service, thread, declaration, declare, saveEvidence};
}

it('rejects a model-supplied root outside the current approved project', async () => {
  const f = fixture();
  await expect(f.declare(f.outside)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.get('verificationDeclaration', ctx.threadId)).toBeNull();
});

it('accepts the exact attested project root', async () => {
  const f = fixture(); await expect(f.declare()).resolves.toEqual({requirements: 1});
  f.saveEvidence(); expect(verificationPanelModel(f.store, ctx.threadId).label).toBe('VERIFIED');
});

it.each(['side', 'delegate'] as const)('does not lend the project root to a %s thread', async kind => {
  const f = fixture();
  f.store.internal('test.owner', ctx.threadId, () => f.store.put('thread', ctx.threadId, ctx.threadId, {...f.thread, kind}));
  await expect(f.declare()).rejects.toMatchObject({code: kind === 'delegate' ? 'AGENT_TOOL_DENIED' : 'CAPABILITY_DENIED'});
});

it('rejects a root whose physical directory was replaced', async () => {
  const f = fixture(); renameSync(f.root, join(f.directory, 'previous')); mkdirSync(f.root); writeFileSync(join(f.root, 'app.ts'), 'export const value = 1;\n');
  await expect(f.declare()).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('uses the current working copy rather than the project parent when a workspace is selected', async () => {
  const f = fixture(); const stat = lstatSync(f.outside, {bigint: true});
  f.store.internal('test.workspace', ctx.threadId, () => {
    f.store.put('thread', ctx.threadId, ctx.threadId, {...f.thread, workspaceId: 'w1'});
    f.store.put('workspaceBinding', 'w1', ctx.threadId, {id: 'w1', threadId: ctx.threadId, projectId: 'p1', path: f.outside, identity: {dev: String(stat.dev), ino: String(stat.ino)}});
  });
  await expect(f.declare(f.root)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  await expect(f.declare(f.outside)).resolves.toEqual({requirements: 1});
});

it('does not keep a saved result current after the project directory is replaced by equal bytes', () => {
  const f = fixture(); f.saveEvidence();
  renameSync(f.root, join(f.directory, 'previous')); mkdirSync(f.root); writeFileSync(join(f.root, 'app.ts'), 'export const value = 1;\n');
  const model = verificationPanelModel(f.store, ctx.threadId);
  expect(model.label).toBe('COMPLETED_UNVERIFIED');
  expect(model.rows[0].freshness).toBe('INDETERMINATE');
});

it('does not verify a legacy declaration for an unapproved root at completion', async () => {
  const f = fixture(); f.saveEvidence(f.outside);
  await f.service.tool({name: 'task_finish', args: {outcome: 'done'}}, ctx);
  expect(f.store.all<{label: string}>('assessment', ctx.threadId).at(-1)?.label).toBe('COMPLETED_UNVERIFIED');
});
