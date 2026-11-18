// Validate this audit handoff without turning its artifacts into feature proof.
// Run from the repository root:
// corepack pnpm exec node --import tsx docs/implementation/v3/m14/verify-evidence.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  implementationEvidenceV3Schema, sourceLockV3Schema,
  validateImplementationEvidence, bundleStatus,
} from '../../../../packages/contracts/implementation-evidence.ts';
import { verifySourceLock } from '../../../../scripts/research-baseline.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = path => readFileSync(resolve(root, path));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const lockBytes = read('docs/implementation/v3/M14-source-lock.json');
const lock = sourceLockV3Schema.parse(JSON.parse(lockBytes.toString('utf8')));
const evidence = implementationEvidenceV3Schema.parse(JSON.parse(read('docs/implementation/v3/M14-verification.json').toString('utf8')));
assert.equal(evidence.bundleId, 'M14');
assert.equal(evidence.sourceLockDigest, digest(lockBytes));
assert.deepEqual(verifySourceLock(root, lock), []);
assert.deepEqual(validateImplementationEvidence(evidence, {
  expectedBaseSha: lock.executionBaseSha, requiredContracts: lock.publicContracts,
}), []);

// The shared M01 source verifier has a finite source-name map. Validate the
// additional real M01/M02 definitions explicitly, without changing that API.
const extraSources = {
  'M01.ImplementationEvidenceV3': 'packages/contracts/implementation-evidence.ts',
  'M01.CapabilityFlags': 'packages/core/capability-flags.ts',
  'M02.ToolEffectV1': 'packages/contracts/tool-effects.ts',
  'M02.ToolAuthority': 'packages/core/tool-authority.ts',
  'M02.ToolEffectLedger': 'packages/core/tool-effects.ts',
};
for (const [name, path] of Object.entries(extraSources)) {
  const contract = evidence.dependencyContracts.find(item => item.name === name);
  assert.ok(contract, `Missing inspected contract: ${name}`);
  assert.equal(contract.version, git(['rev-parse', `${lock.executionBaseSha}:${path}`]));
  assert.ok(lock.inspectedPaths.some(item => item.path === path && item.blobSha === contract.version));
  for (const testId of contract.testIds) assert.ok(existsSync(resolve(root, testId)), `Missing test: ${testId}`);
}
assert.ok(evidence.flags.every(flag => flag.enabled === false));
assert.notEqual(bundleStatus(evidence.phases), 'PASS', 'This audit has no feature acceptance proof.');
assert.ok(evidence.phases.some(phase => phase.id === 'CORE.required-dependencies' && phase.status === 'BLOCKED'));

for (const phase of evidence.phases) {
  for (const ref of phase.artifactRefs) assert.ok(existsSync(resolve(root, ref)), `Missing artifact: ${ref}`);
  for (const command of phase.commands) {
    const log = read(command.boundedLogRef);
    assert.equal(digest(log), command.logDigest, `Log digest mismatch: ${command.boundedLogRef}`);
    assert.ok(log.length <= 200_000, `Unbounded log: ${command.boundedLogRef}`);
  }
}

// Include staged, committed and untracked files so the same check works before
// and after committing this branch. No source/runtime/lockfile changes belong
// to the blocked audit delivery.
const names = new Set([
  ...git(['diff', '--name-only', lock.executionBaseSha]).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
].filter(Boolean));
assert.deepEqual([...names].sort(), [...evidence.changedFiles].sort());
for (const name of names) {
  assert.ok(name.startsWith('docs/implementation/v3/M14-') || name.startsWith('docs/implementation/v3/m14/') || name === 'tests/m14-evidence-gates.test.ts', `Out-of-scope file: ${name}`);
}
console.log(`M14 audit evidence validated; bundle ${bundleStatus(evidence.phases)}; product implementation BLOCKED.`);
