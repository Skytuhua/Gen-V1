import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../packages/core/service.ts';
import { Store, digest } from '../packages/storage/store.ts';
import { createProjectTrust } from '../packages/core/project-trust.ts';
import { hostFlagEnvName } from '../packages/core/host-flags.ts';
import { createPythonProgramProvider, type PythonHostConfiguration } from '../packages/core/python-program-provider.ts';
import { inspectPythonRuntime, pythonProgramArguments, pythonRuntimeFingerprint, type PythonRuntimeConfiguration } from '../packages/runtime/python-program-worker.ts';
import { DEFAULT_PROGRAM_LIMITS, type ProgramExecutionRequest, type ProgramExecutor, type ProgramJournalV1, type PythonKernelV1 } from '../packages/contracts/tool-program.ts';
import type { PlatformProof } from '../packages/core/execution-policy.ts';
import type { ResourceGrant, RuntimeAdapter, Thread } from '../packages/contracts/index.ts';
import type { ToolOwner, ToolEffectRecord } from '../packages/contracts/tool-effects.ts';
import type { ToolProgramResult } from '../packages/core/tool-programs.ts';
import { testEffectAuthenticator } from './fixtures/effect-authenticator.ts';
import { pythonQualificationProfile } from './fixtures/python-qualification-profile.ts';

const native = process.platform === 'linux' && process.arch === 'x64';
// Historical host paths unless the test-only qualification manifest is explicitly selected.
const qualification = pythonQualificationProfile();
const cleanups: (() => Promise<void>)[] = [], executors: ProgramExecutor[] = [];
let runtime: PythonRuntimeConfiguration;
const proof: PlatformProof = {
  platformProofRef: 'm12-python-native-test-matrix', platform: 'linux-x64', status: 'PASS',
  recordedAt: '2026-11-15T00:00:00.000Z',
  evidenceRef: 'tests/python-program-backend-v3.test.ts and tests/python-program-integration-v3.test.ts (synthetic operator approval, actual native confinement)',
};
const owner: ToolOwner = { threadId: 'thread', runId: 'run', epoch: 1, projectId: 'project', workspaceId: 'workspace', accountBinding: 'account' };
const flags = {
  [hostFlagEnvName('security.executionProfilesV1')]: 'true',
  [hostFlagEnvName('security.projectTrustV1')]: 'true',
};
type PythonCellResult = ToolProgramResult & { kernelId: string; generation: number };

