import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeAdapter, Thread } from '../packages/contracts/index.ts';
import type { NestedCallV1, ToolProgramV1 } from '../packages/contracts/tool-program.ts';
import type { ToolEffectRecord, ToolOwner } from '../packages/contracts/tool-effects.ts';
import { Service } from '../packages/core/service.ts';
import { ToolAuthority, buildToolRegistry } from '../packages/core/tool-authority.ts';
import { PrivateToolResults } from '../packages/core/tool-results.ts';
import { Store } from '../packages/storage/store.ts';
import * as domain from '../packages/capabilities/index.ts';
import { REPLAY_OWNER, m12Ledger, m12EffectAuthenticator, type CrashPoint, type ReplayFixtureState } from './fixtures/tool-program-replay-harness-v3.ts';
import { assertCrashDeath } from './fixtures/tool-program-crash-death-v3.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
  finally { vi.restoreAllMocks(); }
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'm12-service-recovery-'));
  cleanups.push(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
async function killAt(path: string, point: CrashPoint) {
  const filename = fileURLToPath(new URL('./fixtures/tool-program-crash-v3.mts', import.meta.url));
  return await new Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', filename, path, point], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const capture = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-16 * 1024); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Crash fixture timed out at ${point}: ${output}`)); }, 60_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, output }); });
  });
}
async function crashed(point: CrashPoint) {
  const path = directory(), exit = await killAt(path, point);
  assertCrashDeath(exit);
  const store = new Store(path);
  cleanups.push(() => store.close());
  const state = store.get<ReplayFixtureState>('m12ReplayFixture', 'fixture')!;
  expect(state).toMatchObject({ owner: REPLAY_OWNER, killedAt: point });
  const programId = state.programId!;
  const thread: Thread = {
    id: REPLAY_OWNER.threadId, title: 'M12 retained recovery', projectName: null,
    status: 'working', epoch: REPLAY_OWNER.epoch, runId: REPLAY_OWNER.runId,
    accountId: REPLAY_OWNER.accountBinding, projectId: REPLAY_OWNER.projectId!, workspaceId: REPLAY_OWNER.workspaceId!,
    modelId: null, sessionPath: null, createdAt: '', updatedAt: '',
  };
  store.internal('m12.recovery.fixture.thread', thread.id, () => { store.put('thread', thread.id, thread.id, thread); });
  const authority = new ToolAuthority(buildToolRegistry()), effects = m12Ledger(store, authority);
  const unrelated = effects.admit({
    call: { name: 'repository_read', args: { invocationId: 'unrelated-m02-read' } },
    owner: REPLAY_OWNER, definition: authority.require('repository_read'),
  });
  // Matching program prefixes and parent IDs are insufficient without a bound
  // NestedCall identity. This remains an unrelated M02 receipt.
  const unlinked = effects.admit({
    call: { name: 'repository_read', args: { invocationId: `${programId}:call:63` } },
    owner: REPLAY_OWNER, definition: authority.require('repository_read'), parentInvocationId: `${programId}:attempt:1`,
  });
  const runtime: RuntimeAdapter = {
    configure: vi.fn(), models: vi.fn(async () => []), start: vi.fn(async () => {}), followUp: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}), compact: vi.fn(async () => {}), history: vi.fn(async () => []), dispose: vi.fn(async () => {}),
  };
  const executeRead = vi.spyOn(domain, 'handleDomainTool').mockRejectedValue(new Error('Recovery must not execute a tool'));
  // No M12 program flag overrides and no program executor: exercise actual
  // default-off program startup. The reopened store holds audit-mode receipts,
  // so the Service keeps the producing deployment's effect flag and key custody.
  const service = new Service(store, runtime, {
    toolEffectFlags: { 'audit.effectsV1': true },
    toolEffectAuthenticator: m12EffectAuthenticator(),
  });
  cleanups.push(() => service.dispose());
  return { store, service, runtime, executeRead, state, programId, unrelated, unlinked };
}
function retainedRefs(store: Store, programId: string): string[] {
  const program = store.get<ToolProgramV1>('toolProgram', programId)!;
  const calls = store.all<NestedCallV1>('nestedCall').filter(call => call.parentProgramId === programId);
  return [...(program.resultRef ? [program.resultRef] : []), ...calls.flatMap(call => call.resultRef ? [call.resultRef] : [])];
}
function expectNoExecution(f: Awaited<ReturnType<typeof crashed>>) {
  expect(f.store.get<ReplayFixtureState>('m12ReplayFixture', 'fixture')!.reads).toBe(f.state.reads);
  expect(f.runtime.start).not.toHaveBeenCalled();
  expect(f.runtime.followUp).not.toHaveBeenCalled();
  expect(f.runtime.compact).not.toHaveBeenCalled();
  expect(f.executeRead).not.toHaveBeenCalled();
  expect(f.service.programToolMetadata()).toEqual([]);
  expect(f.service.toolProgramView(REPLAY_OWNER.threadId).available).toEqual({ javascript: false, python: false, replay: false });
  // Open M02 receipts without M12 linkage are reconciled by the generic effect
  // recovery like any other interrupted dispatch: retained, never executed and
  // rolled back to UNKNOWN_EXTERNAL_OUTCOME — never a committed state.
  for (const prior of [f.unrelated, f.unlinked]) {
    expect(f.store.get<ToolEffectRecord>('toolEffect', prior.invocationId)).toMatchObject({
      invocationId: prior.invocationId, toolId: prior.toolId, owner: prior.owner,
      privateArgumentCommitment: prior.privateArgumentCommitment, parentInvocationId: prior.parentInvocationId,
      state: 'UNKNOWN_EXTERNAL_OUTCOME',
    });
  }
  for (const value of [f.store.snapshot(), f.store.eventsAfter(0), f.store.all('toolEffect'), f.service.toolProgramView(REPLAY_OWNER.threadId)]) {
    expect(JSON.stringify(value)).not.toContain('M12_REPLAY_PRIVATE_SOURCE');
    expect(JSON.stringify(value)).not.toContain('M12_RECOVERY_PRIVATE_FAILURE');
  }
}

