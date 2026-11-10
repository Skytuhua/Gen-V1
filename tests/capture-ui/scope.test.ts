import { describe, expect, it, vi } from 'vitest';
import { discover, parseFilePaths, parseGitLog, type Run } from '../../scripts/capture-ui/scope';

vi.mock('node:child_process', () => ({ execFileSync: () => { throw Error('Unexpected real command'); } }));

const now = new Date('2026-11-09T16:30:00.000Z');
const merged = { number: 77, title: 'Update controls', mergedAt: '2026-11-08T12:00:00Z', files: [{ path: 'apps/web/src/App.tsx' }] };

function fakeRun(responses: Record<string, string | Error>) {
  const calls: { cmd: string; args: string[] }[] = [];
  const run: Run = (cmd, args) => {
    calls.push({ cmd, args });
    const response = responses[[cmd, ...args].join(' ')];
    if (response instanceof Error) throw response;
    if (response === undefined) throw Error(`Unexpected command: ${cmd} ${args.join(' ')}`);
    return response;
  };
  return { run, calls };
}

const ghCommand = 'gh pr list --state merged --base main --limit 1000 --search merged:>=2026-10-10 --json number,title,mergedAt,files';
const branchResponses = {
  'git rev-parse --abbrev-ref HEAD': 'work/ui-capture\n',
  'git diff --name-only -z origin/main...HEAD': 'apps/web/src/App.tsx\0docs/branch.md\0',
  'git diff --name-only -z': 'docs/branch.md\0docs/unstaged.md\0',
  'git diff --cached --name-only -z': 'docs/staged.md\0',
  'git ls-files --others --exclude-standard -z': 'docs/new file.md\0',
};

describe('scope parsers', () => {
  it('parses mixed merge, squash, and ordinary first-parent subjects', () => {
    expect(parseGitLog([
      'aaa\t2026-11-08T01:00:00Z\tMerge pull request #123 from org/feature',
      'bbb\t2026-11-08T02:00:00Z\tImprove controls (#124)',
      'ccc\t2026-11-08T03:00:00Z\tFollow up on issue #125',
      'malformed',
    ].join('\n'))).toEqual([
      { sha: 'aaa', number: 123, mergedAt: '2026-11-08T01:00:00Z', title: 'Merge pull request #123 from org/feature' },
      { sha: 'bbb', number: 124, mergedAt: '2026-11-08T02:00:00Z', title: 'Improve controls (#124)' },
      { sha: 'ccc', number: null, mergedAt: '2026-11-08T03:00:00Z', title: 'Follow up on issue #125' },
    ]);
  });

  it('parses empty, line-separated, and null-separated paths without stripping spaces', () => {
    expect(parseFilePaths('')).toEqual([]);
    expect(parseFilePaths('docs/a.md\r\ndocs/b.md\r\n')).toEqual(['docs/a.md', 'docs/b.md']);
    expect(parseFilePaths('docs/new file.md\0 docs/spaces.md \0')).toEqual(['docs/new file.md', ' docs/spaces.md ']);
  });
});

describe('scope discovery', () => {
  it('keeps gh PRs and always appends the current branch with all local file sources', () => {
    const { run } = fakeRun({ [ghCommand]: JSON.stringify([merged]), ...branchResponses });
    const scope = discover(30, run, now);
    expect(scope.source).toBe('gh');
    expect(scope.since).toBe('2026-10-10');
    expect(scope.warnings).toEqual([]);
    expect(scope.pulls.map(pull => pull.title)).toEqual(['Update controls', 'current branch work/ui-capture']);
    expect(scope.pulls[1]).toMatchObject({ number: null, mergedAt: now.toISOString() });
    expect(scope.pulls[1].files.map(file => file.path)).toEqual([
      'apps/web/src/App.tsx', 'docs/branch.md', 'docs/unstaged.md', 'docs/staged.md', 'docs/new file.md',
    ]);
  });

  it('walks every first-parent commit since UTC midnight and diffs each against its first parent', () => {
    const { run, calls } = fakeRun({
      [ghCommand]: Error('gh is unavailable'),
      'git log origin/main --first-parent --since-as-filter=2026-10-10T00:00:00Z --format=%H%x09%cI%x09%s': [
        'aaa\t2026-11-08T01:00:00Z\tMerge pull request #123 from org/feature',
        'bbb\t2026-11-08T02:00:00Z\tImprove controls (#124)',
        'ccc\t2026-11-08T03:00:00Z\tDirect maintenance commit',
      ].join('\n'),
      'git diff-tree --no-commit-id --name-only -z -r aaa^1 aaa': 'docs/merge.md\0',
      'git diff-tree --no-commit-id --name-only -z -r bbb^1 bbb': 'docs/squash.md\0',
      'git diff-tree --no-commit-id --name-only -z -r ccc^1 ccc': 'docs/direct.md\0',
      ...branchResponses,
    });
    const scope = discover(30, run, now);
    expect(scope.source).toBe('git');
    expect(scope.pulls.map(pull => pull.number)).toEqual([123, 124, null, null]);
    expect(scope.pulls.map(pull => pull.files[0]?.path)).toEqual([
      'docs/merge.md', 'docs/squash.md', 'docs/direct.md', 'apps/web/src/App.tsx',
    ]);
    expect(calls.find(call => call.args[0] === 'log')?.args).not.toContain('--merges');
    expect(scope.warnings).toEqual(['gh unavailable: gh is unavailable']);
  });

  it('includes the branch when history is empty', () => {
    const { run } = fakeRun({ [ghCommand]: '[]', ...branchResponses });
    expect(discover(30, run, now).pulls.map(pull => pull.title)).toEqual(['current branch work/ui-capture']);
  });

  it('keeps readable local files when the origin comparison fails', () => {
    const { run } = fakeRun({
      [ghCommand]: '[]', ...branchResponses,
      'git diff --name-only -z origin/main...HEAD': Error('unknown origin/main'),
    });
    const scope = discover(30, run, now);
    expect(scope.pulls[0].files.map(file => file.path)).toEqual([
      'docs/branch.md', 'docs/unstaged.md', 'docs/staged.md', 'docs/new file.md',
    ]);
    expect(scope.warnings.some(warning => warning.includes('unknown origin/main'))).toBe(true);
  });

  it('returns a branch placeholder and warnings when gh and git are missing', () => {
    const run: Run = cmd => { throw Error(`${cmd} ENOENT`); };
    const scope = discover(30, run, now);
    expect(scope.source).toBe('unavailable');
    expect(scope.pulls).toHaveLength(1);
    expect(scope.pulls[0]).toMatchObject({ title: 'current branch unknown', number: null, files: [] });
    expect(scope.warnings.some(warning => warning.includes('gh ENOENT'))).toBe(true);
    expect(scope.warnings.some(warning => warning.includes('git ENOENT'))).toBe(true);
  });
});
