import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySourceLock } from '../scripts/research-baseline.ts';
import type { SourceLockV3 } from '../packages/contracts/implementation-evidence.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'source-lock-drift-')); roots.push(root);
  const hooks = join(root, 'empty-hooks'); mkdirSync(hooks);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  const commit = (text: string) => {
    writeFileSync(join(root, 'tracked.txt'), text); git('add', '--', 'tracked.txt'); git('commit', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD'); return { sha, blob: git('rev-parse', `${sha}:tracked.txt`) };
  };
  const original = commit('original\n'), approved = commit('reviewed change\n'), other = commit('unreviewed change\n');
  const lock: SourceLockV3 = {
    schemaVersion: 3, auditAncestorSha: original.sha, executionBaseSha: other.sha,
    inspectedPaths: [{ path: 'tracked.txt', blobSha: original.blob }], publicContracts: [], acceptedDependencyCommits: [],
    approvedDrift: [{ path: 'tracked.txt', fromBlob: original.blob, toBlob: approved.blob, note: 'Only the reviewed bytes are approved' }],
  };
  return { root, git, lock, original, approved, other };
}
const codes = (root: string, lock: SourceLockV3) => verifySourceLock(root, lock).map(issue => issue.code);

describe('source-lock exact approved drift target', () => {
  it('rejects an unreviewed third blob rather than calling it approved drift', () => {
    const x = fixture();
    assert.deepEqual(codes(x.root, x.lock), ['SOURCE_DRIFT']);
  });
  it('does not label a deleted inspected path as an approved change', () => {
    const x = fixture(); x.git('rm', '--', 'tracked.txt'); x.git('commit', '-m', 'delete fixture');
    assert.deepEqual(codes(x.root, { ...x.lock, executionBaseSha: x.git('rev-parse', 'HEAD') }), ['SOURCE_DRIFT']);
  });
  it('requires the approved destination blob to be the actual object at the base', () => {
    const x = fixture();
    const approvedDrift = [{ ...x.lock.approvedDrift[0]!, toBlob: '0'.repeat(40) }];
    assert.deepEqual(codes(x.root, { ...x.lock, approvedDrift }), ['SOURCE_DRIFT']);
  });
  it('continues to identify exactly matching approved drift', () => {
    const x = fixture();
    assert.deepEqual(codes(x.root, { ...x.lock, executionBaseSha: x.approved.sha }), ['APPROVED_DRIFT_PRESENT']);
  });
  it('keeps the unchanged inspected blob clean', () => {
    const x = fixture();
    assert.deepEqual(codes(x.root, { ...x.lock, executionBaseSha: x.original.sha }), []);
  });
  it('does not accept approval for a different original blob', () => {
    const x = fixture();
    const approvedDrift = [{ ...x.lock.approvedDrift[0]!, fromBlob: x.other.blob }];
    assert.deepEqual(codes(x.root, { ...x.lock, executionBaseSha: x.approved.sha, approvedDrift }), ['SOURCE_DRIFT']);
  });
  it('keeps unapproved changes unapproved when no drift record exists', () => {
    const x = fixture();
    assert.deepEqual(codes(x.root, { ...x.lock, approvedDrift: [] }), ['SOURCE_DRIFT']);
  });
});
