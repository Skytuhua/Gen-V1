import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { ToolAuthority, buildToolRegistry } from '../packages/core/tool-authority.ts';
import { ToolEffectLedger } from '../packages/core/tool-effects.ts';
import { ToolDisclosure } from '../packages/core/tool-disclosure.ts';
import { PrivateToolResults } from '../packages/core/tool-results.ts';
import { ToolPrograms } from '../packages/core/tool-programs.ts';
import { registeredCapabilityFlags } from '../packages/core/capability-flags.ts';
import {
  DEFAULT_PROGRAM_LIMITS, toolProgramV1Schema, nestedCallV1Schema,
  programJournalV1Schema, pythonKernelV1Schema, programLimitsSchema,
} from '../packages/contracts/tool-program.ts';
import type { ProgramExecutionRequest, ProgramExecutor } from '../packages/contracts/tool-program.ts';

const owner = { threadId: 'thread', runId: 'run', epoch: 1, projectId: 'project', workspaceId: 'workspace', accountBinding: 'account' };
const hash = 'a'.repeat(64);

describe('M12 protocol contracts before executor installation', () => {
  it('bounds every program budget and rejects ambient capability fields', () => {
    expect(DEFAULT_PROGRAM_LIMITS).toEqual({ deadlineMs: 30_000, maxCalls: 64, maxConcurrentCalls: 4, maxOutputBytes: 262_144, memoryBytes: 134_217_728 });
    for (const [key, value] of Object.entries(DEFAULT_PROGRAM_LIMITS)) {
      expect(programLimitsSchema.safeParse({ ...DEFAULT_PROGRAM_LIMITS, [key]: value + 1 }).success).toBe(false);
    }
    expect(programLimitsSchema.safeParse({ ...DEFAULT_PROGRAM_LIMITS, credentials: {} }).success).toBe(false);
  });

  it('requires durable owner, digests and state on programs and calls', () => {
    const program = { version: 1, programId: 'program', owner, language: 'JAVASCRIPT', sourceDigest: hash,
      runtimeFingerprint: hash, toolRegistryDigest: hash, allowedTools: ['repository_read'], inputRefs: [],
      limits: DEFAULT_PROGRAM_LIMITS, state: 'PREPARED', resultRef: null, createdAt: 1, startedAt: null,
      deadlineAt: null, elapsedMs: 0, nestedCallCount: 0, error: null };
    expect(toolProgramV1Schema.parse(program)).toEqual(program);
    expect(toolProgramV1Schema.safeParse({ ...program, owner: { threadId: 'thread' } }).success).toBe(false);
    expect(toolProgramV1Schema.safeParse({ ...program, allowedTools: ['repository_read', 'repository_read'] }).success).toBe(false);
    expect(nestedCallV1Schema.parse({ version: 1, parentProgramId: 'program', stableCallKey: 'call:0',
      invocationId: 'invocation', owner, toolName: 'repository_read', definitionDigest: hash,
      argumentsCommitment: hash, resultRef: null, effectClass: 'READ_RETRYABLE', state: 'PREPARED', error: null })).toBeTruthy();
    expect(nestedCallV1Schema.safeParse({ effectClass: 'NONREPLAYABLE' }).success).toBe(false);
  });

  it('requires deterministic journal start data and an explicit kernel generation', () => {
    expect(programJournalV1Schema.parse({ version: 1, programId: 'program', sourceDigest: hash,
      runtimeFingerprint: hash, toolRegistryDigest: hash, startSeed: hash, startClock: 1000,
      deadlineAt: 31_000, issuedCallKeys: [], committedIssuedCount: 0, deliveries: [] })).toBeTruthy();
    expect(pythonKernelV1Schema.safeParse({ kernelId: 'kernel', owner }).success).toBe(false);
  });
});

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function syntheticExecutor(execute: (request: ProgramExecutionRequest) => Promise<unknown>): ProgramExecutor {
  return { proof: { backendId: 'synthetic-protocol-only', language: 'JAVASCRIPT', runtimeFingerprint: hash, platform: 'synthetic', isolation: 'WASM_NO_HOST_IMPORTS', memoryScope: 'SYNTHETIC_CONTRACT', memoryLimitBytes: 134_217_728, wholeExecutorMemoryLimitBytes: null, hardMemoryLimit: true, tested: true, evidenceRef: 'CORE fixture; not platform proof' }, execute, stop: async () => {} };
}
function fixture(executeRead: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'm12-program-')), store = new Store(dir);
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

