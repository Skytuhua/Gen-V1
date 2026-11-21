import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { ToolAuthority, buildToolRegistry } from '../packages/core/tool-authority.ts';
import { ToolDisclosure } from '../packages/core/tool-disclosure.ts';
import { ToolEffectLedger, privateArgumentCommitment } from '../packages/core/tool-effects.ts';
import { PrivateToolResults } from '../packages/core/tool-results.ts';
import { ToolPrograms } from '../packages/core/tool-programs.ts';
import { PythonKernels } from '../packages/core/python-kernels.ts';
import { createJavaScriptExecutor } from '../packages/runtime/tool-program-worker.ts';
import type { NestedCallV1, ProgramExecutor, ProgramExecutionRequest, ProgramJournalV1, PythonKernelIdentity } from '../packages/contracts/tool-program.ts';
import { REPLAY_OWNER, openReplayHarness } from './fixtures/tool-program-replay-harness-v3.ts';

const owner = { threadId: 'thread', runId: 'run', epoch: 1, projectId: 'project', workspaceId: 'workspace', accountBinding: 'account' };
const hash = 'a'.repeat(64);
const PYTHON_PROOF = { backendId: 'core-only', language: 'PYTHON', runtimeFingerprint: hash, platform: 'synthetic', isolation: 'M03_CONFINED_PROCESS', memoryScope: 'SYNTHETIC_CONTRACT', hardMemoryLimit: true, memoryLimitBytes: 134_217_728, wholeExecutorMemoryLimitBytes: null, tested: true, evidenceRef: 'CORE-only fixture' } as const;

let sharedExecutor: ProgramExecutor;
beforeAll(async () => { sharedExecutor = await createJavaScriptExecutor(); });
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
afterAll(async () => { await sharedExecutor?.stop(); });

function syntheticExecutor(execute: (request: ProgramExecutionRequest) => Promise<unknown>): ProgramExecutor {
  return { proof: { backendId: 'synthetic-protocol-only', language: 'JAVASCRIPT', runtimeFingerprint: hash, platform: 'synthetic', isolation: 'WASM_NO_HOST_IMPORTS', memoryScope: 'SYNTHETIC_CONTRACT', memoryLimitBytes: 134_217_728, wholeExecutorMemoryLimitBytes: null, hardMemoryLimit: true, tested: true, evidenceRef: 'CORE fixture; not platform proof' }, execute, stop: async () => {} };
}
function fixture(executeRead: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'm12-v6-program-')), store = new Store(dir);
  let current = { ...owner };
  const authority = new ToolAuthority(buildToolRegistry());
  const disclosure = new ToolDisclosure(store, authority, { currentOwner: () => current, eligibleTools: ['repository_read', 'repository_log', 'file_replace_prepare'] });
  disclosure.disclose(owner, ['repository_read']);
  const results = new PrivateToolResults(store, { currentOwner: () => current });
  const effects = new ToolEffectLedger(store, authority);
  const programs = new ToolPrograms(store, { authority, disclosure, results, effects, currentOwner: () => current,
    enabled: () => true, executeRead: (call, _owner, signal) => executeRead(call.name, call.args, signal) });
  cleanups.push(async () => { await programs.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { programs, store, results, effects, disclosure, setOwner: (next: typeof owner) => { current = next; } };
}
const prepare = (programs: ToolPrograms, executor: ProgramExecutor, extra = {}) => programs.prepare({ owner, language: 'JAVASCRIPT', source: 'synthetic fixture', allowedTools: ['repository_read'], inputRefs: [], requestedAggregate: 'sum requested rows', ...extra }, executor);

describe('M12-D01 persistent Python cells retain and reset generation state', () => {
  const identity: PythonKernelIdentity = { owner, interpreterDigest: hash, configurationDigest: hash, cwdIdentity: 'device:inode', toolRegistryDigest: hash, executionProfileDigest: hash };
  function kernelFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'm12-v6-kernel-')), store = new Store(dir);
    let created = 0, cells = 0;
    const executorVars = new WeakMap<ProgramExecutor, Map<string, number>>();
    const sources = new Map<string, string>();
    const factory = () => {
      created++;
      const executor = { proof: { ...PYTHON_PROOF }, execute: async () => null, stop: async () => {} } satisfies ProgramExecutor;
      executorVars.set(executor, new Map());
      return executor;
    };
    const programs = {
      prepare: async (input: { source: string }) => { const programId = `cell-${++cells}`; sources.set(programId, input.source); return { programId }; },
      run: async (programId: string, _owner: unknown, executor: ProgramExecutor) => {
        const vars = executorVars.get(executor)!, source = sources.get(programId)!.trim();
        const assignment = /^([a-z_]\w*)\s*=\s*(\d+)$/.exec(source);
        if (assignment) { vars.set(assignment[1]!, Number(assignment[2])); return { programId, state: 'SUCCEEDED', aggregate: { value: Number(assignment[2]) }, resultRef: null, sourceRefs: [], error: null, usage: { nestedCalls: 0, elapsedMs: 0, visibleBytes: 0 } }; }
        if (vars.has(source)) return { programId, state: 'SUCCEEDED', aggregate: { value: vars.get(source) }, resultRef: null, sourceRefs: [], error: null, usage: { nestedCalls: 0, elapsedMs: 0, visibleBytes: 0 } };
        return { programId, state: 'FAILED', resultRef: null, sourceRefs: [], error: { code: 'NAME_ERROR', message: `name '${source}' is not defined` }, usage: { nestedCalls: 0, elapsedMs: 0, visibleBytes: 0 } };
      },
      cancel: async () => {},
    } as unknown as ToolPrograms;
    const kernels = new PythonKernels(store, programs, { currentOwner: () => ({ ...owner }), enabled: () => true });
    cleanups.push(async () => { await kernels.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
    return { kernels, factory, created: () => created };
  }

  it('keeps x=7 visible to a second cell in one generation, then drops it after reset', async () => {
    const f = kernelFixture();
    const kernel = await f.kernels.create(identity, f.factory);
    const assigned = await f.kernels.cell(kernel.kernelId, owner, { source: 'x = 7', allowedTools: [], requestedAggregate: 'x' });
    expect(assigned.state).toBe('SUCCEEDED');
    const read = await f.kernels.cell(kernel.kernelId, owner, { source: 'x', allowedTools: [], requestedAggregate: 'x' });
    expect(read).toMatchObject({ state: 'SUCCEEDED', aggregate: { value: 7 } });
    expect(f.created()).toBe(1);
    expect(f.kernels.get(kernel.kernelId, owner)).toMatchObject({ generation: 1, state: 'READY', retainedState: true });
    const reset = await f.kernels.reset(kernel.kernelId, owner);
    expect(reset).toMatchObject({ generation: 2, state: 'READY', retainedState: false });
    expect(f.created()).toBe(2);
    const absent = await f.kernels.cell(kernel.kernelId, owner, { source: 'x', allowedTools: [], requestedAggregate: 'x' });
    expect(absent).toMatchObject({ state: 'FAILED', error: { code: 'NAME_ERROR' } });
    expect(f.kernels.get(kernel.kernelId, owner)).toMatchObject({ state: 'RESET_REQUIRED', retainedState: false });
  });
});

