// M01 baseline runner: executes declared commands as recorded CommandEvidence.
// Reuses the repository's Windows-capable launcher (packages/capabilities/process.ts):
// argv arrays, explicit cwd, inherited-environment allowlist, bounded output and
// a hard deadline, with owned process-tree kill on timeout/cancel. It never
// invokes a .cmd shim with shell:false — package-manager calls go through the
// real corepack executable (or a resolved JS entry under process.execPath).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HarnessError } from '../packages/contracts/index.ts';
import { runProcess } from '../packages/capabilities/process.ts';
import type { BenchmarkRecord, CommandEvidence, CommandStatus, CommandTermination, ExpectedNegative, EvidenceIssue, SourceLockV3 } from '../packages/contracts/implementation-evidence.ts';
import { sourceLockV3Schema } from '../packages/contracts/implementation-evidence.ts';

const OUTPUT_LIMIT = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const root = fileURLToPath(new URL('../', import.meta.url));

export interface ResolvedExecutable { file: string; identity: string }
// Spawn requires a real executable image: on Windows the package-manager shim
// is pnpm.cmd, which CreateProcess cannot run without a shell. Resolve the
// corepack PE executable instead; it dispatches to the declared pnpm version.
export function resolveExecutable(name: string): ResolvedExecutable {
  if (/\.(cmd|bat|ps1)$/i.test(name)) throw new HarnessError('UNSAFE_EXECUTABLE', `Refusing to spawn a shell shim without a shell: ${name}`);
  if (name.includes('/') || name.includes('\\') || isAbsolute(name)) {
    const target = resolve(name);
    const targetStat = statSync(target, { throwIfNoEntry: false });
    if (!targetStat) throw new HarnessError('SPAWN_ERROR', `Executable is missing: ${target}`);
    if (!targetStat.isFile()) throw new HarnessError('SPAWN_ERROR', `Executable path is not a file: ${target}`);
    return { file: target, identity: realpathSync(target) };
  }
  for (const dir of (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const candidate of [name, `${name}.exe`, `${name}.com`]) {
      const target = join(dir, candidate);
      if (existsSync(target) && statSync(target).isFile()) return { file: target, identity: realpathSync(target) };
    }
  }
  throw new HarnessError('SPAWN_ERROR', `Executable is not on PATH: ${name}`);
}

