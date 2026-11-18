import {afterEach, describe, expect, it, vi} from 'vitest';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, linkSync, symlinkSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {crc32, deflateSync} from 'node:zlib';
import {Store} from '../packages/storage/store.ts';
import type {Thread} from '../packages/contracts/index.ts';
import type {ToolOwner} from '../packages/contracts/tool-effects.ts';
import type {CheckObservationV1} from '../packages/contracts/verification.ts';
import {assertNotStorage} from '../packages/core/security.ts';
import {VerificationArtifactStore, VERIFICATION_ARTIFACT_LIMITS} from '../packages/core/verification-artifacts.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup();});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'verification-artifacts-')), store = new Store(join(root, 'host'));
  cleanups.push(() => {store.close(); rmSync(root, {recursive: true, force: true});});
  const stamp = '2026-11-17T10:00:00.000Z';
  const thread: Thread = {id: 'artifact-thread', title: 'Verification', projectName: 'Project', projectId: 'project-a', workspaceId: 'workspace-a', accountId: 'account-a', createdAt: stamp, updatedAt: stamp, status: 'working', epoch: 2, runId: 'run-a', modelId: null, sessionPath: null};
  const owner: ToolOwner = {threadId: thread.id, projectId: 'project-a', workspaceId: 'workspace-a', accountBinding: 'account-a', runId: 'run-a', epoch: 2};
  store.internal('fixture.thread', thread.id, () => store.put('thread', thread.id, thread.id, thread));
  const artifacts = new VerificationArtifactStore(store), executionId = 'execution-a';
  const pathFor = (ref: string) => join(store.dataDir, 'artifacts', 'verification-v1', ref.replace('verification-artifact:', '') + '.bin');
  const log = (bytes = Buffer.from('Observed process output\n')) => artifacts.write({owner, executionId, kind: 'LOG', bytes});
  return {root, store, thread, owner, artifacts, executionId, pathFor, log};
}

function png(width = 320, height = 240, padding = 0, image?: {header?: Buffer; compressed?: Buffer; extraCritical?: boolean}) {
  function chunk(name: string, data: Buffer) {
    const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(name, 4, 'ascii'); data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4); return bytes;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', image?.header ?? header), ...(padding ? [chunk('tEXt', Buffer.alloc(padding, 97))] : []), ...(image?.extraCritical ? [chunk('TEST', Buffer.alloc(0))] : []), chunk('IDAT', image?.compressed ?? deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

function observation(f: ReturnType<typeof fixture>, ref: string): CheckObservationV1 {
  return {version: 1, checkId: 'observed-check', executionId: f.executionId, owner: f.owner, codeDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64), recipeDigest: 'c'.repeat(64), environmentId: 'observed-environment', argv: ['node', 'test'], cwdIdentity: 'workspace', phase: 'TEST', startedAt: f.thread.createdAt, endedAt: f.thread.createdAt, exitCode: 0, outcome: 'PASS', artifactRefs: [ref], observationKind: 'process'};
}

