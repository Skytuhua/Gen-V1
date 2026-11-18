import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessError } from '../packages/contracts/index.ts';
import { createCapabilityFlags, CapabilityFlags } from '../packages/core/capability-flags.ts';
import {
  bundleStatus, commandEvidenceSchema, implementationEvidenceV3Schema, sourceLockV3Schema,
  validateCommandEvidence, validateImplementationEvidence,
  type BenchmarkRecord, type CommandEvidence, type ImplementationEvidenceV3, type PhaseEvidence,
} from '../packages/contracts/implementation-evidence.ts';
import {
  CONTRACT_SOURCES, benchmarkReportHtml, resolveExecutable, resolvePackageManager, runRecordedCommand,
  statusFromObservation, verifySourceLock, writeCommandEvidence,
} from '../scripts/research-baseline.ts';

const dirs: string[] = [];
const dir = (label: string) => {
  const target = mkdtempSync(join(tmpdir(), `m01-${label}-`));
  dirs.push(target);
  return target;
};
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const pidAlive = (pid: number | undefined) => {
  if (pid === undefined) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

describe('recorded command runner', () => {
  const cwd = process.cwd();

  it('records an exit-0 command as PASS evidence', async () => {
    const out = dir('exit0');
    const obs = await runRecordedCommand('node', ['-e', 'process.exit(0)'], { cwd });
    expect(obs.termination).toBe('NONE');
    expect(obs.exitCode).toBe(0);
    const evidence = await writeCommandEvidence(obs, out, 'exit0', statusFromObservation(obs));
    expect(evidence.status).toBe('PASS');
    expect(evidence.argv).toEqual(['node', '-e', 'process.exit(0)']);
    expect(commandEvidenceSchema.parse(evidence)).toBeTruthy();
    expect(validateCommandEvidence(evidence)).toEqual([]);
  });

  it('records an exit-7 command as FAIL, never an expected negative', async () => {
    const obs = await runRecordedCommand('node', ['-e', 'process.exit(7)'], { cwd });
    expect(obs.exitCode).toBe(7);
    expect(statusFromObservation(obs)).toBe('FAIL');
    expect(statusFromObservation(obs, { expectedNegativeMarker: 'anything' })).toBe('FAIL');
  });

  it('records a missing executable as SPAWN_ERROR', async () => {
    const obs = await runRecordedCommand('definitely-missing-m01-executable', [], { cwd });
    expect(obs.termination).toBe('SPAWN_ERROR');
    expect(obs.exitCode).toBeNull();
    expect(statusFromObservation(obs)).toBe('BLOCKED');
  });

  it('records an invalid working directory as SPAWN_ERROR', async () => {
    const obs = await runRecordedCommand('node', ['-e', ''], { cwd: join(cwd, 'does-not-exist-m01') });
    expect(obs.termination).toBe('SPAWN_ERROR');
    expect(obs.spawnError).toMatch(/working directory|ENOENT/i);
  });

  it('times out a hung child and kills its process tree', async () => {
    const obs = await runRecordedCommand('node', ['-e', 'setInterval(() => {}, 1000)'], { cwd, timeoutMs: 1500 });
    expect(obs.termination).toBe('TIMEOUT');
    expect(obs.pid).toBeDefined();
    expect(pidAlive(obs.pid)).toBe(false);
    expect(statusFromObservation(obs)).toBe('BLOCKED');
  });

  it('cancels a running child on abort and kills its process tree', async () => {
    const controller = new AbortController();
    const pending = runRecordedCommand('node', ['-e', 'setInterval(() => {}, 1000)'], { cwd, signal: controller.signal });
    setTimeout(() => controller.abort(), 200);
    const obs = await pending;
    expect(obs.termination).toBe('CANCELLED');
    expect(pidAlive(obs.pid)).toBe(false);
  });

  it('cancels a command whose signal is already aborted before launch', async () => {
    const controller = new AbortController();
    controller.abort();
    const obs = await runRecordedCommand('node', ['-e', 'process.exit(0)'], { cwd, signal: controller.signal });
    expect(obs.termination).toBe('CANCELLED');
    expect(obs.exitCode).toBeNull();
    expect(obs.stdout).toBe('');
  });

  it('bounds child output and marks truncation', async () => {
    const obs = await runRecordedCommand('node', ['-e', 'process.stdout.write("x".repeat(400000))'], { cwd, outputLimit: 4096 });
    expect(obs.truncated).toBe(true);
    expect(obs.stdout.length).toBeLessThanOrEqual(4096 + 8);
    expect(obs.termination).toBe('NONE');
  });

  it('runs fixture scripts at Unicode and space-containing paths', async () => {
    const workspace = dir('unicode  space');
    const script = join(workspace, 'fixture スクリプト.cjs');
    writeFileSync(script, 'process.exit(3)');
    const obs = await runRecordedCommand('node', [script], { cwd: workspace });
    expect(obs.termination).toBe('NONE');
    expect(obs.exitCode).toBe(3);
    expect(statusFromObservation(obs)).toBe('FAIL');
  });

  it('keeps ambient environment out of the child allowlist', async () => {
    process.env.M01_SECRET_MARKER = 'do-not-leak';
    try {
      const obs = await runRecordedCommand('node', ['-e', 'console.log(process.env.M01_SECRET_MARKER ?? "absent")'], { cwd });
      expect(obs.stdout).toContain('absent');
    } finally { delete process.env.M01_SECRET_MARKER; }
  });

  it('PASSes an expected-negative fixture only when the asserted failure was observed', async () => {
    const reproduction = 'console.log("known-bug: bad-value-42"); process.exit(0)';
    const obs = await runRecordedCommand('node', ['-e', reproduction], { cwd });
    const status = statusFromObservation(obs, { expectedNegativeMarker: 'bad-value-42' });
    expect(status).toBe('EXPECTED_NEGATIVE');
    const evidence = await writeCommandEvidence(obs, dir('neg'), 'neg', status, { assertedFailure: 'bad-value-42', observed: true });
    expect(validateCommandEvidence(evidence)).toEqual([]);
    const wrongMarker = statusFromObservation(obs, { expectedNegativeMarker: 'some-other-value' });
    expect(wrongMarker).toBe('FAIL');
  });
});

describe('executable resolution', () => {
  it('refuses .cmd shims and resolves real executables', () => {
    expect(() => resolveExecutable('pnpm.cmd')).toThrow(HarnessError);
    const node = resolveExecutable('node');
    expect(node.identity.toLowerCase()).toContain('node');
    expect(() => resolveExecutable('definitely-missing-m01')).toThrow(/not on PATH|missing/);
  });

  it('resolves the declared pnpm through the corepack executable', () => {
    const bin = dir('resolver');
    copyFileSync(process.execPath, join(bin, process.platform === 'win32' ? 'corepack.exe' : 'corepack'), constants.COPYFILE_FICLONE);
    vi.stubEnv('PATH', bin);
    try {
      const pm = resolvePackageManager(process.cwd());
      expect(pm.declaredVersion).toBe('10.30.3');
      expect(`${pm.file} ${pm.prefix.join(' ')}`.toLowerCase()).toContain('corepack');
      expect(pm.file).not.toMatch(/\.cmd$/i);
      expect(pm.prefix.length).toBeGreaterThan(0);
      expect(pm.prefix.every(arg => !/\.(cmd|bat|ps1)$/i.test(arg))).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });

  it('prefers an installed pnpm naming the declared version over corepack', () => {
    // Corepack can sit next to node and still fail `--version` offline: it has
    // to fetch the pinned tarball unless that exact version was already run.
    // A matching installed copy answers without the network, so it must win.
    const bin = dir('installed-bin'), packageRoot = join(dir('installed-pkg'), 'node_modules', 'pnpm');
    mkdirSync(join(packageRoot, 'bin'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'pnpm', version: '10.30.3' }));
    writeFileSync(join(packageRoot, 'bin', 'pnpm.cjs'), "process.stdout.write('10.30.3\\n');\n");
    symlinkSync(join(packageRoot, 'bin', 'pnpm.cjs'), join(bin, 'pnpm'));
    copyFileSync(process.execPath, join(bin, process.platform === 'win32' ? 'corepack.exe' : 'corepack'), constants.COPYFILE_FICLONE);
    vi.stubEnv('PATH', bin);
    try {
      const pm = resolvePackageManager(process.cwd());
      expect(pm.declaredVersion).toBe('10.30.3');
      expect(pm.file).toBe(process.execPath);
      expect(`${pm.file} ${pm.prefix.join(' ')}`.toLowerCase()).not.toContain('corepack');
      expect(pm.prefix.at(-1)).toContain(join('pnpm', 'bin', 'pnpm.cjs'));
    } finally { vi.unstubAllEnvs(); }
  });

  it('keeps a differently versioned installed pnpm as the last resort', () => {
    const bin = dir('mismatch-bin'), packageRoot = join(dir('mismatch-pkg'), 'node_modules', 'pnpm');
    mkdirSync(join(packageRoot, 'bin'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'pnpm', version: '9.15.0' }));
    writeFileSync(join(packageRoot, 'bin', 'pnpm.cjs'), "process.stdout.write('9.15.0\\n');\n");
    symlinkSync(join(packageRoot, 'bin', 'pnpm.cjs'), join(bin, 'pnpm'));
    // Corepack's per-manager dispatcher sits beside node, not on PATH, so the
    // fallback is only reachable once this run has no dispatcher next to it.
    const node = join(dir('mismatch-node'), process.platform === 'win32' ? 'node.exe' : 'node');
    writeFileSync(node, '');
    vi.stubEnv('PATH', bin);
    const execPath = vi.spyOn(process, 'execPath', 'get').mockReturnValue(node);
    try {
      // No corepack here, so the mismatch is reported by the caller as the
      // observed version rather than as a missing toolchain.
      const pm = resolvePackageManager(process.cwd());
      expect(pm.declaredVersion).toBe('10.30.3');
      expect(pm.prefix.at(-1)).toContain(join('pnpm', 'bin', 'pnpm.cjs'));
    } finally { execPath.mockRestore(); vi.unstubAllEnvs(); }
  });
});

