// Runs current dependency contract tests. Historical manifest validation remains
// structural; only this fresh execution receipt can report compatibility PASS.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandEvidence, EvidenceIssue, SourceLockV3 } from '../packages/contracts/implementation-evidence.ts';
import { sourceLockV3Schema } from '../packages/contracts/implementation-evidence.ts';
import { CONTRACT_SOURCES, resolvePackageManager, runRecordedCommand, statusFromObservation, writeCommandEvidence } from './research-baseline.ts';

type Status = 'PASS' | 'FAIL' | 'BLOCKED';
interface SourceReceipt {
  headSha: string; treeSha: string; sourceLockDigest: string; blobs: Record<string, string>;
}
interface TestReceipt { testId: string; status: Status; passed: number; failed: number; unexecuted: number }
export interface DependencyExecutionReceipt {
  format: 'M01.DependencyExecutionReceipt.v1';
  status: Status; releaseApproved: false; startedAt: string; endedAt: string;
  platform: string; nodeVersion: string; packageManagerVersion: string | null; vitestVersion: string | null;
  source: SourceReceipt | null; commands: CommandEvidence[];
  tests: TestReceipt[];
  contracts: { name: string; version: string; testIds: string[]; status: Status }[];
  report: { path: string; digest: string } | null;
  issues: EvidenceIssue[];
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const aliases: Record<string, string> = {
  ...CONTRACT_SOURCES,
  'M01.ImplementationEvidenceV3': 'packages/contracts/implementation-evidence.ts',
  'M01.CapabilityFlags': 'packages/core/capability-flags.ts',
};
const exactTestPath = /^tests\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.test\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  }).trim();
}
function safePath(path: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(path)
    && !path.split('/').some(part => !part || part === '.' || part === '..');
}
function trackedBlob(root: string, head: string, path: string): string {
  requireValue(safePath(path), 'Unsupported repository path: ' + path);
  const entry = git(root, 'ls-tree', head, '--', path);
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
  requireValue(match && match[3] === path, 'A tracked regular file is required: ' + path);
  const absolute = join(root, path);
  requireValue(lstatSync(absolute).isFile(), 'A regular working file is required: ' + path);
  const inside = relative(root, realpathSync(absolute));
  requireValue(inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside), 'Path escapes checkout: ' + path);
  requireValue(git(root, 'hash-object', '--no-filters', '--', absolute) === match[2], 'Working source differs from locked source: ' + path);
  return match[2]!;
}
function sourceReceipt(root: string, lock: SourceLockV3, lockBytes: string, testIds: string[]): SourceReceipt {
  requireValue(git(root, 'rev-parse', 'HEAD') === lock.executionBaseSha, 'HEAD must equal executionBaseSha.');
  requireValue(git(root, 'status', '--porcelain', '--untracked-files=all') === '', 'Checkout must have no changed tracked files or untracked files.');
  for (const sha of [lock.auditAncestorSha, ...lock.acceptedDependencyCommits]) {
    try { git(root, 'merge-base', '--is-ancestor', sha, lock.executionBaseSha); }
    catch { throw new Error('Required audit/dependency commit is not an ancestor: ' + sha); }
  }
  const blobs: Record<string, string> = Object.create(null);
  const capture = (path: string) => blobs[path] ??= trackedBlob(root, lock.executionBaseSha, path);
  for (const inspected of lock.inspectedPaths) {
    const actual = capture(inspected.path);
    requireValue(actual === inspected.blobSha || lock.approvedDrift.some(drift =>
      drift.path === inspected.path && drift.fromBlob === inspected.blobSha && drift.toBlob === actual),
    'Inspected source drift is not approved at the actual destination: ' + inspected.path);
  }
  const names = new Set<string>();
  for (const contract of lock.publicContracts) {
    requireValue(!names.has(contract.name), 'Duplicate contract name: ' + contract.name);
    names.add(contract.name);
    const source = aliases[contract.name] ?? contract.name;
    requireValue(source.includes('/') && capture(source) === contract.version, 'Contract source/version mismatch: ' + contract.name);
  }
  for (const path of ['package.json', 'pnpm-lock.yaml', 'vitest.config.ts', ...testIds]) capture(path);
  return { headSha: lock.executionBaseSha, treeSha: git(root, 'rev-parse', 'HEAD^{tree}'), sourceLockDigest: digest(lockBytes), blobs };
}
function inspectTestReport(raw: unknown, root: string, testIds: string[]): TestReceipt[] {
  requireValue(raw && typeof raw === 'object', 'Missing Vitest JSON report object.');
  const report = raw as { success?: unknown; testResults?: unknown };
  requireValue(Array.isArray(report.testResults), 'Missing Vitest per-file results.');
  const expected = new Map(testIds.map(id => [realpathSync(join(root, id)), id]));
  const found = new Map<string, TestReceipt>();
  for (const value of report.testResults) {
    requireValue(value && typeof value === 'object', 'Invalid Vitest file result.');
    const file = value as { name?: unknown; status?: unknown; assertionResults?: unknown };
    requireValue(typeof file.name === 'string' && isAbsolute(file.name), 'Vitest must report an absolute test path.');
    const testId = expected.get(realpathSync(file.name));
    requireValue(testId && !found.has(testId), 'Unexpected or duplicate test file: ' + file.name);
    requireValue(Array.isArray(file.assertionResults), 'Missing assertions for ' + testId);
    let passed = 0, failed = 0, unexecuted = 0;
    for (const assertion of file.assertionResults) {
      const status = assertion && typeof assertion === 'object' ? (assertion as { status?: unknown }).status : undefined;
      if (status === 'passed') passed++;
      else if (status === 'failed') failed++;
      else unexecuted++;
    }
    found.set(testId, { testId, passed, failed, unexecuted,
      status: failed > 0 ? 'FAIL'
        : passed > 0 && unexecuted === 0 && file.status === 'passed' ? 'PASS' : 'BLOCKED' });
  }
  requireValue(found.size === expected.size, 'A declared test file has no current result.');
  const results = testIds.map(id => found.get(id)!);
  requireValue(report.success === true || results.some(item => item.status !== 'PASS'), 'Vitest did not report a successful run.');
  return results;
}

