import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('matches reported tracked and untracked paths against literal Git names', () => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'm05-inventory-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  try {
    const tracked = 'café notes.txt', untracked = '資料.txt';
    const directory = 'docs/implementation/v3';
    for (const path of ['scripts', 'packages/contracts', directory]) mkdirSync(join(root, path), { recursive: true });
    for (const path of ['scripts/verify-m05-evidence.ts', 'packages/contracts/implementation-evidence.ts'])
      copyFileSync(join(source, path), join(root, path));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'junction');
    writeFileSync(join(root, '.gitignore'), 'docs/implementation/v3/\nnode_modules\n');
    writeFileSync(join(root, tracked), 'original');
    git('init', '-q');
    git('config', 'core.quotePath', 'true');
    git('add', '--', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=.git/hooks-disabled', 'commit', '-qm', 'fixture base');
    const sha = git('rev-parse', 'HEAD');
    writeFileSync(join(root, tracked), 'modified');
    writeFileSync(join(root, untracked), 'new');
    const lock = JSON.stringify({schemaVersion:3,auditAncestorSha:sha,executionBaseSha:sha,inspectedPaths:[],publicContracts:[],acceptedDependencyCommits:[],approvedDrift:[]});
    writeFileSync(join(root,directory,'M05-source-lock.json'),lock);
    writeFileSync(join(root,directory,'M05-verification.json'),JSON.stringify({
      schemaVersion:3,bundleId:'fixture',baseSha:sha,sourceLockDigest:createHash('sha256').update(lock).digest('hex'),
      platform:process.platform,nodeVersion:process.version,packageManagerVersion:'fixture',
      phases:[],changedFiles:[tracked,untracked],dependencyContracts:[],flags:[],remainingGates:[],reviewerApproval:false,
    }));
    const run = spawnSync(process.execPath, ['--import','tsx',join(root,'scripts/verify-m05-evidence.ts')], { cwd:root,encoding:'utf8',windowsHide:true,timeout:10_000 });
    expect(run.error).toBeUndefined();
    const receipt=JSON.parse(readFileSync(join(root,directory,'M05-evidence-integrity.json'),'utf8'));
    expect(receipt.errors).toEqual([]);
    expect(run.status,run.stderr).toBe(0);
  } finally {
    rmSync(root,{recursive:true,force:true,maxRetries:5});
  }
}, 15_000);
