import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { PythonKernels, pythonKernelKey } from '../packages/core/python-kernels.ts';
import type { PythonKernelIdentity, ProgramExecutor } from '../packages/contracts/tool-program.ts';
import type { ToolPrograms } from '../packages/core/tool-programs.ts';

const owner = { threadId: 'thread', runId: 'run', epoch: 1, projectId: 'project', workspaceId: 'workspace', accountBinding: 'account' };
const hash = 'a'.repeat(64);
const identity: PythonKernelIdentity = { owner, interpreterDigest: hash, configurationDigest: hash, cwdIdentity: 'device:inode', toolRegistryDigest: hash, executionProfileDigest: hash };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'm12-kernel-')), store = new Store(dir);
  let created = 0, stopped = 0, executions = 0;
  const authority = { owner: { ...owner }, enabled: true }, instances: { stopped: number }[] = [];
  const programStates = new Map<string, string>(); let runCalls = 0;
  const factory = () => { created++; const instance = { stopped: 0 }; instances.push(instance); return { proof: { backendId: 'core-only', language: 'PYTHON', runtimeFingerprint: hash, platform: 'synthetic', isolation: 'M03_CONFINED_PROCESS', memoryScope: 'SYNTHETIC_CONTRACT', hardMemoryLimit: true, memoryLimitBytes: 134_217_728, wholeExecutorMemoryLimitBytes: null, tested: true, evidenceRef: 'CORE-only fixture' }, execute: async () => null, stop: async () => { stopped++; instance.stopped++; } } satisfies ProgramExecutor; };
  const programs = { prepare: async () => { const programId = `cell-${++executions}`; programStates.set(programId, 'PREPARED'); return { programId }; },
    run: async (programId: string) => { runCalls++; programStates.set(programId, 'SUCCEEDED'); return { state: 'SUCCEEDED', aggregate: { value: 1 } }; },
    cancel: async (programId: string) => { if (programStates.get(programId) === 'PREPARED') programStates.set(programId, 'CANCELLED'); } } as unknown as ToolPrograms;
  const kernels = new PythonKernels(store, programs, { currentOwner: () => authority.owner, enabled: () => authority.enabled });
  cleanups.push(async () => { await kernels.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, programs, kernels, factory, authority, instances, programStates, runCalls: () => runCalls, counts: () => ({ created, stopped, executions }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

it('keys kernels by owner, interpreter/config, workspace identity, tool set and execution profile', () => {
  const key = pythonKernelKey(identity);
  for (const field of ['interpreterDigest', 'configurationDigest', 'cwdIdentity', 'toolRegistryDigest', 'executionProfileDigest'] as const)
    expect(pythonKernelKey({ ...identity, [field]: field === 'cwdIdentity' ? 'other-inode' : 'b'.repeat(64) })).not.toBe(key);
  for (const field of ['accountBinding', 'workspaceId', 'projectId', 'threadId', 'runId'] as const)
    expect(pythonKernelKey({ ...identity, owner: { ...owner, [field]: 'another' } })).not.toBe(key);
});

it('keeps one process between successful cells with fresh program admission each time', async () => {
  const f = fixture(), kernel = await f.kernels.create(identity, f.factory);
  await f.kernels.cell(kernel.kernelId, owner, { source: 'result = 1', allowedTools: [], requestedAggregate: 'value' });
  await f.kernels.cell(kernel.kernelId, owner, { source: 'result = 2', allowedTools: [], requestedAggregate: 'value' });
  expect(f.counts()).toEqual({ created: 1, stopped: 0, executions: 2 });
  expect(f.kernels.get(kernel.kernelId, owner)).toMatchObject({ generation: 1, state: 'READY', retainedState: true });
});

it('persists a new generation before reset accepts another cell and never reruns history', async () => {
  const f = fixture(), kernel = await f.kernels.create(identity, f.factory);
  await f.kernels.cell(kernel.kernelId, owner, { source: 'counter += 1', allowedTools: [], requestedAggregate: 'counter' });
  const reset = await f.kernels.reset(kernel.kernelId, owner);
  expect(reset).toMatchObject({ generation: 2, state: 'READY', retainedState: false });
  expect(f.counts()).toEqual({ created: 2, stopped: 1, executions: 1 });
  await f.kernels.stop(kernel.kernelId, owner);
  expect(f.kernels.get(kernel.kernelId, owner)).toMatchObject({ state: 'STOPPED', retainedState: false });
  await expect(f.kernels.cell(kernel.kernelId, owner, { source: 'result = 1', allowedTools: [], requestedAggregate: 'value' })).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
});

it('fails exact owner checks for Stop and Reset without killing another owner process', async () => {
  const f = fixture(), kernel = await f.kernels.create(identity, f.factory);
  await expect(f.kernels.stop(kernel.kernelId, { ...owner, accountBinding: 'other' })).rejects.toMatchObject({ code: 'KERNEL_OWNER_DENIED' });
  await expect(f.kernels.reset(kernel.kernelId, { ...owner, workspaceId: 'other' })).rejects.toMatchObject({ code: 'KERNEL_OWNER_DENIED' });
  expect(f.counts().stopped).toBe(0);
});

it('marks failed, cancelled or wedged cells reset-required and invalidates variables', async () => {
  const f = fixture(), kernel = await f.kernels.create(identity, f.factory);
  f.programs.run = async () => ({ state: 'FAILED', resultRef: null, error: { code: 'PROGRAM_DEADLINE' } }) as never;
  await f.kernels.cell(kernel.kernelId, owner, { source: 'while True: pass', allowedTools: [], requestedAggregate: 'value' });
  expect(f.kernels.get(kernel.kernelId, owner)).toMatchObject({ state: 'RESET_REQUIRED', retainedState: false });
  expect(f.counts().stopped).toBe(1);
});

it('does not reconstruct retained variables after host recovery', async () => {
  const f = fixture(), kernel = await f.kernels.create(identity, f.factory);
  await f.kernels.cell(kernel.kernelId, owner, { source: 'x = 42', allowedTools: [], requestedAggregate: 'x' });
  const recovered = new PythonKernels(f.store, f.programs, { currentOwner: () => owner, enabled: () => true });
  recovered.recover();
  expect(recovered.get(kernel.kernelId, owner)).toMatchObject({ generation: 1, state: 'RESET_REQUIRED', retainedState: false });
  await expect(recovered.create(identity, f.factory)).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  expect(f.counts().executions).toBe(1);
});

it('invalidates generations on host rollback without replaying or removing receipts', async () => {
  const f = fixture(), kernel = await f.kernels.create(identity, f.factory);
  await f.kernels.cell(kernel.kernelId, owner, { source: 'value = 42', allowedTools: [], requestedAggregate: 'value' });
  await f.kernels.close();
  expect(f.kernels.get(kernel.kernelId, owner)).toMatchObject({ generation: 2, state: 'STOPPED', retainedState: false });
  const before = f.counts(); await f.kernels.close();
  expect(f.counts()).toEqual(before);
  expect(f.counts().executions).toBe(1);
  await expect(f.kernels.create(identity, f.factory)).rejects.toMatchObject({ code: 'KERNEL_DISABLED' });
});

it('disposes an initial factory that resolves after Stop without resurrecting READY', async () => {
  const f = fixture(), gate = deferred<ProgramExecutor>();
  const creating = f.kernels.create(identity, () => gate.promise);
  const rejected = expect(creating).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  const kernel = f.kernels.list(owner)[0]!;
  await f.kernels.stop(kernel.kernelId, owner);
  gate.resolve(f.factory()); await rejected;
  expect(f.kernels.get(kernel.kernelId, owner)).toMatchObject({ generation: 1, state: 'STOPPED', retainedState: false });
  expect(f.counts()).toEqual({ created: 1, stopped: 1, executions: 0 });
});

it('cannot replace a reset generation with a late initial factory', async () => {
  const f = fixture(), gate = deferred<ProgramExecutor>();
  const creating = f.kernels.create(identity, generation => generation === 1 ? gate.promise : f.factory());
  const rejected = expect(creating).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  const initial = f.kernels.list(owner)[0]!, next = await f.kernels.reset(initial.kernelId, owner);
  expect(next).toMatchObject({ generation: 2, state: 'READY' });
  gate.resolve(f.factory()); await rejected;
  expect(f.kernels.get(initial.kernelId, owner)).toMatchObject({ generation: 2, state: 'READY' });
  expect(f.instances).toEqual([{ stopped: 0 }, { stopped: 1 }]);
  await f.kernels.cell(initial.kernelId, owner, { source: 'result = 1', allowedTools: [], requestedAggregate: 'value' });
  expect(f.counts()).toEqual({ created: 2, stopped: 1, executions: 1 });
});

it('disposes a late initial factory after host rollback and keeps the invalidated generation', async () => {
  const f = fixture(), gate = deferred<ProgramExecutor>();
  const creating = f.kernels.create(identity, () => gate.promise);
  const rejected = expect(creating).rejects.toMatchObject({ code: 'KERNEL_DISABLED' });
  const initial = f.kernels.list(owner)[0]!;
  await f.kernels.close();
  gate.resolve(f.factory()); await rejected;
  expect(f.kernels.get(initial.kernelId, owner)).toMatchObject({ generation: 2, state: 'STOPPED', retainedState: false });
  expect(f.counts()).toEqual({ created: 1, stopped: 1, executions: 0 });
});

it('disposes a late initial factory after exact owner revocation', async () => {
  const f = fixture(), gate = deferred<ProgramExecutor>();
  const creating = f.kernels.create(identity, () => gate.promise);
  const rejected = expect(creating).rejects.toMatchObject({ code: 'KERNEL_OWNER_DENIED' });
  f.authority.owner = { ...owner, accountBinding: 'another' };
  gate.resolve(f.factory()); await rejected;
  expect(f.kernels.list(owner)[0]).toMatchObject({ generation: 1, state: 'RESET_REQUIRED', retainedState: false });
  expect(f.counts()).toEqual({ created: 1, stopped: 1, executions: 0 });
});

it('rejects a late initial factory after recovery changes its admission record without changing generation', async () => {
  const f = fixture(), gate = deferred<ProgramExecutor>();
  const creating = f.kernels.create(identity, () => gate.promise);
  const rejected = expect(creating).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  f.kernels.recover();
  gate.resolve(f.factory()); await rejected;
  expect(f.kernels.list(owner)[0]).toMatchObject({ generation: 1, state: 'RESET_REQUIRED', error: { code: 'KERNEL_RESET_REQUIRED' } });
  expect(f.counts()).toEqual({ created: 1, stopped: 1, executions: 0 });
});

it('revokes a pending initial factory when a changed configuration selects another kernel for the same owner', async () => {
  const f = fixture(), gate = deferred<ProgramExecutor>();
  const creating = f.kernels.create(identity, () => gate.promise);
  const rejected = expect(creating).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  const initial = f.kernels.list(owner)[0]!;
  const next = await f.kernels.create({ ...identity, configurationDigest: 'b'.repeat(64) }, f.factory);
  gate.resolve(f.factory()); await rejected;
  expect(f.kernels.get(initial.kernelId, owner).state).toBe('STOPPED');
  expect(f.kernels.get(next.kernelId, owner).state).toBe('READY');
  expect(f.instances).toEqual([{ stopped: 0 }, { stopped: 1 }]);
});

it('rejects an executor whose explicit language is not Python even if its isolation claim matches', async () => {
  const f = fixture(), executor = f.factory();
  await expect(f.kernels.create(identity, () => ({ ...executor, proof: { ...executor.proof, language: 'JAVASCRIPT' } }))).rejects.toMatchObject({ code: 'UNSUPPORTED_BACKEND' });
  expect(f.counts()).toEqual({ created: 1, stopped: 1, executions: 0 });
  expect(f.kernels.list(owner)[0]?.state).toBe('RESET_REQUIRED');
});

it('lets only the latest different-key create acquire the owner after a pending stop', async () => {
  const f = fixture(), held = deferred<void>(), stopping = deferred<void>(), firstExecutor = f.factory();
  const originalStop = firstExecutor.stop;
  firstExecutor.stop = async () => { stopping.resolve(); await held.promise; await originalStop(); };
  await f.kernels.create(identity, () => firstExecutor);
  const secondIdentity = { ...identity, toolRegistryDigest: 'b'.repeat(64) };
  const thirdIdentity = { ...identity, toolRegistryDigest: 'c'.repeat(64) };
  const second = f.kernels.create(secondIdentity, f.factory);
  await stopping.promise;
  const third = f.kernels.create(thirdIdentity, f.factory);
  await Promise.resolve();
  const createdDuringStop = f.counts().created;
  held.resolve();
  const outcomes = await Promise.allSettled([second, third]);
  expect(createdDuringStop).toBe(1);
  expect(outcomes[0]).toMatchObject({ status: 'rejected', reason: { code: 'KERNEL_RESET_REQUIRED' } });
  expect(outcomes[1]).toMatchObject({ status: 'fulfilled', value: { key: pythonKernelKey(thirdIdentity), state: 'READY' } });
  expect(f.kernels.list(owner).filter(kernel => kernel.state === 'READY').map(kernel => kernel.key)).toEqual([pythonKernelKey(thirdIdentity)]);
  expect(f.counts()).toEqual({ created: 2, stopped: 1, executions: 0 });
});

it('lets reset supersede a different-key create while preserving custody of the stopping executor', async () => {
  const f = fixture(), held = deferred<void>(), stopping = deferred<void>(), firstExecutor = f.factory();
  const originalStop = firstExecutor.stop;
  firstExecutor.stop = async () => { stopping.resolve(); await held.promise; await originalStop(); };
  const first = await f.kernels.create(identity, generation => generation === 1 ? firstExecutor : f.factory());
  const second = f.kernels.create({ ...identity, toolRegistryDigest: 'b'.repeat(64) }, f.factory);
  await stopping.promise;
  const reset = f.kernels.reset(first.kernelId, owner);
  await Promise.resolve();
  const createdDuringStop = f.counts().created;
  held.resolve();
  const outcomes = await Promise.allSettled([second, reset]);
  expect(createdDuringStop).toBe(1);
  expect(outcomes[0]).toMatchObject({ status: 'rejected', reason: { code: 'KERNEL_RESET_REQUIRED' } });
  expect(outcomes[1]).toMatchObject({ status: 'fulfilled', value: { kernelId: first.kernelId, generation: 2, state: 'READY' } });
  expect(f.kernels.list(owner).filter(kernel => kernel.state === 'READY').map(kernel => kernel.kernelId)).toEqual([first.kernelId]);
  expect(f.counts()).toEqual({ created: 2, stopped: 1, executions: 0 });
});

it('resets a previously selected key only after stopping the current different-key kernel', async () => {
  const f = fixture(), first = await f.kernels.create(identity, f.factory);
  const second = await f.kernels.create({ ...identity, toolRegistryDigest: 'b'.repeat(64) }, f.factory);
  expect(f.kernels.get(first.kernelId, owner).state).toBe('STOPPED');
  const reset = await f.kernels.reset(first.kernelId, owner);
  expect(reset).toMatchObject({ generation: 2, state: 'READY' });
  expect(f.kernels.get(second.kernelId, owner).state).toBe('STOPPED');
  expect(f.kernels.list(owner).filter(kernel => kernel.state === 'READY').map(kernel => kernel.kernelId)).toEqual([first.kernelId]);
  expect(f.counts()).toEqual({ created: 3, stopped: 2, executions: 0 });
});

it.each(['stop', 'reset'] as const)('cancels an old program prepared after %s without dispatching it or changing the new kernel state', async action => {
  const f = fixture(), kernel = await f.kernels.create(identity, f.factory), entered = deferred<void>(), release = deferred<void>();
  const prepare = f.programs.prepare.bind(f.programs);
  f.programs.prepare = async (...args) => { entered.resolve(); await release.promise; return prepare(...args); };
  const cell = f.kernels.cell(kernel.kernelId, owner, { source: 'result = 1', allowedTools: [], requestedAggregate: 'value' });
  const rejected = expect(cell).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  await entered.promise;
  if (action === 'stop') await f.kernels.stop(kernel.kernelId, owner);
  else await f.kernels.reset(kernel.kernelId, owner);
  release.resolve(); await rejected;
  expect(f.programStates.get('cell-1')).toBe('CANCELLED');
  expect(f.runCalls()).toBe(0);
  expect(f.kernels.get(kernel.kernelId, owner)).toMatchObject({ state: action === 'stop' ? 'STOPPED' : 'READY', generation: action === 'stop' ? 1 : 2 });
});

it.each(['failed result', 'prepare rejection'] as const)('keeps cleanup custody after a %s until reset can replace the process', async failureMode => {
  const f = fixture(), held = deferred<void>(), stopping = deferred<void>(), firstExecutor = f.factory();
  const originalStop = firstExecutor.stop;
  firstExecutor.stop = async () => { stopping.resolve(); await held.promise; await originalStop(); };
  const kernel = await f.kernels.create(identity, generation => generation === 1 ? firstExecutor : f.factory());
  if (failureMode === 'failed result') f.programs.run = async () => ({ state: 'FAILED', resultRef: null, error: { code: 'PROGRAM_DEADLINE' } }) as never;
  else f.programs.prepare = async () => { throw new Error('input authorization failed'); };
  const cell = f.kernels.cell(kernel.kernelId, owner, { source: 'result = 1', allowedTools: [], requestedAggregate: 'value' });
  const outcome = cell.then(value => ({ value }), error => ({ error }));
  await stopping.promise;
  const reset = f.kernels.reset(kernel.kernelId, owner);
  await new Promise<void>(resolve => setImmediate(resolve));
  const createdDuringStop = f.counts().created;
  held.resolve(); await outcome;
  expect(await reset).toMatchObject({ generation: 2, state: 'READY' });
  expect(createdDuringStop).toBe(1);
  expect(f.instances).toEqual([{ stopped: 1 }, { stopped: 0 }]);
});
