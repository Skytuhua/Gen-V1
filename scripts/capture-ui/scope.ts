import { execFileSync } from 'node:child_process';
import { aggregate, type PullRequest } from './helpers';

export type Run = (cmd: string, args: string[]) => string;
type GitCommit = { sha: string; number: number | null; title: string; mergedAt: string };

const defaultRun: Run = (cmd, args) => execFileSync(cmd, args, {
  encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
});

export function parseFilePaths(output: string): string[] {
  return output.split(output.includes('\0') ? '\0' : /\r?\n/).filter(Boolean);
}

export function parseGitLog(output: string): GitCommit[] {
  return output.split(/\r?\n/).flatMap(line => {
    const [sha, mergedAt, ...subject] = line.split('\t');
    if (!sha || !mergedAt || !subject.length) return [];
    const title = subject.join('\t');
    const match = title.match(/^Merge pull request #(\d+)(?:\s|$)|\(#(\d+)\)\s*$/);
    return [{ sha, mergedAt, title, number: match ? Number(match[1] ?? match[2]) : null }];
  });
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0];
}

export function discover(days: number, run: Run = defaultRun, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const warnings: string[] = [];
  const readGit = (args: string[], context: string) => {
    try { return run('git', args); }
    catch (error) { throw Error(`${context}: ${message(error)}. Scope discovery requires complete git data; use --scope=baseline or --screens for a git-independent capture.`); }
  };
  let prs: PullRequest[] = [];
  let source: 'gh' | 'git' = 'gh';
  try {
    prs = JSON.parse(run('gh', ['pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '1000', '--search', `merged:>=${since}`, '--json', 'number,title,mergedAt,files'])) as PullRequest[];
    if (!Array.isArray(prs)) throw Error('Invalid gh PR response');
    if (prs.length === 1000) warnings.push('gh limit reached; scope may be truncated.');
    source = 'gh';
  } catch (error) {
    warnings.push(`gh unavailable: ${message(error)}`);
    prs = [];
    try {
      // Filter the full walk so an older-dated commit cannot hide later commits.
      const lines = readGit(['log', 'origin/main', '--first-parent', `--since-as-filter=${since}T00:00:00Z`, '--format=%H%x09%cI%x09%s'], 'git history unavailable');
      prs = parseGitLog(lines).map(({ sha, ...pr }) => ({
        ...pr,
        files: parseFilePaths(readGit(['diff-tree', '--no-commit-id', '--name-only', '-z', '-r', `${sha}^1`, sha], `git files unavailable for ${sha}`)).map(path => ({ path })),
      }));
      source = 'git';
    } catch (error) { throw Error(`gh discovery failed (${warnings[0]}); ${message(error)}`); }
  }

  const branch = readGit(['rev-parse', '--abbrev-ref', 'HEAD'], 'git branch unavailable').trim();
  if (!branch) throw Error('git branch unavailable: empty HEAD name');
  const branchFiles = [
    readGit(['diff', '--name-only', '-z', 'origin/main...HEAD'], 'git branch diff unavailable'),
    readGit(['diff', '--name-only', '-z'], 'git unstaged files unavailable'),
    readGit(['diff', '--cached', '--name-only', '-z'], 'git staged files unavailable'),
    readGit(['ls-files', '--others', '--exclude-standard', '-z'], 'git untracked files unavailable'),
  ].flatMap(parseFilePaths);
  prs.push({
    number: null, title: `current branch ${branch}`, mergedAt: now.toISOString(),
    files: [...new Set(branchFiles)].map(path => ({ path })),
  });
  return { ...aggregate(prs), source, since, warnings };
}

export function resolveScope(options: {scope: string; screens: readonly string[]; sinceDays: number}, run: Run = defaultRun, now = new Date()) {
  if (options.screens.length || options.scope === 'baseline') return {...aggregate([]), source: options.screens.length ? 'explicit-screens' : 'baseline', warnings: []};
  return discover(options.sinceDays, run, now);
}
