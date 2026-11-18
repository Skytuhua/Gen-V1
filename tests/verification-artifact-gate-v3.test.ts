import {afterEach, describe, expect, it, vi} from 'vitest';
import {lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {crc32, deflateSync} from 'node:zlib';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import {sourceDigestSync} from '../packages/core/project-verification.ts';
import {computeAssessment, type AssessmentInput} from '../packages/core/verification-gate.ts';
import {attestVerificationArtifacts, VerificationArtifactStore, VERIFICATION_ARTIFACT_LIMITS} from '../packages/core/verification-artifacts.ts';
import {verificationPanelModel} from '../packages/core/verification-read-models.ts';
import type {RuntimeAdapter, Thread} from '../packages/contracts/index.ts';
import type {DeliverableAssessmentV1, VerificationDeclarationV1, VisualObservationV1} from '../packages/contracts/verification.ts';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs(); __setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);});
function png() {
  const chunk = (type: string, data: Buffer) => {const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;};
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(5))), chunk('IEND', Buffer.alloc(0))]);
}
function fixture() {
  vi.stubEnv('HARNESS_FLAG_VERIFICATION_WORKFLOW_V1', '1'); __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  const directory = mkdtempSync(join(tmpdir(), 'verification-artifact-gate-')), root = join(directory, 'project'); mkdirSync(root); writeFileSync(join(root, 'app.ts'), 'export const ready = true;\n');
  const store = new Store(join(directory, 'state'));
  const runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime, {});
  cleanups.push(async () => {await service.dispose(); store.close(); rmSync(directory, {recursive: true, force: true});});
  const stamp = new Date().toISOString(), ctx = {threadId: 'artifact-task', runId: 'run-1', epoch: 1};
  const thread: Thread = {id: ctx.threadId, title: 'Artifact task', projectName: 'Project', projectId: 'p1', kind: 'main', mode: 'build', status: 'working', createdAt: stamp, updatedAt: stamp, modelId: null, sessionPath: null, runId: ctx.runId, epoch: ctx.epoch};
  const owner = {...ctx, projectId: 'p1', workspaceId: null, accountBinding: null}, executionId = 'observed-execution', physical = lstatSync(root, {bigint: true});
  store.internal('fixture.owner', thread.id, () => {store.put('thread', thread.id, thread.id, thread); store.put('workspaceProject', 'p1', null, {id: 'p1', name: 'Project', rootPath: root, authority: {kind: 'local'}, createdAt: stamp}); store.put('workspaceProjectRoot', 'p1', null, {path: root, identity: {dev: String(physical.dev), ino: String(physical.ino)}});});
  const artifacts = new VerificationArtifactStore(store), viewport = {width: 1, height: 1};
  const retained = artifacts.write({owner, executionId, kind: 'SCREENSHOT', bytes: png(), viewport});
  const declaration: VerificationDeclarationV1 = {version: 1, rootPath: root, sourceFiles: ['app.ts'], dependencyFiles: [], environmentId: 'fixture-environment', requirements: [{id: 'app-ready', checkRefs: ['assert-ready']}]};
  const observed: VisualObservationV1 = {version: 1, checkId: 'assert-ready', executionId, owner, codeDigest: sourceDigestSync(root, ['app.ts']), dependencyDigest: sourceDigestSync(root, []), recipeDigest: 'a'.repeat(64), environmentId: declaration.environmentId, argv: [], cwdIdentity: root, phase: 'BROWSER', startedAt: stamp, endedAt: stamp, exitCode: 0, outcome: 'PASS', artifactRefs: [retained.ref], observationKind: 'browser', checklistItemId: 'ready', actionTraceId: 'ready-trace', origin: 'http://127.0.0.1:3000', viewport, assertion: 'Ready control is visible', observed: 'Ready control is visible', screenshotDigest: retained.sha256};
  const input: AssessmentInput = {threadId: thread.id, sourceCut: {headSha: null, codeDigest: observed.codeDigest, dependencyDigest: observed.dependencyDigest, environmentId: observed.environmentId}, requirements: declaration.requirements, observations: [observed], unresolvedEffects: [], verifierIdentity: 'fixture', provenance: 'Host artifact custody fixture, not native execution proof'};
  const saved = computeAssessment(input);
  store.internal('fixture.evidence', thread.id, () => {store.put('verificationDeclaration', thread.id, thread.id, declaration); store.put('visualObservation', observed.checkId, thread.id, observed); store.put('assessment', saved.assessmentId, thread.id, saved);});
  const path = join(store.dataDir, 'artifacts', 'verification-v1', retained.ref.slice('verification-artifact:'.length) + '.bin');
  const finish = async () => {await service.tool({name: 'task_finish', args: {outcome: 'done'}}, ctx); return store.all<DeliverableAssessmentV1>('assessment', thread.id).at(-1)!;};
  return {store, service, thread, input, observed, artifacts, retained, path, finish};
}

