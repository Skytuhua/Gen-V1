import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessError } from '../packages/contracts/index.ts';
import { CODE_REVIEW_LIMITS, type CodeReviewComparison, type ComparisonFile, type LocalComparisonIdentity } from '../packages/contracts/code-review.ts';
import {
  ComparisonSnapshots,
  PullComparisonSchema,
  RemoteComparisonSchema,
  comparisonError,
  comparisonResult,
  normalizeChecks,
  readLocalComparison,
  readLocalComparisonFile,
  remotePatch,
  reviewHash,
  type LocalReviewContext,
} from '../packages/workspace/code-review.ts';

const localIdentity: LocalComparisonIdentity = {
  kind: 'local', id: 'id-1', scope: 'worktree', headOid: 'a'.repeat(40), branch: 'main',
  revision: 'rev-1', base: { kind: 'index', revision: 'idx' }, head: { kind: 'worktree', revision: 'rev-1' },
};
const comparisonFile = (over: Partial<ComparisonFile> = {}): ComparisonFile => ({
  path: 'file.ts', status: 'M ', untracked: false, additions: 2, deletions: 1, ...over,
});
const comparison = (over: Partial<CodeReviewComparison> = {}): CodeReviewComparison => ({
  identity: localIdentity, files: [comparisonFile()], filesTruncated: false, checks: [],
  observedAt: '2026-01-01T00:00:00Z', access: { mode: 'managed', untrackedIncluded: true }, ...over,
});

describe('reviewHash', () => {
  it('is deterministic, hex-shaped and input-order sensitive', () => {
    expect(reviewHash(['a', 'b'])).toBe(reviewHash(['a', 'b']));
    expect(reviewHash(['a', 'b'])).toMatch(/^[0-9a-f]{64}$/);
    expect(reviewHash(['a', 'b'])).not.toBe(reviewHash(['b', 'a']));
  });
});

describe('comparisonError and comparisonResult', () => {
  it('maps a HarnessError code and never leaks the underlying message', () => {
    const read = comparisonError(new HarnessError('REVISION_CHANGED', 'secret internal detail'));
    expect(read).toEqual({ state: 'error', error: { code: 'REVISION_CHANGED', message: 'The comparison could not be read. Refresh or sign in and retry.' } });
    expect(comparisonError(new Error('secret internal detail'))).toEqual({ state: 'error', error: { code: 'COMPARISON_UNAVAILABLE', message: 'The comparison could not be read. Refresh or sign in and retry.' } });
  });
  it('reports ready only when files exist or the file list was truncated', () => {
    expect(comparisonResult(comparison()).state).toBe('ready');
    expect(comparisonResult(comparison({ files: [], filesTruncated: true })).state).toBe('ready');
    expect(comparisonResult(comparison({ files: [] })).state).toBe('empty');
  });
});

describe('ComparisonSnapshots', () => {
  it('round-trips snapshots by owner and rejects other owners or unknown ids', () => {
    const snapshots = new ComparisonSnapshots(), value = comparison();
    snapshots.save('owner-a', value);
    expect(snapshots.get('owner-a', value.identity.id).value).toEqual(value);
    expect(() => snapshots.get('owner-b', value.identity.id)).toThrowError(expect.objectContaining({ code: 'COMPARISON_EXPIRED' }));
    expect(() => snapshots.get('owner-a', 'missing')).toThrowError(expect.objectContaining({ code: 'COMPARISON_EXPIRED' }));
  });
  it('evicts the oldest entry past the limit and keeps a refreshed entry newest', () => {
    const snapshots = new ComparisonSnapshots();
    const values = Array.from({ length: CODE_REVIEW_LIMITS.snapshots }, (_, index) =>
      comparison({ identity: { ...localIdentity, id: 'snap-' + index } }));
    for (const value of values) snapshots.save('o', value);
    snapshots.save('o', values[0]); // refresh first entry back to newest
    snapshots.save('o', comparison({ identity: { ...localIdentity, id: 'snap-new' } }));
    expect(snapshots.get('o', 'snap-0').value.identity.id).toBe('snap-0');
    expect(() => snapshots.get('o', 'snap-1')).toThrowError(expect.objectContaining({ code: 'COMPARISON_EXPIRED' }));
    expect(snapshots.get('o', 'snap-new').value.identity.id).toBe('snap-new');
  });
  it('deep-copies on save and get so callers cannot mutate stored state', () => {
    const snapshots = new ComparisonSnapshots(), value = comparison();
    snapshots.save('o', value);
    value.files.push(comparisonFile({ path: 'mutated.ts' }));
    const first = snapshots.get('o', value.identity.id);
    expect(first.value.files).toHaveLength(1);
    first.value.files.push(comparisonFile({ path: 'mutated.ts' }));
    expect(snapshots.get('o', value.identity.id).value.files).toHaveLength(1);
  });
});