export interface PackageManagerResolution { file: string; prefix: string[]; declaredVersion: string | null }
interface InstalledPnpm { resolution: PackageManagerResolution; matchesDeclared: boolean }
// Resolve an installed pnpm (npm's symlink or the JavaScript entry beside its
// Windows shim) and read the version from its own package metadata. A shim is
// never returned: `shell:false` cannot run a .cmd file, and corepack shims
// resolve to corepack's dispatcher, which is handled separately.
function installedPnpm(declared: string | null): InstalledPnpm | null {
  // A corepack shim is not an installed copy: it is the dispatcher, which the
  // caller falls back to only after this search fails to produce a match.
  const shimmed = (path: string) => path.split(/[\\/]/).includes('corepack');
  let fallback: InstalledPnpm | null = null;
  for (const directory of (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const name of ['pnpm', 'pnpm.exe', 'pnpm.cmd', 'pnpm.CMD']) {
      const target = join(directory, name);
      if (!existsSync(target) || !statSync(target).isFile()) continue;
      const actual = realpathSync(target);
      if (/\.exe$/i.test(actual)) {
        if (!shimmed(actual)) fallback ??= { resolution: { file: actual, prefix: [], declaredVersion: declared }, matchesDeclared: false };
        continue;
      }
      for (const entry of [actual, join(dirname(actual), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'), join(dirname(actual), '..', 'pnpm', 'bin', 'pnpm.cjs')]) {
        if (!/\.[cm]?js$/i.test(entry) || !existsSync(entry) || !statSync(entry).isFile() || shimmed(entry)) continue;
        let version: string | null = null;
        for (const metadataPath of [join(dirname(entry), 'package.json'), join(dirname(entry), '..', 'package.json')]) {
          if (!existsSync(metadataPath)) continue;
          try {
            const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
            if (metadata?.name === 'pnpm' && typeof metadata.version === 'string') { version = metadata.version; break; }
          } catch { /* Unreadable metadata is not a version claim. */ }
        }
        const resolution = { file: process.execPath, prefix: [realpathSync(entry)], declaredVersion: declared };
        // A later PATH entry may still carry the declared version.
        if (version !== null && version === declared) return { resolution, matchesDeclared: true };
        fallback ??= { resolution, matchesDeclared: false };
      }
    }
  }
  return fallback;
}
export function resolvePackageManager(repoRoot: string): PackageManagerResolution {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@').at(-1)! : null;
  // An installed copy that names the declared version answers `--version`
  // offline. Corepack may sit beside node and still be unable to fetch that
  // version with COREPACK_ENABLE_NETWORK=0, so it never outranks this match.
  const installed = installedPnpm(declared);
  if (installed?.matchesDeclared) return installed.resolution;
  // `corepack enable` lays down POSIX/.cmd shims, not a PE image, so the real
  // entry on Windows is node.exe plus corepack's per-manager dispatcher.
  const dispatcher = join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js');
  if (existsSync(dispatcher)) return { file: process.execPath, prefix: [dispatcher], declaredVersion: declared };
  try {
    const corepack = resolveExecutable('corepack');
    return { file: corepack.file, prefix: ['pnpm'], declaredVersion: declared };
  } catch (error) {
    if (!(error instanceof HarnessError) || error.code !== 'SPAWN_ERROR') throw error;
  }
  // Corepack is optional when the declared pnpm is already installed; a
  // different installed version is still preferred over refusing to run, so
  // the caller reports the observed mismatch instead of a missing toolchain.
  if (installed) return installed.resolution;
  throw new HarnessError('SPAWN_ERROR', 'Corepack or an installed pnpm executable/JavaScript entry is required.');
}

export interface RecordedObservation {
  argv: string[]; cwdIdentity: string; executableIdentity: string;
  startedAt: string; endedAt: string; exitCode: number | null;
  termination: CommandTermination; stdout: string; stderr: string;
  truncated: boolean; pid?: number; spawnError?: string;
}
export interface RunRecordedOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  environment?: NodeJS.ProcessEnv;
  outputLimit?: number;
}

export async function runRecordedCommand(file: string, args: string[], options: RunRecordedOptions): Promise<RecordedObservation> {
  const startedAt = new Date().toISOString();
  const finish = (partial: Omit<RecordedObservation, 'argv' | 'startedAt' | 'endedAt'>): RecordedObservation =>
    ({ argv: [file, ...args], startedAt, endedAt: new Date().toISOString(), ...partial });
  let resolved: ResolvedExecutable, cwdIdentity: string;
  try { resolved = resolveExecutable(file); } catch (error) {
    return finish({ cwdIdentity: options.cwd, executableIdentity: file, exitCode: null, termination: 'SPAWN_ERROR', stdout: '', stderr: '', truncated: false, spawnError: error instanceof Error ? error.message : String(error) });
  }
  try { cwdIdentity = realpathSync(resolve(options.cwd)); } catch (error) {
    return finish({ cwdIdentity: options.cwd, executableIdentity: resolved.identity, exitCode: null, termination: 'SPAWN_ERROR', stdout: '', stderr: '', truncated: false, spawnError: `Invalid working directory: ${error instanceof Error ? error.message : String(error)}` });
  }
  if (!statSync(cwdIdentity).isDirectory())
    return finish({ cwdIdentity, executableIdentity: resolved.identity, exitCode: null, termination: 'SPAWN_ERROR', stdout: '', stderr: '', truncated: false, spawnError: 'Working directory is not a directory' });
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const environment = options.environment?.COREPACK_ENABLE_NETWORK === '0' && process.env.COREPACK_HOME
      ? { COREPACK_HOME: process.env.COREPACK_HOME, ...options.environment } : options.environment;
    const result = await runProcess(resolved.file, args, cwdIdentity, controller.signal, () => {}, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, environment, options.outputLimit ?? OUTPUT_LIMIT);
    return finish({ cwdIdentity, executableIdentity: resolved.identity, exitCode: result.exitCode, termination: result.cancelled ? 'CANCELLED' : result.timedOut ? 'TIMEOUT' : 'NONE', stdout: result.stdout, stderr: result.stderr, truncated: result.truncated, pid: result.pid });
  } catch (error) {
    if (error instanceof HarnessError && error.code === 'CANCELLED')
      return finish({ cwdIdentity, executableIdentity: resolved.identity, exitCode: null, termination: 'CANCELLED', stdout: '', stderr: '', truncated: false, spawnError: error.message });
    return finish({ cwdIdentity, executableIdentity: resolved.identity, exitCode: null, termination: 'SPAWN_ERROR', stdout: '', stderr: '', truncated: false, spawnError: error instanceof Error ? error.message : String(error) });
  } finally { options.signal?.removeEventListener('abort', onAbort); }
}