describe('M12-D02 replay divergence on recorded argument, definition digest or result order', () => {
  function replayFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'm12-v6-replay-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const f = openReplayHarness(dir, { owner: REPLAY_OWNER, executor: sharedExecutor });
    cleanups.push(() => f.close());
    return f;
  }
  function replace<T>(f: ReturnType<typeof replayFixture>, kind: string, id: string, change: (value: T) => T) {
    f.store.internal('m12.fixture.corrupt', REPLAY_OWNER.threadId, () => {
      f.store.put(kind, id, REPLAY_OWNER.threadId, change(f.store.get<T>(kind, id)!));
    });
  }
  const reads = (f: ReturnType<typeof replayFixture>) => f.state().reads;

  it.each(['argument', 'tool-definition digest'] as const)('rejects a changed recorded %s with REPLAY_DIVERGED and no new calls', async change => {
    const f = replayFixture();
    const program = await f.prepare();
    const first = await f.programs.run(program.programId, REPLAY_OWNER, sharedExecutor);
    expect(first.state).toBe('SUCCEEDED');
    if (change === 'argument') replace<NestedCallV1>(f, 'nestedCall', `${program.programId}:call:0`, value => ({ ...value, argumentsCommitment: privateArgumentCommitment({ name: 'repository_read', args: { sequence: 999 } }) }));
    else replace<NestedCallV1>(f, 'nestedCall', `${program.programId}:call:0`, value => ({ ...value, definitionDigest: 'b'.repeat(64) }));
    const replay = await f.programs.run(program.programId, REPLAY_OWNER, sharedExecutor, { replay: true });
    expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED', originalResultRef: first.resultRef } });
    expect(reads(f)).toBe(1);
  });

  it('rejects a changed recorded result order with REPLAY_DIVERGED and no new calls', async () => {
    const f = replayFixture();
    const source = "const a = await tools.call('repository_read', {sequence: 0}); const b = await tools.call('repository_read', {sequence: 1}); return [a.total + b.total];";
    const program = await f.prepare(source);
    const first = await f.programs.run(program.programId, REPLAY_OWNER, sharedExecutor);
    expect(first).toMatchObject({ state: 'SUCCEEDED', aggregate: [14] });
    expect(reads(f)).toBe(2);
    replace<ProgramJournalV1>(f, 'programJournal', program.programId, value => ({ ...value, deliveries: [value.deliveries[1]!, value.deliveries[0]!] }));
    const replay = await f.programs.run(program.programId, REPLAY_OWNER, sharedExecutor, { replay: true });
    expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED', originalResultRef: first.resultRef } });
    expect(reads(f)).toBe(2);
  });
});