describe('normalizeChecks', () => {
  it('returns an empty list for null input and unknown for unparseable rows', () => {
    expect(normalizeChecks(null)).toEqual([]);
    expect(normalizeChecks([42, { name: 'x'.repeat(2000) }, {}])).toEqual([
      { name: 'Unknown check', status: 'unknown' },
      { name: 'Unknown check', status: 'unknown' },
      { name: 'Unknown check', status: 'unknown' },
    ]);
  });
  it('prefers conclusion over state over status and maps each outcome class', () => {
    expect(normalizeChecks([{ name: 'a', conclusion: 'SUCCESS', state: 'FAILURE', status: 'QUEUED' }])).toEqual([{ name: 'a', status: 'passed' }]);
    expect(normalizeChecks([{ context: 'ctx', state: 'FAILURE' }])).toEqual([{ name: 'ctx', status: 'failed' }]);
    expect(normalizeChecks([{ name: 'n', status: 'IN_PROGRESS' }])).toEqual([{ name: 'n', status: 'pending' }]);
    for (const [state, expected] of [['EXPECTED', 'pending'], ['ERROR', 'failed'], ['TIMED_OUT', 'failed'], ['ACTION_REQUIRED', 'failed'], ['STARTUP_FAILURE', 'failed'], ['STALE', 'failed'], ['PENDING', 'pending'], ['QUEUED', 'pending'], ['WAITING', 'pending'], ['REQUESTED', 'pending'], ['PENDING_DEPLOYMENT', 'pending'], ['NEUTRAL', 'neutral'], ['SKIPPED', 'neutral'], ['WHATEVER', 'unknown'], ['success', 'unknown']] as const) {
      expect(normalizeChecks([{ name: 'c', conclusion: state }])).toEqual([{ name: 'c', status: expected }]);
    }
  });
});

describe('remotePatch', () => {
  const patchText = '@@ -1,2 +1,3 @@\n context\n-removed\n+added1\n+added2\n';
  it('returns unavailable for omitted patches and truncated for oversized text', () => {
    expect(remotePatch(localIdentity, comparisonFile())).toMatchObject({ state: 'unavailable', text: null, reason: 'patch-omitted' });
    const big = '+' + 'x'.repeat(CODE_REVIEW_LIMITS.patchBytes);
    expect(remotePatch(localIdentity, comparisonFile(), big)).toMatchObject({ state: 'truncated', reason: 'resource-limit' });
  });
  it('accepts a well-formed patch and an empty one', () => {
    expect(remotePatch(localIdentity, comparisonFile(), patchText)).toMatchObject({ state: 'text', text: patchText });
    expect(remotePatch(localIdentity, comparisonFile({ additions: 0, deletions: 0 }), '')).toMatchObject({ state: 'empty', text: '' });
  });
  it('balances multiple hunks including additions-only and deletion-only sections', () => {
    const text = '@@ -0,0 +1,2 @@\n+new1\n+new2\n@@ -10,1 +12,0 @@\n-gone\n';
    expect(remotePatch(localIdentity, comparisonFile({ additions: 2, deletions: 1 }), text)).toMatchObject({ state: 'text' });
  });
  it('tolerates the no-newline marker and rejects foreign or over-running lines', () => {
    const marked = '@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file';
    expect(remotePatch(localIdentity, comparisonFile({ additions: 1, deletions: 1 }), marked)).toMatchObject({ state: 'text' });
    const extra = '@@ -1 +1,2 @@\n same\n+extra\n+over\n';
    expect(remotePatch(localIdentity, comparisonFile({ additions: 2, deletions: 0 }), extra)).toMatchObject({ state: 'truncated', reason: 'patch-omitted' });
    const foreign = '@@ -1 +1 @@\nforeign\n';
    expect(remotePatch(localIdentity, comparisonFile({ additions: 0, deletions: 0 }), foreign)).toMatchObject({ state: 'truncated' });
  });
  it('rejects a new hunk before the previous one balanced and count mismatches', () => {
    const early = '@@ -1,2 +1,2 @@\n-a\n@@ -5,1 +5,1 @@\n+b\n';
    expect(remotePatch(localIdentity, comparisonFile({ additions: 1, deletions: 1 }), early)).toMatchObject({ state: 'truncated', reason: 'patch-omitted' });
    const mismatch = '@@ -1,1 +1,1 @@\n-a\n+b\n';
    expect(remotePatch(localIdentity, comparisonFile({ additions: 5, deletions: 1 }), mismatch)).toMatchObject({ state: 'truncated' });
    expect(remotePatch(localIdentity, comparisonFile({ additions: null, deletions: null }), mismatch)).toMatchObject({ state: 'truncated' });
  });
});

