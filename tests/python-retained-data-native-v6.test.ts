import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { createProjectTrust } from '../packages/core/project-trust.ts';
import { hostFlagEnvName } from '../packages/core/host-flags.ts';
import { createPythonProgramProvider, type PythonHostConfiguration } from '../packages/core/python-program-provider.ts';
import {
  createPythonProgramWorker, inspectPythonRuntime, pythonProgramArguments, pythonRuntimeFingerprint, PYTHON_RETAINED_DATA_LIMITS,
  type PythonProgramWorkerOptions, type PythonRuntimeConfiguration,
} from '../packages/runtime/python-program-worker.ts';
import { DEFAULT_PROGRAM_LIMITS, type ProgramExecutionRequest, type ProgramExecutor, type PythonKernelV1 } from '../packages/contracts/tool-program.ts';
import type { ApprovedLaunch, PlatformProof } from '../packages/core/execution-policy.ts';
import type { RuntimeAdapter, Thread } from '../packages/contracts/index.ts';
import type { ToolOwner } from '../packages/contracts/tool-effects.ts';
import type { ToolProgramResult } from '../packages/core/tool-programs.ts';
import { testEffectAuthenticator } from './fixtures/effect-authenticator.ts';
import { pythonQualificationProfile } from './fixtures/python-qualification-profile.ts';

// M12-D06 retained-data accounting through the actual confined interpreter.
// Ordinary owned fixture files only: logical length and allocated bytes are
// checked separately against inclusive 64 MiB ceilings before launch and after
// the stopped-state proof. This is accepted retained-state accounting, not a
// filesystem quota; no confinement bypass or adversarial case is exercised.
const native = process.platform === 'linux' && process.arch === 'x64';
const qualification = pythonQualificationProfile();
const CEILING = Number(PYTHON_RETAINED_DATA_LIMITS.maxLogicalBytes);
const MIB = 1024 * 1024;
const proof: PlatformProof = {
  platformProofRef: 'm12-python-native-test-matrix', platform: 'linux-x64', status: 'PASS',
  recordedAt: '2026-11-15T00:00:00.000Z',
  evidenceRef: 'tests/python-retained-data-native-v6.test.ts (synthetic operator approval, owned retained-data fixtures)',
};
const owner: ToolOwner = { threadId: 'thread', runId: 'run', epoch: 1, projectId: 'project', workspaceId: 'workspace', accountBinding: 'account' };
let runtime: PythonRuntimeConfiguration;
const workers: ProgramExecutor[] = [], cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(workers.splice(0).map(worker => worker.stop()));
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function request(source: string): ProgramExecutionRequest {
  return { source, inputValues: [], limits: { ...DEFAULT_PROGRAM_LIMITS }, startSeed: 'a'.repeat(64), startClock: Date.now(),
    signal: new AbortController().signal, call: async () => ({ value: null, resultRef: 'unused', clock: Date.now() }) };
}