afterEach(async () => {
  await Promise.allSettled(executors.splice(0).map(executor => executor.stop()));
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(options: { approved?: boolean; platformProof?: PlatformProof } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'm12-python-provider-')), cwd = join(directory, 'work');
  await mkdir(cwd, { mode: 0o700 });
  const policyFile = join(directory, 'host-policy.json');
  await writeFile(policyFile, '{"profile":"private-python","revision":1}');
  const trust = await createProjectTrust({ rootPath: directory, approvedFiles: [{ path: 'host-policy.json', kind: 'configuration' }],
    scope: { read: true, write: true, network: 'none' }, decision: 'trusted' });
  const host: { current: PythonHostConfiguration; wait?: Promise<void> } = { current: {
    cwd, trust, trustRootPath: directory, env: { ...flags, PROVIDER_PRIVATE_ENV: 'not-for-python' },
    profile: { profileId: 'M12_PRIVATE_PYTHON', version: 1, backendId: runtime.backendId,
      capabilities: ['process.execute', 'fs.read', 'fs.write'], readRoots: [cwd], writeRoots: [cwd],
      networkPolicy: { mode: 'none' }, secretRefs: [],
      executableAllowlist: [{ executableSha256: runtime.interpreter.sha256, argv: pythonProgramArguments() }],
      platformProofRef: proof.platformProofRef },
  } };
  const configurationOwners: ToolOwner[] = [];
  const provider = createPythonProgramProvider({ runtime, platformProof: options.platformProof ?? proof, approved: options.approved ?? true,
    configuration: async configuredOwner => { configurationOwners.push(structuredClone(configuredOwner)); await host.wait; return host.current; } });
  const store = new Store(join(directory, 'state'));
  const adapter: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, adapter, { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true },
    toolEffectAuthenticator: testEffectAuthenticator(),
    toolPrograms: { flags: { 'tools.pythonKernelV1': true }, python: provider } });
  const thread: Thread = { id: owner.threadId, runId: owner.runId, epoch: owner.epoch, projectId: owner.projectId!, workspaceId: owner.workspaceId!,
    accountId: owner.accountBinding, title: 'Python integration', projectName: null, status: 'working', modelId: null, sessionPath: null, createdAt: '', updatedAt: '' };
  const sourcePath = join(directory, 'source.json');
  await writeFile(sourcePath, JSON.stringify({ rows: [1, 2, 3], privateMarker: 'M12_PROVIDER_PRIVATE_SOURCE' }));
  const info = await stat(sourcePath, { bigint: true });
  const grant: ResourceGrant = { id: 'source', threadId: thread.id, path: sourcePath, label: 'Source', kind: 'file', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
  store.internal('fixture.created', thread.id, () => { store.put('thread', thread.id, thread.id, thread); store.put('resource', grant.id, thread.id, grant); });
  cleanups.push(async () => { await service.dispose(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, cwd, policyFile, host, provider, store, service, thread, configurationOwners,
    ctx: { threadId: thread.id, runId: owner.runId!, epoch: owner.epoch } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function cell(f: Fixture, commandId: string, source: string, options: Record<string, unknown> = {}): Promise<PythonCellResult> {
  return await f.service.tool({ name: 'python_cell', args: { commandId, source, allowedTools: [], requestedAggregate: 'Return the explicit fixture aggregate', ...options } }, f.ctx) as PythonCellResult;
}
function request(source: string, options: Partial<ProgramExecutionRequest> = {}): ProgramExecutionRequest {
  return { source, inputValues: [], limits: { ...DEFAULT_PROGRAM_LIMITS }, startClock: Date.now(), startSeed: 'a'.repeat(64),
    signal: new AbortController().signal, call: async () => ({ value: null, resultRef: 'unused', clock: Date.now() }), ...options };
}
async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try { await stat(path); return; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  throw new Error('The actual Python process did not reach the expected cell boundary');
}

describe.runIf(native)('M03 Python provider through actual Service and M02 integration', () => {
  beforeAll(async () => {
    runtime = await inspectPythonRuntime(qualification.inspection);
    expect(runtime.interpreter.sha256).toBe('889c603f0d17cb54060951bcf4c4f9b8c9ebd9e52b392c70209bbb9755d797d9');
    if (qualification.expected) {
      // Opt-in staged profile: every pinned byte and the fingerprint must equal the hash-verified manifest.
      expect(runtime).toEqual(qualification.expected.runtime);
      expect(pythonRuntimeFingerprint(runtime)).toBe(qualification.expected.runtimeFingerprint);
    }
  });

  it.each([
    ['disabled flags', 'DISABLED', (f: Fixture) => { f.host.current.env = {}; }],
    ['missing trust', 'REQUIRE_APPROVAL', (f: Fixture) => { f.host.current.trust = null; }],
    ['declined trust', 'DENY', (f: Fixture) => { f.host.current.trust = { ...f.host.current.trust!, decision: 'declined' }; }],
    ['unapproved argument vector', 'REQUIRE_APPROVAL', (f: Fixture) => { f.host.current.profile.executableAllowlist[0]!.argv = ['-c', 'unapproved']; }],
    ['TRUSTED_HOST', 'DENY', (f: Fixture) => { f.host.current.profile.profileId = 'TRUSTED_HOST'; }],
  ] as const)('fails closed on the real M03 %s decision', async (_label, status, change) => {
    const f = await fixture(); change(f);
    const configured = await f.provider.configure(owner, digest([]), f.store.dataDir);
    await expect(configured.factory(1)).rejects.toMatchObject({ code: 'PYTHON_EXECUTION_DENIED', details: { status } });
    expect(f.store.all('pythonKernel')).toEqual([]);
  });

  it('requires host operator approval and the matching native PASS platform proof', async () => {
    const unapproved = await fixture({ approved: false });
    await expect((await unapproved.provider.configure(owner, digest([]), unapproved.store.dataDir)).factory(1)).rejects.toMatchObject({ code: 'PYTHON_EXECUTION_DENIED', details: { status: 'BLOCKED' } });
    const untested = await fixture({ platformProof: { ...proof, status: 'UNTESTED' } });
    await expect((await untested.provider.configure(owner, digest([]), untested.store.dataDir)).factory(1)).rejects.toMatchObject({ code: 'PYTHON_EXECUTION_DENIED', details: { status: 'BLOCKED' } });
  });

  it('pins owner, tool selection, profile, host configuration and physical cwd identity', async () => {
    const f = await fixture(), first = await f.provider.configure(owner, digest([]), f.store.dataDir);
    expect((await f.provider.configure(owner, digest([]), f.store.dataDir)).identity).toEqual(first.identity);
    expect((await f.provider.configure({ ...owner, accountBinding: 'another' }, digest([]), f.store.dataDir)).identity.owner).not.toEqual(first.identity.owner);
    expect((await f.provider.configure(owner, digest(['repository_read']), f.store.dataDir)).identity.toolRegistryDigest).not.toBe(first.identity.toolRegistryDigest);
    f.host.current.profile.version++;
    const changedProfile = await f.provider.configure(owner, digest([]), f.store.dataDir);
    expect(changedProfile.identity.executionProfileDigest).not.toBe(first.identity.executionProfileDigest);
    await expect(first.factory(1)).rejects.toMatchObject({ code: 'KERNEL_IDENTITY_CHANGED' });
    const previous = f.cwd + '-previous'; await rename(f.cwd, previous); await mkdir(f.cwd, { mode: 0o700 });
    const changedCwd = await f.provider.configure(owner, digest([]), f.store.dataDir);
    expect(changedCwd.identity.cwdIdentity).not.toBe(changedProfile.identity.cwdIdentity);
    f.host.current.env = {};
    expect((await f.provider.configure(owner, digest([]), f.store.dataDir)).identity.configurationDigest).not.toBe(changedCwd.identity.configurationDigest);
  });

  it('persists variables, keeps nested read payloads private, journals M02 deliveries, and resets without replaying files', async () => {
    const f = await fixture();
    await f.service.tool({ name: 'tool_program_discover', args: { names: ['repository_read'] } }, f.ctx);
    const first = await cell(f, 'first', "import json, os\npayload = tools.call('repository_read', {'resourceId': 'source'})\nprint(payload['value']['text'])\nnumber = sum(json.loads(payload['value']['text'])['rows'])\nopen('/work/saved.txt', 'w').write('kept')\nresult = {'total': number, 'envAbsent': os.getenv('PROVIDER_PRIVATE_ENV') is None}", { allowedTools: ['repository_read'] });
    expect(first.error).toBeNull();
    expect(first).toMatchObject({ state: 'SUCCEEDED', aggregate: { total: 6, envAbsent: true }, generation: 1, usage: { nestedCalls: 1 } });
    const second = await cell(f, 'second', "payload = tools.call('repository_read', {'resourceId': 'source'})\nnumber += sum(json.loads(payload['value']['text'])['rows'])\nresult = {'total': number, 'input': inputs[0]['total']}", { kernelId: first.kernelId, allowedTools: ['repository_read'], inputRefs: [first.resultRef] });
    expect(second).toMatchObject({ state: 'SUCCEEDED', kernelId: first.kernelId, aggregate: { total: 12, input: 6 }, generation: 1, usage: { nestedCalls: 1 } });
    for (const result of [first, second]) {
      const journal = f.store.get<ProgramJournalV1>('programJournal', result.programId)!;
      expect(journal.issuedCallKeys).toEqual(['call:0']);
      expect(journal.deliveries).toMatchObject([{ stableCallKey: 'call:0', issuedCount: 1, state: 'SUCCEEDED' }]);
      const parentInvocationId = `${result.programId}:attempt:1`;
      expect(f.store.get<ToolEffectRecord>('toolEffect', `${result.programId}:call:0`)).toMatchObject({ owner, parentInvocationId, state: 'SUCCEEDED' });
      expect(f.store.get<ToolEffectRecord>('toolEffect', parentInvocationId)).toMatchObject({ owner, invocationId: parentInvocationId, state: 'SUCCEEDED' });
    }
    expect(f.store.all('data')).toEqual([]);
    expect(JSON.stringify(f.store.snapshot())).not.toContain('M12_PROVIDER_PRIVATE_SOURCE');
    expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('M12_PROVIDER_PRIVATE_SOURCE');
    expect(JSON.stringify(f.store.all('toolEffect'))).not.toContain('M12_PROVIDER_PRIVATE_SOURCE');
    expect(JSON.stringify(f.service.toolProgramView(owner.threadId))).not.toContain('M12_PROVIDER_PRIVATE_SOURCE');
    await f.service.command({ id: 'reset', type: 'pythonKernel.reset', threadId: owner.threadId, payload: { owner, kernelId: first.kernelId, generation: 1 } });
    const reset = await cell(f, 'after-reset', "result = {'variablesCleared': 'number' not in globals(), 'file': open('/work/saved.txt').read()}", { kernelId: first.kernelId, allowedTools: ['repository_read'] });
    expect(reset).toMatchObject({ state: 'SUCCEEDED', generation: 2, aggregate: { variablesCleared: true, file: 'kept' } });
    expect(f.store.all<ToolEffectRecord>('toolEffect').filter(effect => effect.toolId === 'repository_read')).toHaveLength(2);
    expect(f.configurationOwners.every(value => digest(value) === digest(owner))).toBe(true);
  });

  it('does not accept model-selected interpreter, host configuration or ownership fields', async () => {
    const f = await fixture();
    await expect(cell(f, 'forged-host-options', 'result = 1', { interpreterPath: '/bin/sh', env: { SECRET: 'value' }, owner: { ...owner, accountBinding: 'another' } })).rejects.toMatchObject({ name: 'ZodError' });
    expect(f.store.all('pythonKernel')).toEqual([]);
    expect(f.configurationOwners).toEqual([]);
  });

  it('rechecks actual grants before every nested read and invalidates a failed persistent kernel', async () => {
    const f = await fixture();
    await f.service.tool({ name: 'tool_program_discover', args: { names: ['repository_read'] } }, f.ctx);
    const source = "payload = tools.call('repository_read', {'resourceId': 'source'})\nresult = len(payload['value']['text'])";
    const first = await cell(f, 'granted', source, { allowedTools: ['repository_read'] });
    expect(first.error).toBeNull();
    expect(first.state).toBe('SUCCEEDED');
    f.store.internal('fixture.revoke', owner.threadId, () => f.store.remove('resource', 'source'));
    const denied = await cell(f, 'revoked', source, { kernelId: first.kernelId, allowedTools: ['repository_read'] });
    expect(denied.state).toBe('FAILED'); expect(denied.aggregate).toBeUndefined();
    expect(f.store.get<PythonKernelV1>('pythonKernel', first.kernelId)).toMatchObject({ state: 'RESET_REQUIRED', retainedState: false });
    expect(f.store.get<ProgramJournalV1>('programJournal', denied.programId)?.deliveries).toEqual([]);
    expect(f.store.all<ToolEffectRecord>('toolEffect').filter(effect => effect.toolId === 'repository_read')).toHaveLength(1);
  });

  it('denies a kernel to a changed account or workspace without reusing variables', async () => {
    const f = await fixture(), first = await cell(f, 'owner-first', 'secret_number = 42\nresult = 1');
    expect(first.state).toBe('SUCCEEDED');
    f.store.internal('fixture.accountChanged', owner.threadId, () => f.store.put('thread', owner.threadId, owner.threadId, { ...f.thread, accountId: 'another', workspaceId: 'another-workspace' }));
    await expect(cell(f, 'owner-second', 'result = secret_number', { kernelId: first.kernelId })).rejects.toMatchObject({ code: 'KERNEL_OWNER_DENIED' });
    expect(f.store.all('toolProgram')).toHaveLength(1);
    expect(f.service.toolProgramView(owner.threadId).kernels).toEqual([]);
  });

  it('revalidates approved configuration bytes for each cell and refuses reset under invalidated trust', async () => {
    const f = await fixture(), first = await cell(f, 'trust-first', 'number = 7\nresult = number');
    expect(first.state).toBe('SUCCEEDED');
    await writeFile(f.policyFile, '{"profile":"changed-without-approval"}');
    const denied = await cell(f, 'trust-second', "open('/work/should-not-execute', 'w').write('bad')\nresult = number", { kernelId: first.kernelId });
    expect(denied).toMatchObject({ state: 'FAILED', error: { code: 'PYTHON_EXECUTION_DENIED' } });
    await expect(stat(join(f.cwd, 'should-not-execute'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(f.service.command({ id: 'untrusted-reset', type: 'pythonKernel.reset', threadId: owner.threadId, payload: { owner, kernelId: first.kernelId, generation: 1 } })).rejects.toMatchObject({ code: 'PYTHON_EXECUTION_DENIED' });
  });

  it('cancels an actual running Python cell through the host and requires explicit reset', async () => {
    const f = await fixture(), first = await cell(f, 'cancel-warm', 'counter = 1\nresult = counter');
    const pending = cell(f, 'cancel-running', "open('/work/running', 'w').write('ready')\nwhile True:\n pass", { kernelId: first.kernelId });
    await waitForFile(join(f.cwd, 'running'));
    const running = f.store.get<PythonKernelV1>('pythonKernel', first.kernelId)!;
    expect(running).toMatchObject({ state: 'RUNNING' }); expect(running.activeProgramId).not.toBeNull();
    const start = Date.now();
    await f.service.command({ id: 'cancel-cell', type: 'toolProgram.cancel', threadId: owner.threadId, payload: { owner, programId: running.activeProgramId } });
    const result = await pending;
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(result).toMatchObject({ state: 'CANCELLED', error: { code: 'PROGRAM_CANCELLED' } });
    expect(f.store.get<PythonKernelV1>('pythonKernel', first.kernelId)).toMatchObject({ state: 'RESET_REQUIRED', retainedState: false });
    await expect(cell(f, 'cancel-no-restart', 'result = counter', { kernelId: first.kernelId })).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
    expect(await readFile(join(f.cwd, 'running'), 'utf8')).toBe('ready');
  });

  it('includes policy callback delay in the cell deadline and never starts late source after cancellation', async () => {
    const f = await fixture(), configured = await f.provider.configure(owner, digest([]), f.store.dataDir);
    const executor = await configured.factory(1); executors.push(executor);
    expect(await executor.execute(request('result = 1'))).toBe(1);
    let release!: () => void; f.host.wait = new Promise<void>(resolve => { release = resolve; });
    await expect(executor.execute(request("open('/work/late-source', 'w').write('bad')\nresult = 2", { limits: { ...DEFAULT_PROGRAM_LIMITS, deadlineMs: 100 } }))).rejects.toMatchObject({ code: 'PROGRAM_DEADLINE' });
    release();
    await expect(executor.execute(request('result = 3'))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
    await expect(stat(join(f.cwd, 'late-source'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('invalidates a persistent executor when host execution flags change and cannot revive it by restoring them', async () => {
    const f = await fixture(), configured = await f.provider.configure(owner, digest([]), f.store.dataDir);
    const executor = await configured.factory(1); executors.push(executor);
    expect(await executor.execute(request('number = 7\nresult = number'))).toBe(7);
    f.host.current.env = {};
    await expect(executor.execute(request("open('/work/revoked-flags', 'w').write('bad')\nresult = number"))).rejects.toMatchObject({ code: 'KERNEL_IDENTITY_CHANGED' });
    f.host.current.env = { ...flags };
    await expect(executor.execute(request('result = number'))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
    await expect(stat(join(f.cwd, 'revoked-flags'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects working directories that expose protected host storage, its ancestors, descendants or aliases', async () => {
    const f = await fixture(), descendant = join(f.store.dataDir, 'private-python'), alias = join(f.directory, 'storage-alias');
    await mkdir(descendant); await symlink(f.store.dataDir, alias);
    for (const cwd of [f.store.dataDir, f.directory, descendant, alias]) {
      f.host.current.cwd = cwd; f.host.current.profile.readRoots = [cwd]; f.host.current.profile.writeRoots = [cwd];
      await expect(f.provider.configure(owner, digest([]), f.store.dataDir)).rejects.toMatchObject({ code: 'PYTHON_PROFILE_DENIED' });
    }
    expect(f.store.all('pythonKernel')).toEqual([]);
    expect(f.store.all('toolProgram')).toEqual([]);
  });
});
