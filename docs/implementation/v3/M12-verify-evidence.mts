import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { implementationEvidenceV3Schema, sourceLockV3Schema, validateImplementationEvidence, bundleStatus } from '../../../packages/contracts/implementation-evidence.ts';
import { registeredCapabilityFlags } from '../../../packages/core/capability-flags.ts';

// This controller verifies custody and recorded evidence. It does not execute
// acceptance suites, grant backend approval, or turn a failed bundle into PASS.
const root = process.cwd(), directory = 'docs/implementation/v3';
const local = (path: string) => {
  assert.ok(!isAbsolute(path) && !relative(root, resolve(root, path)).startsWith('..'), `Nonlocal artifact: ${path}`);
  return resolve(root, path);
};
const read = (path: string) => readFileSync(local(path));
const json = (path: string) => JSON.parse(read(path).toString('utf8'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const gitPaths = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// This controller certifies the recorded accepted-base evidence bundle. The live
// M12-verification.json describes the current source cut; after the v6 merge it
// describes the combined tree. The pinned fcaa52f7 assertions below therefore
// read the preserved accepted-base artifact, not the live file.
const evidence = implementationEvidenceV3Schema.parse(json(`${directory}/m12-artifacts/M12-verification-fcaa52f7.json`));
const lock = sourceLockV3Schema.parse(json(`${directory}/M12-source-lock.json`));
const audit = json(`${directory}/M12-source-audit.json`);
assert.equal(evidence.bundleId, 'M12');
assert.equal(evidence.baseSha, 'fcaa52f7fcdc9f39420118a79f9a8250ba83c563');
assert.equal(lock.executionBaseSha, evidence.baseSha);
assert.equal(evidence.sourceLockDigest, sha256(read(`${directory}/M12-source-lock.json`)));
assert.equal(audit.sourceLockDigest, evidence.sourceLockDigest);
assert.deepEqual(validateImplementationEvidence(evidence, { expectedBaseSha: lock.executionBaseSha, requiredContracts: lock.publicContracts }), []);
assert.equal(evidence.reviewerApproval, false);
assert.equal(git('branch', '--show-current'), 'agent/m12-v3');
assert.ok(['https://github.com/Skytuhua/Gen-V1.git', 'https://github.com/skytuhua-org/Gen-V1.git'].includes(git('remote', 'get-url', 'origin')), 'Unexpected origin remote');
git('merge-base', '--is-ancestor', lock.auditAncestorSha, lock.executionBaseSha);
for (const sha of lock.acceptedDependencyCommits) git('merge-base', '--is-ancestor', sha, lock.executionBaseSha);
// Working-tree identity checks are only meaningful on the pinned accepted cut.
// On the merged v6 tree they would report legitimate post-merge drift, which the
// v6 evidence documents separately instead of asserting here.
const atPinnedCut = git('rev-parse', 'HEAD') === lock.executionBaseSha;
for (const item of lock.inspectedPaths) {
  assert.equal(git('rev-parse', `${lock.executionBaseSha}:${item.path}`), item.blobSha, item.path);
  const drift = lock.approvedDrift.find(entry => entry.path === item.path);
  if (atPinnedCut) assert.equal(git('hash-object', item.path), drift?.toBlob ?? item.blobSha, `Unreviewed source drift: ${item.path}`);
  if (drift) assert.equal(drift.fromBlob, item.blobSha);
}
for (const contract of lock.publicContracts) {
  const source = audit.contractSources.find((item: { name: string }) => item.name === contract.name);
  assert.ok(source, `Missing source path for ${contract.name}`);
  if (atPinnedCut) assert.equal(git('hash-object', source.path), contract.version, `Contract drift: ${contract.name}`);
  for (const path of contract.testIds) assert.ok(existsSync(local(path)), path);
}
assert.equal(sha256(read(audit.sourceCut.path)), audit.sourceCut.sha256, 'Candidate source-cut digest differs');
const cut = json(audit.sourceCut.path) as { executionBaseSha: string; sourceLockDigest: string; changedProductTestConfigPaths: string[]; files: { path: string; blobSha: string; sha256: string; bytes: number }[] };
assert.equal(cut.executionBaseSha, evidence.baseSha);
assert.equal(cut.sourceLockDigest, evidence.sourceLockDigest);
if (atPinnedCut) for (const item of cut.files) {
  const bytes = read(item.path);
  assert.equal(bytes.byteLength, item.bytes, item.path);
  assert.equal(sha256(bytes), item.sha256, item.path);
  assert.equal(git('hash-object', item.path), item.blobSha, item.path);
}
const review = json(`${directory}/m12-artifacts/independent-review-final.json`);
assert.equal(review.kind, 'M12_INDEPENDENT_ENGINEERING_REVIEW');
assert.equal(review.productionApproval, false);
assert.equal(review.implementationFindingsOpen, 0);
assert.equal(review.acceptedBaseSha, evidence.baseSha);
assert.equal(review.auditAncestorSha, lock.auditAncestorSha);
assert.equal(review.sourceCut.path, audit.sourceCut.path);
assert.equal(review.sourceCut.sha256, audit.sourceCut.sha256, 'Independent review belongs to another source cut');
assert.equal(review.sourceCut.sourceLockDigest, evidence.sourceLockDigest);
assert.equal(review.sourceCut.fileCount, cut.files.length);
assert.deepEqual(review.sourceCut.files, cut.files, 'Independent review source entries differ');
let commands = 0;
for (const phase of evidence.phases) {
  for (const ref of phase.artifactRefs) assert.ok(existsSync(local(ref)), ref);
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
    assert.ok(Number.isFinite(Date.parse(command.startedAt)) && Date.parse(command.endedAt) >= Date.parse(command.startedAt));
    commands++;
  }
}
const manifest = json(`${directory}/m12-artifacts/artifact-integrity.json`) as { artifacts: { path: string; sha256: string; bytes: number }[] };
for (const entry of manifest.artifacts) {
  const bytes = read(entry.path);
  assert.equal(bytes.byteLength, entry.bytes, entry.path);
  assert.equal(sha256(bytes), entry.sha256, entry.path);
}
const pythonConfiguration = json(`${directory}/m12-artifacts/python-runtime-configuration.json`);
assert.equal(pythonConfiguration.operatorApproved, false);
assert.equal(pythonConfiguration.sourceDigests.length, 9);
for (const item of pythonConfiguration.sourceDigests) {
  assert.equal(sha256(read(item.path)), item.sha256, `Stale Python source proof: ${item.path}`);
  assert.equal(git('hash-object', item.path), item.gitBlobSha1);
  assert.equal(cut.files.find(entry => entry.path === item.path)?.sha256, item.sha256);
}
const packaging = json(`${directory}/m12-artifacts/public-source-manifest-additions.json`);
if (atPinnedCut) assert.equal(packaging.afterSha256, sha256(read(packaging.manifest)), 'Stale public-source manifest review');
assert.deepEqual(packaging.removedPaths, []);
assert.equal(packaging.rulesChanged, false);
const benchmarkPath = `${directory}/m12-artifacts/aggregation-benchmark.json`;
const benchmark = json(benchmarkPath);
assert.equal(benchmark.liveModelEvaluation, false);
assert.equal(benchmark.tokenization.status, 'MEASURED_OFFLINE');
const benchmarkSourcePaths = [
  'tests/tool-program-benchmark-v3.test.ts', 'tests/fixtures/tool-program-benchmark-v3.ts',
  'tests/fixtures/tool-program-replay-harness-v3.ts', 'packages/core/tool-programs.ts',
  'packages/core/tool-effects.ts', 'packages/core/tool-disclosure.ts', 'packages/core/tool-results.ts',
  'packages/core/tool-authority.ts', 'packages/core/security.ts', 'packages/storage/store.ts',
  'packages/contracts/tool-program.ts', 'packages/contracts/tool-results.ts', 'packages/contracts/tool-effects.ts',
  'packages/runtime/tool-program-worker.ts', 'packages/runtime/tool-program-worker-child.mjs',
  'package.json', 'pnpm-lock.yaml', `${directory}/m12-artifacts/tokenizer-dependency-review.json`,
];
assert.deepEqual(Object.keys(benchmark.provenance.workingTreeSourceSha256).sort(), [...benchmarkSourcePaths].sort());
for (const path of benchmarkSourcePaths) {
  const actual = sha256(read(path));
  if (atPinnedCut) assert.equal(benchmark.provenance.workingTreeSourceSha256[path], actual, `Stale benchmark source: ${path}`);
  if (path === `${directory}/m12-artifacts/tokenizer-dependency-review.json`) {
    assert.equal(manifest.artifacts.find(entry => entry.path === path)?.sha256, actual);
    assert.equal(benchmark.tokenization.evidence.dependencyReviewSha256, actual);
  } else if (atPinnedCut) assert.equal(cut.files.find(entry => entry.path === path)?.sha256, actual);
}
assert.equal(Object.hasOwn(benchmark.provenance, 'command'), false, 'A rerun recipe is not an observed command');
assert.deepEqual(benchmark.provenance.reproductionCommand,
  ['corepack', 'pnpm@10.30.3', 'exec', 'vitest', 'run', 'tests/tool-program-benchmark-v3.test.ts']);
assert.equal(benchmark.provenance.commandEvidenceNote,
  'reproductionCommand is a standalone rerun recipe, not the command observed for this measurement. The outer command recorder and benchmark-execution-link.json identify the actual launch, working directory, timestamps and exit.');
const link = json(`${directory}/m12-artifacts/benchmark-execution-link.json`);
const records = json(`${directory}/m12-artifacts/command-records.json`);
assert.equal(link.schemaVersion, 1);
assert.equal(link.kind, 'M12_BENCHMARK_EXECUTION_LINK');
assert.equal(link.benchmark.path, benchmarkPath);
assert.equal(link.benchmark.sha256, sha256(read(benchmarkPath)), 'Benchmark was overwritten after execution linkage');
assert.equal(link.benchmark.bytes, read(benchmarkPath).byteLength);
assert.equal(link.benchmark.beganAt, benchmark.provenance.beganAt);
assert.equal(link.benchmark.finishedAt, benchmark.provenance.finishedAt);
assert.equal(link.sourceCut.path, audit.sourceCut.path);
assert.equal(link.sourceCut.sha256, audit.sourceCut.sha256);
assert.equal(link.sourceCut.sourceLockDigest, evidence.sourceLockDigest);
assert.ok(Object.hasOwn(records, link.commandRecordId), 'Benchmark launch record is missing');
assert.deepEqual(link.command, records[link.commandRecordId]);
const linkedCommand = evidence.phases.flatMap(phase => phase.commands)
  .find(command => command.boundedLogRef === link.command.boundedLogRef);
assert.ok(linkedCommand, 'Benchmark launch is absent from canonical command evidence');
assert.deepEqual(link.command, linkedCommand);
assert.equal(link.command.status, 'PASS');
assert.equal(link.command.exitCode, 0);
assert.equal(link.command.termination, 'NONE');
if (atPinnedCut) assert.equal(link.command.cwdIdentity, root);
assert.deepEqual(link.command.argv, benchmark.provenance.reproductionCommand,
  'Final benchmark acceptance requires its explicit recorded standalone invocation');
const start = Date.parse(link.command.startedAt), end = Date.parse(link.command.endedAt);
const began = Date.parse(link.benchmark.beganAt), finished = Date.parse(link.benchmark.finishedAt);
assert.ok([start, end, began, finished].every(Number.isFinite) && start <= began && began <= finished && finished <= end,
  'Benchmark timestamps are outside the explicitly selected actual invocation');
for (const item of audit.proposedFiles) {
  assert.equal(item.trackedAtBase, false);
  assert.equal(item.existsInWorktree, true);
  assert.ok(existsSync(local(item.path)), item.path);
}
const flagNames = ['tools.durableReplayExperimentV1', 'tools.jsReadProgramV1', 'tools.pythonKernelV1'];
assert.deepEqual(evidence.flags.map(flag => flag.key).sort(), flagNames);
assert.ok(evidence.flags.every(flag => !flag.enabled));
assert.deepEqual(Object.fromEntries(Object.entries(registeredCapabilityFlags()).filter(([key]) => key.startsWith('tools.'))), Object.fromEntries(flagNames.map(key => [key, false])));
if (atPinnedCut) {
  const additions = [...new Set([
    ...gitPaths('diff', '--name-only', '--no-renames', '-z', evidence.baseSha, '--'),
    ...gitPaths('ls-files', '--others', '--exclude-standard', '-z'),
  ])].sort();
  const currentSourceChanges = additions.filter(path => !path.startsWith('docs/'));
  assert.deepEqual(currentSourceChanges, [...cut.changedProductTestConfigPaths].sort(), 'Unreviewed source inventory drift');
  const reviewedPaths = new Set(cut.files.map(entry => entry.path));
  for (const path of currentSourceChanges) assert.ok(reviewedPaths.has(path), `Changed source has no reviewed file entry: ${path}`);
  assert.deepEqual([...evidence.changedFiles].sort(), additions, 'Changed-file inventory is stale');
  assert.equal(git('-C', audit.repository.originalCheckout, 'status', '--porcelain'), '', 'Original checkout changed');
  assert.equal(git('-C', audit.repository.originalCheckout, 'rev-parse', 'HEAD'), evidence.baseSha);
}
console.log(JSON.stringify({ schemaValidation: 'PASS', artifacts: manifest.artifacts.length, reviewedBaseBlobs: lock.inspectedPaths.length,
  dependencyContracts: lock.publicContracts.length, verifiedCommandLogs: commands, sourceGate: audit.sourceGate,
  bundleStatus: bundleStatus(evidence.phases), activationAuthorized: false }, null, 2));