describe('M12-D03 nested authority denies a revoked grant before dispatch', () => {
  it('revokes the resource grant between preparation and nested dispatch, retaining a denial receipt and no tool call', async () => {
    let calls = 0;
    const f = fixture(async () => { calls++; return 1; });
    f.store.internal('m12.fixture.grant', owner.threadId, () => { f.store.put('resource', 'res-1', owner.threadId, { id: 'res-1', threadId: owner.threadId, kind: 'file', path: '/tmp/granted', label: 'granted', writable: false, createdAt: new Date().toISOString() }); return { granted: true }; });
    const executor = syntheticExecutor(async request => (await request.call('call:0', 'repository_read', { resourceId: 'res-1', path: '/tmp/granted/x' })).value);
    const program = await prepare(f.programs, executor);
    f.store.internal('m12.fixture.revoke', owner.threadId, () => { f.store.remove('resource', 'res-1'); return { revoked: true }; });
    const result = await f.programs.run(program.programId, owner, executor);
    expect(result).toMatchObject({ state: 'FAILED', error: { code: 'RESULT_ACCESS_DENIED' } });
    expect(calls).toBe(0);
    expect(f.effects.get(`${program.programId}:call:0`)).toBeNull();
    expect(f.store.get<NestedCallV1>('nestedCall', `${program.programId}:call:0`)).toMatchObject({ state: 'CANCELLED', error: { code: 'RESULT_ACCESS_DENIED' } });
  });
});

describe('M12-D04 guest-only memory proof never claims an aggregate bound', () => {
  it('keeps wholeExecutorMemoryLimitBytes null and cannot enable Python admission', async () => {
    expect(sharedExecutor.proof).toMatchObject({ language: 'JAVASCRIPT', isolation: 'WASM_NO_HOST_IMPORTS', memoryScope: 'GUEST_WASM_LINEAR', memoryLimitBytes: 134_217_728, hardMemoryLimit: true, wholeExecutorMemoryLimitBytes: null, tested: true });
    const f = fixture(async () => 1);
    const program = await f.programs.prepare({ owner, language: 'JAVASCRIPT', source: 'return 1;', allowedTools: ['repository_read'], inputRefs: [], requestedAggregate: 'the literal one' }, sharedExecutor);
    const result = await f.programs.run(program.programId, owner, sharedExecutor);
    expect(result.state).toBe('SUCCEEDED');
    expect(sharedExecutor.proof.wholeExecutorMemoryLimitBytes).toBeNull();
    await expect(f.programs.prepare({ owner, language: 'PYTHON', source: 'x = 1', allowedTools: [], inputRefs: [], requestedAggregate: 'x' }, sharedExecutor)).rejects.toMatchObject({ code: 'UNSUPPORTED_BACKEND' });
    const kernelIdentity: PythonKernelIdentity = { owner, interpreterDigest: hash, configurationDigest: hash, cwdIdentity: 'device:inode', toolRegistryDigest: hash, executionProfileDigest: hash };
    const kernels = new PythonKernels(f.store, f.programs, { currentOwner: () => ({ ...owner }), enabled: () => true });
    await expect(kernels.create(kernelIdentity, async () => sharedExecutor)).rejects.toMatchObject({ code: 'UNSUPPORTED_BACKEND' });
  });
});

describe('M12-D05 noncooperative host cancellation keeps ownership until settlement', () => {
  it('never confirms, replaces or releases a cancelled read that ignores the abort signal', async () => {
    let reads = 0, resolveRead!: (value: unknown) => void;
    const f = fixture(() => { reads++; return new Promise(resolve => { resolveRead = resolve; }); });
    const executor = syntheticExecutor(async request => {
      await request.call('call:0', 'repository_read', {}).catch(() => {});
      await request.call('call:1', 'repository_read', {}).catch(() => {});
      return 'returned';
    });
    const program = await prepare(f.programs, executor);
    const run = f.programs.run(program.programId, owner, executor);
    while (!f.store.get<NestedCallV1>('nestedCall', `${program.programId}:call:0`) || f.store.get<NestedCallV1>('nestedCall', `${program.programId}:call:0`)!.state !== 'DISPATCHED') await new Promise(resolve => setImmediate(resolve));
    let runSettled = false; void run.then(() => { runSettled = true; }, () => { runSettled = true; });
    let cancelSettled = false; const cancel = f.programs.cancel(program.programId, owner).then(() => { cancelSettled = true; }, () => { cancelSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(runSettled).toBe(false);
    expect(cancelSettled).toBe(false);
    expect(f.store.get<NestedCallV1>('nestedCall', `${program.programId}:call:0`)).toMatchObject({ state: 'UNKNOWN' });
    expect(f.effects.get(`${program.programId}:call:0`)).toMatchObject({ state: 'UNKNOWN_EXTERNAL_OUTCOME' });
    resolveRead({ rows: [1] });
    const result = await run;
    await cancel;
    expect(result.state).toBe('CANCELLED');
    expect(reads).toBe(1);
    expect(f.store.get<NestedCallV1>('nestedCall', `${program.programId}:call:0`)).toMatchObject({ state: 'UNKNOWN' });
    expect(f.effects.get(`${program.programId}:call:0`)).toMatchObject({ state: 'UNKNOWN_EXTERNAL_OUTCOME' });
    expect(f.store.get<NestedCallV1>('nestedCall', `${program.programId}:call:1`)).toBeNull();
  });
});
