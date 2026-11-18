import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('publishes a failed M15 validation summary when a command log is missing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gen-m15-missing-log-'));
  const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
  const root = join(cwd, 'docs', 'implementation', 'v3');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const run = (...args: string[]) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 10000 });
  const summary = () => JSON.parse(readFileSync(join(root, 'M15-validation-summary.json'), 'utf8'));
  try {
    mkdirSync(join(root, 'm15-artifacts'), { recursive: true });
    git('init', '-q');
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.30.3' }));
    git('add', 'package.json');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Seed');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'M15-evidence-plan.json'), JSON.stringify({
      executionBaseSha: base, auditAncestorSha: base, acceptedDependencyCommits: [],
      dependencyContracts: [], inspectedPaths: [], remainingGates: [], phases: [],
    }));
    const recorded = run(join(scripts, 'm15-record.mjs'), 'fixture', process.execPath, '--version');
    expect(recorded.status, recorded.stderr).toBe(0);
    const args = ['--import', import.meta.resolve('tsx'), join(scripts, 'm15-evidence.mts')];
    const assembled = run(...args, '--assemble');
    expect(assembled.status, assembled.stderr).toBe(0);
    expect(summary().integrityStatus).toBe('PASS');
    rmSync(join(root, 'm15-logs', 'fixture.log'));
    expect(run(...args).status).toBe(1);
    expect(summary().integrityStatus).toBe('FAIL');
    expect(summary().issues).toContain('Missing or mismatched command log: docs/implementation/v3/m15-logs/fixture.log');
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5 });
  }
});