describe('evidence manifest validation', () => {
  const command: CommandEvidence = {
    argv: ['node', '-e', 'process.exit(0)'], cwdIdentity: 'C:/repo', executableIdentity: 'C:/node/node.exe',
    startedAt: '2026-11-14T00:00:00Z', endedAt: '2026-11-14T00:00:01Z', exitCode: 0,
    termination: 'NONE', status: 'PASS', boundedLogRef: 'logs/1.log',
    logDigest: 'a'.repeat(64),
  };
  const phase = (over: Partial<PhaseEvidence> = {}): PhaseEvidence => ({
    id: 'unit', status: 'PASS', requiredCases: [{ id: 'suite', status: 'PASS' }],
    commands: [command], artifactRefs: [], ...over,
  });
  const evidence = (phases: PhaseEvidence[]): ImplementationEvidenceV3 => ({
    schemaVersion: 3, bundleId: 'M01', baseSha: 'b'.repeat(40), sourceLockDigest: 'c'.repeat(64),
    platform: 'win32-x64', nodeVersion: 'v24.22.2', packageManagerVersion: '10.30.3',
    phases, changedFiles: [], dependencyContracts: [], flags: [], remainingGates: [], reviewerApproval: false,
  });

  it('accepts a complete evidence manifest', () => {
    const value = evidence([phase()]);
    expect(implementationEvidenceV3Schema.parse(value)).toBeTruthy();
    expect(validateImplementationEvidence(value, { expectedBaseSha: 'b'.repeat(40) })).toEqual([]);
    expect(bundleStatus(value.phases)).toBe('PASS');
  });

  it('rejects a skipped required suite inside a PASS phase', () => {
    const issues = validateImplementationEvidence(evidence([phase({ requiredCases: [{ id: 'suite', status: 'NOT_RUN' }] })]));
    expect(issues.map(i => i.code)).toContain('REQUIRED_CASE_NOT_RUN');
    const empty = validateImplementationEvidence(evidence([phase({ requiredCases: [] })]));
    expect(empty.map(i => i.code)).toContain('SKIPPED_REQUIRED_SUITE');
  });

  it('rejects a stale base SHA', () => {
    const issues = validateImplementationEvidence(evidence([phase()]), { expectedBaseSha: 'd'.repeat(40) });
    expect(issues.map(i => i.code)).toContain('STALE_BASE_SHA');
  });

  it('rejects an incompatible dependency contract', () => {
    const value = evidence([phase()]);
    value.dependencyContracts = [{ name: 'process-launcher', version: 'f'.repeat(40), testIds: ['tests/capabilities.test.ts'] }];
    const issues = validateImplementationEvidence(value, { requiredContracts: [{ name: 'process-launcher', version: 'e'.repeat(40) }] });
    expect(issues.map(i => i.code)).toContain('CONTRACT_MISMATCH');
  });

  it('rejects a self-reported PASS with no command evidence', () => {
    const issues = validateImplementationEvidence(evidence([phase({ commands: [] })]));
    expect(issues.map(i => i.code)).toContain('NO_COMMAND_EVIDENCE');
  });

  it('computes bundle status FAIL/PARTIAL/BLOCKED from phase outcomes', () => {
    expect(bundleStatus([phase({ status: 'PASS' }), phase({ id: 'x', status: 'FAIL' })])).toBe('FAIL');
    expect(bundleStatus([phase({ requiredCases: [{ id: 'suite', status: 'FAIL' }] })])).toBe('FAIL');
    expect(bundleStatus([phase({ status: 'PASS' }), phase({ id: 'x', status: 'BLOCKED' })])).toBe('PARTIAL');
    expect(bundleStatus([phase({ status: 'BLOCKED' }), phase({ id: 'x', status: 'NOT_RUN' })])).toBe('BLOCKED');
    expect(bundleStatus([])).toBe('BLOCKED');
  });
});