// An expected-negative fixture is PASS only when its asserted failure was
// observed (the marker in bounded output with a clean exit). A command that
// exits nonzero is FAIL, never an expected negative.
export function statusFromObservation(observation: RecordedObservation, options: { expectedNegativeMarker?: string | RegExp } = {}): CommandStatus {
  if (observation.termination !== 'NONE') return 'BLOCKED';
  if (observation.exitCode !== 0) return 'FAIL';
  const marker = options.expectedNegativeMarker;
  if (marker === undefined) return 'PASS';
  const output = `${observation.stdout}\n${observation.stderr}`;
  return (typeof marker === 'string' ? output.includes(marker) : marker.test(output)) ? 'EXPECTED_NEGATIVE' : 'FAIL';
}

export async function writeCommandEvidence(observation: RecordedObservation, outDir: string, id: string, status: CommandStatus, expectedNegative?: ExpectedNegative): Promise<CommandEvidence> {
  await mkdir(outDir, { recursive: true });
  const boundedLogRef = join(outDir, `${id}.log`);
  const log = [
    `argv: ${JSON.stringify(observation.argv)}`,
    `cwd: ${observation.cwdIdentity}`,
    `termination: ${observation.termination}`,
    `exitCode: ${observation.exitCode === null ? 'null' : observation.exitCode}`,
    ...(observation.spawnError ? [`spawnError: ${observation.spawnError}`] : []),
    ...(observation.truncated ? ['[output truncated at bound]'] : []),
    '--- stdout ---', observation.stdout,
    '--- stderr ---', observation.stderr,
  ].join('\n');
  await writeFile(boundedLogRef, log, 'utf8');
  return {
    argv: observation.argv, cwdIdentity: observation.cwdIdentity, executableIdentity: observation.executableIdentity,
    startedAt: observation.startedAt, endedAt: observation.endedAt, exitCode: observation.exitCode,
    termination: observation.termination, status, boundedLogRef, logDigest: sha256(log),
    ...(expectedNegative ? { expectedNegative } : {}),
  };
}

// The dependency-contract checker: verifies accepted commit ancestry, contract
// version (the blob SHA of the defining source at the execution base) and the
// presence of current contract tests. Unresolved drift blocks the affected
// integration path; it never fabricates a clean baseline.
export const CONTRACT_SOURCES: Record<string, string> = {
  'runtime-adapter': 'packages/contracts/index.ts',
  'store-command': 'packages/storage/store.ts',
  'process-launcher': 'packages/capabilities/process.ts',
  'eval-runner': 'evals/runner.ts',
  'browser-suite-registry': 'scripts/browser-suites.ts',
  'preference-schema': 'packages/contracts/preferences.ts',
};

