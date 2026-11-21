import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { implementationEvidenceV3Schema, sourceLockV3Schema, validateImplementationEvidence, bundleStatus } from '../../../packages/contracts/implementation-evidence.ts';

const root = process.cwd();
const directory = 'docs/implementation/v3';
const read = (path: string) => readFileSync(resolve(root, path));
const json = (path: string) => JSON.parse(read(path).toString('utf8'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const evidence = implementationEvidenceV3Schema.parse(json(`${directory}/M12-verification.json`));
const lock = sourceLockV3Schema.parse(json(`${directory}/M12-source-lock.json`));
const audit = json(`${directory}/M12-source-audit.json`);
assert.equal(evidence.bundleId, 'M12');
assert.equal(evidence.baseSha, 'fcaa52f7fcdc9f39420118a79f9a8250ba83c563');
assert.equal(lock.executionBaseSha, evidence.baseSha);
assert.equal(evidence.sourceLockDigest, sha256(read(`${directory}/M12-source-lock.json`)));
assert.equal(audit.sourceLockDigest, evidence.sourceLockDigest);
assert.deepEqual(validateImplementationEvidence(evidence, { expectedBaseSha: lock.executionBaseSha, requiredContracts: lock.publicContracts }), []);
assert.equal(bundleStatus(evidence.phases), 'FAIL');
assert.equal(audit.sourceGate, 'BLOCKED_SOURCE_DRIFT');
assert.equal(audit.verificationOutcome, 'FAIL');
assert.equal(evidence.reviewerApproval, false);
assert.equal(git('branch', '--show-current'), 'agent/m12-v3');
assert.equal(git('remote', 'get-url', 'origin'), 'https://github.com/Skytuhua/Gen-V1.git');
git('merge-base', '--is-ancestor', lock.auditAncestorSha, lock.executionBaseSha);
for (const sha of lock.acceptedDependencyCommits) git('merge-base', '--is-ancestor', sha, lock.executionBaseSha);
for (const item of lock.inspectedPaths) {
  assert.equal(git('rev-parse', `${lock.executionBaseSha}:${item.path}`), item.blobSha, item.path);
  assert.equal(git('hash-object', item.path), item.blobSha, `${item.path} differs from the accepted source`);
}
for (const contract of lock.publicContracts) {
  const source = audit.contractSources.find((item: { name: string }) => item.name === contract.name);
  assert.ok(source, `missing source path for ${contract.name}`);
  assert.equal(git('rev-parse', `${lock.executionBaseSha}:${source.path}`), contract.version);
  for (const path of contract.testIds) assert.ok(existsSync(resolve(root, path)), path);
}
let commands = 0;
for (const phase of evidence.phases) {
  for (const ref of phase.artifactRefs) assert.ok(existsSync(resolve(root, ref)), ref);
  for (const command of phase.commands) {
    const bytes = read(command.boundedLogRef);
    assert.ok(bytes.byteLength <= 65536, command.boundedLogRef);
    assert.equal(sha256(bytes), command.logDigest, command.boundedLogRef);
    const header = JSON.parse(bytes.toString('utf8').split('\n\n', 1)[0]!);
    assert.deepEqual(header.argv, command.argv);
    assert.equal(header.cwd, command.cwdIdentity);
    assert.equal(header.exitCode, command.exitCode);
    assert.equal(header.termination, command.termination);
    assert.equal(header.startedAt, command.startedAt);
    assert.equal(header.endedAt, command.endedAt);
    assert.ok(new Date(command.endedAt).getTime() >= new Date(command.startedAt).getTime());
    commands++;
  }
}
for (const item of audit.proposedFiles) {
  assert.equal(item.created, false);
  assert.equal(item.trackedAtBase, false);
  assert.equal(item.existsInWorktree, false);
  assert.equal(existsSync(resolve(root, item.path)), false, item.path);
}
assert.deepEqual(evidence.flags.map(flag => flag.key).sort(), ['tools.durableReplayExperimentV1', 'tools.jsReadProgramV1', 'tools.pythonKernelV1']);
assert.ok(evidence.flags.every(flag => !flag.enabled));
assert.ok(audit.featureFlags.every((flag: { registered: boolean; enabled: boolean }) => !flag.registered && !flag.enabled));
const additions = [...new Set([
  ...git('diff', '--name-only', evidence.baseSha).split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
].filter(Boolean))].sort();
assert.deepEqual([...evidence.changedFiles].sort(), additions);
for (const path of additions) assert.ok(path.startsWith(`${directory}/M12-`) || path.startsWith(`${directory}/m12-logs/`), path);
assert.equal(git('-C', audit.repository.originalCheckout, 'status', '--porcelain'), '', 'original checkout changed');
assert.equal(git('-C', audit.repository.originalCheckout, 'rev-parse', 'HEAD'), evidence.baseSha);
console.log(JSON.stringify({ schemaValidation: 'PASS', artifacts: additions.length, verifiedSourceBlobs: lock.inspectedPaths.length, verifiedCommandLogs: commands, sourceGate: audit.sourceGate, bundleStatus: bundleStatus(evidence.phases), activationAuthorized: false }, null, 2));