describe('host verification artifact custody', () => {
  it('writes exact private bytes behind an opaque reference and records the complete producing owner', () => {
    const f = fixture(), saved = f.log(), result = f.artifacts.read(saved.ref, f.owner, f.executionId);
    expect(saved.ref).toMatch(/^verification-artifact:[a-f0-9-]{36}$/);
    expect(saved).toMatchObject({version: 1, owner: f.owner, executionId: f.executionId, kind: 'LOG', mediaType: 'text/plain; charset=utf-8', byteLength: 24, truncated: false});
    expect(result.bytes.toString()).toBe('Observed process output\n');
    expect(f.store.get('verificationArtifact', saved.ref)).toMatchObject(saved);
    expect(saved).not.toHaveProperty('path'); expect(saved).not.toHaveProperty('rootPath');
    expect(() => assertNotStorage(f.pathFor(saved.ref), f.store.dataDir)).toThrow();
    if (process.platform !== 'win32') expect(statSync(f.pathFor(saved.ref)).mode & 0o077).toBe(0);
    expect(f.artifacts.attest(observation(f, saved.ref))).toEqual([expect.objectContaining({owner: f.owner, executionId: f.executionId, ref: saved.ref, sha256: saved.sha256, byteLength: saved.byteLength})]);
  });

  it('allows historical bytes to remain readable for the same durable owner but rejects a changed account', () => {
    const f = fixture(), saved = f.log();
    f.store.internal('fixture.next-run', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, runId: 'next-run', epoch: 3}));
    expect(f.artifacts.readForThread(f.thread.id, saved.ref).bytes.toString()).toContain('Observed');
    expect(() => f.log()).toThrow(/owner|run|revoked/i);
    f.store.internal('fixture.other-account', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, accountId: 'account-b'}));
    expect(() => f.artifacts.readForThread(f.thread.id, saved.ref)).toThrow();
    expect(f.artifacts.attest(observation(f, saved.ref))).toEqual([]);
  });

  it.each(['threadId', 'projectId', 'workspaceId', 'accountBinding', 'runId', 'epoch'] as const)('rejects a forged %s in an exact artifact owner', field => {
    const f = fixture(), saved = f.log(), owner = {...f.owner, [field]: field === 'epoch' ? 99 : 'foreign'};
    expect(() => f.artifacts.read(saved.ref, owner, f.executionId)).toThrow();
    expect(f.artifacts.attest({...observation(f, saved.ref), owner})).toEqual([]);
  });

  it('rejects raw paths, unknown references and a different producing execution', () => {
    const f = fixture(), saved = f.log(), outside = join(f.root, 'outside.txt'); writeFileSync(outside, 'private outside value');
    for (const ref of [outside, '../outside.txt', 'verification-artifact:../../outside.txt', 'verification-artifact:00000000-0000-4000-8000-000000000000']) expect(() => f.artifacts.read(ref, f.owner, f.executionId)).toThrow();
    expect(() => f.artifacts.read(saved.ref, f.owner, 'different-execution')).toThrow();
    expect(readFileSync(outside, 'utf8')).toBe('private outside value');
  });

  it.each(['deleted', 'changed', 'replaced', 'hardlinked'] as const)('loses attestation when the artifact is %s without changing historical metadata', change => {
    const f = fixture(), saved = f.log(), path = f.pathFor(saved.ref), before = f.store.get('verificationArtifact', saved.ref);
    if (change === 'deleted') rmSync(path);
    if (change === 'changed') writeFileSync(path, 'Changed process output\n');
    if (change === 'replaced') {renameSync(path, path + '.old'); writeFileSync(path, 'Observed process output\n', {mode: 0o600});}
    if (change === 'hardlinked') linkSync(path, join(f.root, 'outside-link'));
    expect(f.artifacts.attest(observation(f, saved.ref))).toEqual([]);
    expect(() => f.artifacts.read(saved.ref, f.owner, f.executionId)).toThrow();
    expect(f.store.get('verificationArtifact', saved.ref)).toEqual(before);
  });

  it.each(['replacement', 'junction'] as const)('rejects a %s of its private artifact directory', change => {
    const f = fixture(), saved = f.log(), directory = join(f.store.dataDir, 'artifacts', 'verification-v1');
    renameSync(directory, directory + '.retained');
    if (change === 'junction') symlinkSync(directory + '.retained', directory, 'junction');
    else {mkdirSync(directory, {mode: 0o700}); writeFileSync(f.pathFor(saved.ref), 'Observed process output\n', {mode: 0o600});}
    expect(f.artifacts.attest(observation(f, saved.ref))).toEqual([]);
    expect(() => f.log()).toThrow();
    expect(new VerificationArtifactStore(f.store).attest(observation(f, saved.ref))).toEqual([]);
  });

  it('does not create any directory through a replaced artifacts parent', () => {
    const f = fixture(), outside = join(f.root, 'outside'); mkdirSync(outside);
    symlinkSync(outside, join(f.store.dataDir, 'artifacts'), 'junction');
    expect(() => f.log()).toThrow();
    expect(existsSync(join(outside, 'verification-v1'))).toBe(false);
  });

  it('requires bounded UTF-8 logs and a PNG matching the declared viewport', () => {
    const f = fixture();
    expect(() => f.log(Buffer.alloc(VERIFICATION_ARTIFACT_LIMITS.logBytes + 1, 97))).toThrow();
    expect(() => f.log(Buffer.from([0xff]))).toThrow();
    expect(() => f.artifacts.write({owner: f.owner, executionId: f.executionId, kind: 'SCREENSHOT', bytes: Buffer.from('not an image'), viewport: {width: 320, height: 240}})).toThrow();
    expect(() => f.artifacts.write({owner: f.owner, executionId: f.executionId, kind: 'SCREENSHOT', bytes: png(), viewport: {width: 321, height: 240}})).toThrow();
    const saved = f.artifacts.write({owner: f.owner, executionId: f.executionId, kind: 'SCREENSHOT', bytes: png(), viewport: {width: 320, height: 240}});
    expect(saved).toMatchObject({kind: 'SCREENSHOT', mediaType: 'image/png', viewport: {width: 320, height: 240}});
  });

  it.each(['invalid-zlib', 'short-scanline', 'extra-decoded-bytes', 'invalid-filter', 'invalid-depth', 'invalid-color', 'unknown-critical', 'extra-compressed-bytes'] as const)('rejects a valid-CRC PNG with %s before publishing screenshot custody', kind => {
    const f = fixture(), header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    let compressed = deflateSync(Buffer.alloc(5));
    if (kind === 'invalid-zlib') compressed = Buffer.from('not a zlib stream');
    if (kind === 'short-scanline') compressed = deflateSync(Buffer.alloc(4));
    if (kind === 'extra-decoded-bytes') compressed = deflateSync(Buffer.alloc(1024 * 1024));
    if (kind === 'invalid-filter') compressed = deflateSync(Buffer.from([5, 0, 0, 0, 0]));
    if (kind === 'invalid-depth') header[8] = 7;
    if (kind === 'invalid-color') header[9] = 7;
    if (kind === 'extra-compressed-bytes') compressed = Buffer.concat([compressed, Buffer.from('trailing stream data')]);
    const bytes = png(1, 1, 0, {header, compressed, extraCritical: kind === 'unknown-critical'});
    expect(() => f.artifacts.write({owner: f.owner, executionId: f.executionId, kind: 'SCREENSHOT', bytes, viewport: {width: 1, height: 1}})).toThrow(/PNG|screenshot/i);
    expect(f.store.all('verificationArtifact', f.thread.id)).toEqual([]);
  });

  it('keeps artifact references bounded for each complete producing execution', () => {
    const f = fixture();
    for (let index = 0; index < VERIFICATION_ARTIFACT_LIMITS.executionCount; index++) f.log(Buffer.alloc(0));
    expect(() => f.log()).toThrow(/limit|budget/i);
    const other = new VerificationArtifactStore(f.store);
    expect(() => other.write({owner: f.owner, executionId: 'independent-execution', kind: 'LOG', bytes: Buffer.from('new execution')})).not.toThrow();
  });

  it('enforces the cumulative byte budget across all artifacts of an execution', () => {
    const f = fixture(), small = png(1, 1), bytes = png(1, 1, VERIFICATION_ARTIFACT_LIMITS.screenshotBytes - small.length - 12);
    expect(bytes.length).toBe(VERIFICATION_ARTIFACT_LIMITS.screenshotBytes);
    for (let index = 0; index < VERIFICATION_ARTIFACT_LIMITS.executionBytes / bytes.length; index++)
      f.artifacts.write({owner: f.owner, executionId: f.executionId, kind: 'SCREENSHOT', bytes, viewport: {width: 1, height: 1}});
    expect(() => f.log(Buffer.from('one byte beyond the execution budget'))).toThrow(/limit|budget/i);
  });

  it('does not publish an artifact when persistence fails', () => {
    const f = fixture(), put = f.store.put.bind(f.store), failure = new Error('artifact persistence failed');
    vi.spyOn(f.store, 'put').mockImplementation((kind, ...args) => {if (kind === 'verificationArtifact') throw failure; return put(kind, ...args);});
    expect(() => f.log()).toThrow(failure);
    expect(f.store.all('verificationArtifact', f.thread.id)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('rejects private artifact storage whose permissions were broadened', () => {
    const f = fixture(), saved = f.log(); chmodSync(join(f.store.dataDir, 'artifacts', 'verification-v1'), 0o755);
    expect(() => f.artifacts.read(saved.ref, f.owner, f.executionId)).toThrow();
    expect(() => f.log()).toThrow();
  });
});