describe('M12 non-replaying synthetic host protocol', () => {
  it('registers exactly the three requested default-off flags', () => {
    const flags = registeredCapabilityFlags();
    expect(Object.fromEntries(Object.entries(flags).filter(([key]) => key.startsWith('tools.')))).toMatchObject({
      'tools.jsReadProgramV1': false, 'tools.durableReplayExperimentV1': false, 'tools.pythonKernelV1': false,
    });
  });

  it('persists identity and M02 dispatch before the read and keeps bulk out of snapshots and events', async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture(async () => {
      const nested = f.store.all<{ state: string; invocationId: string }>('nestedCall')[0]!;
      expect(nested.state).toBe('DISPATCHED');
      expect(f.effects.get(nested.invocationId)?.state).toBe('DISPATCHED');
      return { rows: [1, 2, 3], secretBulk: 'private material marker' };
    });
    const executor = syntheticExecutor(async request => {
      const delivery = await request.call('call:0', 'repository_read', {});
      await request.beforeDelivery!('call:0', 1);
      return { total: (delivery.value as { rows: number[] }).rows.reduce((sum, value) => sum + value, 0) };
    });
    const program = await prepare(f.programs, executor);
    const result = await f.programs.run(program.programId, owner, executor);
    expect(result.state).toBe('SUCCEEDED');
    expect(result.aggregate).toEqual({ total: 6 });
    expect(result.sourceRefs).toHaveLength(1);
    const nestedEffect = f.effects.get(`${program.programId}:call:0`)!;
    expect(nestedEffect.parentInvocationId).toBe(`${program.programId}:attempt:1`);
    expect(f.effects.get(nestedEffect.parentInvocationId!)).toMatchObject({ state: 'SUCCEEDED' });
    expect(result.usage.visibleBytes).toBe(Buffer.byteLength(JSON.stringify(result)));
    expect(JSON.stringify(f.store.snapshot())).not.toContain('private material marker');
    expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('private material marker');
    expect(JSON.stringify(f.store.all('toolEffect'))).not.toContain('private material marker');
    const journal = f.store.get<{ committedIssuedCount: number; deliveries: unknown[] }>('programJournal', program.programId)!;
    expect(journal.committedIssuedCount).toBe(1);
    expect(journal.deliveries).toHaveLength(1);
  });

  it.each(['repository_log', 'file_replace_prepare', 'unregistered'])('denies %s before an executor dispatch', async name => {
    let calls = 0;
    const f = fixture(async () => { calls++; return 1; });
    const executor = syntheticExecutor(async request => (await request.call('call:0', name, {})).value);
    const program = await prepare(f.programs, executor);
    const result = await f.programs.run(program.programId, owner, executor);
    expect(result.state).toBe('FAILED');
    expect(calls).toBe(0);
  });

  it('denies account drift after preparation and before any read', async () => {
    let calls = 0;
    const f = fixture(async () => { calls++; return 1; });
    const executor = syntheticExecutor(async request => (await request.call('call:0', 'repository_read', {})).value);
    const program = await prepare(f.programs, executor);
    f.setOwner({ ...owner, accountBinding: 'another' });
    await expect(f.programs.run(program.programId, owner, executor)).rejects.toMatchObject({ code: 'PROGRAM_OWNER_REVOKED' });
    expect(calls).toBe(0);
  });

  it('bounds admitted concurrency and call count before dispatch', async () => {
    let active = 0, maximum = 0, calls = 0;
    const f = fixture(async () => { active++; calls++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return 1; });
    const executor = syntheticExecutor(async request => {
      const values = await Promise.all(Array.from({ length: 64 }, (_, i) => request.call(`call:${i}`, 'repository_read', { i })));
      for (let i = 0; i < values.length; i++) await request.beforeDelivery!(`call:${i}`, 64);
      await request.call('call:64', 'repository_read', {});
      return 0;
    });
    const program = await prepare(f.programs, executor);
    const result = await f.programs.run(program.programId, owner, executor);
    expect(result.state).toBe('FAILED');
    expect(result.error?.code).toBe('CALL_LIMIT');
    expect(calls).toBe(64);
    expect(maximum).toBe(4);
  });

  it.each([undefined, null, false, 0, new Error('ordinary source error')])('retains a rejected source as failed even when its thrown value is %s', async failure => {
    const f = fixture(async () => { throw failure; });
    const executor = syntheticExecutor(async request => {
      await request.call('call:0', 'repository_read', {}).catch(() => {});
      await request.beforeDelivery!('call:0', 1);
      return { summary: 'a caught rejection is still a source failure' };
    });
    const program = await prepare(f.programs, executor);
    const result = await f.programs.run(program.programId, owner, executor);
    expect(result.state).toBe('FAILED');
    expect(result.aggregate).toBeUndefined();
    expect(f.store.get('nestedCall', `${program.programId}:call:0`)).toMatchObject({ state: 'FAILED' });
    expect(f.effects.get(`${program.programId}:call:0`)).toMatchObject({ state: 'FAILED' });
    expect(result.sourceRefs).toHaveLength(1);
    expect(await f.results.read(owner, result.sourceRefs[0]!, { programId: program.programId })).toMatchObject({ status: 'FAILED' });
  });

  it('preserves a source failure even if a script catches it and returns an aggregate', async () => {
    const f = fixture(async () => { throw new Error('original private source failure'); });
    const executor = syntheticExecutor(async request => { await request.call('call:0', 'repository_read', {}).catch(() => {}); return { summary: 'done' }; });
    const program = await prepare(f.programs, executor);
    const result = await f.programs.run(program.programId, owner, executor);
    expect(result.state).toBe('FAILED');
    expect(result.error?.code).toBe('NESTED_TOOL_FAILED');
    expect(result.sourceRefs).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('original private source failure');
  });

  it('rejects oversized visible aggregates and cancellation fences queued reads', async () => {
    const f = fixture(async () => 1);
    const executor = syntheticExecutor(async () => 'x'.repeat(262_145));
    const program = await prepare(f.programs, executor);
    const result = await f.programs.run(program.programId, owner, executor);
    expect(result.error?.code).toBe('OUTPUT_LIMIT');
    const waiting = syntheticExecutor(request => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })));
    const pending = await prepare(f.programs, waiting);
    const run = f.programs.run(pending.programId, owner, waiting);
    await f.programs.cancel(pending.programId, owner);
    expect((await run).state).toBe('CANCELLED');
  });

  it('admits only one owned program at a time so parallel tool envelopes cannot multiply the read budget', async () => {
    const f = fixture(async () => 1);
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const executor = syntheticExecutor(request => { started(); return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })); });
    const another = syntheticExecutor(async () => 1);
    const first = await prepare(f.programs, executor), second = await prepare(f.programs, another);
    const run = f.programs.run(first.programId, owner, executor); await began;
    try { await expect(f.programs.run(second.programId, owner, another)).rejects.toMatchObject({ code: 'PROGRAM_BUSY' }); }
    finally { await f.programs.cancel(first.programId, owner); await run; await f.programs.cancel(second.programId, owner); }
  });

  it('bounds failure envelopes and references after exhausting a small visible budget', async () => {
    const f = fixture(async () => 1);
    const executor = syntheticExecutor(async request => {
      for (let index = 0; index < 64; index++) {
        await request.call(`call:${index}`, 'repository_read', { index });
        await request.beforeDelivery!(`call:${index}`, index + 1);
      }
      await request.call('call:64', 'repository_read', {});
      return null;
    });
    const program = await prepare(f.programs, executor, { limits: { maxOutputBytes: 2048 } });
    const result = await f.programs.run(program.programId, owner, executor);
    expect(result).toMatchObject({ state: 'FAILED', error: { code: 'CALL_LIMIT' } });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(2048);
    expect(result.usage.visibleBytes).toBe(Buffer.byteLength(JSON.stringify(result)));
    expect(result.sourceRefs.length + (result.sourceRefsOmitted ?? 0)).toBe(64);
    expect(f.programs.inspect(program.programId, owner).sourceRefs).toHaveLength(64);
  });

  it.each([{ error: 'explicit source failure' }, { ok: false }, { success: false }])('retains explicitly unsuccessful source outcomes as failures: %j', async value => {
    const f = fixture(async () => value);
    const executor = syntheticExecutor(async request => {
      await request.call('call:0', 'repository_read', {}).catch(() => {});
      await request.beforeDelivery!('call:0', 1);
      return 'claimed success';
    });
    const program = await prepare(f.programs, executor);
    const result = await f.programs.run(program.programId, owner, executor);
    expect(result).toMatchObject({ state: 'FAILED', error: { code: 'NESTED_TOOL_FAILED' } });
    expect(result).not.toHaveProperty('aggregate');
    expect(await f.results.read(owner, result.sourceRefs[0]!, { programId: program.programId })).toMatchObject({ status: 'FAILED' });
  });
});
