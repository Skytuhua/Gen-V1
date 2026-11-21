/**
 * Reversible negative probe for the actual M12 evidence controller.
 *
 * Run only after the canonical evidence and its actual verifier are valid and
 * no other process is rebuilding M12-verification.json. The original evidence
 * bytes stay in memory. One exclusive-open UUID source file is created at the
 * repository root; only that file and the temporary changedFiles addition are
 * removed/restored in finally. The verifier itself is never modified.
 *
 * Before and after the verifier fix, use the same assertion:
 * node --import tsx docs/implementation/v3/m12-artifacts/source-inventory-negative-probe.mts \
 *   --expect rejected --error 'Unreviewed source inventory drift'
 *
 * The vulnerable verifier produces a real exit-1 red proof because it accepts
 * the unreviewed file. The corrected verifier must reject with the exact named
 * assertion to produce exit 0. No acceptance suite or backend is launched.
 */
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync, type SpawnSyncReturns} from 'node:child_process';
import {closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const verificationPath = resolve(root, 'docs/implementation/v3/M12-verification.json');
const verifier = 'docs/implementation/v3/M12-verify-evidence.mts';
const verifierArgs = ['--import', 'tsx', verifier];
const retainedBytes = 4096, captureBytes = 128 * 1024, childTimeoutMs = 45000;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000);
const buffer = (value: Buffer | string | null | undefined) => Buffer.isBuffer(value) ? value : Buffer.from(value ?? '');
const stripAnsi = (value: string) => value.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g, '');

function bounded(value: Buffer | string | null | undefined) {
  const bytes = buffer(value), half = retainedBytes / 2;
  return {capturedBytes: bytes.length, capturedSha256: sha256(bytes), truncated: bytes.length > retainedBytes,
    text: bytes.length <= retainedBytes ? bytes.toString('utf8')
      : `${bytes.subarray(0, half).toString('utf8')}\n[Middle output omitted.]\n${bytes.subarray(-half).toString('utf8')}`};
}

function runVerifier() {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, verifierArgs, {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: captureBytes,
    timeout: childTimeoutMs, killSignal: 'SIGTERM', windowsHide: true,
  });
  return {result, evidence: {argv: [process.execPath, ...verifierArgs], cwd: root, startedAt,
    endedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal,
    spawnError: result.error ? errorMessage(result.error) : null,
    stdout: bounded(result.stdout), stderr: bounded(result.stderr)}};
}

function completed(result: SpawnSyncReturns<Buffer>, label: string) {
  assert.equal(result.error, undefined, `${label} failed to complete: ${result.error ? errorMessage(result.error) : ''}`);
  assert.equal(result.signal, null, `${label} was terminated by a signal`);
  assert.notEqual(result.status, null, `${label} has no observed exit code`);
}