describe('M12 default-off Service recovery after real process death', () => {
  it.each(['call.effect_committed', 'call.read_returned', 'call.result_committed', 'program.result_committed'] as const)(
    'reconciles only M12 receipts after %s without execution or inference', async point => {
      const f = await crashed(point);
      const privateBefore = f.store.all('privateToolResult'), refsBefore = retainedRefs(f.store, f.programId);
      const attemptsBefore = f.store.get('toolProgramPrivate', f.programId);
      const journalBefore = f.store.get('programJournal', f.programId);
      await f.service.recover();
      const program = f.store.get<ToolProgramV1>('toolProgram', f.programId)!;
      const call = f.store.get<NestedCallV1>('nestedCall', `${f.programId}:call:0`)!;
      const nested = f.store.get<ToolEffectRecord>('toolEffect', call.invocationId)!;
      const parent = f.store.get<ToolEffectRecord>('toolEffect', `${f.programId}:attempt:1`)!;
      const committed = point === 'call.result_committed' || point === 'program.result_committed';
      expect(program.state).toBe(point === 'program.result_committed' ? 'SUCCEEDED' : 'UNKNOWN');
      expect(call.state).toBe(committed ? 'SUCCEEDED' : 'UNKNOWN');
      expect(nested.state).toBe(committed ? 'SUCCEEDED' : 'UNKNOWN_EXTERNAL_OUTCOME');
      expect(parent.state).toBe(point === 'program.result_committed' ? 'SUCCEEDED' : 'UNKNOWN_EXTERNAL_OUTCOME');
      if (committed) expect(nested.outcome?.value).toEqual({ resultRef: call.resultRef });
      if (point === 'call.result_committed') expect(nested.providerReceiptRef).toBe(call.resultRef);
      if (point === 'program.result_committed') expect(parent.providerReceiptRef).toBe(program.resultRef);
      expect(retainedRefs(f.store, f.programId)).toEqual(refsBefore);
      expect(f.store.all('privateToolResult')).toEqual(privateBefore);
      expect(f.store.get('toolProgramPrivate', f.programId)).toEqual(attemptsBefore);
      expect(f.store.get('programJournal', f.programId)).toEqual(journalBefore);
      expect(f.service.thread(REPLAY_OWNER.threadId)).toMatchObject({ epoch: REPLAY_OWNER.epoch + 1, runId: null, status: 'interrupted' });
      for (const ref of refsBefore) {
        const page = await f.service.toolProgramResultRange(REPLAY_OWNER.threadId, f.programId, ref, { offset: 0, limit: 16384 });
        expect(page.status).toBe('SUCCEEDED');
        expect(JSON.parse(page.text)).toMatchObject({ total: 7 });
      }
      expectNoExecution(f);
      const settledEffects = f.store.all('toolEffect'), settledCalls = f.store.all('nestedCall');
      await f.service.recover();
      expect(f.store.all('toolEffect')).toEqual(settledEffects);
      expect(f.store.all('nestedCall')).toEqual(settledCalls);
      expectNoExecution(f);
    }, 15_000,
  );

  it('settles a committed failed source receipt without exposing its retained private error', async () => {
    const f = await crashed('call.result_committed');
    const call = f.store.get<NestedCallV1>('nestedCall', `${f.programId}:call:0`)!;
    const results = new PrivateToolResults(f.store, { currentOwner: () => REPLAY_OWNER });
    // Inject the alternative FAILED transaction at the same proven crash gap.
    // The original crash came from a real successful read; no second read runs.
    const prepared = results.prepare({ owner: REPLAY_OWNER, programId: f.programId, invocationId: call.invocationId,
      status: 'FAILED', error: { code: 'SOURCE_FAILED', message: 'M12_RECOVERY_PRIVATE_FAILURE' }, grants: [] });
    f.store.internal('m12.recovery.fixture.failed-receipt', REPLAY_OWNER.threadId, () => {
      const resultRef = results.put(prepared);
      f.store.put('nestedCall', call.invocationId, REPLAY_OWNER.threadId, { ...call, state: 'FAILED', resultRef,
        error: { code: 'NESTED_TOOL_FAILED', message: 'Nested tool failed; inspect its retained source handle', originalResultRef: resultRef } });
      return { resultRef, state: 'FAILED' };
    });
    const privateBefore = f.store.all('privateToolResult');
    await f.service.recover();
    expect(f.store.get<ToolEffectRecord>('toolEffect', call.invocationId)).toMatchObject({
      state: 'FAILED', providerReceiptRef: prepared.resultRef, outcome: { value: { resultRef: prepared.resultRef } },
    });
    expect(f.store.get<NestedCallV1>('nestedCall', call.invocationId)).toMatchObject({ state: 'FAILED', resultRef: prepared.resultRef });
    expect(f.store.all('privateToolResult')).toEqual(privateBefore);
    const page = await f.service.toolProgramResultRange(REPLAY_OWNER.threadId, f.programId, prepared.resultRef, { offset: 0, limit: 16384 });
    expect(page.status).toBe('FAILED');
    expect(JSON.parse(page.text)).toMatchObject({ message: 'M12_RECOVERY_PRIVATE_FAILURE' });
    expectNoExecution(f);
  }, 15_000);

  it('does not attribute the latest terminal result to an earlier unfinished parent attempt', async () => {
    const f = await crashed('program.result_committed');
    const first = f.store.get<ToolEffectRecord>('toolEffect', `${f.programId}:attempt:1`)!;
    f.store.internal('m12.recovery.fixture.later-attempt', REPLAY_OWNER.threadId, () => {
      const privateProgram = f.store.get<{ attempts: number }>('toolProgramPrivate', f.programId)!;
      f.store.put('toolProgramPrivate', f.programId, REPLAY_OWNER.threadId, { ...privateProgram, attempts: 2 });
      f.store.put('toolEffect', `${f.programId}:attempt:2`, REPLAY_OWNER.threadId,
        { ...first, invocationId: `${f.programId}:attempt:2`, effectId: 'later-m12-attempt' });
    });
    await f.service.recover();
    expect(f.store.get<ToolEffectRecord>('toolEffect', first.invocationId)?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
    expect(f.store.get<ToolEffectRecord>('toolEffect', `${f.programId}:attempt:2`)).toMatchObject({
      state: 'SUCCEEDED', providerReceiptRef: f.store.get<ToolProgramV1>('toolProgram', f.programId)!.resultRef,
    });
    expectNoExecution(f);
  }, 15_000);

  it('keeps a nested outcome unknown when its retained private receipt fails integrity', async () => {
    const f = await crashed('call.result_committed');
    const call = f.store.get<NestedCallV1>('nestedCall', `${f.programId}:call:0`)!;
    const ref = call.resultRef!;
    f.store.internal('m12.recovery.fixture.corrupt-private', REPLAY_OWNER.threadId, () => {
      const record = f.store.get<Record<string, unknown>>('privateToolResult', ref)!;
      f.store.put('privateToolResult', ref, REPLAY_OWNER.threadId, { ...record, base64: Buffer.from('changed private result').toString('base64') });
    });
    await f.service.recover();
    expect(f.store.get<NestedCallV1>('nestedCall', call.invocationId)).toMatchObject({ state: 'UNKNOWN', resultRef: ref });
    expect(f.store.get<ToolEffectRecord>('toolEffect', call.invocationId)?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
    expect(retainedRefs(f.store, f.programId)).toContain(ref);
    await expect(f.service.toolProgramResultRange(REPLAY_OWNER.threadId, f.programId, ref, { offset: 0, limit: 16384 }))
      .rejects.toMatchObject({ code: 'RESULT_INTEGRITY' });
    expectNoExecution(f);
  }, 15_000);
});

function privateFixture() {
  const store = new Store(directory());
  cleanups.push(() => store.close());
  let current: ToolOwner = { ...REPLAY_OWNER };
  const currentOwner = vi.fn(() => current);
  return { store, currentOwner, setCurrent: (owner: ToolOwner) => { current = owner; }, results: new PrivateToolResults(store, { currentOwner }) };
}

describe('M12 host-only receipt metadata for recovery', () => {
  it('verifies historical success and failure without exposing payloads or renewing owner/input authority', async () => {
    const f = privateFixture();
    const success = await f.results.save({ owner: REPLAY_OWNER, programId: 'program', invocationId: 'call', status: 'SUCCEEDED', value: { secret: 'PRIVATE_SUCCESS' }, grants: [] });
    const failure = await f.results.save({ owner: REPLAY_OWNER, programId: 'program', invocationId: 'failed-call', status: 'FAILED', error: { code: 'SOURCE_FAILED', message: 'PRIVATE_FAILURE' }, grants: [] });
    const before = f.store.sequence;
    f.setCurrent({ ...REPLAY_OWNER, epoch: REPLAY_OWNER.epoch + 1 });
    f.currentOwner.mockClear();
    for (const [ref, invocationId, status] of [[success, 'call', 'SUCCEEDED'], [failure, 'failed-call', 'FAILED']] as const) {
      const metadata = f.results.recoveryMetadata(REPLAY_OWNER, ref, { programId: 'program', invocationId });
      expect(metadata).toMatchObject({ resultRef: ref, status, revision: 1 });
      expect(Object.keys(metadata).sort()).toEqual(['bytes', 'contentType', 'resultRef', 'revision', 'sha256', 'status']);
      expect(JSON.stringify(metadata)).not.toContain('PRIVATE_');
    }
    expect(f.currentOwner).not.toHaveBeenCalled();
    expect(f.store.sequence).toBe(before);
    expect(f.store.all('privateToolResultAccess')).toEqual([]);
    await expect(f.results.read(REPLAY_OWNER, success, { programId: 'program' })).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
    await expect(f.results.authorizeInput(REPLAY_OWNER, success, 'new-program')).rejects.toMatchObject({ code: 'RESULT_ACCESS_DENIED' });
  });

  it.each(['threadId', 'runId', 'epoch', 'projectId', 'workspaceId', 'accountBinding'] as const)('rejects a recovery metadata %s binding mismatch', async field => {
    const f = privateFixture();
    const ref = await f.results.save({ owner: REPLAY_OWNER, programId: 'program', invocationId: 'call', status: 'SUCCEEDED', value: 7, grants: [] });
    const changed = { ...REPLAY_OWNER, [field]: field === 'epoch' ? 99 : 'foreign-owner' };
    expect(() => f.results.recoveryMetadata(changed, ref, { programId: 'program', invocationId: 'call' })).toThrowError(expect.objectContaining({ code: 'RESULT_ACCESS_DENIED' }));
  });

  it('requires the exact program and invocation, including an absent invocation for aggregate receipts', async () => {
    const f = privateFixture();
    const nested = await f.results.save({ owner: REPLAY_OWNER, programId: 'program', invocationId: 'call', status: 'SUCCEEDED', value: 7, grants: [] });
    const aggregate = await f.results.save({ owner: REPLAY_OWNER, programId: 'program', status: 'SUCCEEDED', value: { total: 7 }, grants: [] });
    expect(() => f.results.recoveryMetadata(REPLAY_OWNER, nested, { programId: 'different-program', invocationId: 'call' })).toThrowError(expect.objectContaining({ code: 'RESULT_ACCESS_DENIED' }));
    expect(() => f.results.recoveryMetadata(REPLAY_OWNER, nested, { programId: 'program', invocationId: 'other-call' })).toThrowError(expect.objectContaining({ code: 'RESULT_ACCESS_DENIED' }));
    expect(() => f.results.recoveryMetadata(REPLAY_OWNER, nested, { programId: 'program' })).toThrowError(expect.objectContaining({ code: 'RESULT_ACCESS_DENIED' }));
    expect(() => f.results.recoveryMetadata(REPLAY_OWNER, aggregate, { programId: 'program', invocationId: 'call' })).toThrowError(expect.objectContaining({ code: 'RESULT_ACCESS_DENIED' }));
    expect(f.results.recoveryMetadata(REPLAY_OWNER, aggregate, { programId: 'program' })).toMatchObject({ status: 'SUCCEEDED' });
  });
});
