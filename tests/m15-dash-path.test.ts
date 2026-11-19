import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('hashes leading-dash source filenames without treating them as Git options', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gen-m15-dash-path-'));
  const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
  const root = join(cwd, 'docs', 'implementation', 'v3');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (path: string, text: string) => writeFileSync(join(cwd, path), text);
  const run = (args: string[]) => {
    const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 15000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  };
  try {
    mkdirSync(join(root, 'm15-artifacts'), { recursive: true });
    const tracked = '-tracked.ts', untracked = '-untracked.ts';
    git('init', '-q');
    put('package.json', JSON.stringify({ packageManager: 'pnpm@10.30.3' }));
    put(tracked, 'old\n');
    put('removed.ts', 'old\n');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Seed');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'M15-evidence-plan.json'), JSON.stringify({
      executionBaseSha: base, auditAncestorSha: base, acceptedDependencyCommits: [],
      dependencyContracts: [], inspectedPaths: [], remainingGates: [], phases: [],
    }));
    put(tracked, 'changed\n');
    put(untracked, 'new\n');
    rmSync(join(cwd, 'removed.ts'));
    run([join(scripts, 'm15-record.mjs'), 'fixture', process.execPath, '--version']);
    const tsx = import.meta.resolve('tsx');
    run(['--import', tsx, join(scripts, 'm15-evidence.mts'), '--assemble']);
    const cut = JSON.parse(readFileSync(join(root, 'M15-source-cut.json'), 'utf8'));
    expect(cut.files.map((entry: { path: string }) => entry.path)).toEqual([tracked, untracked].sort());
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5 });
  }
});