describe('comparison schemas', () => {
  const oid = 'a'.repeat(40);
  it('accepts a valid pull comparison and rejects bad oids, nonpositive numbers and missing rollup', () => {
    const row = { id: 'x', number: 7, title: 't', url: 'u', baseRefOid: oid, headRefOid: oid, baseRefName: 'main', headRefName: 'f', statusCheckRollup: null };
    expect(PullComparisonSchema.parse(row).number).toBe(7);
    expect(PullComparisonSchema.safeParse({ ...row, baseRefOid: 'abc' }).success).toBe(false);
    expect(PullComparisonSchema.safeParse({ ...row, number: 0 }).success).toBe(false);
    expect(PullComparisonSchema.safeParse({ ...row, statusCheckRollup: undefined }).success).toBe(false);
    expect(PullComparisonSchema.safeParse({ ...row, statusCheckRollup: [{}] }).success).toBe(true);
  });
  it('accepts a valid remote comparison and enforces the remote file bound', () => {
    const file = { sha: oid, filename: 'f.ts', status: 'modified', additions: 1, deletions: 0 };
    const base = { base_commit: { sha: oid }, merge_base_commit: { sha: oid } };
    expect(RemoteComparisonSchema.parse({ ...base, files: [file] }).files).toHaveLength(1);
    expect(RemoteComparisonSchema.safeParse({ ...base, files: Array(CODE_REVIEW_LIMITS.remoteFiles + 1).fill(file) }).success).toBe(false);
    expect(RemoteComparisonSchema.safeParse({ ...base, files: [{ ...file, additions: -1 }] }).success).toBe(false);
  });
});