export async function runDependencyContracts(sourceLockPath: string, outputDirectory: string,
  repoRoot = fileURLToPath(new URL('../', import.meta.url))): Promise<DependencyExecutionReceipt> {
  const receipt: DependencyExecutionReceipt = {
    format: 'M01.DependencyExecutionReceipt.v1', status: 'BLOCKED', releaseApproved: false,
    startedAt: new Date().toISOString(), endedAt: '', platform: process.platform + '-' + process.arch,
    nodeVersion: process.version, packageManagerVersion: null, vitestVersion: null,
    source: null, commands: [], tests: [], contracts: [], report: null, issues: [],
  };
  const root = realpathSync(repoRoot);
  const outputPath = resolve(outputDirectory);
  const out = join(realpathSync(dirname(outputPath)), basename(outputPath));
  const outputRelative = relative(root, out);
  if (outputRelative !== '..' && !outputRelative.startsWith('..' + sep) && !isAbsolute(outputRelative)) {
    receipt.issues.push({ code: 'COMPATIBILITY_SETUP_BLOCKED', message: 'Evidence output must be outside the source checkout.' });
    receipt.endedAt = new Date().toISOString();
    return receipt;
  }
  // Exclusive ownership prevents adoption or replacement of old command receipts.
  await mkdir(out);
  let lock: SourceLockV3 | undefined;
  try {
    const lockBytes = readFileSync(sourceLockPath, 'utf8');
    lock = sourceLockV3Schema.parse(JSON.parse(lockBytes));
    requireValue(lock.publicContracts.length > 0, 'No dependency contracts were declared.');
    const testIds = [...new Set(lock.publicContracts.flatMap(contract => contract.testIds))].sort();
    requireValue(testIds.length > 0 && testIds.length <= 64, 'Declare between 1 and 64 exact test files.');
    for (const id of testIds) requireValue(exactTestPath.test(id), 'Unsupported test ID; expected an exact Vitest test-file path: ' + id);
    receipt.source = sourceReceipt(root, lock, lockBytes, testIds);
    await writeFile(join(out, 'source-lock.json'), lockBytes, { flag: 'wx' });
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    requireValue(typeof pkg.packageManager === 'string' && /^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager), 'An exact pnpm packageManager version is required.');
    const installed = JSON.parse(readFileSync(join(root, 'node_modules/vitest/package.json'), 'utf8'));
    requireValue(typeof installed.version === 'string' && installed.version === (pkg.devDependencies?.vitest ?? pkg.dependencies?.vitest),
      'Installed Vitest must match the exact declared version.');
    receipt.vitestVersion = installed.version;
    const pm = resolvePackageManager(root);
    const environment = { COREPACK_ENABLE_NETWORK: '0', CI: 'true' };
    const version = await runRecordedCommand(pm.file, [...pm.prefix, '--version'], { cwd: root, timeoutMs: 30_000, environment });
    receipt.commands.push(await writeCommandEvidence(version, out, '00-package-manager', statusFromObservation(version)));
    receipt.packageManagerVersion = version.stdout.trim();
    requireValue(statusFromObservation(version) === 'PASS' && receipt.packageManagerVersion === pkg.packageManager.slice(5),
      'Pinned pnpm is unavailable offline or its version does not match.');
    const reportPath = join(out, 'vitest.json');
    const configPath = join(out, 'vitest.config.mjs');
    // Positional Vitest filters match substrings. A fresh exact include list
    // prevents a neighboring file from accidentally satisfying this contract.
    const config = [
      'import base from ' + JSON.stringify(join(root, 'vitest.config.ts').replaceAll('\\', '/')) + ';',
      'if (!base || typeof base !== "object" || Array.isArray(base) || typeof base.then === "function" || base.test?.projects || base.test?.dir) throw new Error("Unsupported Vitest project/config shape");',
      'export default { ...base, root: ' + JSON.stringify(root) + ', test: { ...base.test,',
      'include: ' + JSON.stringify(testIds) + ', passWithNoTests: false, allowOnly: false,',
      'reporters: ["json"], outputFile: ' + JSON.stringify(reportPath) + ', maxWorkers: 1 } };',
    ].join('\n');
    await writeFile(configPath, config, { flag: 'wx' });
    const observation = await runRecordedCommand(pm.file, [...pm.prefix, 'exec', 'vitest', 'run', '--config', configPath],
      { cwd: root, timeoutMs: 10 * 60_000, environment });
    receipt.commands.push(await writeCommandEvidence(observation, out, '10-contract-tests', statusFromObservation(observation)));
    if (observation.termination !== 'NONE' || observation.exitCode !== 0)
      receipt.issues.push({ code: 'COMMAND_NOT_SUCCESSFUL', message: 'Contract command termination=' + observation.termination + ', exitCode=' + observation.exitCode });
    try {
      requireValue(statSync(reportPath).size <= 16 * 1024 * 1024, 'Vitest report exceeds the 16 MiB bound.');
      const reportBytes = readFileSync(reportPath, 'utf8');
      receipt.report = { path: reportPath, digest: digest(reportBytes) };
      receipt.tests = inspectTestReport(JSON.parse(reportBytes), root, testIds);
      if (receipt.tests.some(test => test.status === 'BLOCKED'))
        receipt.issues.push({ code: 'CONTRACT_TEST_NOT_EXECUTED', message: 'Every declared file needs at least one passed assertion, with no skipped, pending, or todo cases.' });
    } catch (error) {
      receipt.issues.push({ code: 'CURRENT_TEST_RECEIPTS_MISSING', message: error instanceof Error ? error.message : String(error) });
    }
    try {
      requireValue(readFileSync(sourceLockPath, 'utf8') === lockBytes, 'Source-lock bytes changed during execution.');
      requireValue(readFileSync(configPath, 'utf8') === config, 'Exact test selection changed during execution.');
      const after = sourceReceipt(root, lock, lockBytes, testIds);
      requireValue(JSON.stringify(after) === JSON.stringify(receipt.source), 'Source custody changed during execution.');
    } catch (error) {
      receipt.issues.push({ code: 'SOURCE_CHANGED_DURING_EXECUTION', message: error instanceof Error ? error.message : String(error) });
    }
    receipt.status = receipt.tests.some(test => test.status === 'FAIL') ? 'FAIL'
      : receipt.issues.length === 0 && receipt.tests.length === testIds.length ? 'PASS' : 'BLOCKED';
  } catch (error) {
    receipt.issues.push({ code: 'COMPATIBILITY_SETUP_BLOCKED', message: error instanceof Error ? error.message : String(error) });
  }
  receipt.contracts = (lock?.publicContracts ?? []).map<DependencyExecutionReceipt['contracts'][number]>(contract => ({
    ...contract, status: contract.testIds.some(id => receipt.tests.some(test => test.testId === id && test.status === 'FAIL')) ? 'FAIL'
      : receipt.status === 'PASS' ? 'PASS' : 'BLOCKED',
  }));
  receipt.endedAt = new Date().toISOString();
  await writeFile(join(out, 'compatibility.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}

export async function dependencyContractsMain(args: string[]): Promise<number> {
  if (args.length !== 4 || args[0] !== '--source-lock' || args[2] !== '--out' || !args[1] || !args[3]) {
    console.error('Usage: tsx scripts/run-dependency-contracts.ts --source-lock <file> --out <NEW-directory>');
    return 2;
  }
  const receipt = await runDependencyContracts(resolve(args[1]), resolve(args[3]));
  console.log(JSON.stringify(receipt, null, 2));
  return receipt.status === 'PASS' ? 0 : receipt.status === 'FAIL' ? 1 : 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dependencyContractsMain(process.argv.slice(2)).then(code => { process.exitCode = code; })
    .catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 2; });
}