function main() {
  let expected: 'accepted' | 'rejected' | undefined;
  let expectedError = 'Unreviewed source inventory drift';
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--expect') {
      assert.equal(expected, undefined, '--expect may be supplied only once');
      const value = args[++index];
      assert.ok(value === 'accepted' || value === 'rejected', '--expect requires accepted or rejected');
      expected = value;
    } else if (argument === '--error') {
      expectedError = args[++index] ?? '';
      assert.ok(expectedError.length > 0 && expectedError.length <= 200 && !/[\r\n]/.test(expectedError), '--error requires one bounded assertion message');
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  assert.ok(expected, 'Supply --expect rejected for the recorded red and green proofs');
  assert.equal(realpathSync(process.cwd()), realpathSync(root), 'Run from the isolated M12 worktree');
  const branch = spawnSync('git', ['branch', '--show-current'], {cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 4096});
  assert.equal(branch.status, 0, 'Cannot identify the worktree branch');
  assert.equal(branch.stdout.trim(), 'agent/m12-v3', 'The probe is confined to the isolated M12 branch');
  const stat = lstatSync(verificationPath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Canonical evidence must be a regular file');
  const originalBytes = readFileSync(verificationPath), originalSha256 = sha256(originalBytes);
  const original = JSON.parse(originalBytes.toString('utf8')) as {changedFiles: string[]; [key: string]: unknown};
  assert.ok(Array.isArray(original.changedFiles) && original.changedFiles.every(path => typeof path === 'string'));
  const probeName = `m12-source-inventory-probe-${randomUUID()}.ts`;
  const probePath = resolve(root, probeName);
  assert.ok(!existsSync(probePath) && !original.changedFiles.includes(probeName), 'Probe path collision');
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', probeName], {cwd: root, timeout: 10000, maxBuffer: 4096});
  assert.equal(ignored.error, undefined, 'Cannot check whether the probe is ignored');
  assert.equal(ignored.status, 1, 'Probe must be visible to the ordinary untracked-file inventory');

  const report: Record<string, unknown> = {
    kind: 'M12_SOURCE_INVENTORY_NEGATIVE_PROBE', expected, expectedError,
    beganAt: new Date().toISOString(), sourcePath: probeName, originalVerificationSha256: originalSha256,
    childTimeoutMs, maximumCapturedBytesPerStream: captureBytes, maximumRetainedBytesPerStream: retainedBytes,
    interpretation: 'This is an evidence-integrity negative probe. A probe exit0 means the requested assertion was observed; it is not product or browser acceptance.',
  };
  const probeBytes = Buffer.from('// Temporary M12 source-inventory custody probe. Never imported.\nexport const temporaryInventoryProbe = false;\n');
  let created = false, evidenceTouched = false;
  let identity: {dev: number; ino: number} | undefined;
  let failure: unknown;
  const cleanupErrors: string[] = [];
  try {
    const baseline = runVerifier();
    report.baseline = baseline.evidence;
    completed(baseline.result, 'Pristine baseline verifier');
    assert.equal(baseline.result.status, 0, 'Canonical evidence is not valid; no source probe was admitted');
    assert.ok(readFileSync(verificationPath).equals(originalBytes), 'Canonical evidence changed during the baseline check');

    const fd = openSync(probePath, 'wx', 0o600);
    created = true;
    try {
      const metadata = fstatSync(fd);
      identity = {dev: metadata.dev, ino: metadata.ino};
      writeFileSync(fd, probeBytes);
    } finally { closeSync(fd); }
    const changed = {...original, changedFiles: [...original.changedFiles, probeName].sort()};
    const changedBytes = Buffer.from(JSON.stringify(changed, null, 2) + '\n');
    report.mutatedVerificationSha256 = sha256(changedBytes);
    report.probeSourceSha256 = sha256(probeBytes);
    evidenceTouched = true;
    writeFileSync(verificationPath, changedBytes);

    const probe = runVerifier();
    report.probe = probe.evidence;
    completed(probe.result, 'Mutated-evidence verifier');
    report.observed = probe.result.status === 0 ? 'UNREVIEWED_SOURCE_ACCEPTED' : 'VERIFIER_REJECTED';
    const exactError = stripAnsi(buffer(probe.result.stderr).toString('utf8')).split(/\r?\n/)
      .some(line => line.trim() === `AssertionError [ERR_ASSERTION]: ${expectedError}`);
    report.exactInventoryAssertionObserved = exactError;
    if (expected === 'accepted') {
      assert.equal(probe.result.status, 0, 'Expected the vulnerable verifier to accept the additional source file');
    } else {
      assert.equal(probe.result.status, 1, 'Expected inventory rejection, but the verifier accepted an unreviewed source file');
      assert.ok(exactError, `The verifier rejected for another reason; expected exact assertion: ${expectedError}`);
    }
  } catch (cause) { failure = cause; }
  finally {
    try {
      if (evidenceTouched) writeFileSync(verificationPath, originalBytes);
      report.canonicalEvidenceRestored = readFileSync(verificationPath).equals(originalBytes);
      assert.equal(report.canonicalEvidenceRestored, true, 'Canonical evidence restoration differs from its original bytes');
    } catch (cause) { cleanupErrors.push(errorMessage(cause)); }
    try {
      if (created) {
        const current = lstatSync(probePath);
        assert.ok(identity && current.dev === identity.dev && current.ino === identity.ino && current.isFile(), 'Refusing to remove a replaced probe path');
        unlinkSync(probePath);
      }
      report.probeFileRemoved = !existsSync(probePath);
      assert.equal(report.probeFileRemoved, true, 'Temporary probe source still exists');
    } catch (cause) { cleanupErrors.push(errorMessage(cause)); }
  }
  report.finishedAt = new Date().toISOString();
  report.failure = failure ? errorMessage(failure) : null;
  report.cleanupErrors = cleanupErrors;
  report.status = failure || cleanupErrors.length ? 'FAIL' : 'PASS';
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (failure || cleanupErrors.length) process.exitCode = 1;
}

try { main(); }
catch (cause) {
  process.stderr.write(`Source-inventory probe setup failed: ${errorMessage(cause)}\n`);
  process.exitCode = 1;
}