async function workerFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'm12-retained-native-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const launch: ApprovedLaunch = {
    profileId: 'M12_PRIVATE_PYTHON', profileVersion: 1, executable: runtime.interpreter.path, executableSha256: runtime.interpreter.sha256,
    argv: pythonProgramArguments(), cwd: directory, readRoots: [directory], writeRoots: [directory], networkPolicy: { mode: 'none' }, secretRefs: [],
  };
  const options: PythonProgramWorkerOptions = { runtime, generation: 1, launch, platformProof: proof, approved: true };
  const worker = createPythonProgramWorker(options); workers.push(worker);
  return { worker, directory };
}
const sparse = async (path: string, bytes: number) => { await writeFile(path, ''); await truncate(path, bytes); };
const allocatedOnly = (path: string, bytes: number) => execFileSync('fallocate', ['--keep-size', '-l', String(bytes), path]);
const ran = "open('/work/ran', 'w').close()\nresult = 1";
const absent = async (path: string) => { await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' }); };

describe.runIf(native)('M12-D06 retained-data accounting through the actual Python worker', () => {
  beforeAll(async () => {
    runtime = await inspectPythonRuntime(qualification.inspection);
    expect(runtime.interpreter.sha256).toBe('889c603f0d17cb54060951bcf4c4f9b8c9ebd9e52b392c70209bbb9755d797d9');
    if (qualification.expected) {
      expect(runtime).toEqual(qualification.expected.runtime);
      expect(pythonRuntimeFingerprint(runtime)).toBe(qualification.expected.runtimeFingerprint);
    }
  });

  it('admits exactly 64 MiB of logical length before launch', async () => {
    const { worker, directory } = await workerFixture();
    await sparse(join(directory, 'exact.bin'), CEILING);
    expect(await worker.execute(request(ran))).toBe(1);
    expect((await stat(join(directory, 'ran'))).isFile()).toBe(true);
  });

  it('refuses one logical byte over 64 MiB before launch and preserves the file', async () => {
    const { worker, directory } = await workerFixture();
    await sparse(join(directory, 'over.bin'), CEILING + 1);
    await expect(worker.execute(request(ran))).rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_LIMIT' });
    await absent(join(directory, 'ran'));
    expect((await stat(join(directory, 'over.bin'))).size).toBe(CEILING + 1);
    await expect(worker.execute(request(ran))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  });

  it('refuses allocated bytes over 64 MiB before launch even when logical length is zero', async () => {
    const { worker, directory } = await workerFixture(), file = join(directory, 'reserved.bin');
    await writeFile(file, ''); allocatedOnly(file, CEILING + MIB);
    const info = await stat(file, { bigint: true });
    expect(info.size).toBe(0n);
    expect(info.blocks * 512n).toBeGreaterThan(PYTHON_RETAINED_DATA_LIMITS.maxAllocatedBytes);
    await expect(worker.execute(request(ran))).rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_LIMIT' });
    await absent(join(directory, 'ran'));
    expect((await stat(file)).size).toBe(0);
  });

  it('refuses a pre-existing structural overage before launch', async () => {
    const { worker, directory } = await workerFixture();
    await Promise.all(Array.from({ length: 4096 }, (_, index) => writeFile(join(directory, `entry-${index}`), '')));
    await expect(worker.execute(request(ran))).rejects.toMatchObject({ code: 'PYTHON_DIRECTORY_LIMIT' });
    await absent(join(directory, 'ran'));
    expect(await readdir(directory)).toHaveLength(4096);
  });

  it('fails a cell that leaves more than 64 MiB after the stopped proof, requires reset and preserves its files', async () => {
    const { worker, directory } = await workerFixture();
    expect(await worker.execute(request('result = 0'))).toBe(0);
    // 65 ordinary 1 MiB files: each within the 1 MiB per-file limit.
    await expect(worker.execute(request("for i in range(65):\n open('/work/part-' + str(i), 'wb').write(b'x' * 1048576)\nresult = 65")))
      .rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_LIMIT' });
    const parts = (await readdir(directory)).filter(name => name.startsWith('part-'));
    expect(parts).toHaveLength(65);
    for (const name of parts) expect((await stat(join(directory, name))).size).toBe(MIB);
    await expect(worker.execute(request(ran))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
    await absent(join(directory, 'ran'));
  });

  it('records RESET_REQUIRED on the persistent kernel through the actual Service and keeps retained files', async () => {
    const f = await serviceFixture();
    const first = await cell(f, 'first', 'number = 7\nresult = number');
    expect(first).toMatchObject({ state: 'SUCCEEDED', generation: 1 });
    const over = await cell(f, 'over', "for i in range(65):\n open('/work/part-' + str(i), 'wb').write(b'x' * 1048576)\nresult = 65", { kernelId: first.kernelId });
    expect(over.state).toBe('FAILED');
    expect(over.aggregate).toBeUndefined();
    expect(f.store.get<PythonKernelV1>('pythonKernel', first.kernelId)).toMatchObject({ state: 'RESET_REQUIRED', retainedState: false });
    await expect(cell(f, 'no-reset', 'result = number', { kernelId: first.kernelId })).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
    expect((await readdir(f.cwd)).filter(name => name.startsWith('part-'))).toHaveLength(65);
  });
});

type PythonCellResult = ToolProgramResult & { kernelId: string; generation: number };
async function serviceFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'm12-retained-service-')), cwd = join(directory, 'work');
  await mkdir(cwd, { mode: 0o700 });
  await writeFile(join(directory, 'host-policy.json'), '{"profile":"private-python","revision":1}');
  const trust = await createProjectTrust({ rootPath: directory, approvedFiles: [{ path: 'host-policy.json', kind: 'configuration' }],
    scope: { read: true, write: true, network: 'none' }, decision: 'trusted' });
  const host: PythonHostConfiguration = {
    cwd, trust, trustRootPath: directory,
    env: { [hostFlagEnvName('security.executionProfilesV1')]: 'true', [hostFlagEnvName('security.projectTrustV1')]: 'true' },
    profile: { profileId: 'M12_PRIVATE_PYTHON', version: 1, backendId: runtime.backendId,
      capabilities: ['process.execute', 'fs.read', 'fs.write'], readRoots: [cwd], writeRoots: [cwd],
      networkPolicy: { mode: 'none' }, secretRefs: [],
      executableAllowlist: [{ executableSha256: runtime.interpreter.sha256, argv: pythonProgramArguments() }],
      platformProofRef: proof.platformProofRef },
  };
  const provider = createPythonProgramProvider({ runtime, platformProof: proof, approved: true, configuration: async () => host });
  const store = new Store(join(directory, 'state'));
  const adapter: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, adapter, { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true },
    toolEffectAuthenticator: testEffectAuthenticator(), toolPrograms: { flags: { 'tools.pythonKernelV1': true }, python: provider } });
  const thread: Thread = { id: owner.threadId, runId: owner.runId, epoch: owner.epoch, projectId: owner.projectId!, workspaceId: owner.workspaceId!,
    accountId: owner.accountBinding, title: 'Retained data', projectName: null, status: 'working', modelId: null, sessionPath: null, createdAt: '', updatedAt: '' };
  store.internal('fixture.created', thread.id, () => { store.put('thread', thread.id, thread.id, thread); });
  cleanups.push(async () => { await service.dispose(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { cwd, store, service, ctx: { threadId: thread.id, runId: owner.runId!, epoch: owner.epoch } };
}
async function cell(f: Awaited<ReturnType<typeof serviceFixture>>, commandId: string, source: string, options: Record<string, unknown> = {}): Promise<PythonCellResult> {
  return await f.service.tool({ name: 'python_cell', args: { commandId, source, allowedTools: [], requestedAggregate: 'Return the explicit fixture aggregate', ...options } }, f.ctx) as PythonCellResult;
}