function git(rootDir: string, args: string[]): string {
  return execFileSync('git', ['-C', rootDir, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

export function verifySourceLock(rootDir: string, lock: SourceLockV3): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  sourceLockV3Schema.parse(lock);
  try { git(rootDir, ['merge-base', '--is-ancestor', lock.auditAncestorSha, lock.executionBaseSha]); }
  catch { issues.push({ code: 'AUDIT_NOT_ANCESTOR', message: 'Audit commit ' + lock.auditAncestorSha + ' is not an ancestor of ' + lock.executionBaseSha + '.' }); }
  const approved = new Map(lock.approvedDrift.map(item => [item.path, item]));
  for (const inspected of lock.inspectedPaths) {
    if (inspected.path.includes('..') || isAbsolute(inspected.path) || inspected.path.includes('\\') || inspected.path.includes(':'))
      issues.push({ code: 'INVALID_INSPECTED_PATH', message: `Inspected path is not a repository-relative path: ${inspected.path}` });
    let actual: string | null = null;
    try { actual = git(rootDir, ['rev-parse', `${lock.executionBaseSha}:${inspected.path}`]); } catch { /* missing at base */ }
    const drift = approved.get(inspected.path);
    if (actual === inspected.blobSha) continue;
    if (drift && drift.fromBlob === inspected.blobSha && drift.toBlob === actual)
      issues.push({ code: 'APPROVED_DRIFT_PRESENT', message: `${inspected.path}: recorded approved drift to ${drift.toBlob} — ${drift.note}` });
    else issues.push({ code: 'SOURCE_DRIFT', message: `${inspected.path}: blob at base is ${actual ?? 'missing'}, expected ${inspected.blobSha}` });
  }
  for (const sha of lock.acceptedDependencyCommits) {
    try { execFileSync('git', ['-C', rootDir, 'merge-base', '--is-ancestor', sha, lock.executionBaseSha], { windowsHide: true }); }
    catch { issues.push({ code: 'DEPENDENCY_NOT_ACCEPTED', message: `Accepted dependency commit ${sha} is not an ancestor of ${lock.executionBaseSha}.` }); }
  }
  for (const contract of lock.publicContracts) {
    const source = CONTRACT_SOURCES[contract.name];
    if (!source) { issues.push({ code: 'CONTRACT_UNKNOWN', message: `No defining source registered for contract ${contract.name}.` }); continue; }
    let actual: string | null = null;
    try { actual = git(rootDir, ['rev-parse', `${lock.executionBaseSha}:${source}`]); } catch { /* missing */ }
    if (actual !== contract.version)
      issues.push({ code: 'CONTRACT_VERSION_MISMATCH', message: `Contract ${contract.name} version ${contract.version} does not match ${source} blob ${actual ?? 'missing'} at base.` });
    for (const testId of contract.testIds) {
      let isFile = false;
      // Missing or inaccessible test files cannot establish compatibility.
      try { isFile = statSync(join(rootDir, testId), { throwIfNoEntry: false })?.isFile() ?? false; }
      catch { /* collect the issue and continue checking the other entries */ }
      if (!isFile) issues.push({ code: 'CONTRACT_TEST_MISSING', message: `Contract ${contract.name} test is not an accessible regular file: ${testId}` });
    }
  }
  return issues;
}

export function readSourceLock(path: string): SourceLockV3 {
  return sourceLockV3Schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const cell = (value: number | null, suffix = '') => `<td>${value === null ? 'unavailable' : `${value}${suffix}`}</td>`;
// Local development artifact only: distinguishes baseline, candidate,
// unavailable measurement, failed check and expected-negative reproduction.
// Byte budgets are labelled bytes, never tokens.
export function benchmarkReportHtml(records: readonly BenchmarkRecord[]): string {
  const rows = records.flatMap(record => (['baseline', 'candidate'] as const).map(role => {
    const run = record[role] ?? { role, status: 'UNAVAILABLE', measurement: {
      elapsedMs: null, coldStartMs: null, firstPublicResponseMs: null, requests: null,
      inputBytes: null, outputBytes: null, cacheInputBytes: null, cacheOutputBytes: null,
      totalCostBytes: null, backgroundCostBytes: null, completionQuality: null,
    } };
    const m = run.measurement;
    return `<tr class="${run.status.toLowerCase()}"><td>${escapeHtml(record.fixture)}</td><td>${escapeHtml(record.config)}</td><td>${record.model ? escapeHtml(record.model) : 'unavailable'}</td><td>${run.role}</td><td class="status">${run.status}</td><td>${record.seed}</td>`
      + cell(m.elapsedMs, ' ms') + cell(m.coldStartMs, ' ms') + cell(m.firstPublicResponseMs, ' ms') + cell(m.requests)
      + cell(m.inputBytes, ' B') + cell(m.outputBytes, ' B') + cell(m.cacheInputBytes, ' B') + cell(m.cacheOutputBytes, ' B')
      + cell(m.totalCostBytes, ' B') + cell(m.backgroundCostBytes, ' B') + cell(m.completionQuality)
      + `<td>${record.notes.map(escapeHtml).join('; ') || ''}</td></tr>`;
  }));
  return `<!doctype html><meta charset="utf-8"><title>Benchmark report</title>
<style>body{font:14px/1.4 system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px;text-align:left}.pass{background:#e7f6e7}.fail,.setup_failed{background:#fbe4e4}.unavailable{background:#f3f3f3;color:#777}.expected_negative{background:#fff3cd}</style>
<h1>Paired benchmark report</h1><p>Local development artifact. All sizes and costs are byte budgets, labelled in bytes. Unmeasured fields are "unavailable", never fabricated.</p>
<table><thead><tr><th>fixture</th><th>config</th><th>model</th><th>role</th><th>status</th><th>seed</th><th>elapsed</th><th>cold start</th><th>first public response</th><th>requests</th><th>input</th><th>output</th><th>cache read</th><th>cache write</th><th>total cost</th><th>background cost</th><th>quality</th><th>notes</th></tr></thead><tbody>
${rows.join('\n')}
</tbody></table>`;
}

interface BaselineCommand { id: string; args: string[]; required: boolean }
const baselineCommands = (pm: PackageManagerResolution): BaselineCommand[] => [
  { id: 'typecheck', args: [...pm.prefix, 'typecheck'], required: true },
  { id: 'test', args: [...pm.prefix, 'test'], required: true },
  { id: 'build', args: [...pm.prefix, 'build'], required: true },
  { id: 'test-browser', args: [...pm.prefix, 'test:browser'], required: true },
];

export interface BaselineOptions { commandTimeoutMs?: number }
function baselineCommandTimeout(value: unknown): number {
  // Node timers overflow beyond this finite signed 32-bit range.
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
    throw new HarnessError('INVALID_INPUT', 'Command timeout must be an integer from 1 to 2147483647 milliseconds.');
  return value;
}

export async function runBaseline(outDir: string, repoRoot = root, options: BaselineOptions = {}): Promise<{ commands: CommandEvidence[]; platform: string; nodeVersion: string; packageManagerVersion: string; commandTimeoutMs: number }> {
  const commandTimeoutMs = baselineCommandTimeout(options.commandTimeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.commandTimeoutMs);
  if (existsSync(outDir)) throw new HarnessError('INVALID_INPUT', `Output directory must be new: ${outDir}`);
  const pm = resolvePackageManager(repoRoot);
  const commands: CommandEvidence[] = [];
  const environment = { COREPACK_ENABLE_NETWORK: '0' };
  const versionObs = await runRecordedCommand(pm.file, [...pm.prefix, '--version'], { cwd: repoRoot, timeoutMs: 60_000, environment });
  const packageManagerVersion = statusFromObservation(versionObs) !== 'PASS' ? 'unavailable' : versionObs.stdout.trim().split('\n').at(-1) ?? 'unavailable';
  commands.push(await writeCommandEvidence(versionObs, outDir, '00-package-manager', statusFromObservation(versionObs)));
  if (!pm.declaredVersion || packageManagerVersion !== pm.declaredVersion)
    throw new HarnessError('INCOMPATIBLE_TOOLCHAIN', `Installed pnpm ${packageManagerVersion} does not match the declared version ${pm.declaredVersion ?? 'unavailable'}.`);
  for (const item of baselineCommands(pm)) {
    const observation = await runRecordedCommand(pm.file, item.args, { cwd: repoRoot, signal: undefined, timeoutMs: commandTimeoutMs, environment });
    commands.push(await writeCommandEvidence(observation, outDir, `10-${item.id}`, statusFromObservation(observation)));
  }
  return { commands, platform: `${process.platform}-${process.arch}`, nodeVersion: process.version, packageManagerVersion, commandTimeoutMs };
}

export function baselineMain(args: string[]): Promise<number> {
  const usage = () => {
    console.error('Usage: tsx scripts/research-baseline.ts --out <NEW-directory> [--command-timeout-ms <1..2147483647>]');
    return Promise.resolve(2);
  };
  let outDir: string | undefined, commandTimeoutMs: number | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!value || value.startsWith('--')) return usage();
    if (name === '--out' && outDir === undefined) outDir = value;
    else if (name === '--command-timeout-ms' && commandTimeoutMs === undefined && /^[1-9][0-9]*$/.test(value)) {
      try { commandTimeoutMs = baselineCommandTimeout(Number(value)); }
      catch { return usage(); }
    } else return usage();
  }
  if (outDir === undefined) return usage();
  return runBaseline(resolve(outDir), root, { commandTimeoutMs }).then(result => {
    const failed = result.commands.filter(command => command.status === 'FAIL' || command.status === 'BLOCKED');
    console.log(JSON.stringify({ platform: result.platform, nodeVersion: result.nodeVersion, packageManagerVersion: result.packageManagerVersion, commandTimeoutMs: result.commandTimeoutMs, commands: result.commands.map(command => ({ status: command.status, argv: command.argv, exitCode: command.exitCode, termination: command.termination })) }, null, 2));
    return failed.length ? 1 : 0;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  baselineMain(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
