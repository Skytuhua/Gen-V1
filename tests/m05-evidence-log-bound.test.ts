import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.skipIf(process.platform === 'win32')('reports an oversize log without reading it', () => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'm05-log-bound-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  try {
    const directory = 'docs/implementation/v3';
    for (const path of ['scripts', 'packages/contracts', directory]) mkdirSync(join(root, path), { recursive: true });
    for (const path of ['scripts/verify-m05-evidence.ts', 'packages/contracts/implementation-evidence.ts'])
      copyFileSync(join(source, path), join(root, path));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'junction');
    writeFileSync(join(root, '.gitignore'), 'docs/implementation/v3/\nnode_modules\n');
    git('init', '-q');
    git('add', '--', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=.git/hooks-disabled', 'commit', '-qm', 'fixture base');
    const sha = git('rev-parse', 'HEAD');
    const logRef = directory + '/oversize.log';
    writeFileSync(join(root, logRef), '');
    // POSIX truncate extends as a sparse file, without materializing the payload.
    truncateSync(join(root, logRef), 2 ** 31 + 1);
    const timestamp = '2026-01-01T00:00:00.000Z';
    const command = { argv:['fixture'],cwdIdentity:root,executableIdentity:'fixture',
      startedAt:timestamp,endedAt:timestamp,exitCode:0,termination:'NONE',
      status:'PASS',boundedLogRef:logRef,logDigest:'0'.repeat(64) };
    const lock = JSON.stringify({schemaVersion:3,auditAncestorSha:sha,executionBaseSha:sha,inspectedPaths:[],publicContracts:[],acceptedDependencyCommits:[],approvedDrift:[]});
    writeFileSync(join(root,directory,'M05-source-lock.json'),lock);
    writeFileSync(join(root,directory,'M05-verification.json'),JSON.stringify({
      schemaVersion:3,bundleId:'fixture',baseSha:sha,sourceLockDigest:createHash('sha256').update(lock).digest('hex'),
      platform:process.platform,nodeVersion:process.version,packageManagerVersion:'fixture',
      phases:[{id:'fixture',status:'BLOCKED',requiredCases:[],commands:[command],artifactRefs:[]}],changedFiles:[],dependencyContracts:[],flags:[],remainingGates:[],reviewerApproval:false,
    }));
    const run = spawnSync(process.execPath, ['--import','tsx',join(root,'scripts/verify-m05-evidence.ts')], { cwd:root,encoding:'utf8',windowsHide:true,timeout:10_000 });
    expect(run.error).toBeUndefined();
    expect(run.stdout, run.stderr).not.toBe('');
    expect(JSON.parse(run.stdout).errors).toEqual(['Unbounded log: ' + logRef]);
    expect(run.status,run.stderr).toBe(1);
  } finally {
    rmSync(root,{recursive:true,force:true,maxRetries:5});
  }
}, 15_000);