describe('capability flag registry', () => {
  const defs = [
    { key: 'm01.evidence', owner: 'M01', description: 'Evidence runner wiring' },
    { key: 'm01.benchmarks', owner: 'M01', description: 'Benchmark fixtures' },
  ] as const;

  it('defaults every registered key to false and rejects unknown keys', () => {
    const flags = new CapabilityFlags<'m01.evidence' | 'm01.benchmarks'>([...defs]);
    expect(flags.enabled('m01.evidence')).toBe(false);
    expect(flags.enabled('m01.benchmarks')).toBe(false);
    expect(() => flags.enabled('nope' as never)).toThrow(HarnessError);
    expect(() => flags.set('nope' as never, true)).toThrow(HarnessError);
  });

  it('rejects unknown override keys at construction and sets keys independently', () => {
    expect(() => createCapabilityFlags([...defs], { 'ghost': true } as never)).toThrow(HarnessError);
    const flags = createCapabilityFlags<'m01.evidence' | 'm01.benchmarks'>([...defs]);
    flags.set('m01.evidence', true);
    expect(flags.enabled('m01.evidence')).toBe(true);
    expect(flags.enabled('m01.benchmarks')).toBe(false);
    expect(flags.snapshot()).toEqual({ 'm01.evidence': true, 'm01.benchmarks': false });
    expect(Object.isFrozen(flags.snapshot())).toBe(true);
  });
});

