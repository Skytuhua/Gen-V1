import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleStatus, implementationEvidenceV3Schema, sourceLockV3Schema, validateImplementationEvidence } from '../packages/contracts/implementation-evidence.ts';

// Validate the evidence receipt, not activation or release permission. A valid
// receipt must still report FAIL/BLOCKED where execution does not support PASS.
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const directory = resolve(root, 'docs/implementation/v3');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const errors: string[] = [];
const lockBytes = readFileSync(resolve(directory, 'M05-source-lock.json'));
const lock = sourceLockV3Schema.parse(JSON.parse(lockBytes.toString('utf8')));
const evidence = implementationEvidenceV3Schema.parse(JSON.parse(readFileSync(resolve(directory, 'M05-verification.json'), 'utf8')));
if (sha256(lockBytes) !== evidence.sourceLockDigest) errors.push('Source lock digest mismatch.');
errors.push(...validateImplementationEvidence(evidence, { expectedBaseSha: lock.executionBaseSha, requiredContracts: lock.publicContracts }).map(issue => `${issue.code}: ${issue.message}`));
for (const path of lock.inspectedPaths) {
  if (git('rev-parse', `${lock.executionBaseSha}:${path.path}`) !== path.blobSha) errors.push(`Accepted source blob changed: ${path.path}`);
}
for (const commit of lock.acceptedDependencyCommits) {
  try { execFileSync('git', ['merge-base', '--is-ancestor', commit, lock.executionBaseSha], { cwd: root }); }
  catch { errors.push(`Dependency is absent from accepted base: ${commit}`); }
}
let commandCount = 0;
for (const phase of evidence.phases) {
  for (const command of phase.commands) {
    commandCount++;
    const path = resolve(root, command.boundedLogRef);
    const contained = relative(root, path);
    if (!contained || contained.startsWith('..') || isAbsolute(contained) || !existsSync(path)) { errors.push(`Missing log: ${command.boundedLogRef}`); continue; }
    if (statSync(path).size > 65536) errors.push(`Unbounded log: ${command.boundedLogRef}`);
    if (sha256(readFileSync(path)) !== command.logDigest) errors.push(`Log digest mismatch: ${command.boundedLogRef}`);
    if (Date.parse(command.endedAt) < Date.parse(command.startedAt)) errors.push(`Invalid command times: ${command.boundedLogRef}`);
  }
  for (const path of phase.artifactRefs) if (!existsSync(resolve(root, path))) errors.push(`Missing artifact: ${path}`);
}
for (const path of evidence.changedFiles) if (!existsSync(resolve(root, path))) errors.push(`Missing changed file: ${path}`);
const expected = new Set(evidence.changedFiles);
const actual = new Set([
  ...git('diff', '--name-only', '-z', lock.executionBaseSha, '--').split('\0'),
  ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
].filter(Boolean));
for (const path of actual) if (!expected.has(path)) errors.push(`Unrecorded change: ${path}`);
for (const path of expected) if (!actual.has(path)) errors.push(`Receipt lists an unchanged path: ${path}`);
for (const flag of evidence.flags) if (flag.enabled) errors.push(`Activation lacks independent review: ${flag.key}`);
const result = {
  schemaVersion: 1,
  status: errors.length ? 'FAIL' : 'PASS',
  purpose: 'Evidence integrity only; not release approval or a passing implementation bundle.',
  implementationBundleStatus: bundleStatus(evidence.phases),
  executionBaseSha: lock.executionBaseSha,
  inspectedPaths: lock.inspectedPaths.length,
  verifiedCommandRecords: commandCount,
  changedFiles: evidence.changedFiles.length,
  reviewerApproval: false,
  errors,
};
writeFileSync(resolve(directory, 'M05-evidence-integrity.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