describe('readLocalComparison', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-code-review-'));
  const signal = new AbortController().signal;
  const context = (statusRaw: string, overrides: Partial<LocalReviewContext> = {}): LocalReviewContext => ({
    git: async (args: string[]) => {
      const key = args.join(' ');
      if (key === 'rev-parse HEAD') return 'a'.repeat(40) + '\n';
      if (key === 'branch --show-current') return 'main\n';
      if (key === 'ls-files --stage -z') return 'index-state';
      if (key.startsWith('status --porcelain=v1 -z')) return statusRaw;
      throw new Error('unexpected git call: ' + key);
    },
    path: root, managed: true, signal, owner: 'owner-1', ...overrides,
  });

  it('builds deterministic staged and worktree identities for an empty working copy', async () => {
    const staged = await readLocalComparison(context(''), 'staged');
    expect(staged.files).toEqual([]);
    expect(staged.identity).toMatchObject({ kind: 'local', scope: 'staged', headOid: 'a'.repeat(40), branch: 'main', base: { kind: 'commit' }, head: { kind: 'index' } });
    const worktree = await readLocalComparison(context(''), 'worktree');
    expect(worktree.identity).toMatchObject({ scope: 'worktree', base: { kind: 'index' }, head: { kind: 'worktree' } });
    expect(worktree.identity.id).toMatch(/^[0-9a-f]{64}$/);
    expect(worktree.access).toEqual({ mode: 'managed', untrackedIncluded: true });
    const again = await readLocalComparison(context(''), 'worktree');
    expect(again.identity.id).toBe(worktree.identity.id);
  });

  it('keeps deleted entries in scope without touching file content and marks unsupported files', async () => {
    mkdirSync(join(root, 'real-dir.ts'), { recursive: true });
    const value = await readLocalComparison(context(' D deleted.ts\0D  staged-delete.ts\0 M real-dir.ts\0'), 'worktree');
    const paths = value.files.map((file) => [file.path, file.status]);
    expect(paths).toEqual([['deleted.ts', ' D'], ['real-dir.ts', ' M']]);
    expect(value.files[1].patchUnavailable).toBe('unsupported-file');
    const staged = await readLocalComparison(context(' D deleted.ts\0D  staged-delete.ts\0'), 'staged');
    expect(staged.files.map((file) => file.path)).toEqual(['staged-delete.ts']);
  });

  it('fails closed when consecutive snapshots disagree', async () => {
    let calls = 0;
    const ctx = context('');
    ctx.git = async (args: string[]) => {
      const key = args.join(' ');
      if (key === 'rev-parse HEAD') return 'a'.repeat(40);
      if (key === 'branch --show-current') return 'main';
      if (key === 'ls-files --stage -z') return 'index-state';
      if (key.startsWith('status --porcelain=v1 -z')) return ++calls >= 2 ? ' D late.ts\0' : '';
      throw new Error('unexpected');
    };
    await expect(readLocalComparison(ctx, 'worktree')).rejects.toMatchObject({ code: 'REVISION_CHANGED' });
  });

  it('reads a deleted file patch through injected git without touching the file', async () => {
    const ctx = context(' D deleted.ts\0');
    const value = await readLocalComparison(ctx, 'worktree');
    const diff = '@@ -1,1 +0,0 @@\n-gone\n';
    ctx.git = async (args: string[]) => {
      const key = args.join(' ');
      if (key === 'rev-parse HEAD') return 'a'.repeat(40);
      if (key === 'branch --show-current') return 'main';
      if (key === 'ls-files --stage -z') return 'index-state';
      if (key.startsWith('status --porcelain=v1 -z')) return ' D deleted.ts\0';
      if (key.startsWith('diff --numstat -z')) return '0\t1\tdeleted.ts\0';
      if (key.startsWith('diff --full-index')) return diff;
      throw new Error('unexpected git call: ' + key);
    };
    const patch = await readLocalComparisonFile(ctx, value, 'deleted.ts');
    expect(patch).toMatchObject({ state: 'text', text: diff });
    await expect(readLocalComparisonFile(ctx, value, 'other.ts')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports binary and unavailable states for deleted files', async () => {
    const ctx = context(' D blob.bin\0 D gone\\path.ts\0');
    const value = await readLocalComparison(ctx, 'worktree');
    ctx.git = async (args: string[]) => {
      const key = args.join(' ');
      if (key === 'rev-parse HEAD') return 'a'.repeat(40);
      if (key === 'branch --show-current') return 'main';
      if (key === 'ls-files --stage -z') return 'index-state';
      if (key.startsWith('status --porcelain=v1 -z')) return ' D blob.bin\0 D gone\\path.ts\0';
      if (key.startsWith('diff --numstat -z')) return '-\t-\tblob.bin\0';
      if (key.startsWith('diff --full-index')) return 'binary diff';
      throw new Error('unexpected: ' + key);
    };
    expect(await readLocalComparisonFile(ctx, value, 'blob.bin')).toMatchObject({ state: 'binary' });
    expect(await readLocalComparisonFile(ctx, value, 'gone\\path.ts')).toMatchObject({ state: 'unavailable', reason: 'unsupported-path' });
  });

  it('rejects non-local identities and stale comparisons before reading', async () => {
    const ctx = context(' D deleted.ts\0');
    const value = await readLocalComparison(ctx, 'worktree');
    const remote = { ...value, identity: { kind: 'pull-request' as const, id: 'x', repo: 'r', number: 1, pullRequestId: 'p', baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), mergeBaseOid: 'c'.repeat(40), baseRef: 'm', headRef: 'h', semantics: 'merge-base' as const } };
    await expect(readLocalComparisonFile(ctx, remote, 'deleted.ts')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(readLocalComparisonFile({ ...ctx, owner: 'other-owner' }, value, 'deleted.ts')).rejects.toMatchObject({ code: 'REVISION_CHANGED' });
  });
});
