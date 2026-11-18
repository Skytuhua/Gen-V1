import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourceLockV3 } from '../packages/contracts/implementation-evidence.ts';
import { verifySourceLock } from '../scripts/research-baseline.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function repository(label: string) {
  const root = mkdtempSync(join(tmpdir(), 'm01-ancestry-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init');
  git('config', 'user.name', 'Source lock fixture');
  git('config', 'user.email', 'source-lock@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(join(root, 'source.txt'), `audit ${label}\n`);
  git('add', '--', 'source.txt');
  git('commit', '-m', 'Audit source');
  const audit = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'source.txt'), `execution ${label}\n`);
  git('add', '--', 'source.txt');
  git('commit', '-m', 'Execution source');
  const execution = git('rev-parse', 'HEAD');
  const lock: SourceLockV3 = {
    schemaVersion: 3,
    auditAncestorSha: audit,
    executionBaseSha: execution,
    inspectedPaths: [{ path: 'source.txt', blobSha: git('rev-parse', `${execution}:source.txt`) }],
    publicContracts: [],
    acceptedDependencyCommits: [audit],
    approvedDrift: [],
  };
  return { root, git, audit, execution, lock };
}

describe('M01 source-lock audit ancestry', () => {
  it('accepts the recorded audit ancestor with exact execution-source blobs', () => {
    const value = repository('accepted ancestor');
    expect(verifySourceLock(value.root, value.lock)).toEqual([]);
  });

  it('accepts an audit cut equal to the execution base', () => {
    const value = repository('same cut');
    expect(verifySourceLock(value.root, { ...value.lock, auditAncestorSha: value.execution })).toEqual([]);
  });

  it('rejects a missing audit commit even when inspected execution blobs match', () => {
    const value = repository('missing audit');
    const issues = verifySourceLock(value.root, { ...value.lock, auditAncestorSha: '0'.repeat(40) });
    expect(issues.map(issue => issue.code)).toContain('AUDIT_NOT_ANCESTOR');
  });

  it('rejects an audit commit that exists only in another repository', () => {
    const value = repository('execution repository');
    const foreign = repository('foreign audit repository');
    expect(() => value.git('cat-file', '-e', `${foreign.audit}^{commit}`)).toThrow();
    const issues = verifySourceLock(value.root, { ...value.lock, auditAncestorSha: foreign.audit });
    expect(issues.map(issue => issue.code)).toContain('AUDIT_NOT_ANCESTOR');
  });

  it('rejects a present orphan audit commit with identical source bytes', () => {
    const value = repository('orphan audit');
    const tree = value.git('rev-parse', `${value.execution}^{tree}`);
    const orphan = value.git('commit-tree', tree, '-m', 'Disconnected audit history');
    expect(value.git('cat-file', '-t', orphan)).toBe('commit');
    expect(value.git('rev-parse', `${orphan}:source.txt`)).toBe(value.lock.inspectedPaths[0]!.blobSha);
    const issues = verifySourceLock(value.root, { ...value.lock, auditAncestorSha: orphan });
    expect(issues.map(issue => issue.code)).toContain('AUDIT_NOT_ANCESTOR');
  });

  it('rejects a later audit commit that is not an ancestor of the execution base', () => {
    const value = repository('future audit');
    value.git('commit', '--allow-empty', '-m', 'Later audit');
    const later = value.git('rev-parse', 'HEAD');
    expect(value.git('rev-parse', `${later}:source.txt`)).toBe(value.lock.inspectedPaths[0]!.blobSha);
    const issues = verifySourceLock(value.root, { ...value.lock, auditAncestorSha: later });
    expect(issues.map(issue => issue.code)).toContain('AUDIT_NOT_ANCESTOR');
  });
});