// Deterministic crash/race infrastructure: pause points before admission,
// before dispatch, after external effect, before settlement and after commit.
// Fault injection lives in this test factory only — never a production flag —
// and it terminates/relaunches a real child process, not only thrown
// exceptions. Fixed seeds 1, 2, 7, 42 and 99 reproduce identical control
// actions and identical observed external-effect counts.
const PAUSE_POINTS = ['before-admission', 'before-dispatch', 'after-external-effect', 'before-settlement', 'after-commit'] as const;
type PausePoint = typeof PAUSE_POINTS[number];

function mulberry(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CrashTrace { actions: string[]; observedExternalEffects: number; pids: number[] }

async function crashPipeline(seed: number, workspace: string): Promise<CrashTrace> {
  const rand = mulberry(seed);
  const actions: string[] = [];
  const pids: number[] = [];
  const marker = join(workspace, 'effects.log');
  const spawnWorker = () => {
    const child = spawn(process.execPath, ['-e',
      `process.stdin.once('data',()=>{require('node:fs').appendFileSync(${JSON.stringify(marker)},'x');process.exit(0)});setInterval(()=>{},500)`],
      { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    pids.push(child.pid!);
    return child;
  };
  let worker = spawnWorker();
  const kill = async () => {
    worker.kill('SIGKILL');
    await once(worker, 'close');
    worker = spawnWorker();
  };
  const pause = async (point: PausePoint) => {
    actions.push(point);
    const roll = rand();
    if (roll < 0.3) { actions.push(`${point}:terminate-relaunch`); await kill(); }
    else if (roll < 0.45) { actions.push(`${point}:fault`); throw new HarnessError('INJECTED_FAULT', `fault at ${point}`); }
  };
  await (async () => {
    try {
      await pause('before-admission');
      actions.push('admit');
      await pause('before-dispatch');
      actions.push('dispatch');
      worker.stdin.end('go\n');
      await once(worker, 'close');
      worker = spawnWorker();
      await pause('after-external-effect');
      await pause('before-settlement');
      actions.push('settle');
      actions.push('commit');
      await pause('after-commit');
    } catch { actions.push('halt'); }
  })();
  const observedExternalEffects = existsSync(marker) ? readFileSync(marker, 'utf8').length : 0;
  worker.kill('SIGKILL');
  await once(worker, 'close');
  expect(pidAlive(worker.pid)).toBe(false);
  return { actions, observedExternalEffects, pids };
}

describe('crash/race fixtures', () => {
  it('reproduce identical control actions and effect counts per fixed seed', async () => {
    const runs = new Map<number, CrashTrace>();
    for (const seed of [1, 2, 7, 42, 99]) {
      const first = await crashPipeline(seed, dir(`crash-${seed}-a`));
      const second = await crashPipeline(seed, dir(`crash-${seed}-b`));
      expect(second.actions).toEqual(first.actions);
      expect(second.observedExternalEffects).toBe(first.observedExternalEffects);
      expect(first.pids.length).toBeGreaterThanOrEqual(1);
      expect(new Set(first.pids).size).toBe(first.pids.length);
      runs.set(seed, first);
    }
    const allActions = [...runs.values()].flatMap(run => run.actions);
    for (const point of PAUSE_POINTS) expect(allActions).toContain(point);
    expect(allActions.some(action => action.endsWith(':terminate-relaunch'))).toBe(true);
  });
});

describe('benchmark report shape fixtures', () => {
  const record = (): BenchmarkRecord => {
    const measurement = {
      elapsedMs: null, coldStartMs: null, firstPublicResponseMs: null, requests: null,
      inputBytes: null, outputBytes: null, cacheInputBytes: null, cacheOutputBytes: null,
      totalCostBytes: null, backgroundCostBytes: null, completionQuality: null,
    };
    return {
      fixture: 'renderer-only-fixture', model: null, account: null, config: 'Report formatting only', seed: 42,
      baseline: { role: 'baseline', status: 'UNAVAILABLE', measurement },
      candidate: { role: 'candidate', status: 'UNAVAILABLE', measurement: { ...measurement } },
      notes: ['No workload or provider request was executed by this report shape fixture.'],
    };
  };

  it('labels both arms and keeps unmeasured values unavailable', () => {
    const html = benchmarkReportHtml([record()]);
    expect(html).toContain('baseline');
    expect(html).toContain('candidate');
    expect(html).toContain('unavailable');
    expect(html).toContain('UNAVAILABLE');
  });

  it('renders setup failure separately from model-quality failure and expected regression', () => {
    const broken = record();
    broken.baseline!.status = 'SETUP_FAILED';
    expect(benchmarkReportHtml([broken])).toContain('SETUP_FAILED');
    expect(broken.baseline!.status).not.toBe('EXPECTED_NEGATIVE');
    expect(broken.baseline!.status).not.toBe('FAIL');
  });
});

describe('dependency-contract checker', () => {
  it('requires a file at a declared contract test path', () => {
    const checkout = dir('contract-file');
    const git = (...args: string[]) => execFileSync('git', ['-C', checkout, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const source = 'packages/capabilities/process.ts', testId = 'tests/contract.test.ts';
    git('init', '-q');
    mkdirSync(join(checkout, 'packages', 'capabilities'), { recursive: true });
    mkdirSync(join(checkout, testId), { recursive: true });
    writeFileSync(join(checkout, source), 'export {};');
    git('add', '--', source);
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Seed');
    const sha = git('rev-parse', 'HEAD'), blob = git('rev-parse', sha + ':' + source);
    const lock = sourceLockV3Schema.parse({
      schemaVersion: 3, auditAncestorSha: sha, executionBaseSha: sha, inspectedPaths: [{ path: source, blobSha: blob }],
      publicContracts: [{ name: 'process-launcher', version: blob, testIds: [testId] }], acceptedDependencyCommits: [], approvedDrift: [],
    });
    expect(verifySourceLock(checkout, lock).map(issue => issue.code)).toEqual(['CONTRACT_TEST_MISSING']);
    rmSync(join(checkout, testId), { recursive: true });
    writeFileSync(join(checkout, testId), 'export {};');
    expect(verifySourceLock(checkout, lock)).toEqual([]);
  });

  it('flags drift, missing ancestry, contract version mismatch and absent contract tests', () => {
    const lock = sourceLockV3Schema.parse({
      schemaVersion: 3,
      auditAncestorSha: 'a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54',
      executionBaseSha: 'b'.repeat(40),
      inspectedPaths: [{ path: 'packages/capabilities/process.ts', blobSha: '0'.repeat(40) }],
      publicContracts: [{ name: 'process-launcher', version: '0'.repeat(40), testIds: ['tests/no-such-contract.test.ts'] }],
      acceptedDependencyCommits: ['a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54'],
      approvedDrift: [],
    });
    const issues = verifySourceLock(process.cwd(), lock);
    const codes = issues.map(item => item.code);
    expect(codes).toContain('SOURCE_DRIFT');
    expect(codes).toContain('DEPENDENCY_NOT_ACCEPTED');
    expect(codes).toContain('CONTRACT_VERSION_MISMATCH');
    expect(codes).toContain('CONTRACT_TEST_MISSING');
    expect(CONTRACT_SOURCES['process-launcher']).toBe('packages/capabilities/process.ts');
  });
});
