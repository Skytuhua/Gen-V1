import { execFileSync } from 'node:child_process';
import { aggregate, type PullRequest } from './helpers';
export function discover(days: number) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const warnings: string[] = [];
  try {
    const prs = JSON.parse(run('gh', ['pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '1000', '--search', `merged:>=${since}`, '--json', 'number,title,mergedAt,files'])) as PullRequest[];
    if (prs.length === 1000) warnings.push('gh limit reached; scope may be truncated.');
    return { ...aggregate(prs), source: 'gh', since, warnings };
  } catch (error) { warnings.push(`gh unavailable: ${error instanceof Error ? error.message.split('\n')[0] : error}`); }
  try {
    let lines = run('git', ['log', 'origin/main', '--first-parent', '--merges', `--since=${since}`, '--format=%H%x09%cI%x09%s']);
    if (!lines) { warnings.push('No merge commits; using first-parent commits (includes squash merges).'); lines = run('git', ['log', 'origin/main', '--first-parent', `--since=${since}`, '--format=%H%x09%cI%x09%s']); }
    const prs = lines ? lines.split('\n').map(line => {
      const [sha, mergedAt, title] = line.split('\t');
      const match = title.match(/#(\d+)/);
      const files = run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', '--first-parent', '-m', sha]).split('\n').filter(Boolean).map(path => ({ path }));
      return { number: match ? Number(match[1]) : null, title, mergedAt, files };
    }) : [];
    return { ...aggregate(prs), source: 'git', since, warnings };
  } catch (error) { warnings.push(`git scope unavailable: ${String(error)}`); return { ...aggregate([]), source: 'unavailable', since, warnings }; }
}