describe('current artifact custody in the verification gate', () => {
  it('accepts an executed assertion only with actual host-attested matching screenshot bytes', () => {
    const f = fixture();
    expect(computeAssessment(f.input).label).toBe('BLOCKED');
    expect(computeAssessment({...f.input, artifactAttestations: f.artifacts.attest(f.observed)}).label).toBe('VERIFIED');
    expect(computeAssessment({...f.input, observations: [{...f.observed, observationKind: 'visual'}], artifactAttestations: f.artifacts.attest(f.observed)}).label).toBe('COMPLETED_UNVERIFIED');
  });

  it.each(['executionId', 'threadId', 'runId', 'epoch', 'projectId', 'workspaceId', 'accountBinding', 'sha256', 'ref'] as const)('rejects an attestation with another %s', field => {
    const f = fixture(), attestation = f.artifacts.attest(f.observed)[0];
    const changed = field === 'executionId' || field === 'sha256' || field === 'ref' ? {...attestation, [field]: 'foreign'} : {...attestation, owner: {...attestation.owner, [field]: field === 'epoch' ? 99 : 'foreign'}};
    expect(computeAssessment({...f.input, artifactAttestations: [changed]}).label).toBe('BLOCKED');
  });

  it('requires retained custody of referenced process logs as well as screenshots', () => {
    const f = fixture(), log = f.artifacts.write({owner: f.observed.owner, executionId: f.observed.executionId, kind: 'LOG', bytes: Buffer.from('Observed build output')});
    const process = {version: f.observed.version, checkId: f.observed.checkId, executionId: f.observed.executionId, owner: f.observed.owner, codeDigest: f.observed.codeDigest, dependencyDigest: f.observed.dependencyDigest, recipeDigest: f.observed.recipeDigest, environmentId: f.observed.environmentId, argv: ['node', 'check.mjs'], cwdIdentity: 'project', phase: 'TEST' as const, startedAt: f.observed.startedAt, endedAt: f.observed.endedAt, exitCode: 0, outcome: 'PASS' as const, artifactRefs: [log.ref], observationKind: 'process' as const};
    expect(computeAssessment({...f.input, observations: [process]}).label).toBe('BLOCKED');
    expect(computeAssessment({...f.input, observations: [process], artifactAttestations: f.artifacts.attest(process)}).label).toBe('VERIFIED');
  });

  it('accepts an executed browser assertion with retained log evidence and no required screenshot', () => {
    const f = fixture(), log = f.artifacts.write({owner: f.observed.owner, executionId: f.observed.executionId, kind: 'LOG', bytes: Buffer.from('Browser assertion output')});
    const assertion = {...f.observed, screenshotDigest: null, artifactRefs: [log.ref]};
    expect(computeAssessment({...f.input, observations: [assertion], artifactAttestations: f.artifacts.attest(assertion)}).label).toBe('VERIFIED');
    expect(computeAssessment({...f.input, observations: [assertion]}).label).toBe('BLOCKED');
    const foreign = f.artifacts.attest(assertion).map(value => ({...value, executionId: 'foreign-execution'}));
    expect(computeAssessment({...f.input, observations: [assertion], artifactAttestations: foreign}).label).toBe('BLOCKED');
  });

  it.each(['deleted', 'changed'] as const)('loses current verification in every production projection when screenshot bytes are %s', async change => {
    const f = fixture();
    expect(verificationPanelModel(f.store, f.thread.id).label).toBe('VERIFIED');
    expect((await f.service.sourceWorkbench.evidence(f.thread.id)).items.find(item => item.id === 'requirement:app-ready')).toMatchObject({grade: 'VERIFIED', outcome: 'VERIFIED'});
    if (change === 'deleted') rmSync(f.path); else writeFileSync(f.path, Buffer.from('changed screenshot'));
    expect(verificationPanelModel(f.store, f.thread.id).label).toBe('BLOCKED');
    expect((await f.service.sourceWorkbench.evidence(f.thread.id)).items.find(item => item.id === 'requirement:app-ready')).toMatchObject({grade: 'REPORTED', outcome: 'BLOCKED'});
    expect((await f.finish()).label).toBe('BLOCKED');
    expect(f.store.get('visualObservation', f.observed.checkId)).toEqual(f.observed);
  });

  it('feeds intact authorized custody to task_finish', async () => {
    const f = fixture(); expect((await f.finish()).label).toBe('VERIFIED');
  });

  it('classifies retained opaque captures from host metadata and preserves their historical type after deletion', async () => {
    const f = fixture();
    const check = async () => (await f.service.sourceWorkbench.evidence(f.thread.id)).items.find(item => item.id === f.observed.checkId);
    expect(await check()).toMatchObject({screenshotRefs: [f.retained.ref], logRefs: []});
    rmSync(f.path);
    expect(await check()).toMatchObject({screenshotRefs: [f.retained.ref], logRefs: [], grade: 'OBSERVED'});
  });

  it('reads a shared required capture once and never opens unrelated historical artifacts', () => {
    const f = fixture(), other = f.artifacts.write({owner: f.observed.owner, executionId: 'unrelated-execution', kind: 'LOG', bytes: Buffer.from('Unrelated history')});
    const read = vi.spyOn(VerificationArtifactStore.prototype, 'read');
    const attestations = attestVerificationArtifacts(f.store, [f.observed, {...f.observed, checkId: 'capture-sibling', observationKind: 'visual'}, {...f.observed, checkId: 'unrelated-check', executionId: 'unrelated-execution', artifactRefs: [other.ref]}], f.input.requirements);
    expect(attestations).toHaveLength(1); expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(f.retained.ref, f.observed.owner, f.observed.executionId);
  });

  it('checks the cumulative attestation byte budget before reading an artifact', () => {
    const f = fixture(), read = vi.spyOn(f.artifacts, 'read');
    expect(f.artifacts.attest(f.observed, {remainingBytes: f.retained.byteLength - 1, remainingArtifacts: 1})).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it('bounds the full current artifact read cut and leaves omitted required artifacts blocked', () => {
    const f = fixture(), observations = [];
    for (let index = 0; index <= VERIFICATION_ARTIFACT_LIMITS.assessmentCount; index++) {
      const executionId = `budget-execution-${Math.floor(index / 50)}`;
      const log = f.artifacts.write({owner: f.observed.owner, executionId, kind: 'LOG', bytes: Buffer.alloc(0)});
      observations.push({...f.observed, checkId: `budget-check-${index}`, executionId, phase: 'TEST' as const, observationKind: 'process' as const, screenshotDigest: null, artifactRefs: [log.ref]});
    }
    const requirements = [{id: 'all-bounded-logs', checkRefs: [...new Set(observations.map(observation => observation.executionId))]}];
    const attestations = attestVerificationArtifacts(f.store, observations, requirements);
    expect(attestations).toHaveLength(VERIFICATION_ARTIFACT_LIMITS.assessmentCount);
    expect(computeAssessment({...f.input, observations, requirements, artifactAttestations: attestations}).label).toBe('BLOCKED');
  });
});
