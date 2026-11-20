import {describe, expect, it} from 'vitest';
import {
  verificationArtifactAttestationSchema,
  verificationArtifactRecordSchema,
  verificationArtifactRefSchema,
  verificationArtifactRootSchema,
} from '../packages/contracts/verification-artifacts.ts';

const REF = 'verification-artifact:3f2a9c41-8d4e-4a11-9b3c-0123456789ab';
const owner = {threadId: 't', runId: null, epoch: 1, projectId: null, workspaceId: null, accountBinding: null};
const identity = {device: '12', inode: '34567'};
const sha = 'a'.repeat(64);
const at = '2026-11-19T12:00:00.000Z';

const log = {
  version: 1, ref: REF, owner, executionId: 'exec-1', kind: 'LOG',
  mediaType: 'text/plain; charset=utf-8', sha256: sha, byteLength: 100,
  viewport: null, truncated: false, identity, createdAt: at,
};
const shot = {
  ...log, kind: 'SCREENSHOT', mediaType: 'image/png', byteLength: 2000,
  viewport: {width: 800, height: 600},
};

describe('verificationArtifactRefSchema', () => {
  it('accepts only version-4 variant identifiers in the reserved prefix', () => {
    expect(verificationArtifactRefSchema.safeParse(REF).success).toBe(true);
    for (const bad of [
      REF.replace('verification-artifact:', ''),
      REF.replace('4a11', '5a11'),
      REF.replace('9b3c', 'cb3c'),
      REF.replace('0123456789ab', '0123456789AB'),
      REF + '0',
      'verification-artifact:not-a-uuid',
      'x' + REF,
    ]) expect(verificationArtifactRefSchema.safeParse(bad).success).toBe(false);
  });
});

describe('verificationArtifactRootSchema', () => {
  it('accepts version 1 with numeric device/inode identities', () => {
    const root = {version: 1, storage: identity, artifacts: identity, namespace: identity};
    expect(verificationArtifactRootSchema.safeParse(root).success).toBe(true);
  });

  it('rejects other versions, non-numeric identities and extra keys', () => {
    for (const bad of [
      {version: 2, storage: identity, artifacts: identity, namespace: identity},
      {version: 1, storage: {device: 'dev0', inode: '1'}, artifacts: identity, namespace: identity},
      {version: 1, storage: identity, artifacts: identity, namespace: identity, extra: true},
      {version: 1, storage: identity, artifacts: identity},
    ]) expect(verificationArtifactRootSchema.safeParse(bad).success).toBe(false);
  });
});

describe('verificationArtifactRecordSchema', () => {
  it('accepts well-formed log and screenshot records', () => {
    expect(verificationArtifactRecordSchema.safeParse(log).success).toBe(true);
    expect(verificationArtifactRecordSchema.safeParse({...log, truncated: true}).success).toBe(true);
    expect(verificationArtifactRecordSchema.safeParse(shot).success).toBe(true);
  });

  it('enforces log media type, absent viewport and the 64 KiB bound', () => {
    for (const bad of [
      {...log, mediaType: 'image/png'},
      {...log, viewport: {width: 1, height: 1}},
      {...log, byteLength: 64 * 1024 + 1},
    ]) expect(verificationArtifactRecordSchema.safeParse(bad).success).toBe(false);
    expect(verificationArtifactRecordSchema.safeParse({...log, byteLength: 64 * 1024}).success).toBe(true);
  });

  it('enforces screenshot media type, viewport presence, no truncation and pixel bound', () => {
    for (const bad of [
      {...shot, mediaType: 'text/plain; charset=utf-8'},
      {...shot, viewport: null},
      {...shot, truncated: true},
      {...shot, viewport: {width: 8192, height: 8192}},
      {...shot, viewport: {width: 0, height: 10}},
      {...shot, viewport: {width: 4096, height: 4097}},
    ]) expect(verificationArtifactRecordSchema.safeParse(bad).success).toBe(false);
    expect(verificationArtifactRecordSchema.safeParse({...shot, viewport: {width: 4096, height: 4096}}).success).toBe(true);
  });

  it('rejects malformed hashes, oversized payloads and stray keys', () => {
    for (const bad of [
      {...log, sha256: 'z'.repeat(64)},
      {...log, sha256: 'a'.repeat(63)},
      {...log, byteLength: 8 * 1024 * 1024 + 1},
      {...log, byteLength: -1},
      {...log, executionId: ''},
      {...log, createdAt: 'not-a-date'},
      {...log, path: '/tmp/x.png'},
      {...log, identity: {device: 'd1', inode: '1'}},
    ]) expect(verificationArtifactRecordSchema.safeParse(bad).success).toBe(false);
  });
});

describe('verificationArtifactAttestationSchema', () => {
  it('accepts the attestable subset and rejects authority fields', () => {
    const attestation = {
      ref: REF, owner, executionId: 'exec-1', kind: 'SCREENSHOT', sha256: sha,
      byteLength: 100, viewport: {width: 10, height: 10},
    };
    expect(verificationArtifactAttestationSchema.safeParse(attestation).success).toBe(true);
    for (const bad of [
      {...attestation, truncated: false},
      {...attestation, identity},
      {...attestation, createdAt: at},
      {...attestation, mediaType: 'image/png'},
      {...attestation, ref: 'verification-artifact:bad'},
    ]) expect(verificationArtifactAttestationSchema.safeParse(bad).success).toBe(false);
  });
});
