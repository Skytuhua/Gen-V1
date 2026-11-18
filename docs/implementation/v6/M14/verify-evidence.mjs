// Validate the M14 v6 implementation evidence bundle against its own source
// lock. Run from the repository root:
//   pnpm exec node --import tsx docs/implementation/v6/M14/verify-evidence.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  implementationEvidenceV3Schema, sourceLockV3Schema,
  validateImplementationEvidence, bundleStatus,
} from '../../../../packages/contracts/implementation-evidence.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = path => readFileSync(resolve(root, path));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Local copy of scripts/research-baseline.ts verifySourceLock — that module is
// not an admitted public source, so the check is inlined here.
const CONTRACT_SOURCES = {
  'runtime-adapter': 'packages/contracts/index.ts',
  'store-command': 'packages/storage/store.ts',
};
function verifySourceLock(rootDir, lock) {
  const issues = [];
  const approved = new Map(lock.approvedDrift.map(item => [item.path, item]));
  for (const inspected of lock.inspectedPaths) {
    if (inspected.path.includes('..') || isAbsolute(inspected.path) || inspected.path.includes('\\') || inspected.path.includes(':'))
      issues.push(`Inspected path is not repository-relative: ${inspected.path}`);
    let actual = null;
    try { actual = execFileSync('git', ['-C', rootDir, 'rev-parse', `${lock.executionBaseSha}:${inspected.path}`], { encoding: 'utf8' }).trim(); }
    catch { /* missing at base */ }
    const drift = approved.get(inspected.path);
    if (actual === inspected.blobSha) continue;
    issues.push(drift && drift.fromBlob === inspected.blobSha
      ? `${inspected.path}: approved drift to ${drift.toBlob} — ${drift.note}`
      : `${inspected.path}: blob at base is ${actual ?? 'missing'}, expected ${inspected.blobSha}`);
  }
  for (const sha of lock.acceptedDependencyCommits) {
    try { execFileSync('git', ['-C', rootDir, 'merge-base', '--is-ancestor', sha, lock.executionBaseSha]); }
    catch { issues.push(`Accepted dependency commit ${sha} is not an ancestor of ${lock.executionBaseSha}.`); }
  }
  for (const contract of lock.publicContracts) {
    const source = CONTRACT_SOURCES[contract.name];
    if (!source) { issues.push(`No defining source registered for contract ${contract.name}.`); continue; }
    let actual = null;
    try { actual = execFileSync('git', ['-C', rootDir, 'rev-parse', `${lock.executionBaseSha}:${source}`], { encoding: 'utf8' }).trim(); }
    catch { /* missing */ }
    if (actual !== contract.version)
      issues.push(`Contract ${contract.name} version ${contract.version} does not match ${source} blob ${actual ?? 'missing'} at base.`);
    for (const testId of contract.testIds)
      if (!existsSync(resolve(rootDir, testId))) issues.push(`Contract ${contract.name} test is absent: ${testId}`);
  }
  return issues;
}

const lockBytes = read('docs/implementation/v6/M14/source-lock.json');
const lock = sourceLockV3Schema.parse(JSON.parse(lockBytes.toString('utf8')));
const evidence = implementationEvidenceV3Schema.parse(JSON.parse(read('docs/implementation/v3/M14-verification.json').toString('utf8')));

assert.equal(evidence.bundleId, 'M14');
assert.equal(evidence.sourceLockDigest, digest(lockBytes));
assert.equal(evidence.baseSha, lock.executionBaseSha);
assert.deepEqual(verifySourceLock(root, lock), []);
assert.deepEqual(validateImplementationEvidence(evidence, {
  expectedBaseSha: lock.executionBaseSha, requiredContracts: lock.publicContracts,
}), []);

// Contract blob versions in the evidence match the inspected paths at the base.
const contractFiles = {
  'runtime-adapter': 'packages/contracts/index.ts',
  'store-command': 'packages/storage/store.ts',
  'M01.ImplementationEvidenceV3': 'packages/contracts/implementation-evidence.ts',
  'M01.CapabilityFlags': 'packages/core/capability-flags.ts',
  'M02.ToolEffectV1': 'packages/contracts/tool-effects.ts',
  'M04.RequestContextV1': 'packages/contracts/request-context.ts',
  'M05.ProjectMemoryV1': 'packages/contracts/project-memory.ts',
};
for (const contract of evidence.dependencyContracts) {
  const file = contractFiles[contract.name];
  assert.ok(file, `Unmapped dependency contract: ${contract.name}`);
  assert.ok(lock.inspectedPaths.some(item => item.path === file && item.blobSha === contract.version),
    `Contract ${contract.name} is not bound to the locked inspected blob for ${file}`);
  assert.equal(contract.version, git(['rev-parse', `${lock.executionBaseSha}:${file}`]),
    `Contract ${contract.name} does not match the base blob of ${file}`);
  for (const testId of contract.testIds) assert.ok(existsSync(resolve(root, testId)), `Missing test: ${testId}`);
}

// Activation stays off: both M14 flags report disabled in evidence and remain
// default-off in the host registry.
assert.ok(evidence.flags.every(flag => flag.enabled === false));

// Completion honesty: native fork, external formats and platform gates remain
// non-PASS — the bundle must not claim PASS while holds exist.
const status = bundleStatus(evidence.phases);
assert.ok(status !== 'PASS' && status !== 'BLOCKED', `Unexpected bundle status ${status}`);
assert.ok(evidence.phases.some(phase => phase.id === 'INTEGRATION.M14-native-fork' && phase.status === 'BLOCKED'));
assert.ok(evidence.phases.some(phase => phase.id === 'INTEGRATION.M14-external-format' && phase.status === 'BLOCKED'));
assert.ok(evidence.phases.some(phase => phase.id === 'INTEGRATION.M14-admitted-acceptance' && phase.status === 'PASS'));
assert.equal(evidence.reviewerApproval, false);

for (const phase of evidence.phases) {
  for (const ref of phase.artifactRefs) assert.ok(existsSync(resolve(root, ref)), `Missing artifact: ${ref}`);
  for (const command of phase.commands) {
    const log = read(command.boundedLogRef);
    assert.equal(digest(log), command.logDigest, `Log digest mismatch: ${command.boundedLogRef}`);
    assert.ok(log.length <= 200_000, `Unbounded log: ${command.boundedLogRef}`);
  }
}

const matrix = JSON.parse(read('docs/implementation/v6/M14/requirements.json').toString('utf8'));
const ids = new Set(matrix.requirements.map(row => row.id));
for (const required of [
  'M14-C01', 'M14-C02', 'M14-C03',
  'M14-S01', 'M14-S02', 'M14-S03', 'M14-S04', 'M14-S05', 'M14-S06', 'M14-S07', 'M14-S08', 'M14-S09', 'M14-S10', 'M14-S11',
  'M14-U01', 'M14-U02', 'M14-U03',
  'M14-T01', 'M14-T02', 'M14-T03', 'M14-T04', 'M14-T05', 'M14-T06',
  'M14-G01', 'M14-G02', 'M14-G03',
  'M14-D01', 'M14-D02', 'M14-D03', 'M14-D04', 'M14-D05',
]) assert.ok(ids.has(required), `Requirement matrix missing ${required}`);

console.log('M14 v6 evidence bundle: schema, lock, contracts, flags, holds and logs verified.');
